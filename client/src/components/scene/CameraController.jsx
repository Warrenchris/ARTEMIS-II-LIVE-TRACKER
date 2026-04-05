import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useCameraContext } from '../../contexts/CameraContext';
import { useTelemetryRef } from '../../contexts/TelemetryContext';
import { MOON_SCENE_POSITION } from './Moon';

const SCALE = 1 / 1000;

export const CameraController = () => {
  const controlsRef = useRef();
  const { focusTarget } = useCameraContext();
  const telemetryRef = useTelemetryRef();
  const { camera } = useThree();

  // Pre-allocate vectors to avoid runtime allocation in the useFrame loop
  const earthVec = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  const moonVec  = useMemo(() => new THREE.Vector3(...MOON_SCENE_POSITION), []);
  const tempVec  = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    if (!controlsRef.current) return;
    const ctrl = controlsRef.current;

    // 1. Determine where we want the target to be this frame
    if (focusTarget === 'earth') {
      tempVec.copy(earthVec);
    } else if (focusTarget === 'moon') {
      tempVec.copy(moonVec);
    } else if (focusTarget === 'spacecraft') {
      const tel = telemetryRef.current;
      if (tel && tel.position) {
        // Spacecraft coordinate system matching Spacecraft.jsx
        tempVec.set(
          tel.position.x * SCALE,
          tel.position.y * SCALE,
          tel.position.z * SCALE
        );
      } else {
        tempVec.copy(earthVec); // Fallback if no telemetry
      }
    }

    // 2. Smoothly lerp the OrbitControls target to the desired tempVec position
    // A speed of 4 * delta provides a fast but non-jarring pan that catches up gracefully.
    ctrl.target.lerp(tempVec, Math.min(1, delta * 4));

    // Must routinely call update when programmatically changing the target
    ctrl.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan={true}
      enableZoom={true}
      enableRotate={true}
      maxDistance={1000} // Large enough for Moon view
      minDistance={1.2}  // Close enough for Spacecraft view
      zoomSpeed={0.7}
      rotateSpeed={0.5}
      panSpeed={0.5}
      makeDefault
    />
  );
};
