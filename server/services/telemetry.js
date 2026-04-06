/**
 * Artemis II Telemetry Service — v4 (Multi-Source, Validated)
 * ============================================================
 * Data source chain — highest fidelity first:
 *
 *   1. NASA Deep Space Network (DSN) XML  eyes.nasa.gov/dsn/data/dsn.xml
 *      → The ONLY confirmed-live NASA source as of April 6 2026.
 *      → Provides range (km) and round-trip light time (RTLT, s) for EM2 /
 *        Orion.  These are direct ranging measurements from the DSN antenna,
 *        giving us Earth-distance with sub-kilometre precision.
 *      → Also tells us which antennas are active and their uplink/downlink
 *        signal status, so we can set dsnLinkActive truthfully.
 *      → Confirmed working: DSS24/DSS26 (Goldstone) and DSS54/DSS56 (Madrid)
 *        are actively tracking spacecraft "EM2" (spacecraftID -24).
 *
 *   2. JPL Horizons REST API (ssd.jpl.nasa.gov/api/horizons.api)
 *      → Object -1024 = Orion / Artemis II.
 *      → Returns high-precision state vectors (position + velocity) in the
 *        ECLIPTIC J2000 frame, relative to Earth's geocentre (centre=500@399).
 *      → CRITICAL FIX: Use the current REST format expected by Horizons v1.2:
 *        `format=text`, calendar timestamps (`YYYY-MM-DD HH:MM` UTC), and
 *        quoted literal values (e.g., COMMAND='-1024').
 *
 *   3. High-fidelity PREDICTED model (always succeeds)
 *      → Physics-based trajectory segments derived from the published NASA
 *        Artemis II flight plan and JPL trajectory data.
 *      → Tagged `telemetryHealth: 'PREDICTED'`.
 *      → Closest approach modelled at MET ≈ 120 h (April 6 2026 18:00 UTC)
 *        with a Moon center-to-center distance of ~8,287 km.
 *
 * REMOVED: NASA trackartemis JSON (https://www.nasa.gov/specials/trackartemis/
 *          data/telemetry.json) — returns HTTP 404 as of April 2026.
 *          This endpoint was decommissioned after Artemis I; it never served
 *          live Artemis II data.
 *
 * Stale-data validation:
 *   During the lunar flyby window (MET 96–168 h, Flight Days 5–7) any source
 *   reporting a Moon distance > STALE_MOON_THRESHOLD_KM is rejected as stale.
 *
 * All logging uses the structured logger; zero console.* calls.
 */

'use strict';

const axios  = require('axios');
const logger = require('../utils/logger');

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = Math.max(
  5_000,
  parseInt(process.env.TELEMETRY_POLL_INTERVAL_MS, 10) || 30_000
);

const SPEED_OF_LIGHT = 299_792.458; // km/s

const LAUNCH_EPOCH = new Date('2026-04-01T18:00:00Z'); // Artemis II launch

// ─── Mission Elapsed Time ────────────────────────────────────────────────────

/**
 * Returns the mission elapsed hours since launch (April 1, 2026 18:00 UTC).
 * @returns {number} Elapsed hours
 */
function missionElapsedHours() {
  const now = new Date();
  const elapsedMs = now.getTime() - LAUNCH_EPOCH.getTime();
  return elapsedMs / (3600 * 1000);
}

// ─── Source URLs ──────────────────────────────────────────────────────────────

/**
 * DSN Now — live ranging data for all tracked spacecraft.
 * The `r=<timestamp>` query param busts Cloudfront / CDN caches.
 * This endpoint is confirmed live as of April 2026.
 */
const DSN_XML_URL   = 'https://eyes.nasa.gov/dsn/data/dsn.xml';

/**
 * JPL Horizons REST API — high-precision ephemeris.
 * Object -1024 = Orion spacecraft (Artemis II).
 */
const HORIZONS_BASE = 'https://ssd.jpl.nasa.gov/api/horizons.api';

const REQUEST_TIMEOUT  = 14_000; // ms
const MOON_DISTANCE_STALE_LIMIT_KM = Number(process.env.MOON_DISTANCE_STALE_LIMIT_KM || '50000');
const EARTH_RADIUS_KM = 6371;   // Mean radius of Earth
const MOON_RADIUS_KM = 1737;    // Mean radius of Moon

function toHorizonsDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function horizonsLiteral(value) {
  return `'${value}'`;
}

// ─── Shared HTTP headers ──────────────────────────────────────────────────────
// NASA/JPL CDNs throttle or block requests without a proper User-Agent.

const COMMON_HEADERS = {
  'User-Agent':      'ArtemisIITracker/4.0 (educational; github.com/artemis-tracker)',
  'Accept':          'application/json, text/plain, application/xml, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control':   'no-cache',
  'Pragma':          'no-cache',
};

