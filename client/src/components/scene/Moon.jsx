import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { useTelemetryRef } from '../../contexts/TelemetryContext';
import { getMoonPositionAtTime } from './MoonOrbit';

const MOON_TEXTURE_URL = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/moon_1024.jpg';

// Keeping export for backwards compatibility in other modules if any still import it directly without telemetry,
// though all dynamic elements should use getMoonPositionAtTime.
export const MOON_SCENE_POSITION = [0, 0, -384.4];

export const Moon = React.memo(() => {
  const moonRef = useRef();
  const telemetryRef = useTelemetryRef();

  const [colorMap] = useTexture([MOON_TEXTURE_URL]);

  useFrame((_, delta) => {
    if (moonRef.current) {
      // Rotation
      moonRef.current.rotation.y += delta * 0.008;
      
      // Dynamic orbital position based on Kepler physics
      const tel = telemetryRef.current;
      if (tel) {
        const metH = parseFloat(tel.missionElapsedHours) || 0;
        const currentPos = getMoonPositionAtTime(metH);
        moonRef.current.position.copy(currentPos);
      }
    }
  });

  return (
    <mesh ref={moonRef} position={MOON_SCENE_POSITION}>
      <sphereGeometry args={[1.737, 48, 48]} />
      <meshStandardMaterial
        map={colorMap}
        roughness={0.95}
        metalness={0.0}
      />
      {/* ── Lunar Bounce / Albedo Light ── */}
      <pointLight color="#8caebf" intensity={1.5} distance={20} decay={2.0} />
    </mesh>
  );
});

Moon.displayName = 'Moon';
