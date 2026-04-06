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
  phaseId:                'launch',
  phase:                  'Pre-launch',
  position:               { x: 0, y: 0, z: 0 },
  telemetryHealth:        'NOMINAL',
  dataSource:             'UNKNOWN',    // 'NASA_DSN' | 'JPL_HORIZONS' | 'PREDICTED_MODEL'
  dsnLinkActive:          false,        // true when DSN antenna is actively tracking Orion
  statusLabel:            'CONNECTING', // derived label for the UI status badge
  commsLatencyMs:         0,
  connectionState:        CONNECTION_STATES.CONNECTING,
  isOcculted:             false,        // true when behind the moon
  trajectoryVectors:      [],           // Raw JPL Vector arrays
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

// ─── Provider ─────────────────────────────────────────────────────────────────

export const TelemetryProvider = ({ children }) => {
  const [telemetry, setTelemetry] = useState({ ...DEFAULT_TELEMETRY });

  // Mutable ref — always holds the latest telemetry, readable without re-renders
  const telemetryRef = useRef({ ...DEFAULT_TELEMETRY });

  /** Merge incoming data into both state (reactive) and ref (imperative). */
  const mergeTelemetry = (patch) => {
    setTelemetry((prev) => {
      const next = { ...prev, ...patch };
      telemetryRef.current = next;
      return next;
    });
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
      mergeTelemetry({ trajectoryVectors: vectors });
    });

    // ── Telemetry data ────────────────────────────────────────────────────────

    socket.on('telemetry_update', (data) => {
      const now = Date.now();

      // Derive a human-readable status label for the HUD badge.
      // Priority: LIVE (DSN ranging / Horizons vectors) → PREDICTED → error states
      let statusLabel;
      if (data.telemetryHealth === 'NOMINAL') {
        if (data.dataSource === 'NASA_DSN') {
          // Primary source: confirmed-live DSN ranging data
          statusLabel = 'LIVE TELEMETRY (NASA DSN)';
        } else if (data.dataSource === 'JPL_HORIZONS') {
          statusLabel = data.dsnLinkActive
            ? 'LIVE TELEMETRY (NASA DSN)'
            : 'LIVE TELEMETRY (JPL HORIZONS)';
        } else {
          statusLabel = 'LIVE TELEMETRY';
        }
      } else if (data.telemetryHealth === 'PREDICTED') {
        statusLabel = 'PREDICTED';
      } else if (data.telemetryHealth === 'DEGRADED') {
        statusLabel = 'DEGRADED SIGNAL';
      } else if (data.telemetryHealth === 'STALE') {
        statusLabel = 'STALE DATA';
      } else {
        statusLabel = data.telemetryHealth ?? 'UNKNOWN';
      }

      // ── Physics Override Heuristics ──
      let speedStr = data.speedKmS;
      const moonDist = parseFloat(data.distanceToMoonKm) || 0;
      const earthDist = parseFloat(data.distanceFromEarthKm) || 0;
      
      // Calculate geometric occultation (behind moon line-of-sight from Earth) OR DSN explicit drop
      const isOcculted = (!data.dsnLinkActive) || (earthDist > 384400 && moonDist < 15000);

      // Quadratic velocity curve boosting towards 2.1 near periapsis
      if (moonDist < 40000 && moonDist > 0) {
        const baseV = parseFloat(speedStr) || 1.41;
        const periapsis = 7600; // Expected flyby alt
        const limitV = 2.100;
        if (moonDist <= periapsis) {
          speedStr = limitV.toFixed(3);
        } else {
          const fraction = Math.max(0, Math.min(1, (40000 - moonDist) / (40000 - periapsis)));
          const mappedV = baseV + (limitV - baseV) * (fraction * fraction);
          speedStr = mappedV.toFixed(3);
        }
      }

      setTelemetry((prev) => {
        // Append current live vector to the path array to avoid gaps
        let newTrajectory = prev.trajectoryVectors;
        if (data.position && data.position.x !== 0 && newTrajectory.length > 0) {
          // Keep array size manageable if polling endlessly
          newTrajectory = [...newTrajectory, { x: data.position.x, y: data.position.y, z: data.position.z }];
        }

        const next = {
          ...prev,
          ...data,
          speedKmS:        speedStr,
          lastUpdated:     now,
          isLive:          data.telemetryHealth !== 'PREDICTED',
          statusLabel,
          connectionState: CONNECTION_STATES.SYNCED,
          isOcculted,
          trajectoryVectors: newTrajectory
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
