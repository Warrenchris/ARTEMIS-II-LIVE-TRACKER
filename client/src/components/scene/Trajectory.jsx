/**
 * Trajectory — Optimised Imperative Implementation
 * =================================================
 * Uses useTelemetryRef() (not useTelemetry()) so it NEVER causes a React
 * re-render when telemetry updates arrive. All geometry mutation happens
 * inside useFrame, directly on the BufferGeometry's position attribute.
 *
 * Architecture:
 *  - Two THREE.BufferGeometry instances are created once and held in refs.
 *  - useFrame reads the latest telemetry from the mutable ref (no state).
 *  - When earthDistance or moonDistance changes by more than UPDATE_THRESHOLD_KM,
 *    both geometries are recomputed and their position buffers updated in-place.
 *  - The QuadraticBezierCurve3 control point is computed dynamically from the
 *    spacecraft's mission progress (0–1), providing a smooth arc that "closes"
 *    as the craft approaches the Moon.
 */

import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTelemetryRef } from '../../contexts/TelemetryContext';
import * as THREE from 'three';
import { MOON_SCENE_POSITION } from './Moon';

// ─── Config ───────────────────────────────────────────────────────────────────

const SCALE               = 1 / 1000;          // km → scene units
const CURVE_RESOLUTION    = 100;                // points to sample from full arc
const UPDATE_THRESHOLD_KM = 50;                // minimum distance change before recompute (km)

const EARTH_VEC = new THREE.Vector3(0, 0, 0);
const MOON_VEC  = new THREE.Vector3(...MOON_SCENE_POSITION);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Computes the Bezier control point for the translunar arc.
 * As the spacecraft progresses (t: 0→1), the perpendicular displacement
 * ramps up then back down, creating an authentic mid-arc bulge.
 *
 * @param {number} t Mission progress 0–1 along the Earth→Moon line
 * @returns {THREE.Vector3}
 */
function computeControlPoint(t) {
  // Sinusoidal lift — peaks at t=0.5 (mid-journey)
  const lift = Math.sin(Math.PI * Math.max(0, Math.min(1, t))) * 55;
  return new THREE.Vector3(30 + lift * 0.5, lift, -180 + t * -40);
}

/**
 * Writes the first `count` points of a QuadraticBezierCurve3 into a
 * Float32Array in-place, starting at parameter `tStart` and ending at `tEnd`.
 *
 * @param {Float32Array}               buf      Target array (length ≥ count*3)
 * @param {THREE.QuadraticBezierCurve3} curve
 * @param {number}                     tStart   0–1
 * @param {number}                     tEnd     0–1
 * @param {number}                     count    Number of points to write
 */
function fillBuffer(buf, curve, tStart, tEnd, count) {
  const step = count <= 1 ? 0 : (tEnd - tStart) / (count - 1);
  const tmp  = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    curve.getPoint(tStart + i * step, tmp);
    buf[i * 3]     = tmp.x;
    buf[i * 3 + 1] = tmp.y;
    buf[i * 3 + 2] = tmp.z;
  }
}

/**
 * Find the closest Bezier parameter `t` to a given 3D point.
 * Scans CURVE_RESOLUTION samples — fast enough in useFrame when throttled.
 *
 * @param {THREE.QuadraticBezierCurve3} curve
 * @param {THREE.Vector3}               point
 * @returns {number} 0–1
 */
