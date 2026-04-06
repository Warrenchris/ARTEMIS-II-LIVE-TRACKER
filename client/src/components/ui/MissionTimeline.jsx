import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTelemetry } from '../../contexts/TelemetryContext';
import { Flag, Rocket, Orbit, PlaneLanding, ArrowUpCircle, Globe2, Waves } from 'lucide-react';

// ── Phase Definitions (source of truth — mirrors server PHASES array) ─────────
export const PHASES = [
  { id: 'launch',      label: 'Launch',               icon: Rocket          },
  { id: 'earth_orbit', label: 'Earth Orbit',           icon: Globe2          },
  { id: 'tli',         label: 'TLI',                   icon: ArrowUpCircle   },
  { id: 'transit',     label: 'Lunar Transit',          icon: Orbit           },
  { id: 'flyby',       label: 'Approach/Flyby',         icon: Orbit           },
  { id: 'closest_approach', label: '⚡ Closest Approach ⚡', icon: Orbit       },
  { id: 'return',      label: 'Return',                 icon: PlaneLanding    },
  { id: 'splashdown',  label: 'Splashdown',             icon: Waves           },
];

const MilestoneNode = ({ milestone, isActive, isPassed, index }) => {
  const Icon = milestone.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      className="relative z-10 flex flex-col items-center gap-2 flex-1"
    >
      {/* Icon circle */}
      <div className={`
        relative w-9 h-9 rounded-full flex items-center justify-center border-2
        transition-all duration-700
        ${isActive
          ? 'bg-nasa-blue border-white text-white shadow-[0_0_20px_#0B3D91] scale-110'
          : isPassed
            ? 'bg-white/90 border-white text-space-black'
            : 'bg-space-black border-gray-700 text-gray-600'}
      `}>
        <Icon size={14} />
        {isActive && (
          <span className="absolute inset-0 rounded-full border-2 border-nasa-blue/60 animate-ping" />
        )}
      </div>

      {/* Label */}
      <span className={`
        text-[10px] text-center font-medium leading-tight max-w-[64px]
        ${isActive ? 'text-white' : isPassed ? 'text-gray-400' : 'text-gray-600'}
      `}>
        {milestone.label}
      </span>
    </motion.div>
  );
};

export const MissionTimeline = React.memo(() => {
  const { phaseId, distanceToMoonKm, isClosestApproach } = useTelemetry();

  const activeIndex = useMemo(() => {
    // Closest approach takes highest priority
    if (isClosestApproach) {
      return PHASES.findIndex(p => p.id === 'closest_approach');
    }

    const livePhaseAlias = {
      deep_space_transit: 'transit',
      lunar_influence: 'flyby',
      gravity_assist_active: 'flyby',
    };

    const normalizedPhaseId = livePhaseAlias[phaseId] ?? phaseId;
    const idx = PHASES.findIndex(p => p.id === normalizedPhaseId);
    if (idx !== -1) return idx;

    // Distance-derived fallback for unrecognized live labels.
    const moonDist = parseFloat(distanceToMoonKm);
    if (Number.isFinite(moonDist) && moonDist > 0) {
      if (moonDist < 60_000) return PHASES.findIndex((p) => p.id === 'flyby');
      return PHASES.findIndex((p) => p.id === 'transit');
    }

    return idx === -1 ? 0 : idx;
  }, [phaseId, distanceToMoonKm, isClosestApproach]);

  const progressPct = useMemo(() =>
    PHASES.length <= 1 ? 0 : (activeIndex / (PHASES.length - 1)) * 100,
    [activeIndex]
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.3 }}
      className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[calc(100%-3rem)] max-w-5xl glass-panel px-6 py-5 z-10 pointer-events-auto backdrop-blur-sm shadow-2xl"
    >
      {/* Header */}
      <div className="flex justify-between items-center mb-5">
        <h3 className="text-white text-xs font-bold tracking-[0.2em] uppercase">Mission Timeline</h3>
        <span className="text-[10px] text-nasa-blue font-bold tracking-[0.2em] uppercase">Artemis II</span>
      </div>

      {/* Track */}
      <div className="relative flex items-center w-full">
        {/* Background rail */}
        <div className="absolute top-[18px] left-0 right-0 h-px bg-white/10 z-0" />

        {/* Animated progress rail */}
        <motion.div
          className="absolute top-[18px] left-0 h-px bg-nasa-blue z-0 shadow-[0_0_8px_#0B3D91]"
          initial={{ width: 0 }}
          animate={{ width: `${progressPct}%` }}
          transition={{ duration: 1.2, ease: 'easeInOut' }}
        />

        {/* Milestone nodes */}
        {PHASES.map((phase, idx) => (
          <MilestoneNode
            key={phase.id}
            milestone={phase}
            index={idx}
            isActive={idx === activeIndex}
            isPassed={idx < activeIndex}
          />
        ))}
      </div>
    </motion.div>
  );
});

MissionTimeline.displayName = 'MissionTimeline';
