import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { useTelemetryRef } from '../../contexts/TelemetryContext';
import { getDistanceScaleFromTelemetry, kmVectorToScene, MOON_RADIUS_SCENE } from './layout';
import * as THREE from 'three';

const MOON_TEXTURE_URL = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/moon_1024.jpg';

export const Moon = React.memo(() => {
  const moonRef = useRef();
  const glowRef = useRef();
  const telemetryRef = useTelemetryRef();

  const [colorMap] = useTexture([MOON_TEXTURE_URL]);

  useFrame((state, delta) => {
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

    // Closest approach glow effect
    if (glowRef.current) {
      const moonDist = parseFloat(telemetryRef.current?.distanceToMoonKm) || 0;
      const isClosestApproach = moonDist < 9_500 && moonDist > 0;

      if (isClosestApproach) {
        const glowPulse = 0.4 + 0.6 * Math.sin(state.clock.elapsedTime * 2.5);
        glowRef.current.material.color.setRGB(1, 0.2 + 0.5 * glowPulse, 0.2 + 0.5 * glowPulse);
        glowRef.current.material.opacity = 0.3 + 0.2 * glowPulse;
        glowRef.current.scale.setScalar(1.0 + 0.15 * Math.sin(state.clock.elapsedTime * 3));
      } else {
        glowRef.current.material.color.set('#FF4444');
        glowRef.current.material.opacity = 0;
        glowRef.current.scale.setScalar(1.0);
      }
    }
  });

  return (
    <group>
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

      {/* ── Pulsing Glow Overlay for Closest Approach ── */}
      <mesh ref={glowRef} position={[0, 0, 0]} scale={1.0}>
        <sphereGeometry args={[MOON_RADIUS_SCENE + 0.5, 48, 48]} />
        <meshBasicMaterial
          color="#FF4444"
          opacity={0}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
});

Moon.displayName = 'Moon';