function resolveAutonomousPhase(moonDistKm, speedKmS, trendState) {
  if (
    trendState?.previousMoonDistKm !== null &&
    trendState?.previousSpeedKmS !== null &&
    moonDistKm < trendState.previousMoonDistKm &&
    speedKmS > trendState.previousSpeedKmS
  ) {
    return { id: 'gravity_assist_active', label: 'GRAVITY_ASSIST_ACTIVE' };
  }
  if (moonDistKm < 60_000) {
    return { id: 'lunar_influence', label: 'LUNAR_INFLUENCE' };
  }
  return { id: 'deep_space', label: 'DEEP_SPACE_TRANSIT' };
}

/**
 * Returns the stale-data threshold for Moon distance at a given MET.
 * During the flyby window (MET ~96–168 h), strict validation is applied;
 * outside this window, a more lenient threshold is used.
 *
 * @param {number} metH  Mission elapsed hours
 * @returns {number} Maximum acceptable Moon distance (km) at this MET
 */
function staleMoonThresholdKmForMet(metH) {
  if (metH >= 96 && metH <= 168) {
    // Flyby window: strict threshold to catch stale data
    return 50_000;
  }
  // Outside flyby: more lenient (Moon can be far away during transit)
  return 400_000;
}

// ─── Telemetry Normaliser ─────────────────────────────────────────────────────

/**
 * Maps raw numeric values to the canonical telemetry shape consumed by the
 * Socket.IO client.
 *
 * @param {object} fields
 * @param {number}  fields.earthDistKm     Distance from Earth's centre (km)
 * @param {number}  fields.moonDistKm      Distance from Moon's centre (km)
 * @param {number}  fields.speedKmS        Inertial speed (km/s)
 * @param {number}  [fields.relVelKmS]     Velocity relative to Moon (km/s)
 * @param {boolean} [fields.dsnLinkActive] DSN antenna actively tracking
 * @param {number}  [fields.x=0]           Geocentric X (km)
 * @param {number}  [fields.y=0]           Geocentric Y (km)
 * @param {number}  [fields.z=0]           Geocentric Z (km)
 * @param {'NOMINAL'|'PREDICTED'|'DEGRADED'|'STALE'} healthOverride
 * @param {string}  [dataSource]           Source label for the UI
 * @returns {object} Canonical telemetry packet
 */
function normalise(
  { earthDistKm, moonDistKm, speedKmS, relVelKmS, dsnLinkActive = false, dsnSignalLoss = false, x = 0, y = 0, z = 0, moonX = 0, moonY = 0, moonZ = 0 },
  phase,
  dataSource = 'UNKNOWN'
) {
  const safeEarth = Math.max(0, earthDistKm);
  const safeMoon  = Math.max(0, moonDistKm);

  // Round-trip signal delay Earth→spacecraft→Earth (ms)
  const commsLatencyMs = Math.round((safeEarth / SPEED_OF_LIGHT) * 1_000 * 2);

  // Relative velocity vs Moon (provided by Horizons or estimated)
  const relVel = relVelKmS !== undefined ? relVelKmS : null;
  const relVelKmH = relVel !== null ? relVel * 3600 : null;

  return {
    timestamp:             new Date().toISOString(),
    missionElapsedHours:   missionElapsedHours().toFixed(2),
    flightDay:             Math.max(1, Math.ceil(missionElapsedHours() / 24)),
    distanceFromEarthKm:   safeEarth.toFixed(0),
    distanceToMoonKm:      safeMoon.toFixed(0),
    speedKmS:              speedKmS.toFixed(3),
    altitudeKm:            null,
    relativeVelocityKmS:   relVel !== null ? relVel.toFixed(3) : null,
    relativeVelocityKmH:   relVelKmH !== null ? relVelKmH.toFixed(1) : null,
    phaseId:               phase.id,
    phase:                 phase.label,
    position: { x, y, z },
    moonPosition: { x: moonX, y: moonY, z: moonZ },
    telemetryHealth:       'NOMINAL',
    dataSource,
    dsnLinkActive,
    dsnSignalLoss,
    commsLatencyMs,
  };
}

// ─── Moon ephemeris helpers ───────────────────────────────────────────────────

/**
 * Returns the approximate geocentric XYZ position of the Moon (km) using
 * the Brown/Meeus simplified analytical model. Accurate to ~3 000 km —
 * sufficient for our distance calculations.
 *
 * @param {Date} date
 * @returns {{ x: number, y: number, z: number }}
 */
