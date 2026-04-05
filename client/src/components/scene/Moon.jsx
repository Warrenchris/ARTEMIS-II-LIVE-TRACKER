import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';

const MOON_TEXTURE_URL = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/moon_1024.jpg';

// Moon in scene units: 1 unit = 1000 km → 384.4 units from Earth
export const MOON_SCENE_POSITION = [0, 0, -384.4];

export const Moon = React.memo(() => {
  const moonRef = useRef();

  const [colorMap] = useTexture([MOON_TEXTURE_URL]);

  useFrame((_, delta) => {
    if (moonRef.current) moonRef.current.rotation.y += delta * 0.008;
  });

  return (
    <mesh ref={moonRef} position={MOON_SCENE_POSITION}>
      <sphereGeometry args={[1.737, 48, 48]} />
      <meshStandardMaterial
        map={colorMap}
        roughness={0.95}
        metalness={0.0}
      />
    </mesh>
  );
});

Moon.displayName = 'Moon';
