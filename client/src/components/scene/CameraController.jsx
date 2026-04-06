import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useCameraContext } from '../../contexts/CameraContext';
import { useTelemetryRef } from '../../contexts/TelemetryContext';
import { getDistanceScaleFromTelemetry, kmVectorToScene } from './layout';

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

    const distanceScale = getDistanceScaleFromTelemetry(telemetryRef.current);

    // 1. Determine where we want the target to be this frame
    if (focusTarget === 'earth') {
      tempVec.copy(earthVec);
    } else if (focusTarget === 'moon') {
      const moon = telemetryRef.current?.moonPosition;
      if (moon && Number.isFinite(moon.x) && Number.isFinite(moon.y) && Number.isFinite(moon.z)) {
        tempVec.copy(kmVectorToScene(moon, distanceScale));
      }
    } else if (focusTarget === 'spacecraft') {
      const pos = telemetryRef.current?.position;
      if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z)) {
        tempVec.copy(kmVectorToScene(pos, distanceScale));
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
      minDistance={2.5}
      target={[0, 0, 0]}
      maxPolarAngle={Math.PI * 0.92}
      minPolarAngle={Math.PI * 0.08}
      zoomSpeed={0.7}
      rotateSpeed={0.5}
      panSpeed={0.5}
      makeDefault
    />
  );
};
