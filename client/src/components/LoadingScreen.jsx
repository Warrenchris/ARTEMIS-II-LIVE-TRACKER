import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const BOOT_MESSAGES = [
  'Initializing Mission Control...',
  'Establishing DSN link...',
  'Loading spacecraft telemetry...',
  'Calibrating 3D navigation systems...',
  'Connecting to Artemis II...',
];

export const LoadingScreen = ({ isVisible }) => {
  const [msgIndex, setMsgIndex] = React.useState(0);

  React.useEffect(() => {
    const id = setInterval(() => {
      setMsgIndex((i) => (i + 1) % BOOT_MESSAGES.length);
    }, 900);
    return () => clearInterval(id);
  }, []);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="loading"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 1.2 } }}
          className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-space-black"
        >
          {/* Animated Logo / Orbit rings */}
          <div className="relative w-28 h-28 mb-10">
            {/* Outer orbit */}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
              className="absolute inset-0 rounded-full border border-nasa-blue/30"
            />
            {/* Middle orbit */}
            <motion.div
              animate={{ rotate: -360 }}
              transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
              className="absolute inset-3 rounded-full border border-nasa-blue/50"
            />
            {/* Inner pulse */}
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.div
                animate={{ scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="w-10 h-10 rounded-full bg-nasa-blue/20 border border-nasa-blue flex items-center justify-center"
              >
                {/* Tiny spacecraft dot */}
                <div className="w-2 h-2 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
              </motion.div>
            </div>
            {/* Orbiting dot */}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
              className="absolute inset-0"
            >
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-nasa-red shadow-[0_0_10px_rgba(252,61,33,0.8)]" />
            </motion.div>
          </div>

          {/* Title */}
          <h1 className="text-white text-2xl font-bold tracking-[0.3em] uppercase mb-2">
            ARTEMIS II
          </h1>
          <p className="text-gray-500 text-sm tracking-widest uppercase mb-10">
            Mission Control
          </p>

          {/* Status message */}
          <AnimatePresence mode="wait">
            <motion.p
              key={msgIndex}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35 }}
              className="text-nasa-blue text-xs font-mono tracking-widest"
            >
              {BOOT_MESSAGES[msgIndex]}
            </motion.p>
          </AnimatePresence>

          {/* Progress bar */}
          <div className="mt-6 w-56 h-px bg-white/10 rounded overflow-hidden">
            <motion.div
              animate={{ x: ['-100%', '100%'] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              className="h-full w-1/2 bg-gradient-to-r from-transparent via-nasa-blue to-transparent"
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
