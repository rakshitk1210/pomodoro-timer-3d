import * as THREE from "three";
import { MESH } from "./meshData";
import {
  decodeMesh,
  roundedShape,
  srgb,
  inkOn,
  drawButtonIcon,
} from "../lib/three-utils";

/* ------------------------------------------------------------------ */
/*  layout constants derived from the imported body                     */
/*  measured, not guessed. the window is 2.877 x 2.430 and its centre   */
/*  sits 0.224 above the case centre.                                   */
/* ------------------------------------------------------------------ */

const DIAL_SIZE = 2.41;
const DIAL_CY = 0.224;
const PLATE_W = 3.0;
const PLATE_H = 2.7;
const PLATE_FRONT = 0.08;
const DIAL_Z = 0.085;
const DISC_Z = 0.115;
const KNOB_Z = 0.2;
const STEM_Z = 0.2;

/* the case buttons flank the readout, on the solid part of the front face.
   the front face plane is z 0.3523 and is solid out to x +-1.495 at this
   height, so the bay beside the readout (which ends at x 0.604) is 0.891
   wide. */
const BTN_FACE_Z = 0.3523;
const BTN_R = 0.19;
const BTN_HIT_R = 0.26; /* touch target, kept clear of the dial above */
const BTN_CX = 1.03;
const BTN_PROUD = 0.042; /* stands as proud as the readout panel does */
const BTN_PRESS = 0.036; /* sinks to just shy of flush */

const PANEL_FACE_Z = 0.3975; /* readout panel front sits at 0.394 */
const PANEL_CY = -1.2555;
const PANEL_W = 1.13;
const PANEL_H = 0.3;

/* ------------------------------------------------------------------ */

const DEFAULTS = {
  discRadius: 0.72,
  discDepth: 0.05,
  knobRadius: 0.2,
  dialZ: 0,

  caseColor: "#8ac79a",
  discColor: "#1d5f2c",
  faceColor: "#f4f5f2",
  panelColor: "#1a201b",
  digitColor: "#eaf3ea",
  bgColor: "#dfe2dc",

  roughness: 0.62,
  clearcoat: 0.3,

  key: 1.5,
  ambient: 0.62,
  exposure: 1.05,
  shadow: 0.22,
};

const PRESETS = {
  Original: {},
  Ink: {
    caseColor: "#2b2f31",
    discColor: "#e8613c",
    faceColor: "#f7f5f0",
    panelColor: "#141618",
    digitColor: "#e8613c",
    bgColor: "#c9cbc4",
    roughness: 0.5,
    clearcoat: 0.45,
    key: 1.8,
    ambient: 0.45,
  },
  Machined: {
    caseColor: "#b8bfb6",
    discColor: "#22262a",
    faceColor: "#fafaf8",
    panelColor: "#20242a",
    digitColor: "#dfe6ec",
    bgColor: "#e6e7e3",
    roughness: 0.32,
    clearcoat: 0.7,
  },
  Citrus: {
    caseColor: "#f2b134",
    discColor: "#1f3a5f",
    faceColor: "#fffdf6",
    panelColor: "#1f3a5f",
    digitColor: "#ffe9b8",
    bgColor: "#e6e2d6",
  },
  Night: {
    caseColor: "#3a4a44",
    discColor: "#5fd39a",
    faceColor: "#e9eeea",
    panelColor: "#0e1412",
    digitColor: "#5fd39a",
    bgColor: "#aeb5b0",
    roughness: 0.66,
    clearcoat: 0.35,
    key: 1.2,
    ambient: 0.5,
    exposure: 1.0,
  },
};

