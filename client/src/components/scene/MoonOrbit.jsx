import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useTelemetry } from '../../contexts/TelemetryContext';
import { getDistanceScaleFromTelemetry, kmVectorToScene } from './layout';

export const MoonOrbit = React.memo(() => {
  const telemetry = useTelemetry();
  const moonVectors = telemetry?.trajectoryVectors?.moon ?? [];
  const distanceScale = getDistanceScaleFromTelemetry(telemetry);

  const points = useMemo(() => {
    return moonVectors
      .filter((v) => Number.isFinite(v?.x) && Number.isFinite(v?.y) && Number.isFinite(v?.z))
      .map((v) => kmVectorToScene(v, distanceScale));
  }, [moonVectors, distanceScale]);

  // Reference lunar orbit (Kepler ellipse with Earth at one focus).
  // This gives a persistent "Moon revolves around Earth" guide on the map.
  const referenceOrbitPoints = useMemo(() => {
    const ecc = 0.0549;
    const meanMoonDistanceKm = 384400;
    const a = meanMoonDistanceKm * distanceScale; // semi-major axis in scene units
    const b = a * Math.sqrt(1 - ecc * ecc);
    const c = a * ecc; // focus offset from center; Earth at origin => center shifted +c on X
    const segments = 360;
    const orbit = [];
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      const x = c + a * Math.cos(t);
      const z = b * Math.sin(t);
      orbit.push(new THREE.Vector3(x, 0, z));
    }
    return orbit;
  }, [distanceScale]);

  const orbitGeometry = useMemo(() => {
    if (points.length < 2) return null;
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [points]);

  const referenceOrbitGeometry = useMemo(() => {
    return new THREE.BufferGeometry().setFromPoints(referenceOrbitPoints);
  }, [referenceOrbitPoints]);

  return (
    <group>
      {/* Always-visible Earth-centered lunar orbital guide */}
      <line geometry={referenceOrbitGeometry}>
        <lineBasicMaterial
          color="#9bb6ff"
          transparent
          opacity={0.45}
        />
      </line>

      {/* Live/predicted sampled Moon path from fetched vectors */}
      {orbitGeometry && (
        <line geometry={orbitGeometry}>
          <lineBasicMaterial
            color="#ffffff"
            transparent
            opacity={0.65}
          />
        </line>
      )}
    </group>
  );
});

MoonOrbit.displayName = 'MoonOrbit';