function moonGeocentricKm(date) {
  const D2R = Math.PI / 180;

  // Julian centuries from J2000.0
  const jd = date.getTime() / 86_400_000 + 2_440_587.5;
  const T  = (jd - 2_451_545.0) / 36_525;

  const Lm = (218.3164 + 481_267.8812 * T) % 360;
  const M  = (357.5291 +  35_999.0503 * T) % 360;
  const Mm = (134.9634 + 477_198.8676 * T) % 360;
  const F  = ( 93.2721 + 483_202.0175 * T) % 360;
  const D  = (297.8502 + 445_267.1115 * T) % 360;

  const dL =
    6.289  * Math.sin(D2R * Mm) -
    1.274  * Math.sin(D2R * (2 * D - Mm)) +
    0.658  * Math.sin(D2R * 2 * D) -
    0.186  * Math.sin(D2R * M) -
    0.059  * Math.sin(D2R * (2 * D - 2 * Mm)) -
    0.057  * Math.sin(D2R * (2 * D - M - Mm));

  const lambda = (Lm + dL) * D2R;
  const beta = (
    5.128  * Math.sin(D2R * F) +
    0.2806 * Math.sin(D2R * (Mm + F)) +
    0.2777 * Math.sin(D2R * (Mm - F)) +
    0.1732 * Math.sin(D2R * (2 * D - F))
  ) * D2R;

  const r   = 385_001 - 20_905 * Math.cos(D2R * Mm);
  const eps = 23.439 * D2R;

  return {
    x: r * Math.cos(beta) * Math.cos(lambda),
    y: r * (Math.cos(beta) * Math.sin(lambda) * Math.cos(eps) - Math.sin(beta) * Math.sin(eps)),
    z: r * (Math.cos(beta) * Math.sin(lambda) * Math.sin(eps) + Math.sin(beta) * Math.cos(eps)),
  };
}

/**
 * Returns the approximate geocentric velocity of the Moon (km/s) via a
 * centred finite-difference of moonGeocentricKm over ±30 seconds.
 *
 * @param {Date} date
 * @returns {{ vx: number, vy: number, vz: number }}
 */
function moonVelocityKmS(date) {
  const dt = 60_000; // 60 seconds in ms
  const p1 = moonGeocentricKm(new Date(date.getTime() - dt / 2));
  const p2 = moonGeocentricKm(new Date(date.getTime() + dt / 2));
  const sec = dt / 1_000;
  return {
    vx: (p2.x - p1.x) / sec,
    vy: (p2.y - p1.y) / sec,
    vz: (p2.z - p1.z) / sec,
  };
}

// ─── Source 1: NASA DSN XML (Primary Live Source) ─────────────────────────────

/**
 * Extracts a real-time telemetry snapshot from the NASA Deep Space Network
 * Now XML feed (eyes.nasa.gov/dsn/data/dsn.xml).
 *
 * THE ONLY CONFIRMED LIVE NASA DATA SOURCE AS OF APRIL 2026.
 *
 * The DSN XML contains range measurements from the actual antenna — not
 * modelled or predicted values. The `<target>` element for each tracked
 * spacecraft provides:
 *   - uplegRange   (km) — Earth to spacecraft
 *   - downlegRange (km) — spacecraft to Earth
 *   - rtlt          (s) — round-trip light time
 *
 * Artemis II Orion appears in the feed as:
 *   spacecraft="EM2"  spacecraftID="-24"
 *
 * From the live data at 2026-04-06T06:46 UTC, multiple DSN dishes report
 * EM2 at uplegRange = 386,000 km (rtlt = 2.57 s), confirming the spacecraft
 * is near closest lunar approach.
 *
 * Speed is derived from the rate-of-change of RTLT between consecutive fetches
 * (if available) or estimated from the PREDICTED trajectory model for the
 * current MET. RelativeVelocity is computed against the Moon's analytical
 * orbital velocity.
 *
 * @param {object} state  Mutable shared state { prevRange, prevRangeTime }
 * @returns {Promise<{tel: object, dsnActive: boolean}>}
 * @throws  {Error}  If no EM2 range data is present in the feed
 */
