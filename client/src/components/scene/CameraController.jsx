import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useCameraContext } from '../../contexts/CameraContext';
import { useTelemetryRef } from '../../contexts/TelemetryContext';
import { getMoonPositionAtTime } from './MoonOrbit';

const SCALE = 1 / 1000;

export const CameraController = () => {
  const controlsRef = useRef();
  const { focusTarget } = useCameraContext();
  const telemetryRef = useTelemetryRef();
  const { camera } = useThree();

  // Pre-allocate vectors to avoid runtime allocation in the useFrame loop
  const earthVec = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  const tempVec  = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    if (!controlsRef.current) return;
    const ctrl = controlsRef.current;

    // 1. Determine where we want the target to be this frame
    if (focusTarget === 'earth') {
      tempVec.copy(earthVec);
    } else if (focusTarget === 'moon') {
      const tel = telemetryRef.current;
      const metH = parseFloat(tel?.missionElapsedHours) || 0;
      tempVec.copy(getMoonPositionAtTime(metH));
    } else if (focusTarget === 'spacecraft') {
      const tel = telemetryRef.current;
      const metH = parseFloat(tel?.missionElapsedHours) || 0;
      const earthDistKm = parseFloat(tel?.distanceFromEarthKm) || 0;
      const moonDistKm  = parseFloat(tel?.distanceToMoonKm)    || 384400;
      
      const currentMoonNode = getMoonPositionAtTime(metH);
      const t  = Math.min(1, earthDistKm / (earthDistKm + moonDistKm));
      tempVec.copy(earthVec).lerp(currentMoonNode, t);
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
