import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useTelemetry } from '../../contexts/TelemetryContext';

// Moon Orbital Constants
export const MOON_A = 384.4; // Semi-major axis in scene units (384,400 km)
export const MOON_E = 0.0549; // Eccentricity
export const MOON_PERIOD_HOURS = 27.32 * 24; // ~655.68 hours

// Calculate the position of the Moon given an elapsed time in hours
// T0 represents the launch epoch. We assume a specific mean anomaly at launch 
// to align the moon physically with the trajectory interception.
export function getMoonPositionAtTime(elapsedHours) {
  const b = MOON_A * Math.sqrt(1 - MOON_E * MOON_E);
  
  // Artemis II timeline: Flyby at ~120h-144h. 
  // Let's calibrate Mean Anomaly so the moon is near the +Z or -Z axis at flyby.
  // We'll set M0 so that at 130 hours, it's roughly at the top of the orbit.
  const M0 = Math.PI; // Calibration offset for Artemis II specific geometry
  
  const M = M0 + (elapsedHours / MOON_PERIOD_HOURS) * Math.PI * 2;
  
  // Solve Kepler's equation: E - e*sin(E) = M using Newton-Raphson
  let E = M;
  for (let i = 0; i < 10; i++) {
    E = E - (E - MOON_E * Math.sin(E) - M) / (1 - MOON_E * Math.cos(E));
  }
  
  // True anomaly mapped to X-Z plane (since Y is up)
  // Shift focus to Earth (0,0,0)
  const x = b * Math.sin(E);
  const z = -MOON_A * (Math.cos(E) - MOON_E);
  
  return new THREE.Vector3(x, 0, z);
}

export const MoonOrbit = React.memo(() => {
  // We don't redraw the whole orbit geometry on every tick,
  // it's a static ellipse representing the full path in space.
  const points = useMemo(() => {
    const pts = [];
    const segments = 256;
    const b = MOON_A * Math.sqrt(1 - MOON_E * MOON_E);
    
    for (let i = 0; i <= segments; i++) {
      const E = (i / segments) * Math.PI * 2;
      const x = b * Math.sin(E);
      const z = -MOON_A * (Math.cos(E) - MOON_E);
      pts.push(new THREE.Vector3(x, 0, z));
    }
    
    return pts;
  }, []);

  const orbitGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    return geo;
  }, [points]);

  return (
    <line geometry={orbitGeometry}>
      <lineDashedMaterial 
        color="#ffffff" 
        transparent 
        opacity={0.4} 
        dashSize={4} 
        gapSize={4} 
        linewidth={1} 
      />
    </line>
  );
});

MoonOrbit.displayName = 'MoonOrbit';