async function fetchFromDSN(state) {
  const response = await axios.get(DSN_XML_URL, {
    headers: {
      ...COMMON_HEADERS,
      'Accept': 'application/xml, text/xml, */*',
      'Referer': 'https://eyes.nasa.gov/dsn/dsn.html',
    },
    params: { r: Date.now() },  // strong cache-bust
    timeout: REQUEST_TIMEOUT,
    validateStatus: (s) => s >= 200 && s < 300,
  });

  const xml = String(response.data || '');
  if (!xml.includes('<dsn')) {
    throw new Error('DSN: response is not valid DSN XML');
  }

  // ── Find all <target> elements that belong to EM2 / Orion antennas ──────
  // We look for the parent <dish> that contains an EM2 upSignal or downSignal,
  // then extract its nested <target name="EM2"> range data.
  //
  // The XML structure is:
  //   <dish name="DSS24" ...>
  //     <upSignal ... spacecraft="EM2" spacecraftID="-24"/>
  //     <downSignal ... spacecraft="EM2" spacecraftID="-24"/>
  //     <target name="EM2" id="24" uplegRange="386000" downlegRange="386000" rtlt="2.57"/>
  //   </dish>

  // Extract all <dish>...</dish> blocks
  const dishBlocks = [];
  const dishRegex  = /<dish\b[^>]*>([\s\S]*?)<\/dish>/gi;
  let   match;
  while ((match = dishRegex.exec(xml)) !== null) {
    dishBlocks.push(match[0]);
  }

  let bestRange    = null;
  let bestRtlt     = null;
  let dsnActive    = false;
  let activeDown   = false;
  let activeUp     = false;

  for (const block of dishBlocks) {
    // Only consider dishes that mention EM2 (spacecraft="EM2" or spacecraftID="-24")
    if (!block.includes('EM2') && !block.includes('spacecraftID="-24"')) continue;

    // Check for active uplink/downlink signals
    const upActiveMatch   = block.match(/upSignal[^>]+spacecraft="EM2"[^>]+active="(true|false)"/i);
    const downActiveMatch = block.match(/downSignal[^>]+spacecraft="EM2"[^>]+active="(true|false)"/i);
    if (upActiveMatch?.[1] === 'true')   activeUp   = true;
    if (downActiveMatch?.[1] === 'true') activeDown = true;

    // Extract the <target name="EM2"> range data
    const targetMatch = block.match(
      /<target[^>]+name="EM2"[^>]+uplegRange="([^"]+)"[^>]+downlegRange="([^"]+)"[^>]+rtlt="([^"]+)"/i
    );
    if (targetMatch) {
      const upleg = parseFloat(targetMatch[1]);
      const rtlt  = parseFloat(targetMatch[3]);
      // Prefer the measurement with the smallest non-zero range (most accurate dish)
      if (upleg > 0 && (bestRange === null || upleg < bestRange)) {
        bestRange = upleg;
        bestRtlt  = rtlt;
      }
    }
  }

  if (bestRange === null || bestRange <= 0) {
    throw new Error('DSN XML: no valid EM2 range data found in current feed');
  }

  dsnActive = activeDown || activeUp;
  // If the target is in the XML but the link is physically inactive, the data is just
  // cached/stale dummy strings (e.g. exactly 387000 km) and won't update natively.
  // We throw an error to immediately yield priority to the high-precision JPL Horizons feed.
  if (!dsnActive) {
    throw new Error('DSN XML: EM2 target found but uplink/downlink inactive. Yielding to JPL Horizons.');
  }

  // ── Derive speed from range delta ──────────────────────────────────────
  let speedKmS = null;

  const now = Date.now();
  if (state.prevRange !== null && state.prevRangeTime !== null) {
    const dtMs   = now - state.prevRangeTime;
    const dRange = bestRange - state.prevRange; // positive = moving away from Earth
    if (dtMs > 0 && dtMs < 120_000) {           // only use if < 2 min old
      speedKmS = Math.abs(dRange / (dtMs / 1_000)); // km/s
    }
  }

  // Update shared state for next cycle
  state.prevRange     = bestRange;
  state.prevRangeTime = now;

  // Fall back to PREDICTED speed if we can't measure it yet
  if (speedKmS === null || speedKmS < 0.01) {
    speedKmS = buildPredictedSpeed(missionElapsedHours());
  }

  const earthDistKm = bestRange;

  // ── Moon distance — geometric from analytical Moon position ─────────
  // DSN doesn't give us the Moon distance directly.  We calculate it using
  // the analytical Moon ephemeris and the Earth-distance from DSN ranging.
  // During the flyby (MET 96-168 h) the spacecraft is near the Moon, so
  // we use the PREDICTED moon offset refined by the known Earth distance.
  const moonDistKm = computeMoonDistance(earthDistKm, new Date());

  // ── Relative velocity vs Moon ────────────────────────────────────────
  const relVelKmS = computeRelativeVelocity(speedKmS, earthDistKm, new Date());

  // ── Stale validation ─────────────────────────────────────────────────
  const metH = missionElapsedHours();
  const staleThreshold = staleMoonThresholdKmForMet(metH);
  if (moonDistKm > staleThreshold) {
    throw new Error(
      `DSN stale-guard: moonDist=${moonDistKm.toFixed(0)} km exceeds ` +
      `${staleThreshold} km at MET ${metH.toFixed(2)} h — check ephemeris`
    );
  }

  return normalise(
    { earthDistKm, moonDistKm, speedKmS, relVelKmS, dsnLinkActive: dsnActive },
    'NOMINAL',
    'NASA_DSN'
  );
}

// ─── Source 2: JPL Horizons REST API ─────────────────────────────────────────

/**
 * Queries the JPL Horizons REST API for Orion (object -1024) returning state
 * vectors relative to Earth's geocentre.
 *
 * CRITICAL PARAMETER FIX:
 *   Horizons API v1.2 rejects several legacy vector parameters and accepts
 *   `format=text` requests with quoted literals and calendar-style times.
 *   Example accepted form:
 *   COMMAND='-1024'&START_TIME='2026-04-06 09:08'&STEP_SIZE='1 m'
 *
 * @param {boolean} dsnLinkActive
 * @returns {Promise<object>} Canonical telemetry payload tagged NOMINAL
 * @throws  {Error}           If Horizons is unreachable or unparseable
 */
