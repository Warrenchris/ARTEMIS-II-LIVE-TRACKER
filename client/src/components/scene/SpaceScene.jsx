import React, { Suspense, useState, useCallback, useRef } from 'react';
import { Canvas }                                         from '@react-three/fiber';
import { OrbitControls, Stars, Preload }                  from '@react-three/drei';
import { Earth }                                          from './Earth';
import { Moon }                                           from './Moon';
import { Spacecraft }                                     from './Spacecraft';
import { MoonOrbit }                                      from './MoonOrbit';
import { SpacecraftTrajectoryWithDashes }                 from './SpacecraftTrajectory';
import { CameraController }                               from './CameraController';
import { ErrorBoundary }                                  from '../ErrorBoundary';
import { LoadingScreen }                                  from '../LoadingScreen';

import * as THREE                                         from 'three';
import { useTexture }                                     from '@react-three/drei';

const SceneFallback = () => null;

const Sun = () => {
  const sunPos = [-1000, 200, -500];
  const lensflareTex = useTexture('https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/lensflare/lensflare0.png');

  return (
    <group>
      <directionalLight
        position={sunPos}
        intensity={5.0}
        color="#ffffea"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0001}
      >
        <orthographicCamera attach="shadow-camera" args={[-400, 400, 400, -400, 0.1, 2500]} />
      </directionalLight>
      <sprite position={sunPos} scale={[250, 250, 1]}>
        <spriteMaterial map={lensflareTex} color="#ffffff" blending={THREE.AdditiveBlending} depthWrite={false} transparent />
      </sprite>
    </group>
  );
};

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
          shadows
          camera={{ position: [60, 25, 80], fov: 42, near: 0.1, far: 2000 }}
          gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
          dpr={[1, 1.5]}           // max pixel ratio 1.5 for balance of quality/perf
          onCreated={handleCreated}
        >
          <color attach="background" args={['#050B14']} />

          {/* Lighting */}
          <ambientLight intensity={0.02} />
          {/* Earth-shine fill light - high decay creates pure blackness on Lunar far side */}
          <pointLight position={[0, 0, 0]} color="#4db8ff" intensity={4} distance={400} decay={2.5} />

          <Suspense fallback={<SceneFallback />}>
            {/* Starfield — two layers for depth */}
            <Stars radius={500} depth={80} count={7000} factor={5} saturation={0.3} fade speed={0.4} />
            <Stars radius={150} depth={30} count={2000} factor={2} saturation={0}   fade speed={0.2} />

            <Sun />
            <Earth />
            <Moon />
            <Spacecraft />

            {/*
              Trajectory renders the Path-Conics physics simulation.
            */}
            <MoonOrbit />
            <SpacecraftTrajectoryWithDashes />

            <Preload all />
          </Suspense>

          <CameraController />
        </Canvas>
      </ErrorBoundary>
    </div>
  );
};
