import React from 'react';
import { motion } from 'framer-motion';
import { useCameraContext } from '../../contexts/CameraContext';
import { Globe2, Rocket, MoonStar } from 'lucide-react';

export const CameraControlsUI = () => {
  const { focusTarget, setFocusTarget } = useCameraContext();

  const targets = [
    { id: 'earth', label: 'Earth', icon: Globe2 },
    { id: 'spacecraft', label: 'Orion', icon: Rocket },
    { id: 'moon', label: 'Moon', icon: MoonStar },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.2 }}
      className="absolute bottom-[170px] left-1/2 -translate-x-1/2 flex items-center gap-1 glass-panel p-1.5 z-20 pointer-events-auto"
    >
      {targets.map((t) => {
        const isActive = focusTarget === t.id;
        const Icon = t.icon;
        
        return (
          <button
            key={t.id}
            onClick={() => setFocusTarget(t.id)}
            className={`
              relative flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-300
              ${isActive ? 'text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}
            `}
          >
            {isActive && (
              <motion.div
                layoutId="activeTargetIndicator"
                className="absolute inset-0 bg-nasa-blue/30 border border-nasa-blue/50 rounded-lg"
                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              />
            )}
            <Icon size={14} className="relative z-10" />
            <span className="relative z-10 text-[10px] uppercase font-bold tracking-widest">{t.label}</span>
          </button>
        );
      })}
    </motion.div>
  );
};
