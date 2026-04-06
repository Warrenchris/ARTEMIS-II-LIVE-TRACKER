/**
 * TelemetryContext — Production Implementation
 * ============================================
 * Manages the Socket.IO connection lifecycle and the global telemetry state.
 *
 * Key design decisions:
 * - Exposes TWO hooks:
 *     useTelemetry()    → reactive state (triggers re-renders on each update)
 *     useTelemetryRef() → mutable ref (read in useFrame without re-renders)
 *   This separation is the core performance split: UI panels use useTelemetry(),
 *   scene components (Spacecraft, Trajectory) use useTelemetryRef().
 *
 * - Staleness guard: a 10-second setInterval checks whether `lastUpdated` is
 *   more than 60 seconds old. If so, `isLive` is set to false and the UI
 *   renders a "Signal Lost" state.
 *
 * - All connection lifecycle events emit structured log entries to the console
 *   in a parseable format (no raw strings).
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { io } from 'socket.io-client';

// ─── Types / Shapes ───────────────────────────────────────────────────────────

export const CONNECTION_STATES = Object.freeze({
  CONNECTING: 'CONNECTING',
  SYNCED:     'SYNCED',
  OFFLINE:    'OFFLINE',
});

const DEFAULT_TELEMETRY = Object.freeze({
  timestamp:              null,
  lastUpdated:            null,
  isLive:                 false,
  missionElapsedHours:    '0.00',
  flightDay:              1,
  distanceFromEarthKm:    '0',
  distanceToMoonKm:       '384400',
  speedKmS:               '0.000',
  altitudeKm:             '0',
  relativeVelocityKmS:    null,   // km/s relative to Moon's centre of mass
  relativeVelocityKmH:    null,   // km/h relative to Moon
  phaseId:                'launch',
  phase:                  'Pre-launch',
  position:               { x: 0, y: 0, z: 0 },
  moonPosition:           { x: 0, y: 0, z: 0 },
  telemetryHealth:        'DATA_LINK_FAILURE',
  errorMessage:           null,
  dataSource:             'UNKNOWN',    // 'NASA_DSN' | 'JPL_HORIZONS' | 'PREDICTED_MODEL'
  dsnLinkActive:          false,        // true when DSN antenna is actively tracking Orion
  dsnSignalLoss:          true,
  statusLabel:            'CONNECTING', // derived label for the UI status badge
  commsLatencyMs:         0,
  connectionState:        CONNECTION_STATES.CONNECTING,
  isOcculted:             false,        // true when behind the moon
  trajectoryVectors:      { spacecraft: [], moon: [], generatedAt: null },
  isClosestApproach:      false,        // true when moonDistKm < 9,500 km
  estTimeToPeriselenesMs: null,         // estimated ms until reaching 8,900 km
  closureRateKmS:         0,            // rate of approach in km/s
});

// ─── Contexts ─────────────────────────────────────────────────────────────────

// Reactive context — subscribing components re-render on every telemetry tick.
const TelemetryContext    = createContext(DEFAULT_TELEMETRY);

// Ref context — provides a mutable ref; reading it never causes re-renders.
const TelemetryRefContext = createContext({ current: { ...DEFAULT_TELEMETRY } });

// ─── Hooks ────────────────────────────────────────────────────────────────────

/** Use in UI components (TelemetryDashboard, MissionTimeline, etc.) */
export const useTelemetry    = () => useContext(TelemetryContext);

/** Use in R3F useFrame callbacks (Spacecraft, Trajectory) — zero re-renders */
export const useTelemetryRef = () => useContext(TelemetryRefContext);

// ─── Structured Client-side Log ───────────────────────────────────────────────

function clog(level, msg, meta = {}) {
  const entry = { ts: new Date().toISOString(), level, svc: 'telemetry-ctx', msg, ...meta };
  if (level === 'ERROR') {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(entry));
  } else if (level === 'WARN') {
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify(entry));
  } else {
    // eslint-disable-next-line no-console
    console.info(JSON.stringify(entry));
  }
}

// ─── Staleness Threshold ──────────────────────────────────────────────────────

const STALE_THRESHOLD_MS    = 60_000; // 60 seconds
const STALE_CHECK_INTERVAL  = 10_000; // check every 10 seconds

/** Mean lunar radius (km) — must match server/services/telemetry.js */
const MOON_RADIUS_KM = 1737;

/**
 * True when the Earth→spacecraft line segment intersects the Moon sphere first
 * (spacecraft behind the lunar disk from Earth). Uses geocentric km vectors.
 * The old distance-only heuristic (earth > 384400 && moon < 15000) was always
 * true during normal lunar approach, which incorrectly triggered the occultation HUD.
 */
