import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';

// High-quality free textures from Solar System Scope (CC-BY license)
const EARTH_TEXTURE_URL    = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_atmos_2048.jpg';
const EARTH_NORMAL_URL     = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_normal_2048.jpg';
const EARTH_SPECULAR_URL   = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_specular_2048.jpg';

export const Earth = React.memo(() => {
  const earthRef = useRef();
  const atmoRef  = useRef();

  // Load textures — fallback gracefully if fetch fails (three.js does this by default)
  const [colorMap, normalMap, specularMap] = useTexture([
    EARTH_TEXTURE_URL,
    EARTH_NORMAL_URL,
    EARTH_SPECULAR_URL,
  ]);

  useFrame((_, delta) => {
    if (earthRef.current)  earthRef.current.rotation.y  += delta * 0.04;
    if (atmoRef.current)   atmoRef.current.rotation.y   += delta * 0.02;
  });

  return (
    <group>
      {/* Earth surface */}
      <mesh ref={earthRef} position={[0, 0, 0]}>
        <sphereGeometry args={[6.371, 48, 48]} />
        <meshPhongMaterial
          map={colorMap}
          normalMap={normalMap}
          specularMap={specularMap}
          specular={new THREE.Color('#aaccff')}
          shininess={12}
        />
      </mesh>

      {/* Atmospheric glow shell */}
      <mesh ref={atmoRef} position={[0, 0, 0]}>
        <sphereGeometry args={[6.55, 48, 48]} />
        <meshBasicMaterial
          color="#4db8ff"
          transparent
          opacity={0.08}
          side={THREE.FrontSide}
          depthWrite={false}
        />
      </mesh>

      {/* Outer atmospheric haze */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[6.72, 32, 32]} />
        <meshBasicMaterial
          color="#1a6bac"
          transparent
          opacity={0.04}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
});

Earth.displayName = 'Earth';
