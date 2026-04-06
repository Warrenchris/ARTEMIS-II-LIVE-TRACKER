/**
 * Trajectory — Free Return Orbital Path Visualiser
 * =================================================
 * Renders the Artemis II "Free Return" trajectory as two animated line segments:
 *
 *   1. TRAVELLED  — NASA Cyan glowing line with animated "flow" dash offset
 *                   drawn from Earth to current spacecraft position.
 *   2. PLANNED    — Dim dashed red line from spacecraft to Moon.
 *
 * Curve topology (CatmullRomCurve3 with 5 control nodes):
 *
 *   P0: Earth (0,0,0)
 *   P1: Mid-outbound departure point  — positioned off-axis to prevent clipping Earth
 *   P2: Spacecraft live position      — updated from TelemetryRef each frame
 *   P3: Lunar far-side lobe apex      — swings behind the Moon (activated in transit/flyby)
 *   P4: Moon arrival point            — Moon surface on trailing edge
 *
 * Performance:
 *   - Uses useTelemetryRef() (never triggers React re-renders)
 *   - BufferGeometry position attribute updated in-place (no GC pressure)
 *   - Geometry recomputed only when earthDistKm changes by > UPDATE_THRESHOLD_KM
 *   - Dash-offset animation runs every frame via ShaderMaterial uniform (cheap)
 */

import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame }          from '@react-three/fiber';
import { useTelemetryRef }   from '../../contexts/TelemetryContext';
import * as THREE            from 'three';
import { MOON_SCENE_POSITION } from './Moon';

// ─── Scene Constants ──────────────────────────────────────────────────────────

/** km → scene units  (Earth radius = 6.371 scene units) */
const SCALE = 1 / 1000;

/** Curve samples — higher = smoother, but more GPU cost */
const CURVE_POINTS = 160;

/** Skip geometry rebuild if earthDist changed by less than this (km) */
const UPDATE_THRESHOLD_KM = 1000;

/** Earth radius in scene units (matches Earth.jsx geometry 6.371) */
const EARTH_R = 6.371;

/** Moon radius in scene units (matches Moon.jsx geometry 1.737) */
const MOON_R = 1.737;

// Fixed scene vectors
const EARTH_POS = new THREE.Vector3(0, 0, 0);
const MOON_POS  = new THREE.Vector3(...MOON_SCENE_POSITION);

// Phase IDs that unlock the far-side lobe arc
const FAR_SIDE_PHASES = new Set(['transit', 'approach', 'loi']);

// ─── Free Return Curve Builder ────────────────────────────────────────────────

/**
 * Constructs the 5-node CatmullRomCurve3 representing the Free Return path.
 *
 * Node layout:
 *   P0  Earth departure (offset above surface to avoid clipping)
 *   P1  Mid-outbound — swings outward to create a smooth departure arc
 *   P2  Spacecraft live position
 *   P3  Lunar far-side lobe apex (behind Moon, offset perpendicular to Earth-Moon axis)
 *   P4  Moon arrival on trailing edge (offset from Moon center by MOON_R + buffer)
 *
 * @param {THREE.Vector3} scPos        Spacecraft position in scene units
 * @param {string}        phaseId      Current mission phase ID
 * @param {number}        progress     Mission progress 0–1 (Earth→Moon)
 * @returns {THREE.CatmullRomCurve3}
 */
