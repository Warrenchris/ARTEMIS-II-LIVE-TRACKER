import React from 'react';
import { motion } from 'framer-motion';

const CREW = [
  { name: 'Reid Wiseman',    role: 'Commander',           agency: 'NASA' },
  { name: 'Victor Glover',   role: 'Pilot',               agency: 'NASA' },
  { name: 'Christina Koch',  role: 'Mission Specialist 1', agency: 'NASA' },
  { name: 'Jeremy Hansen',   role: 'Mission Specialist 2', agency: 'CSA'  },
];

const CrewMember = ({ name, role, agency }) => (
  <div className="flex items-center gap-3">
    <div className="w-7 h-7 rounded-full bg-nasa-blue/20 border border-nasa-blue/30 flex items-center justify-center shrink-0">
      <span className="text-[10px] text-nasa-blue font-bold">{name.split(' ').map(s => s[0]).join('')}</span>
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex justify-between items-baseline">
        <span className="text-white text-xs font-semibold truncate">{name}</span>
        <span className="text-[10px] font-bold text-nasa-blue tracking-wider shrink-0 ml-2">{agency}</span>
      </div>
      <span className="text-gray-500 text-[10px] truncate block">{role}</span>
    </div>
  </div>
);

export const MissionInfo = React.memo(() => (
  <motion.div
    initial={{ opacity: 0, x: 50 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ duration: 0.8, delay: 0.5 }}
    className="absolute top-8 right-8 w-68 z-10 hidden lg:block pointer-events-auto"
  >
    {/* Spacecraft badge */}
    <div className="flex items-center gap-3 pb-4 border-b border-white/10 mb-4">
      <div className="w-10 h-10 rounded-full bg-nasa-blue/10 border border-nasa-blue/30 flex items-center justify-center">
        <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-nasa-blue" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 2L8 10H2l5 4-2 8 7-4 7 4-2-8 5-4h-6L12 2z" />
        </svg>
      </div>
      <div>
        <div className="text-white text-xs font-bold tracking-wider">ORION CAPSULE</div>
        <div className="text-gray-500 text-[10px] tracking-widest">SLS BLOCK 1 / ARTEMIS II</div>
      </div>
    </div>

    {/* Objectives */}
    <h3 className="text-[10px] font-bold tracking-[0.2em] text-gray-400 uppercase mb-2">
      Mission Objectives
    </h3>
    <ul className="text-gray-300 text-xs leading-relaxed space-y-1.5 mb-5">
      <li className="flex gap-2"><span className="text-nasa-blue mt-0.5">▸</span>First crewed SLS / Orion test flight</li>
      <li className="flex gap-2"><span className="text-nasa-blue mt-0.5">▸</span>Lunar flyby at ~8,900 km altitude</li>
      <li className="flex gap-2"><span className="text-nasa-blue mt-0.5">▸</span>Validate life support for deep-space</li>
      <li className="flex gap-2"><span className="text-nasa-blue mt-0.5">▸</span>Pave the way for Artemis III landing</li>
    </ul>

    {/* Crew */}
    <h3 className="text-[10px] font-bold tracking-[0.2em] text-gray-400 uppercase mb-3">
      Flight Crew
    </h3>
    <div className="space-y-3">
      {CREW.map(c => <CrewMember key={c.name} {...c} />)}
    </div>
  </motion.div>
));

MissionInfo.displayName = 'MissionInfo';
