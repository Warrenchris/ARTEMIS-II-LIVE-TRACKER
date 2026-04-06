import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { useTelemetryRef } from '../../contexts/TelemetryContext';
import { getDistanceScaleFromTelemetry, kmVectorToScene, MOON_RADIUS_SCENE } from './layout';

const MOON_TEXTURE_URL = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/moon_1024.jpg';

export const Moon = React.memo(() => {
  const moonRef = useRef();
  const telemetryRef = useTelemetryRef();

  const [colorMap] = useTexture([MOON_TEXTURE_URL]);

  useFrame((_, delta) => {
    if (moonRef.current) {
      // Rotation
      moonRef.current.rotation.y += delta * 0.008;

      // Position from live ephemeris vectors (geocentric km -> scene units)
      const moonPos = telemetryRef.current?.moonPosition;
      if (moonPos && Number.isFinite(moonPos.x) && Number.isFinite(moonPos.y) && Number.isFinite(moonPos.z)) {
        const distanceScale = getDistanceScaleFromTelemetry(telemetryRef.current);
        moonRef.current.position.copy(kmVectorToScene(moonPos, distanceScale));
      }
    }
  });

  return (
    <mesh ref={moonRef} position={[0, 0, 0]} castShadow receiveShadow>
      <sphereGeometry args={[MOON_RADIUS_SCENE, 48, 48]} />
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