function buildFreeReturnCurve(scPos, phaseId, progress) {
  const isLunarPhase = FAR_SIDE_PHASES.has(phaseId);

  // P0 — Depart Earth surface (slightly above surface, along trajectory axis)
  const p0 = EARTH_POS.clone().add(new THREE.Vector3(0, EARTH_R * 0.2, -(EARTH_R + 1.0)));

  // P1 — Mid-outbound departure bulge
  // Perpendicular lift (Y) peaks early in the journey; lateral offset (X) mimics
  // the slight plane-change burn performed after TLI.
  const t1   = Math.max(0.1, progress * 0.35);
  const lift1 = 28 * Math.sin(Math.PI * t1 * 2);
  const p1   = new THREE.Vector3(
    22 + lift1 * 0.3,
    lift1,
    -(80 + progress * 60),
  );

  // P2 — Live spacecraft position (centre-node; Catmull-Rom passes through it)
  const p2 = scPos.clone();

  // P3 — Lunar far-side lobe apex
  // In lunar transit/approach/LOI phases the craft swings around behind the Moon.
  // We place P3 behind and perpendicular to the Earth-Moon axis so the curve
  // naturally arcs around the trailing edge without passing through the Moon mesh.
  let p3;
  if (isLunarPhase) {
    // Place lobe apex behind Moon + offset on +X (trailing edge)
    p3 = new THREE.Vector3(
      MOON_POS.x + 35,    // swing out to trailing side
      MOON_POS.y + 8,
      MOON_POS.z - 18,    // slightly behind Moon on Z
    );
  } else {
    // Simple mid-approach: interpolate linearly between P2 and Moon approach
    p3 = new THREE.Vector3(
      scPos.x * 0.3 + MOON_POS.x * 0.7,
      3,
      scPos.z * 0.3 + MOON_POS.z * 0.7,
    );
  }

  // P4 — Moon arrival on trailing edge (surface offset so line doesn't pierce Moon)
  const toMoon     = MOON_POS.clone().sub(p3).normalize();
  const sideOffset = new THREE.Vector3(MOON_R + 0.5, 0, 0); // trailing edge offset
  const p4         = MOON_POS.clone()
    .add(toMoon.clone().multiplyScalar(-(MOON_R + 0.4)))
    .add(sideOffset);

  const curve = new THREE.CatmullRomCurve3([p0, p1, p2, p3, p4], false, 'catmullrom', 0.5);
  return curve;
}

// ─── Find Curve T at Spacecraft Position ─────────────────────────────────────

/**
 * Find the CatmullRom parameter `t` (0–1) where the curve passes closest to
 * the spacecraft's scene position. Scans N samples (good enough for our resolution).
 */
function findCurveT(curve, scPos, samples = 200) {
  let bestT   = 0;
  let minDSq  = Infinity;
  const tmp   = new THREE.Vector3();
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    curve.getPoint(t, tmp);
    const dSq = tmp.distanceToSquared(scPos);
    if (dSq < minDSq) { minDSq = dSq; bestT = t; }
  }
  return bestT;
}

// ─── Buffer Fill ──────────────────────────────────────────────────────────────

/**
 * Sample `count` evenly-spaced points from a curve between tStart and tEnd,
 * writing directly into a pre-allocated Float32Array (no allocation).
 */
function fillBuffer(buf, curve, tStart, tEnd, count) {
  if (count < 2) { count = 2; }
  const step = (tEnd - tStart) / (count - 1);
  const tmp  = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const t = Math.min(1, tStart + i * step);
    curve.getPoint(t, tmp);
    buf[i * 3]     = tmp.x;
    buf[i * 3 + 1] = tmp.y;
    buf[i * 3 + 2] = tmp.z;
  }
}

// ─── Animated Glow Line Shader ────────────────────────────────────────────────

/**
 * Custom ShaderMaterial for the "flowing" NASA Cyan travelled line.
 * Uses a repeating dash pattern animated via uTime uniform.
 *
 * The vertex shader passes the cumulative distance along the line (lineDistance
 * attribute, populated by line.computeLineDistances()) to the fragment shader,
 * which uses it to compute animated dash bands.
 */
function makeFlowMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:      { value: 0 },
      uColor:     { value: new THREE.Color('#00f2ff') },
      uOpacity:   { value: 0.55 },
      uDashSize:  { value: 6.0 },
      uGapSize:   { value: 4.0 },
      uFlowSpeed: { value: 4.5 },   // scene units per second
      uGlowWidth: { value: 0.35 },  // glow bloom fraction within dash band
    },
    vertexShader: /* glsl */ `
      attribute float lineDistance;
      varying   float vLineDistance;
      void main() {
        vLineDistance = lineDistance;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3  uColor;
      uniform float uOpacity;
      uniform float uDashSize;
      uniform float uGapSize;
      uniform float uFlowSpeed;
      uniform float uGlowWidth;

      varying float vLineDistance;

      void main() {
        float period     = uDashSize + uGapSize;
        float offset     = mod(vLineDistance - uTime * uFlowSpeed, period);

        // Hard-cut: discard pixels inside the gap band
        if (offset > uDashSize) discard;

        // Glow bloom: bright core that fades toward dash edges
        float bandPos  = offset / uDashSize;            // 0→1 within dash
        float glow     = 1.0 - abs(bandPos - 0.5) * 2.0; // 0 at edges, 1 at centre
        glow = pow(glow, 1.5);

        // Outer soft fringe (additive luminance boost at centre)
        float alpha = uOpacity * (0.55 + 0.45 * glow);
        vec3  col   = uColor   * (1.0 + glow * 0.8);

        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent:  true,
    depthWrite:   false,
    blending:     THREE.AdditiveBlending,
    linewidth:    1,            // WebGL cap – 1px max on most GPUs
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export const Trajectory = () => {
  const telemetryRef = useTelemetryRef();

  // ── Persistent refs ────────────────────────────────────────────────────────
  const maxPts = CURVE_POINTS + 1;

  const travelledGeoRef = useRef(null);
  const plannedGeoRef   = useRef(null);
  const flowMatRef      = useRef(null);

  const travelledBuf = useRef(new Float32Array(maxPts * 3));
  const plannedBuf   = useRef(new Float32Array(maxPts * 3));

  // lineDistance attribute buffers (needed for animated dash shader)
  const travelledDistBuf = useRef(new Float32Array(maxPts));
  const plannedDistBuf   = useRef(new Float32Array(maxPts));

  // Throttle: track last computed distance
  const lastEarthDistRef = useRef(-UPDATE_THRESHOLD_KM * 2);

  // ── Create THREE objects once ──────────────────────────────────────────────
  const { travelledLine, plannedLine } = useMemo(() => {
    // ── Travelled segment ──────────────────────────────────────────────────
    const tGeo    = new THREE.BufferGeometry();
    const tPosBuf = new THREE.BufferAttribute(travelledBuf.current, 3);
    const tDistBuf = new THREE.BufferAttribute(travelledDistBuf.current, 1);
    tPosBuf.setUsage(THREE.DynamicDrawUsage);
    tDistBuf.setUsage(THREE.DynamicDrawUsage);
    tGeo.setAttribute('position',     tPosBuf);
    tGeo.setAttribute('lineDistance', tDistBuf);
    tGeo.setDrawRange(0, 2);
    travelledGeoRef.current = tGeo;

    const tMat = makeFlowMaterial();
    flowMatRef.current = tMat;

    // ── Planned segment ────────────────────────────────────────────────────
    const pGeo    = new THREE.BufferGeometry();
    const pPosBuf = new THREE.BufferAttribute(plannedBuf.current, 3);
    pPosBuf.setUsage(THREE.DynamicDrawUsage);
    pGeo.setAttribute('position', pPosBuf);
    pGeo.setDrawRange(0, 2);
    plannedGeoRef.current = pGeo;

    const pMat = new THREE.LineDashedMaterial({
      color:       '#FC3D21',
      transparent: true,
      opacity:     0.30,
      dashSize:    4,
      gapSize:     4,
      linewidth:   1,
    });

    return {
      travelledLine: new THREE.Line(tGeo, tMat),
      plannedLine:   new THREE.Line(pGeo, pMat),
    };
  }, []);  // created exactly once

  // Compute line distances for the planned dashed segment after first render
  useEffect(() => {
    plannedLine.computeLineDistances();
    return () => {
      // Dispose GPU resources on unmount
      travelledGeoRef.current?.dispose();
      plannedGeoRef.current?.dispose();
      flowMatRef.current?.dispose();
      plannedLine.material?.dispose();
    };
  }, [plannedLine]);

  // ── useFrame — imperative update loop ────────────────────────────────────
  useFrame((state) => {
    const tel = telemetryRef.current;
    if (!tel) return;

    const earthDistKm = parseFloat(tel.distanceFromEarthKm) || 0;
    const moonDistKm  = parseFloat(tel.distanceToMoonKm)    || 384400;
    const phaseId     = tel.phaseId || 'launch';

    // ── Animate flow shader every frame (cheap — just mutates a float uniform)
    if (flowMatRef.current) {
      flowMatRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    }

    // ── Throttle geometry rebuild ─────────────────────────────────────────
    if (Math.abs(earthDistKm - lastEarthDistRef.current) < UPDATE_THRESHOLD_KM) return;
    lastEarthDistRef.current = earthDistKm;

    // ── Spacecraft scene position ─────────────────────────────────────────
    // Use position from telemetry if available (set by Spacecraft.jsx),
    // otherwise derive from earthDistKm along the Earth→Moon axis.
    const posData = tel.position;
    let scPos;
    if (posData && (posData.x !== 0 || posData.y !== 0 || posData.z !== 0)) {
      scPos = new THREE.Vector3(
        posData.x * SCALE,
        posData.y * SCALE,
        posData.z * SCALE,
      );
    } else {
      // Fall back to straight-line interpolation along Earth→Moon axis
      const t  = Math.min(1, earthDistKm / (earthDistKm + moonDistKm));
      scPos    = EARTH_POS.clone().lerp(MOON_POS, t);
    }

    // ── Mission progress ──────────────────────────────────────────────────
    const total    = earthDistKm + moonDistKm;
    const progress = total > 0 ? Math.min(1, earthDistKm / total) : 0;

    // ── Build Free Return curve ───────────────────────────────────────────
    const curve = buildFreeReturnCurve(scPos, phaseId, progress);

    // ── Locate spacecraft on the curve ────────────────────────────────────
    const scT = findCurveT(curve, scPos);

    // ── Split curve into travelled / planned ──────────────────────────────
    const numTravelled = Math.max(2, Math.round(scT       * CURVE_POINTS));
    const numPlanned   = Math.max(2, Math.round((1 - scT) * CURVE_POINTS));

    fillBuffer(travelledBuf.current, curve, 0,   scT, numTravelled);
    fillBuffer(plannedBuf.current,   curve, scT, 1,   numPlanned);

    // ── Update lineDistance attribute for the travelled flow material ─────
    // We compute cumulative distances manually so the shader has correct values.
    {
      const buf = travelledDistBuf.current;
      buf[0]    = 0;
      const tmp  = new THREE.Vector3();
      const prev = new THREE.Vector3(travelledBuf.current[0], travelledBuf.current[1], travelledBuf.current[2]);
      for (let i = 1; i < numTravelled; i++) {
        tmp.set(travelledBuf.current[i * 3], travelledBuf.current[i * 3 + 1], travelledBuf.current[i * 3 + 2]);
        buf[i] = buf[i - 1] + prev.distanceTo(tmp);
        prev.copy(tmp);
      }
    }

    // ── Notify Three.js ───────────────────────────────────────────────────
    const tGeo = travelledGeoRef.current;
    const pGeo = plannedGeoRef.current;

    tGeo.attributes.position.needsUpdate     = true;
    tGeo.attributes.lineDistance.needsUpdate = true;
    pGeo.attributes.position.needsUpdate     = true;

    tGeo.setDrawRange(0, numTravelled);
    pGeo.setDrawRange(0, numPlanned);

    tGeo.computeBoundingSphere();
    pGeo.computeBoundingSphere();

    // Recompute planned-line dashes after position update
    plannedLine.computeLineDistances();
  });

  // ── Render (stable JSX — this element never changes) ─────────────────────
  return (
    <group>
      <primitive object={travelledLine} />
      <primitive object={plannedLine}   />
    </group>
  );
};
