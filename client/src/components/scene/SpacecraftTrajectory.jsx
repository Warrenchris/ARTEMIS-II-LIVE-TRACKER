/**
 * SpacecraftTrajectory — Free Return Orbital Path Visualiser
 * ==========================================================
 * Renders the Artemis II "Free Return" trajectory as two animated line segments:
 *
 *   1. TRAVELLED  — NASA Cyan glowing line with animated "flow" dash offset
 *                   drawn from Earth to current spacecraft position.
 *   2. PLANNED    — Dim dashed red line from spacecraft to Moon.
 *
 * Curve topology (CatmullRomCurve3 with 5 control nodes) mapped dynamically to Moon orbit:
 *
 *   P0: Earth (0,0,0)
 *   P1: Mid-outbound departure point 
 *   P2: Spacecraft live position
 *   P3: Lunar far-side lobe apex (swings behind the dynamically positioned Moon)
 *   P4: Moon arrival point
 */

import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame }          from '@react-three/fiber';
import { useTelemetryRef }   from '../../contexts/TelemetryContext';
import * as THREE            from 'three';

const SCALE = 1 / 1000;
const CURVE_POINTS = 160;
const UPDATE_THRESHOLD_KM = 500;
const EARTH_R = 6.371;
const MOON_R = 1.737;

const EARTH_POS = new THREE.Vector3(0, 0, 0);
const FAR_SIDE_PHASES = new Set(['transit', 'approach', 'loi', 'flyby']);

function buildFreeReturnCurve(scPos, phaseId, progress, currentMoonPos) {
  const isLunarPhase = FAR_SIDE_PHASES.has(phaseId) || progress > 0.5;

  const p0 = EARTH_POS.clone().add(new THREE.Vector3(0, EARTH_R * 0.2, -(EARTH_R + 1.0)));

  const t1   = Math.max(0.1, progress * 0.35);
  const lift1 = 28 * Math.sin(Math.PI * t1 * 2);
  const p1   = new THREE.Vector3(
    22 + lift1 * 0.3,
    lift1,
    -(80 + progress * 60)
  );

  const p2 = scPos.clone();

  let p3;
  if (isLunarPhase) {
    // Dynamic far-side loop behind current moon coordinates
    const dirFromEarth = currentMoonPos.clone().normalize();
    const perp = new THREE.Vector3(1, 0, 0).cross(dirFromEarth).normalize();
    
    // offset behind and to the trailing edge
    p3 = currentMoonPos.clone()
      .add(dirFromEarth.multiplyScalar(8)) // behind moon relative to Earth
      .add(perp.multiplyScalar(-10)) // swinging trailing side
      .add(new THREE.Vector3(0, 4, 0)); // orbital plane inclination twist
  } else {
    p3 = new THREE.Vector3(
      scPos.x * 0.3 + currentMoonPos.x * 0.7,
      3,
      scPos.z * 0.3 + currentMoonPos.z * 0.7
    );
  }

  const toMoon     = currentMoonPos.clone().sub(p3).normalize();
  const sideOffset = new THREE.Vector3(MOON_R + 0.5, 0, 0); 
  const p4         = currentMoonPos.clone()
    .add(toMoon.clone().multiplyScalar(-(MOON_R + 0.4)))
    .add(sideOffset);

  const curve = new THREE.CatmullRomCurve3([p0, p1, p2, p3, p4], false, 'catmullrom', 0.5);
  return curve;
}

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

function makeFlowMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:      { value: 0 },
      uColor:     { value: new THREE.Color('#00f2ff') },
      uOpacity:   { value: 0.9 },
      uDashSize:  { value: 6.0 },
      uGapSize:   { value: 4.0 },
      uFlowSpeed: { value: 4.5 },   
      uGlowWidth: { value: 0.35 },  
    },
    vertexShader: `
      attribute float lineDistance;
      varying   float vLineDistance;
      void main() {
        vLineDistance = lineDistance;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
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

        if (offset > uDashSize) discard;

        float bandPos  = offset / uDashSize;            
        float glow     = 1.0 - abs(bandPos - 0.5) * 2.0; 
        glow = pow(glow, 1.5);

        float alpha = uOpacity * (0.55 + 0.45 * glow);
        vec3  col   = uColor   * (1.0 + glow * 0.8);

        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent:  true,
    depthTest:    false,
    depthWrite:   false,
    blending:     THREE.AdditiveBlending,
    linewidth:    1,            
  });
}

export const SpacecraftTrajectory = () => {
  const telemetryRef = useTelemetryRef();
  const maxPts = CURVE_POINTS + 1;

  const travelledGeoRef = useRef(null);
  const plannedGeoRef   = useRef(null);
  const flowMatRef      = useRef(null);

  const travelledBuf = useRef(new Float32Array(maxPts * 3));
  const plannedBuf   = useRef(new Float32Array(maxPts * 3));
  const travelledDistBuf = useRef(new Float32Array(maxPts));
  const plannedDistBuf   = useRef(new Float32Array(maxPts));
  const lastEarthDistRef = useRef(-UPDATE_THRESHOLD_KM * 2);

  const { travelledLine, plannedLine } = useMemo(() => {
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

    const pGeo    = new THREE.BufferGeometry();
    const pPosBuf = new THREE.BufferAttribute(plannedBuf.current, 3);
    pPosBuf.setUsage(THREE.DynamicDrawUsage);
    pGeo.setAttribute('position', pPosBuf);
    pGeo.setDrawRange(0, 2);
    plannedGeoRef.current = pGeo;

    const pMat = new THREE.LineDashedMaterial({
      color:       '#FC3D21',
      transparent: true,
      opacity:     0.7,
      depthTest:   false,
      dashSize:    4,
      gapSize:     4,
      linewidth:   1,
    });

    return {
      travelledLine: new THREE.Line(tGeo, tMat),
      plannedLine:   new THREE.Line(pGeo, pMat),
    };
  }, []);

  useEffect(() => {
    plannedLine.computeLineDistances();
    return () => {
      travelledGeoRef.current?.dispose();
      plannedGeoRef.current?.dispose();
      flowMatRef.current?.dispose();
      plannedLine.material?.dispose();
    };
  }, [plannedLine]);

  useFrame((state) => {
    const tel = telemetryRef.current;
    if (!tel) return;

    const earthDistKm = parseFloat(tel.distanceFromEarthKm) || 0;
    const moonDistKm  = parseFloat(tel.distanceToMoonKm)    || 384400;
    const phaseId     = tel.phaseId || 'launch';

    if (flowMatRef.current) {
      flowMatRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    }
    if (plannedLine && plannedLine.material) {
      plannedLine.material.dashOffset -= 0.08; // Pulse forward with energy
    }

    if (Math.abs(earthDistKm - lastEarthDistRef.current) < UPDATE_THRESHOLD_KM) return;
    lastEarthDistRef.current = earthDistKm;

    let scPos = new THREE.Vector3(
      (tel.position?.x || 0) * SCALE,
      (tel.position?.y || 0) * SCALE,
      (tel.position?.z || 0) * SCALE
    );

    const moonPosData = tel.moonPosition;
    let currentMoonNode = null;
    if (moonPosData && (moonPosData.x !== 0 || moonPosData.y !== 0 || moonPosData.z !== 0)) {
      currentMoonNode = new THREE.Vector3(
        moonPosData.x * SCALE,
        moonPosData.y * SCALE,
        moonPosData.z * SCALE
      );
    }

    // Force geometric tracing (fallback if backend 0,0,-Z static states are still live)
    if (Math.abs(scPos.x) < 0.1 && Math.abs(scPos.y) < 0.1 && scPos.z < 0) {
      const fallbackMoon = currentMoonNode ?? new THREE.Vector3(moonDistKm * SCALE, 0, 0);
      const t  = Math.min(1, earthDistKm / (earthDistKm + moonDistKm));
      scPos = EARTH_POS.clone().lerp(fallbackMoon, t);
    }

    if (!currentMoonNode) {
      const dir = scPos.lengthSq() > 0 ? scPos.clone().normalize() : new THREE.Vector3(1, 0, 0);
      currentMoonNode = dir.multiplyScalar((earthDistKm + moonDistKm) * SCALE);
    }

    const total    = earthDistKm + moonDistKm;
    const progress = total > 0 ? Math.min(1, earthDistKm / total) : 0;

    let curve;
    if (tel.trajectoryVectors && tel.trajectoryVectors.length >= 2) {
      // Pure JPL Physics trajectory!
      const vectors = tel.trajectoryVectors.map(v => new THREE.Vector3(v.x * SCALE, v.y * SCALE, v.z * SCALE));
      curve = new THREE.CatmullRomCurve3(vectors, false, 'catmullrom');
    } else {
      // Fallback Algorithm
      curve = buildFreeReturnCurve(scPos, phaseId, progress, currentMoonNode);
    }

    const scT = findCurveT(curve, scPos);

    const numTravelled = Math.max(2, Math.round(scT       * CURVE_POINTS));
    const numPlanned   = Math.max(2, Math.round((1 - scT) * CURVE_POINTS));

    fillBuffer(travelledBuf.current, curve, 0,   scT, numTravelled);
    fillBuffer(plannedBuf.current,   curve, scT, 1,   numPlanned);

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

    const tGeo = travelledGeoRef.current;
    const pGeo = plannedGeoRef.current;

    tGeo.attributes.position.needsUpdate     = true;
    tGeo.attributes.lineDistance.needsUpdate = true;
    pGeo.attributes.position.needsUpdate     = true;

    tGeo.setDrawRange(0, numTravelled);
    pGeo.setDrawRange(0, numPlanned);

    tGeo.computeBoundingSphere();
    pGeo.computeBoundingSphere();

    plannedLine.computeLineDistances();
  });

  return (
    <group>
      <primitive object={travelledLine} />
      <primitive object={plannedLine}   />
    </group>
  );
};

export const SpacecraftTrajectoryWithDashes = SpacecraftTrajectory;
