import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useTelemetry } from '../../contexts/TelemetryContext';
import { getDistanceScaleFromTelemetry, kmVectorToScene } from './layout';

export const MoonOrbit = React.memo(() => {
  const telemetry = useTelemetry();
  const moonVectors = telemetry?.trajectoryVectors?.moon ?? [];
  const distanceScale = getDistanceScaleFromTelemetry(telemetry);
  const currentMoonPos = telemetry?.moonPosition ?? null;

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
    const baseA = meanMoonDistanceKm * distanceScale; // semi-major axis in scene units
    const current = currentMoonPos ? kmVectorToScene(currentMoonPos, distanceScale) : null;
    const eps = 1e-6;

    // Estimate orbital major-axis orientation from live Moon vector history.
    // This aligns the analytic guide to the fetched ephemeris plane projection.
    let orientation = 0;
    if (points.length >= 3) {
      let meanX = 0;
      let meanZ = 0;
      for (const p of points) {
        meanX += p.x;
        meanZ += p.z;
      }
      meanX /= points.length;
      meanZ /= points.length;

      let sxx = 0;
      let szz = 0;
      let sxz = 0;
      for (const p of points) {
        const dx = p.x - meanX;
        const dz = p.z - meanZ;
        sxx += dx * dx;
        szz += dz * dz;
        sxz += dx * dz;
      }
      orientation = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    }

    const cosO = Math.cos(orientation);
    const sinO = Math.sin(orientation);
    const rotateToLocal = (v) => ({
      x: v.x * cosO + v.z * sinO,
      z: -v.x * sinO + v.z * cosO,
    });
    const rotateToWorld = (x, z) => ({
      x: x * cosO - z * sinO,
      z: x * sinO + z * cosO,
    });

    // Scale the analytic ellipse so the current live Moon position lies on it,
    // while keeping Earth fixed at one focus (origin) and honoring orientation.
    let orbitScale = 1;
    if (current) {
      const local = rotateToLocal(current);
      const rCurrent = Math.hypot(local.x, local.z);
      const theta = Math.atan2(local.z, local.x);
      const pBase = baseA * (1 - ecc * ecc);
      const rModel = pBase / (1 + ecc * Math.cos(theta));
      if (rModel > eps && Number.isFinite(rCurrent)) {
        orbitScale = rCurrent / rModel;
      }
    }

    const a = baseA * orbitScale;
    const p = a * (1 - ecc * ecc); // semi-latus rectum
    const segments = 720;

    // Start sampling at current anomaly so the first orbit point is exactly the live moon point.
    let startAnomaly = 0;
    if (current) {
      const local = rotateToLocal(current);
      startAnomaly = Math.atan2(local.z, local.x);
    }

    const orbit = [];
    for (let i = 0; i <= segments; i++) {
      const f = startAnomaly + (i / segments) * Math.PI * 2;
      const r = p / (1 + ecc * Math.cos(f));
      const xLocal = r * Math.cos(f);
      const zLocal = r * Math.sin(f);
      const world = rotateToWorld(xLocal, zLocal);
      orbit.push(new THREE.Vector3(world.x, 0, world.z));
    }

    return orbit;
  }, [distanceScale, currentMoonPos, points]);

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