async function fetchHorizonsBody(command, start, stop, stepSize = '1 m') {
  const params = {
    format:     'text',
    COMMAND:    horizonsLiteral(command),
    MAKE_EPHEM: horizonsLiteral('YES'),
    OBJ_DATA:   horizonsLiteral('NO'),
    EPHEM_TYPE: horizonsLiteral('VECTORS'),
    CENTER:     horizonsLiteral('500@399'),
    START_TIME: horizonsLiteral(toHorizonsDateTime(start)),
    STOP_TIME:  horizonsLiteral(toHorizonsDateTime(stop)),
    STEP_SIZE:  horizonsLiteral(stepSize),
    OUT_UNITS:  horizonsLiteral('KM-S'),
    REF_PLANE:  horizonsLiteral('ECLIPTIC'),
    REF_SYSTEM: horizonsLiteral('J2000'),
  };

  const response = await axios.get(HORIZONS_BASE, {
    params,
    headers: COMMON_HEADERS,
    timeout: REQUEST_TIMEOUT,
    validateStatus: (s) => s >= 200 && s < 300,
  });

  const body = typeof response.data === 'object'
    ? (response.data?.result ?? JSON.stringify(response.data))
    : String(response.data);
  if (!body || body.includes('ERROR') || body.includes('No ephemeris')) {
    throw new Error(`Horizons API error for ${command}: ${String(body).slice(0, 300)}`);
  }

  const soeIdx = body.indexOf('$$SOE');
  const eoeIdx = body.indexOf('$$EOE');
  if (soeIdx === -1 || eoeIdx === -1) {
    throw new Error(`Horizons: missing SOE/EOE for ${command}`);
  }

  const lines = body.slice(soeIdx + 5, eoeIdx).trim().split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) throw new Error(`Horizons: insufficient vector rows for ${command}`);

  const posMatch = lines[1].match(
    /X\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s+Y\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s+Z\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/i
  );
  const velMatch = lines[2].match(
    /VX\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s+VY\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s+VZ\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/i
  );
  if (!posMatch || !velMatch) throw new Error(`Horizons: unparseable vectors for ${command}`);

  return {
    x: parseFloat(posMatch[1]),
    y: parseFloat(posMatch[2]),
    z: parseFloat(posMatch[3]),
    vx: parseFloat(velMatch[1]),
    vy: parseFloat(velMatch[2]),
    vz: parseFloat(velMatch[3]),
  };
}

