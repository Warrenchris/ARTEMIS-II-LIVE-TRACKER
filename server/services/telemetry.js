/**
 * Artemis II Telemetry Service — Production Implementation
 * =========================================================
 * Primary source : https://www.nasa.gov/specials/trackartemis/data/telemetry.json
 *
 * Behaviour:
 *  1. Fetch live data from NASA's endpoint on every poll cycle.
 *  2. On failure, apply exponential back-off (2 s → 4 s → 8 s) for up to
 *     MAX_RETRIES attempts before falling through to a PREDICTED fallback.
 *  3. The PREDICTED fallback uses average Artemis II mission constants to
 *     generate plausible state data — it is clearly flagged as "PREDICTED".
 *  4. All logging uses the structured logger (no console.*).
 *  5. The poll interval is cleared on process shutdown (no memory leak).
 */

'use strict';

const axios  = require('axios');
const logger = require('../utils/logger');

// ─── Constants ───────────────────────────────────────────────────────────────

const NASA_URL         = process.env.NASA_API_URL || 'https://www.nasa.gov/specials/trackartemis/data/telemetry.json';
const POLL_INTERVAL_MS = Math.max(2000, parseInt(process.env.TELEMETRY_POLL_INTERVAL_MS, 10) || 5000);
const MAX_RETRIES      = 3;
const REQUEST_TIMEOUT  = 9000; // ms — gives NASA server breathing room

// Physical constants (km)
const MOON_DISTANCE_KM = 384400;
const EARTH_RADIUS_KM  = 6371;
const MOON_RADIUS_KM   = 1737;
const SPEED_OF_LIGHT   = 299792.458; // km/s

// Artemis II reference launch (update when confirmed).
const LAUNCH_DATE = new Date(process.env.ARTEMIS_LAUNCH_DATE || '2025-09-15T18:00:00.000Z');

// ─── Mission Phase Definitions ────────────────────────────────────────────────

const PHASES = [
  { id: 'launch',      label: 'Launch',               minKm: 0,         maxKm: 400    },
  { id: 'earth_orbit', label: 'Earth Orbit',           minKm: 400,       maxKm: 8_000  },
  { id: 'tli',         label: 'Translunar Injection',  minKm: 8_000,     maxKm: 70_000 },
  { id: 'transit',     label: 'Lunar Transit',         minKm: 70_000,    maxKm: 310_000},
  { id: 'approach',    label: 'Lunar Approach',        minKm: 310_000,   maxKm: 380_000},
  { id: 'loi',         label: 'Lunar Orbit Insertion', minKm: 380_000,   maxKm: 384_400},
  { id: 'return',      label: 'Return Trajectory',     minKm: -Infinity, maxKm: -1     },
  { id: 'splashdown',  label: 'Splashdown',            minKm: -Infinity, maxKm: -2     },
];

function resolvePhase(distKm) {
  return (
    PHASES.find((p) => distKm >= p.minKm && distKm < p.maxKm) ||
    PHASES[PHASES.length - 1]
  );
}

function missionElapsedHours() {
  return Math.max(0, (Date.now() - LAUNCH_DATE.getTime()) / 3_600_000);
}

// ─── Telemetry Normaliser ─────────────────────────────────────────────────────

/**
 * Maps a raw NASA JSON blob to the canonical telemetry shape consumed by
 * the frontend. Handles both flat-key and nested-key response formats.
 * All numeric fields are coerced and clamped defensively.
 *
 * Raw NASA trackartemis schema (observed on Artemis I):
 *   { velocity, altitude, earthDistance, moonDistance, ... }
 * Alternate patterns also handled: snake_case, nested in `data` envelope.
 *
 * @param {Record<string, unknown>} raw
 * @param {'NOMINAL'|'PREDICTED'|'DEGRADED'} healthOverride
 * @returns {object} Canonical telemetry payload
 */
function normalise(raw, healthOverride = 'NOMINAL') {
  const src = raw?.data ?? raw; // unwrap optional `data` envelope

  // ── Extract core fields with multi-key fallback chains ────────────────────
  const earthDistKm = parseFloat(
    src.earthDistance   ??
    src.earth_distance  ??
    src.distanceFromEarth ??
    src.distance_from_earth_km ??
    0
  );

  const moonDistKm = parseFloat(
    src.moonDistance    ??
    src.moon_distance   ??
    src.distanceToMoon  ??
    src.distance_to_moon_km ??
    Math.max(0, MOON_DISTANCE_KM - earthDistKm)
  );

  // NASA trackartemis reports velocity in km/h; convert to km/s if > 100
  const rawVelocity = parseFloat(src.velocity ?? src.speed ?? src.speed_km_s ?? 0);
  const speedKmS = rawVelocity > 100 ? rawVelocity / 3600 : rawVelocity;

  const altitude = parseFloat(src.altitude ?? earthDistKm - EARTH_RADIUS_KM);

  const safeEarth = Math.max(0, earthDistKm);
  const safeMoon  = Math.max(0, moonDistKm);
  const phase     = resolvePhase(safeEarth);
  const metHours  = missionElapsedHours();

  // Round-trip signal delay: distance / c × 2 (ms)
  const commsLatencyMs = Math.round((safeEarth / SPEED_OF_LIGHT) * 1000 * 2);

  return {
    timestamp:           new Date().toISOString(),
    missionElapsedHours: metHours.toFixed(2),
    distanceFromEarthKm: safeEarth.toFixed(0),
    distanceToMoonKm:    safeMoon.toFixed(0),
    speedKmS:            speedKmS.toFixed(3),
    altitudeKm:          altitude.toFixed(0),
    phaseId:             phase.id,
    phase:               phase.label,
    // Position in km along Earth→Moon axis (X/Y assumed 0 for straight-line model)
    position: {
      x: parseFloat(src.posX ?? 0),
      y: parseFloat(src.posY ?? 0),
      z: -(safeEarth),          // Scene convention: negative Z toward Moon
    },
    telemetryHealth: healthOverride,
    commsLatencyMs,
  };
}