function isLunarDiskOccultation(position, moonPosition) {
  const sx = Number(position?.x) || 0;
  const sy = Number(position?.y) || 0;
  const sz = Number(position?.z) || 0;
  const mx = Number(moonPosition?.x) || 0;
  const my = Number(moonPosition?.y) || 0;
  const mz = Number(moonPosition?.z) || 0;

  const sLen = Math.hypot(sx, sy, sz);
  const mLen = Math.hypot(mx, my, mz);
  if (sLen < 1e3 || mLen < 1e5) return false;

  const dx = sx / sLen;
  const dy = sy / sLen;
  const dz = sz / sLen;

  const dm = dx * mx + dy * my + dz * mz;
  const cm = mx * mx + my * my + mz * mz - MOON_RADIUS_KM * MOON_RADIUS_KM;
  const inner = dm * dm - cm;
  if (inner < 0) return false;

  const root = Math.sqrt(inner);
  const t1 = dm - root;
  const t2 = dm + root;
  const hits = [t1, t2].filter((t) => t > 1e-3);
  if (hits.length === 0) return false;

  const tEnter = Math.min(...hits);
  return tEnter < sLen - 1e-3;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export const TelemetryProvider = ({ children }) => {
  const [telemetry, setTelemetry] = useState({ ...DEFAULT_TELEMETRY });

  // Mutable ref — always holds the latest telemetry, readable without re-renders
  const telemetryRef = useRef({ ...DEFAULT_TELEMETRY });

  // Closest approach tracking — stores { moonDistKm, timestamp } pairs
  const moonDistHistoryRef = useRef([]);

  /** Merge incoming data into both state (reactive) and ref (imperative). */
  const mergeTelemetry = (patch) => {
    setTelemetry((prev) => {
      const next = { ...prev, ...patch };
      telemetryRef.current = next;
      return next;
    });
  };

  /**
   * Calculates closest approach countdown based on the last two telemetry readings.
   * Returns { isClosestApproach, estTimeToPeriselenesMs, closureRateKmS }
   */
  const calculateClosestApproach = (moonDistKm) => {
    const CLOSEST_APPROACH_THRESHOLD = 9_500; // km
    const PERISELENE_TARGET = 8_900; // km
    const isClosestApproach = moonDistKm < CLOSEST_APPROACH_THRESHOLD && moonDistKm > 0;

    const history = moonDistHistoryRef.current;
    let closureRateKmS = 0;
    let estTimeToPeriselenesMs = null;

    // Keep only the last 2 entries (current + previous) for closure rate calculation
    if (history.length > 2) {
      history.shift();
    }

    // Add current reading
    history.push({ moonDistKm, timestamp: Date.now() });

    // Calculate closure rate from last two readings
    if (history.length >= 2) {
      const prev = history[history.length - 2];
      const curr = history[history.length - 1];
      const timeDeltaMs = curr.timestamp - prev.timestamp;

      if (timeDeltaMs > 0) {
        const distanceDeltaKm = prev.moonDistKm - curr.moonDistKm; // positive = approaching
        closureRateKmS = Math.max(0, distanceDeltaKm / (timeDeltaMs / 1000)); // km/s

        // Calculate ETA to periselene
        if (closureRateKmS > 0 && moonDistKm > PERISELENE_TARGET) {
          const remainingDist = moonDistKm - PERISELENE_TARGET;
          estTimeToPeriselenesMs = Math.round((remainingDist / closureRateKmS) * 1000);
        }
      }
    }

    return { isClosestApproach, estTimeToPeriselenesMs, closureRateKmS };
  };

  // ── Socket.IO connection ────────────────────────────────────────────────────
  useEffect(() => {
    const socketUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000';

    const socket = io(socketUrl, {
      transports:            ['websocket', 'polling'],
      reconnectionAttempts:  Infinity,
      reconnectionDelay:     2_000,
      reconnectionDelayMax:  15_000,
      timeout:               10_000,
    });

    // ── Lifecycle events ──────────────────────────────────────────────────────

    socket.on('connect', () => {
      clog('INFO', 'Socket connected', { id: socket.id });
      mergeTelemetry({ connectionState: CONNECTION_STATES.SYNCED });
    });

    socket.on('disconnect', (reason) => {
      clog('WARN', 'Socket disconnected', { reason });
      mergeTelemetry({ connectionState: CONNECTION_STATES.OFFLINE, isLive: false });
    });

    socket.on('connect_error', (err) => {
      clog('ERROR', 'Socket connection error', { error: err.message });
      mergeTelemetry({ connectionState: CONNECTION_STATES.OFFLINE, isLive: false });
    });

    socket.on('reconnect_attempt', (attempt) => {
      clog('INFO', 'Socket reconnect attempt', { attempt });
      mergeTelemetry({ connectionState: CONNECTION_STATES.CONNECTING });
    });

    socket.on('reconnect', (attempt) => {
      clog('INFO', 'Socket reconnected', { attempt });
      mergeTelemetry({ connectionState: CONNECTION_STATES.SYNCED });
    });

    socket.on('reconnect_failed', () => {
      clog('ERROR', 'Socket reconnection failed permanently');
      mergeTelemetry({ connectionState: CONNECTION_STATES.OFFLINE, isLive: false });
    });

    // ── Trajectory stream ─────────────────────────────────────────────────────
    
    socket.on('trajectory_update', (vectors) => {
      if (Array.isArray(vectors)) {
        // Backward compatibility with older server payload shape
        mergeTelemetry({ trajectoryVectors: { spacecraft: vectors, moon: [], generatedAt: new Date().toISOString() } });
        return;
      }
      mergeTelemetry({
        trajectoryVectors: {
          spacecraft: vectors?.spacecraft ?? [],
          moon: vectors?.moon ?? [],
          generatedAt: vectors?.generatedAt ?? new Date().toISOString(),
        },
      });
    });

    // ── Telemetry data ────────────────────────────────────────────────────────

    socket.on('telemetry_update', (data) => {
      if (data === null) {
        mergeTelemetry({
          timestamp: new Date().toISOString(),
          telemetryHealth: 'DATA_LINK_FAILURE',
          dataSource: 'NONE',
          errorMessage: 'Telemetry link unavailable',
          isLive: false,
          statusLabel: 'DATA_LINK_FAILURE',
          connectionState: CONNECTION_STATES.SYNCED,
        });
        return;
      }

      const now = Date.now();

      // Derive a human-readable status label for the HUD badge.
      // Priority: LIVE (DSN ranging / Horizons vectors) → PREDICTED → error states
      let statusLabel = data.telemetryHealth ?? 'UNKNOWN';
      if (data.telemetryHealth === 'NOMINAL' && data.dataSource === 'JPL_HORIZONS') {
        statusLabel = data.phase || 'LIVE TELEMETRY';
      }

      const moonDist = parseFloat(data.distanceToMoonKm) || 0;
      const dsnSignalLoss = data.dsnSignalLoss === true;
      const geometricOcculted = isLunarDiskOccultation(data.position, data.moonPosition);
      const isOcculted = dsnSignalLoss || geometricOcculted;

      // Calculate closest approach and countdown
      const { isClosestApproach, estTimeToPeriselenesMs, closureRateKmS } = calculateClosestApproach(moonDist);

      setTelemetry((prev) => {
        const next = {
          ...prev,
          ...data,
          lastUpdated:     now,
          isLive:          data.telemetryHealth === 'NOMINAL',
          statusLabel,
          connectionState: CONNECTION_STATES.SYNCED,
          isOcculted,
          isClosestApproach,
          estTimeToPeriselenesMs,
          closureRateKmS,
        };
        telemetryRef.current = next;
        return next;
      });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // ── Staleness guard ─────────────────────────────────────────────────────────
  //
  // Runs every STALE_CHECK_INTERVAL ms. If the most recent telemetry packet is
  // older than STALE_THRESHOLD_MS we flip isLive to false so the UI can show
  // a "Signal Lost" warning without waiting for a socket disconnect.

  useEffect(() => {
    const staleCheckId = setInterval(() => {
      const { lastUpdated, isLive } = telemetryRef.current;

      if (!lastUpdated) return; // no data received yet — nothing to check

      const ageMs = Date.now() - lastUpdated;
      if (ageMs > STALE_THRESHOLD_MS && isLive) {
        clog('WARN', 'Telemetry data is stale — triggering Signal Lost', { ageMs });
        mergeTelemetry({ isLive: false });
      }
    }, STALE_CHECK_INTERVAL);

    return () => clearInterval(staleCheckId);
  }, []); // intentionally uses ref — no deps needed

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <TelemetryRefContext.Provider value={telemetryRef}>
      <TelemetryContext.Provider value={telemetry}>
        {children}
      </TelemetryContext.Provider>
    </TelemetryRefContext.Provider>
  );
};