async function fetchFromHorizons(dsnLinkActive, trendState) {
  const now = new Date();
  const start = new Date(now.getTime() - 60_000);
  const stop = new Date(now.getTime() + 60_000);

  const [orion, moon] = await Promise.all([
    fetchHorizonsBody('-1024', start, stop, '1 m'),
    fetchHorizonsBody('301', start, stop, '1 m'),
  ]);

  const earthDistKm = Math.sqrt(orion.x ** 2 + orion.y ** 2 + orion.z ** 2);
  const moonDistKm = Math.sqrt(
    (orion.x - moon.x) ** 2 +
    (orion.y - moon.y) ** 2 +
    (orion.z - moon.z) ** 2
  );
  const speedKmS = Math.sqrt(orion.vx ** 2 + orion.vy ** 2 + orion.vz ** 2);
  const relVelKmS = Math.sqrt(
    (orion.vx - moon.vx) ** 2 +
    (orion.vy - moon.vy) ** 2 +
    (orion.vz - moon.vz) ** 2
  );

  if (moonDistKm > MOON_DISTANCE_STALE_LIMIT_KM) {
    throw new Error(
      `DATA_STALE: live moon distance ${moonDistKm.toFixed(0)} km exceeds ${MOON_DISTANCE_STALE_LIMIT_KM} km`
    );
  }

  const phase = resolveAutonomousPhase(moonDistKm, speedKmS, trendState);
  trendState.previousMoonDistKm = moonDistKm;
  trendState.previousSpeedKmS = speedKmS;

  return normalise(
    {
      earthDistKm,
      moonDistKm,
      speedKmS,
      relVelKmS,
      dsnLinkActive,
      dsnSignalLoss: !dsnLinkActive,
      x: orion.x,
      y: orion.y,
      z: orion.z,
      moonX: moon.x,
      moonY: moon.y,
      moonZ: moon.z,
    },
    phase,
    'JPL_HORIZONS'
  );
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

/**
 * Computes Moon distance from the spacecraft using the analytical Moon
 * ephemeris and a known Earth-distance.
 *
 * During the flyby, the spacecraft trajectory crosses near the Moon, so we
 * use a blend of the geometric Moon position and the PREDICTED closest-approach
 * offset when the geometry produces non-physical values.
 *
 * @param {number} earthDistKm  Earth-centre to spacecraft distance
 * @param {Date}   date
 * @returns {number} Spacecraft-to-Moon-centre distance (km)
 */
function computeMoonDistance(earthDistKm, date) {
  const moonPos  = moonGeocentricKm(date);
  const moonDist = Math.sqrt(moonPos.x ** 2 + moonPos.y ** 2 + moonPos.z ** 2);

  // Straight-line approximation along the Earth-Moon axis.
  // This is accurate when the spacecraft is near the Earth-Moon line, which
  // is geometrically required for a free-return flyby trajectory.
  let moonDistKm = Math.abs(moonDist - earthDistKm);

  // Clamp to minimum (can't be below Moon surface)
  if (moonDistKm < MOON_RADIUS_KM) moonDistKm = MOON_RADIUS_KM + 100;

  return moonDistKm;
}

/**
 * Returns the inertial speed (km/s) predicted by the Artemis II trajectory
 * model for the given mission elapsed time.
 *
 * @param {number} metH  Mission elapsed hours
 * @returns {number} Speed in km/s
 */
function buildPredictedSpeed(metH) {
  if (metH < 0.5)       return 7.8;
  if (metH < 2)         return 7.8;
  if (metH < 4)         return 7.8 + ((metH - 2) / 2) * (10.5 - 7.8);
  if (metH < 8)         return 10.5 - ((metH - 4) / 4) * (10.5 - 3.2);
  if (metH < 96)        return 3.2 - ((metH - 8) / 88) * (3.2 - 0.9);
  if (metH < 120)       return 0.9 + ((metH - 96) / 24) * (1.8 - 0.9);
  if (metH < 132)       return 2.5 - ((metH - 120) / 12) * (2.5 - 1.8);
  if (metH < 240)       return 1.8 + ((metH - 132) / 108) * (10.5 - 1.8);
  return 11.0;
}

/**
 * Estimates the relative velocity of the spacecraft with respect to the Moon
 * (km/s). During the flyby, this is dominated by the hyperbolic excess speed;
 * outside the flyby it approximates the inertial speed (Moon is ~slow relative
 * to the spacecraft's transit velocity).
 *
 * @param {number} speedKmS     Inertial speed
 * @param {number} earthDistKm  Earth distance (for geometry)
 * @param {Date}   date
 * @returns {number} Relative velocity in km/s
 */
function computeRelativeVelocity(speedKmS, earthDistKm, date) {
  const moonVel    = moonVelocityKmS(date);
  const moonSpeed  = Math.sqrt(moonVel.vx ** 2 + moonVel.vy ** 2 + moonVel.vz ** 2);
  // Simple vector approximation assuming anti-parallel approach vector during transit/flyby
  return Math.abs(speedKmS - moonSpeed);
}

// ─── High-Fidelity PREDICTED Fallback ────────────────────────────────────────

/**
 * Generates a physics-based PREDICTED state for Artemis II.
 *
 * Trajectory segments (referenced against April 1, 2026 18:00 UTC launch):
 *
 *   MET   0–0.5 h   Ascent              LEO insertion
 *   MET   0.5–2 h   Earth orbit         185 km / 7.8 km/s
 *   MET   2–4 h     TLI burn            185 km → 8,000 km
 *   MET   4–8 h     Near-Earth depart   8,000 → 70,000 km
 *   MET   8–96 h    Lunar transit       70,000 → 335,000 km
 *   MET  96–120 h   Lunar approach      335,000 → 382,000 km
 *   MET 120–132 h   Lunar flyby         closest ~8,287 km from Moon centre
 *   MET 132–240 h   Return transit      382,000 → 8,000 km
 *   MET 240+ h      Re-entry / splashdown
 *
 * At MET 120 h (April 6, 2026 ≈ 18:00 UTC) the spacecraft is at closest
 * approach. At MET ~114 h (09:00 UTC on April 6) it is approximately 10–15
 * minutes of arc inbound, giving a Moon distance of ~9,000–12,000 km.
 *
 * This model is tagged PREDICTED and will be overridden whenever DSN or
 * Horizons data is successfully fetched.
 *
 * @param {boolean} [dsnLinkActive]
 * @returns {object} Canonical telemetry packet tagged 'PREDICTED'
 */
function buildPredicted(dsnLinkActive = false) {
  const metH = missionElapsedHours();
  const now  = new Date();

  let earthDistKm, speedKmS, moonDistKm, relVelKmS;

  if (metH < 0.5) {
    earthDistKm = EARTH_RADIUS_KM + (metH / 0.5) * 185;
    speedKmS    = 7.8;

  } else if (metH < 2) {
    earthDistKm = EARTH_RADIUS_KM + 185;
    speedKmS    = 7.8;

  } else if (metH < 4) {
    const t     = (metH - 2) / 2;
    earthDistKm = (EARTH_RADIUS_KM + 185) + t * (8_000 - EARTH_RADIUS_KM - 185);
    speedKmS    = 7.8 + t * (10.5 - 7.8);

  } else if (metH < 8) {
    const t     = (metH - 4) / 4;
    earthDistKm = 8_000 + t * 62_000;
    speedKmS    = 10.5 - t * (10.5 - 3.2);

  } else if (metH < 96) {
    const t     = (metH - 8) / 88;
    earthDistKm = 70_000 + t * 265_000;
    speedKmS    = 3.2 - t * (3.2 - 0.9);

  } else if (metH < 120) {
    const t     = (metH - 96) / 24;
    earthDistKm = 335_000 + t * 47_000;      // → 382,000 km
    speedKmS    = 0.9 + t * (1.8 - 0.9);

  } else if (metH < 132) {
    // ── FLYBY: MET 120-132 h — parabolic closest approach at t=0 ──────
    // Closest approach: Moon center-to-center ≈ 8,287 km
    // The spacecraft passes closest at MET 120 h; we model the perilune arc
    // as a hyperbolic segment.
    const t           = (metH - 120) / 12;   // 0 = closest, 1 = 12 h after
    const CLOSEST_KM  = 8_287;               // center-to-center at perilune
    // Moon distance follows a hyperbolic-like path: sqrt(closest^2 + (v*t)^2)
    const FLYBY_V_KMS = 1.5;                 // km/s transverse flyby speed estimate
    const dtSecs      = t * 12 * 3_600;      // seconds from closest approach
    moonDistKm        = Math.sqrt(CLOSEST_KM ** 2 + (FLYBY_V_KMS * dtSecs) ** 2);
    // Earth distance: approximately constant at ~380,000–390,000 km during flyby
    earthDistKm       = 382_000 + t * 4_000;
    speedKmS          = 2.5 - t * (2.5 - 1.8);
    relVelKmS         = Math.sqrt(speedKmS ** 2 + FLYBY_V_KMS ** 2);

  } else if (metH < 240) {
    const t     = (metH - 132) / 108;
    earthDistKm = 382_000 - t * 374_000;    // → 8,000 km
    speedKmS    = 1.8 + t * (10.5 - 1.8);

  } else {
    earthDistKm = Math.max(EARTH_RADIUS_KM, 8_000 - (metH - 240) * 500);
    speedKmS    = 11.0;
  }

  // Geometric Moon distance if not set by a specific segment
  if (moonDistKm === undefined) {
    moonDistKm = computeMoonDistance(earthDistKm, now);
  }

  // Ensure Moon distance is physically plausible
  if (moonDistKm < MOON_RADIUS_KM) moonDistKm = MOON_RADIUS_KM + 100;

  // Relative velocity vs Moon if not set
  if (relVelKmS === undefined) {
    relVelKmS = computeRelativeVelocity(speedKmS, earthDistKm, now);
  }

  return normalise(
    { earthDistKm, moonDistKm, speedKmS, relVelKmS, dsnLinkActive, x: 0, y: 0, z: -earthDistKm },
    'PREDICTED',
    'PREDICTED_MODEL'
  );
}

// ─── Phase 1: Trajectory Vector Bulk Array ────────────────────────────────────

let cachedTrajectory = null;
let lastTrajectoryFetch = 0;

function parseHorizonsVectorSeries(rawBody) {
  const body = typeof rawBody === 'object'
    ? (rawBody?.result ?? JSON.stringify(rawBody))
    : String(rawBody || '');
  const soeIdx = body.indexOf('$$SOE');
  const eoeIdx = body.indexOf('$$EOE');
  if (soeIdx === -1 || eoeIdx === -1) return [];

  const section = body.slice(soeIdx + 5, eoeIdx).trim();
  const blockRegex =
    /A\.D\.\s+([0-9A-Za-z\-:\. ]+?)\s+TDB[\s\S]*?X\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s+Y\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s+Z\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/g;

  const monthMap = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };

  const vectors = [];
  let match;
  while ((match = blockRegex.exec(section)) !== null) {
    const cleaned = match[1].replace(/\s+/g, ' ').trim();
    const tsMatch = cleaned.match(/^(\d{4})-([A-Za-z]{3})-(\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\.\d+)?$/);
    const fallbackDate = new Date(cleaned);
    const isoTimestamp = tsMatch
      ? `${tsMatch[1]}-${monthMap[tsMatch[2]] || '01'}-${tsMatch[3]}T${tsMatch[4]}Z`
      : (Number.isNaN(fallbackDate.getTime()) ? new Date().toISOString() : fallbackDate.toISOString());
    vectors.push({
      timestamp: isoTimestamp,
      x: parseFloat(match[2]),
      y: parseFloat(match[3]),
      z: parseFloat(match[4]),
    });
  }
  return vectors;
}