function findClosestT(curve, point) {
  let closestT  = 0;
  let minDistSq = Infinity;
  const tmp     = new THREE.Vector3();
  for (let i = 0; i <= CURVE_RESOLUTION; i++) {
    const t = i / CURVE_RESOLUTION;
    curve.getPoint(t, tmp);
    const dSq = tmp.distanceToSquared(point);
    if (dSq < minDistSq) { minDistSq = dSq; closestT = t; }
  }
  return closestT;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const Trajectory = () => {
  const telemetryRef = useTelemetryRef();

  // ── Persistent geometry references ─────────────────────────────────────────
  // The Float32Arrays are sized for CURVE_RESOLUTION+1 points each (×3 floats).
  const maxPts         = CURVE_RESOLUTION + 1;
  const travelledGeoRef = useRef(null);
  const plannedGeoRef   = useRef(null);
  const travelledMatRef = useRef(null);
  const plannedMatRef   = useRef(null);

  const travelledBuf   = useRef(new Float32Array(maxPts * 3));
  const plannedBuf     = useRef(new Float32Array(maxPts * 3));

  // Track last computed distance to throttle recomputation
  const lastEarthDistRef = useRef(-UPDATE_THRESHOLD_KM * 2);

  // ── Create initial THREE objects (once, no React re-render dependency) ─────
  const { travelledLine, plannedLine } = useMemo(() => {
    // Travelled — bright solid blue
    const tGeo  = new THREE.BufferGeometry();
    const tAttr = new THREE.BufferAttribute(travelledBuf.current, 3);
    tAttr.setUsage(THREE.DynamicDrawUsage);
    tGeo.setAttribute('position', tAttr);
    tGeo.setDrawRange(0, 2);           // start minimal
    travelledGeoRef.current = tGeo;

    const tMat = new THREE.LineBasicMaterial({ color: '#4db8ff', transparent: true, opacity: 0.75, linewidth: 1 });
    travelledMatRef.current = tMat;

    // Planned — dim dashed red
    const pGeo  = new THREE.BufferGeometry();
    const pAttr = new THREE.BufferAttribute(plannedBuf.current, 3);
    pAttr.setUsage(THREE.DynamicDrawUsage);
    pGeo.setAttribute('position', pAttr);
    pGeo.setDrawRange(0, 2);
    plannedGeoRef.current = pGeo;

    const pMat = new THREE.LineDashedMaterial({
      color:       '#FC3D21',
      transparent: true,
      opacity:     0.35,
      dashSize:    3,
      gapSize:     3,
      linewidth:   1,
    });
    plannedMatRef.current = pMat;

    return {
      travelledLine: new THREE.Line(tGeo, tMat),
      plannedLine:   new THREE.Line(pGeo, pMat),
    };
  }, []); // created exactly once

  // Compute line distances for dashed material (must call after first render)
  useEffect(() => {
    travelledLine.computeLineDistances();
    plannedLine.computeLineDistances();
  }, [travelledLine, plannedLine]);

  // ── useFrame — imperative geometry update ───────────────────────────────────
  useFrame(() => {
    const tel = telemetryRef.current;
    if (!tel) return;

    const earthDistKm = parseFloat(tel.distanceFromEarthKm) || 0;
    const moonDistKm  = parseFloat(tel.distanceToMoonKm) || 384400;

    // Throttle: skip recompute if change is smaller than threshold
    if (Math.abs(earthDistKm - lastEarthDistRef.current) < UPDATE_THRESHOLD_KM) return;
    lastEarthDistRef.current = earthDistKm;

    // ── Derive spacecraft scene position ──────────────────────────────────────
    const sceneZ  = -(earthDistKm * SCALE);
    const scPoint = new THREE.Vector3(0, 0, sceneZ);

    // ── Mission progress (0–1) based on ratio of distances ───────────────────
    const total  = earthDistKm + moonDistKm;
    const progress = total > 0 ? Math.min(1, earthDistKm / total) : 0;

    // ── Build Bezier curve with dynamic control point ─────────────────────────
    const ctrlPt = computeControlPoint(progress);
    const curve  = new THREE.QuadraticBezierCurve3(EARTH_VEC, ctrlPt, MOON_VEC);

    // ── Find spacecraft position on the curve ─────────────────────────────────
    const scT = findClosestT(curve, scPoint);

    // ── How many points for each segment (proportional to progress) ──────────
    const numTravelled = Math.max(2, Math.round(scT   * CURVE_RESOLUTION));
    const numPlanned   = Math.max(2, Math.round((1 - scT) * CURVE_RESOLUTION));

    // ── Write into shared buffers in-place (no allocation) ───────────────────
    fillBuffer(travelledBuf.current, curve, 0,   scT, numTravelled);
    fillBuffer(plannedBuf.current,   curve, scT, 1,   numPlanned);

    // ── Notify Three.js that the position attributes changed ─────────────────
    const tGeo = travelledGeoRef.current;
    const pGeo = plannedGeoRef.current;

    tGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.position.needsUpdate = true;
    tGeo.setDrawRange(0, numTravelled);
    pGeo.setDrawRange(0, numPlanned);

    // Recompute bounding for frustum culling
    tGeo.computeBoundingSphere();
    pGeo.computeBoundingSphere();

    // Recompute dashes for planned segment
    plannedLine.computeLineDistances();
  });

  // ── Render (stable JSX — never changes) ─────────────────────────────────────
  return (
    <group>
      <primitive object={travelledLine} />
      <primitive object={plannedLine}   />
    </group>
  );
};