const FIELDS = {
  form: [
    ["discRadius", "Disc radius", 0.3, 0.82, 0.01],
    ["discDepth", "Disc thickness", 0.01, 0.18, 0.005],
    ["knobRadius", "Knob size", 0.08, 0.45, 0.005],
    ["dialZ", "Dial depth", -0.16, 0.08, 0.005],
  ],
  light: [
    ["roughness", "Case roughness", 0, 1, 0.01],
    ["clearcoat", "Clearcoat", 0, 1, 0.01],
    ["key", "Key light", 0, 3, 0.05],
    ["ambient", "Ambient", 0, 1.6, 0.02],
    ["exposure", "Exposure", 0.5, 1.9, 0.01],
    ["shadow", "Shadow", 0, 0.5, 0.01],
  ],
  color: [
    ["caseColor", "Case"],
    ["discColor", "Disc"],
    ["faceColor", "Face"],
    ["panelColor", "Panel"],
    ["digitColor", "Digits"],
    ["bgColor", "Backdrop"],
  ],
};

/* ------------------------------------------------------------------ */
/*  generated geometry                                                  */
/* ------------------------------------------------------------------ */

function makeDiscGeometry(minutes, radius, depth) {
  const m = Math.max(0.0001, Math.min(60, minutes));
  const sweep = (m / 60) * Math.PI * 2;
  const start = Math.PI / 2;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(Math.cos(start) * radius, Math.sin(start) * radius);
  shape.absarc(0, 0, radius, start, start + sweep, false);
  shape.lineTo(0, 0);
  const b = Math.min(0.014, depth * 0.28);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 3,
    curveSegments: 90,
  });
  g.translate(0, 0, DISC_Z);
  return g;
}

function makeDialTexture(faceColor) {
  const S = 2048;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  g.fillStyle = faceColor;
  g.fillRect(0, 0, S, S);
  const cx = S / 2,
    cy = S / 2,
    rT = S * 0.375;
  for (let m = 0; m < 60; m++) {
    const major = m % 5 === 0;
    const a = Math.PI / 2 + (m / 60) * Math.PI * 2;
    const len = major ? S * 0.032 : S * 0.017;
    g.strokeStyle = "#141a15";
    g.lineWidth = major ? S * 0.009 : S * 0.0035;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * rT, cy - Math.sin(a) * rT);
    g.lineTo(cx + Math.cos(a) * (rT - len), cy - Math.sin(a) * (rT - len));
    g.stroke();
  }
  const rN = S * 0.437;
  g.fillStyle = "#141a15";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `600 ${Math.round(S * 0.072)}px Helvetica, Arial, sans-serif`;
  for (let m = 0; m < 60; m += 5) {
    const a = Math.PI / 2 + (m / 60) * Math.PI * 2;
    g.fillText(String(m), cx + Math.cos(a) * rN, cy - Math.sin(a) * rN);
  }
  g.strokeStyle = "rgba(20,26,21,0.16)";
  g.lineWidth = S * 0.0022;
  g.beginPath();
  g.arc(cx, cy, S * 0.398, -Math.PI * 0.5, -Math.PI * 1.15, true);
  g.stroke();
  const t = srgb(new THREE.CanvasTexture(c));
  t.anisotropy = 16;
  return t;
}

/* ------------------------------------------------------------------ */