// ─── PREDICTED Fallback ───────────────────────────────────────────────────────

/**
 * Generates a plausible PREDICTED state using average Artemis II constants.
 * Called when NASA's live endpoint is unreachable after MAX_RETRIES attempts.
 *
 * Profile used:
 *   0–2 h      Launch / Earth orbit   (~400 km altitude, ~7.8 km/s)
 *   2–6 h      TLI burn + departure   (8 000–70 000 km, ~10 km/s → 3 km/s)
 *   6–60 h     Translunar transit     (70 000–310 000 km, ~1.2 km/s avg)
 *   60–66 h    Lunar approach         (310 000–380 000 km, ~2 km/s)
 *   66–72 h    Lunar orbit / flyby    (380 000–384 400 km)
 */
function buildPredicted() {
  const metH = missionElapsedHours();

  let distKm, speedKmS;

  if (metH < 2) {
    distKm   = EARTH_RADIUS_KM + metH * 200;       // rough ascent
    speedKmS = 7.8;
  } else if (metH < 6) {
    const t  = (metH - 2) / 4;                     // 0–1 through TLI phase
    distKm   = 8_000 + t * 62_000;
    speedKmS = 10.5 - t * 7.5;                     // 10.5 → 3 km/s
  } else if (metH < 60) {
    const t  = (metH - 6) / 54;
    distKm   = 70_000 + t * 240_000;
    speedKmS = 1.2 - t * 0.2;                      // gentle deceleration
  } else if (metH < 66) {
    const t  = (metH - 60) / 6;
    distKm   = 310_000 + t * 70_000;
    speedKmS = 1.0 + t * 1.0;                      // Moon gravity pulls
  } else {
    distKm   = Math.min(MOON_DISTANCE_KM - MOON_RADIUS_KM - 50, 380_000 + (metH - 66) * 500);
    speedKmS = 2.0;
  }

  return normalise({ earthDistance: distKm, velocity: speedKmS * 3600 }, 'PREDICTED');
}

// ─── Exponential Back-off Fetcher ─────────────────────────────────────────────

/**
 * Attempts to fetch the NASA telemetry endpoint up to MAX_RETRIES times,
 * applying exponential back-off between each attempt (2 s → 4 s → 8 s).
 *
 * @returns {Promise<object>} Normalised telemetry payload
 * @throws  {Error} After all retries are exhausted
 */
async function fetchWithBackoff() {
  const headers = {};
  if (process.env.NASA_API_KEY) {
    headers['Authorization'] = `Bearer ${process.env.NASA_API_KEY}`;
  }

  let lastErr;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.get(NASA_URL, {
        headers,
        timeout: REQUEST_TIMEOUT,
        validateStatus: (s) => s >= 200 && s < 300,
      });

      return normalise(response.data, 'NOMINAL');

    } catch (err) {
      lastErr = err;

      const httpStatus  = err.response?.status;
      const errDetail   = httpStatus ? `HTTP ${httpStatus}` : err.code ?? err.message;
      const backoffMs   = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s

      logger.warn('NASA API fetch failed', {
        attempt,
        maxRetries: MAX_RETRIES,
        url: NASA_URL,
        error: errDetail,
        nextRetryMs: attempt < MAX_RETRIES ? backoffMs : null,
      });

      if (attempt < MAX_RETRIES) {
        await new Promise((res) => setTimeout(res, backoffMs));
      }
    }
  }

  // All retries exhausted
  throw lastErr;
}

// ─── Internal State ───────────────────────────────────────────────────────────

let consecutiveApiFailures = 0;
let intervalHandle         = null;

// ─── Poll Cycle ───────────────────────────────────────────────────────────────

async function runPollCycle(io) {
  try {
    const telemetry          = await fetchWithBackoff();
    consecutiveApiFailures   = 0;

    io.emit('telemetry_update', telemetry);

    logger.info('Live telemetry emitted', {
      phase:   telemetry.phase,
      speedKmS: telemetry.speedKmS,
      distEarthKm: telemetry.distanceFromEarthKm,
    });

  } catch (err) {
    consecutiveApiFailures += 1;

    logger.error('All API retries exhausted — using PREDICTED fallback', {
      consecutive: consecutiveApiFailures,
      error:       err.message,
    });

    const fallback = buildPredicted();
    io.emit('telemetry_update', fallback);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

function startTelemetryStream(io) {
  logger.info('Telemetry stream starting', {
    source:     NASA_URL,
    pollMs:     POLL_INTERVAL_MS,
    launchDate: LAUNCH_DATE.toISOString(),
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

// Graceful shutdown hooks (prevents zombie intervals in containers)
process.once('SIGTERM', stopTelemetryStream);
process.once('SIGINT',  stopTelemetryStream);

module.exports = { startTelemetryStream, stopTelemetryStream, PHASES };