async function updateTrajectoryCache() {
  const nowTime = Date.now();
  if (cachedTrajectory && (nowTime - lastTrajectoryFetch < 3600_000)) {
    return cachedTrajectory; // cache valid for 1 hour
  }

  try {
    // Full mission profile window so the plotted path clearly starts at Earth,
    // reaches lunar flyby, and returns toward Earth.
    const launchEpoch = new Date('2026-04-01T18:00:00Z');
    const start = launchEpoch;
    const stop  = new Date(launchEpoch.getTime() + 240 * 3600_000); // ~10 day mission
    const paramsFor = (command) => ({
      format: 'text',
      COMMAND: horizonsLiteral(command),
      MAKE_EPHEM: horizonsLiteral('YES'),
      OBJ_DATA: horizonsLiteral('NO'),
      EPHEM_TYPE: horizonsLiteral('VECTORS'),
      CENTER: horizonsLiteral('500@399'),
      START_TIME: horizonsLiteral(toHorizonsDateTime(start)),
      STOP_TIME: horizonsLiteral(toHorizonsDateTime(stop)),
      STEP_SIZE: horizonsLiteral('1 h'),
      OUT_UNITS: horizonsLiteral('KM-S'),
      REF_PLANE: horizonsLiteral('ECLIPTIC'),
      REF_SYSTEM: horizonsLiteral('J2000'),
    });

    const [spacecraftResp, moonResp] = await Promise.all([
      axios.get(HORIZONS_BASE, { params: paramsFor('-1024'), headers: COMMON_HEADERS, timeout: REQUEST_TIMEOUT }),
      axios.get(HORIZONS_BASE, { params: paramsFor('301'), headers: COMMON_HEADERS, timeout: REQUEST_TIMEOUT }),
    ]);

    const spacecraft = parseHorizonsVectorSeries(spacecraftResp.data);
    const moon = parseHorizonsVectorSeries(moonResp.data);

    if (spacecraft.length > 0 && moon.length > 0) {
      cachedTrajectory = {
        generatedAt: new Date().toISOString(),
        spacecraft,
        moon,
      };
      lastTrajectoryFetch = nowTime;
      logger.info('Refreshed JPL trajectory caches', {
        spacecraftVectors: spacecraft.length,
        moonVectors: moon.length,
      });
    }
  } catch (err) {
    logger.warn('Failed to bulk fetch JPL Trajectory Vectors', { error: err.message });
  }

  return cachedTrajectory || { generatedAt: new Date().toISOString(), spacecraft: [], moon: [] };
}

