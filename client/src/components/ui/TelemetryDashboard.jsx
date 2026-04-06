import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTelemetry } from '../../contexts/TelemetryContext';
import { Activity, Zap, Navigation, Clock, Signal, Wifi, WifiOff, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';

// ── Animated Number Counter ────────────────────────────────────────────────────
const AnimatedNumber = ({ value, decimals = 0, color = 'text-white' }) => {
  const [displayed, setDisplayed] = useState(parseFloat(value) || 0);
  const animRef  = useRef(null);
  const prevRef  = useRef(parseFloat(value) || 0);

  useEffect(() => {
    const target = parseFloat(value) || 0;
    const start = prevRef.current;
    const duration = 600;
    const startTime = performance.now();

    if (animRef.current) cancelAnimationFrame(animRef.current);

    const tick = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(start + (target - start) * eased);
      if (progress < 1) animRef.current = requestAnimationFrame(tick);
      else { prevRef.current = target; }
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [value]);

  const formatted = decimals > 0
    ? displayed.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : Math.round(displayed).toLocaleString();

  return <span className={`font-mono tabular-nums ${color}`}>{formatted}</span>;
};

// ── Scrambled / Glitch Text ────────────────────────────────────────────────────
const ScrambledText = () => {
  const [text, setText] = useState('---');
  useEffect(() => {
    const chars = '0123456789!@#$%^&*()_+-=<>?{}[]';
    const interval = setInterval(() => {
      let v = '';
      for(let i=0; i<8; i++) v += chars[Math.floor(Math.random()*chars.length)];
      setText(v);
    }, 40);
    return () => clearInterval(interval);
  }, []);
  return <span className="font-mono text-nasa-red opacity-80 animate-pulse">{text}</span>;
};

// ── Countdown Timer ────────────────────────────────────────────────────────────
const CountdownTimer = ({ milliseconds, label = 'Time to Periselene' }) => {
  const [displayTime, setDisplayTime] = useState('--:--');

  useEffect(() => {
    if (!milliseconds || milliseconds <= 0) {
      setDisplayTime('ARRIVED');
      return;
    }

    const updateDisplay = () => {
      const totalSecs = Math.max(0, Math.floor(milliseconds / 1000));
      const minutes = Math.floor(totalSecs / 60);
      const seconds = totalSecs % 60;
      setDisplayTime(`${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
    };

    updateDisplay();
    const interval = setInterval(updateDisplay, 500);
    return () => clearInterval(interval);
  }, [milliseconds]);

  return (
    <div className="flex flex-col gap-1">
      <div className="text-3xl font-mono font-bold text-nasa-red tracking-widest animate-pulse">
        {displayTime}
      </div>
      <div className="text-[9px] text-gray-500 tracking-widest uppercase">{label}</div>
    </div>
  );
};

const LiveMetric = ({ value, decimals, color = 'text-white', isOcculted, unit }) => {
  if (isOcculted) {
    const predVal = parseFloat(value).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return (
      <div className="flex flex-col">
        <div>
          <ScrambledText />
        </div>
        <span className="text-[10px] text-gray-600 tracking-widest mt-0.5 uppercase opacity-60">PRED PATH: {predVal} {unit}</span>
      </div>
    );
  }
  return (
    <div>
      <AnimatedNumber value={value} decimals={decimals} color={color} />
      {unit && <span className="text-sm text-gray-500 ml-1.5">{unit}</span>}
    </div>
  );
};

// ── Connection Badge ──────────────────────────────────────────────────────────
const ConnectionBadge = ({ state }) => {
  const config = {
    SYNCED:     { icon: <Wifi size={12} />,        label: 'SYNCED',     cls: 'border-green-500/50 text-green-400'  },
    OFFLINE:    { icon: <WifiOff size={12} />,     label: 'OFFLINE',    cls: 'border-red-500/50 text-red-400'     },
    CONNECTING: { icon: <Loader2 size={12} className="animate-spin" />, label: 'CONNECTING', cls: 'border-yellow-500/50 text-yellow-400' },
  };
  const c = config[state] ?? config.CONNECTING;
  return (
    <span className={`flex items-center gap-1.5 px-2 py-1 rounded border bg-black/40 text-xs font-bold ${c.cls}`}>
      {c.icon}{c.label}
    </span>
  );
};

// ── Health Dot ────────────────────────────────────────────────────────────────
const HealthBadge = ({ health }) => {
  const map = {
    NOMINAL:   { color: 'text-green-400',  pulseCls: 'bg-green-400' },
    SIMULATED: { color: 'text-yellow-400', pulseCls: 'bg-yellow-400' },
    DEGRADED:  { color: 'text-red-400',    pulseCls: 'bg-red-400'   },
    WARNING:   { color: 'text-red-400',    pulseCls: 'bg-red-400'   },
    OCCULTED:  { color: 'text-nasa-red',   pulseCls: 'bg-nasa-red'  },
  };
  const m = map[health] ?? map.NOMINAL;
  return (
    <div className={`flex items-center gap-2 text-sm font-bold ${m.color}`}>
      <span className={`w-2 h-2 rounded-full ${m.pulseCls} animate-pulse`} />
      <Activity size={14} />
      {health}
    </div>
  );
};

// ── Stat Row ──────────────────────────────────────────────────────────────────
const StatRow = ({ icon, label, children }) => (
  <div className="grid grid-cols-[18px_1fr] gap-2 items-start relative z-10">
    <div className="text-gray-500 mt-0.5">{icon}</div>
    <div>
      <div className="text-gray-400 text-[10px] uppercase tracking-widest mb-1">{label}</div>
      <div className="text-xl leading-tight">{children}</div>
    </div>
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────
export const TelemetryDashboard = () => {
  const telemetry = useTelemetry();
  const [showReacquired, setShowReacquired] = useState(false);
  const prevOcculted = useRef(telemetry.isOcculted);

  // Hook for "Re-Acquisition Protocol"
  useEffect(() => {
    if (prevOcculted.current && !telemetry.isOcculted) {
      setShowReacquired(true);
      setTimeout(() => setShowReacquired(false), 4000);
    }
    prevOcculted.current = telemetry.isOcculted;
  }, [telemetry.isOcculted]);

  return (
    <motion.div
      initial={{ opacity: 0, x: -50 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
      className="absolute top-8 left-8 w-80 z-10 pointer-events-none"
    >
      <div className="relative glass-panel-transparent rounded-lg p-5 max-h-[min(calc(100vh-8rem),calc(100dvh-8rem))] min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain pointer-events-auto scrollbar-hide">
        
        {/* CRT Scanline Overlay during Occultation */}
        {telemetry.isOcculted && (
          <div className="absolute inset-0 z-0 bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(255,255,255,0.03)_2px,rgba(255,255,255,0.03)_4px)] opacity-100 mix-blend-overlay pointer-events-none animate-pulse" />
        )}

        {/* Signal Lost Overlay (Total connection death) */}
        <AnimatePresence>
          {!telemetry.isLive && !telemetry.isOcculted && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-red-950/80 backdrop-blur-xs z-20 flex flex-col items-center justify-center rounded-xl"
            >
              <WifiOff size={32} className="text-nasa-red mb-3 animate-pulse" />
              <h3 className="text-nasa-red font-bold tracking-widest text-lg uppercase glow-text-red">Signal Lost</h3>
              <p className="text-nasa-red/80 text-[10px] mt-1 tracking-widest uppercase font-mono">Telemetry Stale</p>
              {telemetry.errorMessage && (
                <p className="text-red-300/90 text-[10px] mt-2 px-4 text-center normal-case tracking-normal font-mono">
                  {telemetry.errorMessage}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Re-acquired Green Overlay Flash */}
        <AnimatePresence>
          {showReacquired && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              transition={{ duration: 0.3 }}
              className="absolute inset-x-0 top-0 bg-green-500/20 backdrop-blur-md border border-green-500/50 z-30 flex items-center justify-center py-2 shadow-[0_0_20px_rgba(34,197,94,0.3)]"
            >
              <CheckCircle2 size={16} className="text-green-400 mr-2" />
              <span className="text-green-400 font-bold text-xs tracking-widest">SIGNAL RE-ACQUIRED</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Header */}
        <div className="flex justify-between items-center border-b border-white/10 pb-3 mb-4 relative z-10">
          <div>
            <h2 className="text-white font-bold tracking-widest text-base uppercase">Orion Telemetry</h2>
            <p className="text-gray-600 text-[10px] tracking-widest">ARTEMIS II / MISSION CONTROL</p>
          </div>
          <HealthBadge health={telemetry.isOcculted ? 'OCCULTED' : telemetry.telemetryHealth} />
        </div>

        {/* Stats */}
        <div className={`space-y-5 relative z-10 transition-all ${telemetry.isOcculted ? 'opacity-80 mix-blend-lighten' : ''}`}>
          <StatRow icon={<Navigation size={14} />} label="Mission Phase">
            <AnimatePresence mode="wait">
              {telemetry.isOcculted ? (
                <motion.div
                  key="occulted"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [1, 0.5, 1] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                  className="flex items-center text-sm font-bold text-nasa-red glow-text-red bg-red-900/40 border border-nasa-red px-2 py-1 rounded"
                >
                  <AlertTriangle size={14} className="mr-1" />
                  LOSS: LUNAR OCCULTATION
                </motion.div>
              ) : telemetry.isClosestApproach ? (
                <motion.span
                  key="closest_approach"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="text-sm font-semibold text-nasa-red animate-pulse"
                >
                  ⚡ CLOSEST APPROACH ⚡
                </motion.span>
              ) : (
                <motion.span
                  key={telemetry.phase}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="text-sm font-semibold text-nasa-blue"
                >
                  {telemetry.distanceToMoonKm < 50000 && telemetry.distanceToMoonKm > 0 ? "STATUS: LUNAR FLYBY (ACTIVE)" : (telemetry.phase === 'Lunar Flyby' ? "FREE RETURN ENGAGED" : telemetry.phase)}
                </motion.span>
              )}
            </AnimatePresence>
          </StatRow>

          <StatRow icon={null} label="Distance from Earth">
            <LiveMetric value={telemetry.distanceFromEarthKm} isOcculted={telemetry.isOcculted} unit="km" />
          </StatRow>

          <StatRow icon={null} label="Distance to Moon">
            <LiveMetric value={telemetry.distanceToMoonKm} color="text-gray-200" isOcculted={telemetry.isOcculted} unit="km" />
          </StatRow>

          {telemetry.isClosestApproach && telemetry.estTimeToPeriselenesMs !== null && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              className="py-3 px-3 bg-red-900/30 border border-nasa-red/60 rounded-lg"
            >
              <CountdownTimer milliseconds={telemetry.estTimeToPeriselenesMs} label="ETA Periselene (8,900 km)" />
              <div className="mt-2 text-[9px] text-red-300/80 tracking-widest space-y-1">
                <div>Closure Rate: <span className="font-mono text-red-200">{telemetry.closureRateKmS?.toFixed(2)}</span> km/s</div>
              </div>
            </motion.div>
          )}

          <StatRow icon={<Zap size={14} />} label="Relative Velocity">
            <LiveMetric value={telemetry.relativeVelocityKmH ?? 0} decimals={1} isOcculted={telemetry.isOcculted} unit="km/h" />
          </StatRow>

          <StatRow icon={<Clock size={14} />} label="Mission Elapsed Time">
            <AnimatedNumber value={telemetry.missionElapsedHours} decimals={2} />
            <span className="text-sm text-gray-500 ml-1.5">hrs</span>
          </StatRow>

          <StatRow icon={<Signal size={14} />} label="Comms Latency (RT)">
            {telemetry.isOcculted ? (
              <span className="text-nasa-red font-mono text-xl animate-pulse">ERR_TIMEOUT</span>
            ) : (
              <div>
                <AnimatedNumber value={telemetry.commsLatencyMs} color="text-gray-200" />
                <span className="text-sm text-gray-500 ml-1.5">ms</span>
              </div>
            )}
          </StatRow>
        </div>

        {/* Footer */}
        <div className="mt-5 pt-3 border-t border-white/10 flex items-center justify-between relative z-10">
          <span className="text-[10px] text-gray-600 tracking-widest uppercase">DATA LINK: DSN</span>
          <ConnectionBadge state={telemetry.isOcculted ? 'OFFLINE' : telemetry.connectionState} />
        </div>

        {/* Trajectory legend */}
        <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-4 text-[10px] uppercase tracking-widest text-gray-400 relative z-10">
          <div className="flex items-center gap-2">
            <span className="inline-block w-5 h-[2px] bg-[#00f2ff] shadow-[0_0_6px_rgba(0,242,255,0.8)]" />
            <span>Traveled</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-5 h-[2px] bg-nasa-red" />
            <span>Planned</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
