import React, { Suspense, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars, Preload } from '@react-three/drei';
import { Earth } from './Earth';
import { Moon } from './Moon';
import { Spacecraft } from './Spacecraft';
import { Trajectory } from './Trajectory';
import { CameraController } from './CameraController';
import { ErrorBoundary } from '../ErrorBoundary';
import { LoadingScreen } from '../LoadingScreen';

const SceneFallback = () => null;

export const SpaceScene = () => {
  const [isLoading, setIsLoading] = useState(true);

  const handleCreated = useCallback(() => {
    // Delay dismissal slightly to allow initial render + textures to settle
    setTimeout(() => setIsLoading(false), 2200);
  }, []);

  return (
    <div className="absolute inset-0 w-full h-full bg-space-black z-0">
      {/* Loading screen disappears after renderer is ready */}
      <LoadingScreen isVisible={isLoading} />

      <ErrorBoundary>
        <Canvas
          camera={{ position: [60, 25, 80], fov: 42, near: 0.1, far: 2000 }}
          gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
          dpr={[1, 1.5]}           // max pixel ratio 1.5 for balance of quality/perf
          onCreated={handleCreated}
        >
          <color attach="background" args={['#050B14']} />

          {/* Lighting */}
          <ambientLight intensity={0.05} />
          <directionalLight
            position={[300, 60, 150]}
            intensity={3.5}
            castShadow={false}
            color="#fff8ee"
          />
          {/* Subtle Earth-shine fill light */}
          <pointLight position={[0, 0, 0]} color="#4db8ff" intensity={0.4} distance={50} />

          <Suspense fallback={<SceneFallback />}>
            {/* Starfield — two layers for depth */}
            <Stars radius={500} depth={80} count={7000} factor={5} saturation={0.3} fade speed={0.4} />
            <Stars radius={150} depth={30} count={2000} factor={2} saturation={0}   fade speed={0.2} />

            <Earth />
            <Moon />
            <Spacecraft />
            <Trajectory />

            <Preload all />
          </Suspense>

          <CameraController />
        </Canvas>
      </ErrorBoundary>
    </div>
  );
};