function build() {
  const root = new THREE.Group();

  const caseMat = new THREE.MeshPhysicalMaterial({ metalness: 0 });
  const panelMat = new THREE.MeshPhysicalMaterial({
    metalness: 0,
    roughness: 0.22,
    clearcoat: 0.9,
    clearcoatRoughness: 0.1,
  });
  const faceMat = new THREE.MeshStandardMaterial({
    roughness: 0.55,
    metalness: 0,
  });
  const dialMat = new THREE.MeshStandardMaterial({
    roughness: 0.52,
    metalness: 0,
  });
  const discMat = new THREE.MeshPhysicalMaterial({
    metalness: 0,
    roughness: 0.38,
    clearcoat: 0.45,
    clearcoatRoughness: 0.4,
  });
  const knobMat = new THREE.MeshPhysicalMaterial({
    metalness: 0,
    roughness: 0.45,
    clearcoat: 0.4,
    clearcoatRoughness: 0.5,
  });

  /* imported parts */
  const body = new THREE.Mesh(decodeMesh(MESH.body), caseMat);
  const stand = new THREE.Mesh(decodeMesh(MESH.stand), caseMat);
  const readout = new THREE.Mesh(decodeMesh(MESH.panel), panelMat);
  [body, stand, readout].forEach((m) => {
    m.castShadow = true;
    m.receiveShadow = true;
  });
  root.add(body, stand, readout);

  /* the digits, on a plane just proud of the readout panel */
  const digitCanvas = document.createElement("canvas");
  digitCanvas.width = 1024;
  digitCanvas.height = 272;
  const digitTex = srgb(new THREE.CanvasTexture(digitCanvas));
  digitTex.anisotropy = 16;
  const digits = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL_W, PANEL_H),
    new THREE.MeshBasicMaterial({
      map: digitTex,
      transparent: true,
      depthWrite: false,
    })
  );
  digits.position.set(0, PANEL_CY, PANEL_FACE_Z);
  root.add(digits);

  /* the two case buttons: a tapered pad standing proud of the front
     face, an icon printed on it, and an oversized invisible disc in
     front for picking, so the touch target beats the visible size */
  const buttons = [];
  for (const [kind, cx] of [
    ["reset", -BTN_CX],
    ["start", BTN_CX],
  ]) {
    const group = new THREE.Group();
    group.position.set(cx, PANEL_CY, 0);

    const mat = new THREE.MeshPhysicalMaterial({
      metalness: 0,
      roughness: 0.5,
      clearcoat: 0.35,
      clearcoatRoughness: 0.4,
    });
    const h = BTN_PROUD + 0.05;
    const cg = new THREE.CylinderGeometry(BTN_R * 0.93, BTN_R, h, 48);
    cg.rotateX(Math.PI / 2); /* +y cap becomes the +z face */
    cg.translate(0, 0, BTN_FACE_Z + BTN_PROUD - h / 2);
    const cap = new THREE.Mesh(cg, mat);
    cap.castShadow = true;
    cap.receiveShadow = true;
    group.add(cap);

    const iconCanvas = document.createElement("canvas");
    iconCanvas.width = iconCanvas.height = 256;
    const iconTex = srgb(new THREE.CanvasTexture(iconCanvas));
    iconTex.anisotropy = 16;
    const icon = new THREE.Mesh(
      new THREE.PlaneGeometry(BTN_R * 1.5, BTN_R * 1.5),
      new THREE.MeshStandardMaterial({
        map: iconTex,
        transparent: true,
        depthWrite: false,
        roughness: 0.6,
        metalness: 0,
      })
    );
    icon.position.z = BTN_FACE_Z + BTN_PROUD + 0.0035;
    group.add(icon);

    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(BTN_HIT_R, 24),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    pad.position.z = BTN_FACE_Z + BTN_PROUD + 0.02;
    group.add(pad);

    root.add(group);
    buttons.push({
      kind,
      group,
      mat,
      pad,
      iconCanvas,
      iconTex,
      down: false,
      press: BTN_PRESS,
    });
  }

  /* generated face parts, grouped so dial depth can move them together */
  const faceGroup = new THREE.Group();
  faceGroup.position.y = DIAL_CY;
  root.add(faceGroup);

  const plate = new THREE.Mesh(new THREE.BufferGeometry(), faceMat);
  const dial = new THREE.Mesh(
    new THREE.PlaneGeometry(DIAL_SIZE, DIAL_SIZE),
    dialMat
  );
  const disc = new THREE.Mesh(new THREE.BufferGeometry(), discMat);
  const knob = new THREE.Mesh(new THREE.BufferGeometry(), knobMat);
  const stemPivot = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.BufferGeometry(), knobMat);
  stemPivot.add(stem);
  dial.position.z = DIAL_Z;
  plate.receiveShadow = true;
  dial.receiveShadow = true;
  disc.castShadow = true;
  knob.castShadow = true;
  stem.castShadow = true;
  faceGroup.add(plate, dial, disc, stemPivot, knob);

  const pg = new THREE.ExtrudeGeometry(roundedShape(PLATE_W, PLATE_H, 0.3), {
    depth: 0.22,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 3,
    curveSegments: 20,
  });
  pg.translate(0, 0, PLATE_FRONT - 0.24);
  plate.geometry = pg;

  /* one rotary control: the whole dial face. its pivot is the disc
     centre, which lives in faceGroup space. */
  const controls = [
    {
      id: "dial",
      meshes: [disc, dial, knob],
      space: faceGroup,
      local: new THREE.Vector3(0, 0, DISC_Z),
      unitsPerTurn: 60,
      secondsPerUnit: 60,
      step: 60,
    },
  ];

  /* anything solid that must swallow a drag rather than dial it.
     without these a drag on the BACK of the case silently sets time. */
  const blockers = [body, stand, readout];

  let discBuiltAt = -1;
  let discDirty = true;
  let cur = { discRadius: DEFAULTS.discRadius, discDepth: DEFAULTS.discDepth };

  return {
    root,
    controls,
    blockers,
    buttons,

    setTime(seconds, p) {
      const total = Math.max(0, Math.round(seconds));
      const mm = String(Math.floor(total / 60)).padStart(2, "0");
      const ss = String(total % 60).padStart(2, "0");
      const g = digitCanvas.getContext("2d");
      g.clearRect(0, 0, 1024, 272);
      g.fillStyle = p.digitColor;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = '600 168px "Helvetica Neue", Helvetica, Arial, sans-serif';
      g.fillText(`${mm}:${ss}`, 512, 146);
      digitTex.needsUpdate = true;
    },

    update(dt, state) {
      /* the sweep angle IS the remaining minutes, so the disc is rebuilt
         rather than rotated. only when it actually moved. */
      const v = Math.max(0, Math.min(60, state.seconds / 60));
      if (Math.abs(v - discBuiltAt) > 0.01 || discDirty) {
        disc.geometry.dispose();
        disc.geometry = makeDiscGeometry(v, cur.discRadius, cur.discDepth);
        discBuiltAt = v;
        discDirty = false;
        stemPivot.rotation.z = Math.PI / 2 + (v / 60) * Math.PI * 2;
      }
      disc.visible = v > 0.005;
    },

    applyParams(p) {
      faceGroup.position.set(0, DIAL_CY, p.dialZ);

      const kg = new THREE.CylinderGeometry(p.knobRadius, p.knobRadius, 0.2, 48);
      kg.rotateX(Math.PI / 2);
      kg.translate(0, 0, KNOB_Z);
      knob.geometry.dispose();
      knob.geometry = kg;

      const sg = new THREE.BoxGeometry(p.discRadius * 0.72, 0.075, 0.055);
      sg.translate(p.discRadius * 0.36, 0, STEM_Z);
      stem.geometry.dispose();
      stem.geometry = sg;

      cur.discRadius = p.discRadius;
      cur.discDepth = p.discDepth;
      discDirty = true;

      caseMat.color.set(p.caseColor);
      caseMat.roughness = p.roughness;
      caseMat.clearcoat = p.clearcoat;
      panelMat.color.set(p.panelColor);
      knobMat.color.set(new THREE.Color(p.caseColor).offsetHSL(0, 0, -0.07));
      discMat.color.set(p.discColor);
      faceMat.color.set(p.faceColor);
      if (dialMat.map) dialMat.map.dispose();
      dialMat.map = makeDialTexture(p.faceColor);
      dialMat.needsUpdate = true;
    },

    paintButtons(p, running) {
      const startFace = new THREE.Color(p.discColor);
      const resetFace = new THREE.Color(p.faceColor);
      const start = buttons.find((b) => b.kind === "start");
      const reset = buttons.find((b) => b.kind === "reset");
      start.baseColor = startFace;
      reset.baseColor = resetFace;
      drawButtonIcon(start, running ? "pause" : "play", inkOn(startFace));
      drawButtonIcon(reset, "reset", inkOn(resetFace));
    },

    dispose() {
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m.map) m.map.dispose();
            m.dispose();
          }
        }
      });
    },
  };
}

export default {
  id: "time-timer",
  name: "Time Timer",
  maxSeconds: 3600,
  defaults: DEFAULTS,
  presets: PRESETS,
  fields: FIELDS,
  frameHalf: 2.2,
  groundY: -1.63,
  thumb: { phi: 1.33, theta: 0, radius: 7.4 },
  build,
};
