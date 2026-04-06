import * as THREE from 'three';

export const EARTH_RADIUS_KM = 6371;
export const MOON_RADIUS_KM = 1737.4;

// Keep Earth visually dominant while maintaining physical radius ratio.
export const EARTH_RADIUS_SCENE = 12;
export const MOON_RADIUS_SCENE = EARTH_RADIUS_SCENE * (MOON_RADIUS_KM / EARTH_RADIUS_KM);
export const TARGET_MOON_DISTANCE_SCENE = 170;

export function getDistanceScaleFromTelemetry(telemetry) {
  const moon = telemetry?.moonPosition;
  if (moon && Number.isFinite(moon.x) && Number.isFinite(moon.y) && Number.isFinite(moon.z)) {
    const moonDistKm = Math.sqrt(moon.x * moon.x + moon.y * moon.y + moon.z * moon.z);
    if (moonDistKm > 0) {
      return TARGET_MOON_DISTANCE_SCENE / moonDistKm;
    }
  }

  const fallbackDistKm = 384400;
  return TARGET_MOON_DISTANCE_SCENE / fallbackDistKm;
}

export function kmVectorToScene(vecKm, distanceScale) {
  // Constrain objects to a single mission plane for a clear 2D-style map view.
  // Keep X/Z from telemetry and flatten Y so Earth, Moon, and Orion share one pane.
  return new THREE.Vector3(
    vecKm.x * distanceScale,
    0,
    vecKm.z * distanceScale
  );
}