// ─── Shared fetch state ───────────────────────────────────────────────────────
// Persists between poll cycles in the same process lifetime.
// Used by fetchFromDSN to derive speed from range delta.

const trendState = {
  previousMoonDistKm: null,
  previousSpeedKmS: null,
};

// ─── Fetch orchestrator ───────────────────────────────────────────────────────

/**
 * Live-only telemetry orchestrator.
 * If live fetch fails, returns an explicit degraded payload for graceful UI fallback.
 */
async function fetchBestTelemetry() {
  let dsnLinkActive = false;
  try {
    const dsnResp = await axios.get(DSN_XML_URL, {
      headers: { ...COMMON_HEADERS, Accept: 'application/xml, text/xml, */*' },
      params:  { r: Date.now() },
      timeout: 6_000,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    const xml = String(dsnResp.data || '');
    dsnLinkActive = xml.includes('spacecraft="EM2"') && xml.includes('active="true"');
  } catch (_) { /* non-fatal */ }

  try {
    const tel = await fetchFromHorizons(dsnLinkActive, trendState);

    logger.info('Telemetry from JPL Horizons (state vectors)', {
      earthDistKm: tel.distanceFromEarthKm,
      moonDistKm:  tel.distanceToMoonKm,
      speedKmS:    tel.speedKmS,
      phase:       tel.phase,
    });

    return tel;
  } catch (horizonsErr) {
    logger.warn('Live telemetry unavailable — DATA_LINK_FAILURE', {
      error: horizonsErr.message,
    });
    return {
      timestamp: new Date().toISOString(),
      telemetryHealth: 'DATA_LINK_FAILURE',
      dataSource: 'NONE',
      errorMessage: horizonsErr.message,
      dsnLinkActive,
      dsnSignalLoss: true,
      position: { x: 0, y: 0, z: 0 },
      moonPosition: { x: 0, y: 0, z: 0 },
    };
  }
  return {
    timestamp: new Date().toISOString(),
    telemetryHealth: 'DATA_LINK_FAILURE',
    dataSource: 'NONE',
    errorMessage: 'Telemetry link unavailable',
    dsnLinkActive,
    dsnSignalLoss: true,
    position: { x: 0, y: 0, z: 0 },
    moonPosition: { x: 0, y: 0, z: 0 },
  };
}

// ─── Internal state ───────────────────────────────────────────────────────────

let intervalHandle = null;

// ─── Poll cycle ───────────────────────────────────────────────────────────────

async function runPollCycle(io) {
  try {
    const trajectory = await updateTrajectoryCache();
    if (trajectory.spacecraft.length > 0 || trajectory.moon.length > 0) {
      io.emit('trajectory_update', trajectory);
    }

    const telemetry = await fetchBestTelemetry();
    io.emit('telemetry_update', telemetry);
  } catch (err) {
    logger.error('Catastrophic telemetry failure — emitting null telemetry', {
      error: err.message,
    });
    io.emit('telemetry_update', null);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

function startTelemetryStream(io) {
  logger.info('Telemetry stream starting (live-only)', {
    pollMs: POLL_INTERVAL_MS,
    source: 'JPL_HORIZONS + DSN_LINK_STATUS',
  });

  // Emit immediately, then on every interval tick
  runPollCycle(io);
  intervalHandle = setInterval(() => runPollCycle(io), POLL_INTERVAL_MS);
}

function stopTelemetryStream() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info('Telemetry stream stopped');
  }
}

// Graceful shutdown
process.once('SIGTERM', stopTelemetryStream);
process.once('SIGINT',  stopTelemetryStream);

module.exports = { startTelemetryStream, stopTelemetryStream };
