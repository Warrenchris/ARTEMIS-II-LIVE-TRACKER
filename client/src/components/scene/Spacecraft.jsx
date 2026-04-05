import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useTelemetryRef } from '../../contexts/TelemetryContext';
import * as THREE from 'three';
import { MOON_SCENE_POSITION } from './Moon';

const SCALE   = 1 / 1000;    // km → scene units
const EPSILON = 0.0005;       // skip lerp below this positional delta

export const Spacecraft = () => {
  const groupRef     = useRef();
  const glowRef      = useRef();
  const telemetryRef = useTelemetryRef();         // ← ref, not state — no re-renders

  // Stable target position — mutated inside useFrame, no state involved
  const targetPos = useRef(new THREE.Vector3(0, 0, -10));
  const moonVec   = useMemo(() => new THREE.Vector3(...MOON_SCENE_POSITION), []);

  useFrame((state, delta) => {
    const tel = telemetryRef.current;
    const p   = tel?.position;

    // Update target from latest telemetry ref (imperative — never triggers render)
    if (p) {
      targetPos.current.set(p.x * SCALE, p.y * SCALE, p.z * SCALE);
    }

    const g = groupRef.current;
    if (!g) return;

    // Only lerp if distance from target is non-trivial
    const dist = g.position.distanceTo(targetPos.current);
    if (dist > EPSILON) {
      g.position.lerp(targetPos.current, Math.min(1, delta * 2));
    }

    // Orient towards Moon
    g.lookAt(moonVec);

    // Engine glow pulse
    if (glowRef.current) {
      const t = state.clock.elapsedTime;
      glowRef.current.material.opacity = 0.4 + Math.sin(t * 4) * 0.15;
      glowRef.current.scale.setScalar(1 + Math.sin(t * 6) * 0.08);
    }
  });

  return (
    <group ref={groupRef} position={[0, 0, -10]}>
      {/* ── Service Module (cylinder) ── */}
      <mesh position={[0, -0.6, 0]}>
        <cylinderGeometry args={[0.35, 0.4, 0.9, 16]} />
        <meshStandardMaterial
          color="#888899"
          roughness={0.4}
          metalness={0.7}
        />
      </mesh>

      {/* ── Crew Module (capsule cone) ── */}
      <mesh position={[0, 0.35, 0]}>
        <coneGeometry args={[0.35, 0.85, 16]} />
        <meshStandardMaterial
          color="#c8c8d8"
          roughness={0.3}
          metalness={0.8}
          emissive="#0B3D91"
          emissiveIntensity={0.25}
        />
      </mesh>

      {/* ── Solar Arrays (flat boxes) ── */}
      <mesh position={[1.1, -0.6, 0]} rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[0.04, 1.6, 0.7]} />
        <meshStandardMaterial color="#1a2a5a" roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[-1.1, -0.6, 0]} rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[0.04, 1.6, 0.7]} />
        <meshStandardMaterial color="#1a2a5a" roughness={0.5} metalness={0.3} />
      </mesh>

      {/* ── Engine Nozzle ── */}
      <mesh position={[0, -1.15, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.22, 0.35, 12]} />
        <meshStandardMaterial color="#555566" roughness={0.6} metalness={0.9} />
      </mesh>

      {/* ── Engine Glow (animated) ── */}
      <mesh ref={glowRef} position={[0, -1.45, 0]}>
        <sphereGeometry args={[0.24, 12, 12]} />
        <meshBasicMaterial
          color="#FC3D21"
          transparent
          opacity={0.4}
          depthWrite={false}
        />
      </mesh>

      {/* ── Point light from engine ── */}
      <pointLight
        position={[0, -1.4, 0]}
        color="#FC3D21"
        intensity={3}
        distance={8}
        decay={2}
      />

      {/* ── Visual Locator (Always visible) ── */}
      <Html center zIndexRange={[100, 0]}>
        <div className="w-5 h-5 rounded-full border border-nasa-blue/50 flex items-center justify-center pointer-events-none">
          <div className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_10px_#4db8ff]"></div>
        </div>
      </Html>
    </group>
  );
};
