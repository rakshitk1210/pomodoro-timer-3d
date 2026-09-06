import * as THREE from "three";
import {
  roundedShape,
  roundedHole,
  circleHole,
  srgb,
  inkOn,
  drawButtonIcon,
} from "../lib/three-utils";
import { drawSevenSegment } from "../lib/sevenSegment";

/* ------------------------------------------------------------------ */
/*  layout                                                              */
/*  a real compact cassette is 100.5 x 64 x 12 mm. scaled so the width  */
/*  sits in the same envelope as the Time Timer case.                   */
/* ------------------------------------------------------------------ */

const W = 3.4;
const H = 2.17;
const D = 0.4;
const CORNER = 0.13;

const HALF_D = D / 2;
const WALL = 0.07; /* rim thickness */
const PLATE_T = 0.045; /* front and back face thickness */
const FRONT_Z = HALF_D - PLATE_T; /* front plate starts here */

const REEL_CX = 0.72; /* reel centres, mirrored */
const R_HUB = 0.22; /* white hub ring, outer */
const R_MIN = 0.4; /* an empty reel still has this much tape */
const HUB_HOLE = 0.26; /* opening in the front plate over each hub */

const KNOB_R = 0.2;
const KNOB_TEETH = 40;
const KNOB_KNURL = 0.011;
const KNOB_BASE_Z = HALF_D - 0.02;
const KNOB_H = 0.085;

const DISP_W = 0.72;
const DISP_H = 0.34;
const DISP_CY = 0.02;
const DISP_DEPTH = 0.05;
const DISP_BEVEL = 0.006;
/* housing spans HALF_D-0.05 .. HALF_D+0.006, so the lit plane has to
   clear its bevelled front face or the digits render inside the box */
const DISP_FACE_Z = HALF_D + 0.016;

const BTN_R = 0.17;
const BTN_HIT_R = 0.24;
const BTN_CX = 0.55;
const BTN_CY = 0.83;
const BTN_PROUD = 0.04;
const BTN_PRESS = 0.032;

/* tape transport: constant linear speed, so a thin reel spins faster */
const TAPE_SPEED = 1.3;

/* the exposed tape. its width runs along Z, the same axis the packs wind
   about, because tape coming off a reel cannot twist ninety degrees on
   its way out. seen face on that means you look at its edge, which is
   exactly what a real cassette shows you. */
const TAPE_W = 0.13; /* 3.81 mm of tape at this scale */
const TAPE_T = 0.009; /* a ribbon, but not an infinitely thin one */
const TAPE_Z = -0.01; /* centred in the packs it winds onto */
const TAPE_LIFT = 0.006; /* clears the pack surface it lies on */
const GUIDE_X = 1.35;
const GUIDE_Y = -0.85;
const TAPE_WRAP = Math.PI * 0.3; /* how far it hugs each pack */
const TAPE_SEGS = 10;
const TAPE_PTS = 2 * (TAPE_SEGS + 1) + 2;
const TAPE_TILE = 2.4; /* texture tiles per scene unit of tape */

/* ------------------------------------------------------------------ */

const DEFAULTS = {
  reelSize: 0.62,
  knobSize: KNOB_R,
  shellOpacity: 0.15,
  displayGlow: 0.55,

  shellColor: "#eaf1f3",
  tapeColor: "#15161a",
  hubColor: "#f2f4f1",
  knobColor: "#d8a52b",
  displayColor: "#ffab1f",
  bgColor: "#efeee9",

  roughness: 0.08,
  clearcoat: 0.95,

  key: 1.55,
  ambient: 0.66,
  exposure: 1.05,
  shadow: 0.2,
};

const PRESETS = {
  Clear: {},
  Smoke: {
    shellColor: "#8f95a0",
    shellOpacity: 0.28,
    knobColor: "#c9ccd2",
    displayColor: "#7fe0c0",
    hubColor: "#dfe3e6",
    bgColor: "#d8dad6",
  },
  Chrome: {
    shellColor: "#dfe7ea",
    tapeColor: "#241d16",
    knobColor: "#b9bec4",
    hubColor: "#f6f7f4",
    displayColor: "#ffd166",
    bgColor: "#e8e6df",
    roughness: 0.04,
    clearcoat: 1,
  },
  Ferric: {
    shellColor: "#e6dcc8",
    tapeColor: "#2b1d12",
    knobColor: "#a8452c",
    hubColor: "#f4efe2",
    displayColor: "#ff8a3d",
    bgColor: "#ded6c4",
  },
  Midnight: {
    shellColor: "#4a5361",
    shellOpacity: 0.3,
    tapeColor: "#0d0e12",
    knobColor: "#6fd3c4",
    hubColor: "#cdd4dc",
    displayColor: "#6fd3c4",
    bgColor: "#9aa2ab",
    key: 1.2,
    ambient: 0.5,
  },
};

const FIELDS = {
  form: [
    ["reelSize", "Reel size", 0.45, 0.66, 0.005],
    ["knobSize", "Knob size", 0.14, 0.26, 0.005],
    ["shellOpacity", "Shell opacity", 0.06, 0.7, 0.01],
    ["displayGlow", "Display glow", 0, 1.4, 0.02],
  ],
  light: [
    ["roughness", "Shell roughness", 0, 1, 0.01],
    ["clearcoat", "Clearcoat", 0, 1, 0.01],
    ["key", "Key light", 0, 3, 0.05],
    ["ambient", "Ambient", 0, 1.6, 0.02],
    ["exposure", "Exposure", 0.5, 1.9, 0.01],
    ["shadow", "Shadow", 0, 0.5, 0.01],
  ],
  color: [
    ["shellColor", "Shell"],
    ["tapeColor", "Tape"],
    ["hubColor", "Hub"],
    ["knobColor", "Knob"],
    ["displayColor", "Display"],
    ["bgColor", "Backdrop"],
  ],
};

/* ------------------------------------------------------------------ */
/*  geometry helpers                                                    */
/* ------------------------------------------------------------------ */

function extrude(shape, depth, z, bevel = 0.008) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 24,
  });
  g.translate(0, 0, z);
  return g;
}

/* alternating radii around a circle: fine knurling for the knob rim */
function knurledShape(r, teeth, depth) {
  const s = new THREE.Shape();
  const n = teeth * 2;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r - (i % 2 === 0 ? 0 : depth);
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

/* the wound tape, seen end on. concentric layers give it depth, the
   radial streaks are what make the rotation readable at all — a plain
   dark disc spinning about its own axis looks completely static. */
function makeTapeTexture(hex) {
  const S = 1024;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  const base = new THREE.Color(hex);
  const cx = S / 2;
  const cy = S / 2;

  g.fillStyle = `#${base.getHexString()}`;
  g.fillRect(0, 0, S, S);

  const light = base.clone().offsetHSL(0, 0, 0.22);
  const lightHex = `${Math.round(light.r * 255)},${Math.round(
    light.g * 255
  )},${Math.round(light.b * 255)}`;

  /* wound layers */
  g.lineWidth = 1.6;
  for (let i = 0; i < 140; i++) {
    const r = (i / 140) * (S * 0.5);
    g.strokeStyle = `rgba(${lightHex},${0.04 + Math.random() * 0.09})`;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
  }

  /* radial streaks — the rotation cue */
  for (let i = 0; i < 320; i++) {
    const a = Math.random() * Math.PI * 2;
    const r0 = S * (0.08 + Math.random() * 0.2);
    const r1 = r0 + S * (0.05 + Math.random() * 0.24);
    g.strokeStyle = `rgba(${lightHex},${0.04 + Math.random() * 0.16})`;
    g.lineWidth = 0.8 + Math.random() * 3.2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    g.stroke();
  }

  /* the tape end, wound in: one clear mark so a slow rotation is never
     ambiguous */
  for (const [ang, alpha, w] of [
    [0.6, 0.3, 5],
    [0.6 + Math.PI, 0.16, 3],
  ]) {
    g.strokeStyle = `rgba(${lightHex},${alpha})`;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(cx + Math.cos(ang) * S * 0.07, cy + Math.sin(ang) * S * 0.07);
    g.lineTo(cx + Math.cos(ang) * S * 0.49, cy + Math.sin(ang) * S * 0.49);
    g.stroke();
  }

  /* an off centre sheen. it rides with the texture, so the highlight
     sweeps as the reel turns — the single most legible motion cue. */
  const sh = g.createRadialGradient(
    cx - S * 0.16,
    cy - S * 0.18,
    S * 0.02,
    cx,
    cy,
    S * 0.5
  );
  sh.addColorStop(0, `rgba(${lightHex},0.42)`);
  sh.addColorStop(0.4, `rgba(${lightHex},0.12)`);
  sh.addColorStop(1, "rgba(0,0,0,0.22)");
  g.fillStyle = sh;
  g.fillRect(0, 0, S, S);

  const t = srgb(new THREE.CanvasTexture(c));
  t.anisotropy = 16;
  return t;
}

/* the tape seen face on: fine lengthwise grain plus sparse flecks, so
   that scrolling it reads as travel rather than as a shimmer */
function makeRibbonTexture(hex) {
  const W = 256;
  const H = 64;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  const base = new THREE.Color(hex);
  const light = base.clone().offsetHSL(0, 0, 0.26);
  const lightHex = `${Math.round(light.r * 255)},${Math.round(
    light.g * 255
  )},${Math.round(light.b * 255)}`;

  g.fillStyle = `#${base.getHexString()}`;
  g.fillRect(0, 0, W, H);

  /* lengthwise grain */
  for (let i = 0; i < 40; i++) {
    const y = Math.random() * H;
    g.strokeStyle = `rgba(${lightHex},${0.04 + Math.random() * 0.1})`;
    g.lineWidth = 0.6 + Math.random() * 1.6;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }

  /* flecks travelling with the tape are what the eye actually tracks */
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    g.fillStyle = `rgba(${lightHex},${0.08 + Math.random() * 0.22})`;
    g.fillRect(x, y, 1 + Math.random() * 5, 0.8 + Math.random() * 1.6);
  }

  /* a soft highlight down the middle, as if the ribbon is slightly cupped */
  const sh = g.createLinearGradient(0, 0, 0, H);
  sh.addColorStop(0, "rgba(0,0,0,0.3)");
  sh.addColorStop(0.42, `rgba(${lightHex},0.2)`);
  sh.addColorStop(1, "rgba(0,0,0,0.34)");
  g.fillStyle = sh;
  g.fillRect(0, 0, W, H);

  const t = srgb(new THREE.CanvasTexture(c));
  /* the path lays down its own u in tile units, so the texture itself
     repeats once and just slides */
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 16;
  return t;
}

/* ------------------------------------------------------------------ */

function build() {
  const root = new THREE.Group();

  const shellMat = new THREE.MeshPhysicalMaterial({
    metalness: 0,
    transparent: true,
    opacity: DEFAULTS.shellOpacity,
    roughness: DEFAULTS.roughness,
    clearcoat: DEFAULTS.clearcoat,
    clearcoatRoughness: 0.05,
    /* transparent + depthWrite fights with the parts inside. draw the
       shell last instead and let three sort it back to front. */
    depthWrite: false,
  });
  const linerMat = new THREE.MeshStandardMaterial({
    roughness: 0.85,
    metalness: 0,
    color: "#e4e6e1",
  });
  const tapeMat = new THREE.MeshStandardMaterial({
    roughness: 0.44,
    metalness: 0.12,
  });
  const ribbonMat = new THREE.MeshStandardMaterial({
    roughness: 0.34,
    metalness: 0.2,
  });
  const hubMat = new THREE.MeshStandardMaterial({
    roughness: 0.6,
    metalness: 0,
  });
  const knobMat = new THREE.MeshPhysicalMaterial({
    metalness: 0.1,
    roughness: 0.38,
    clearcoat: 0.5,
    clearcoatRoughness: 0.35,
  });
  const notchMat = new THREE.MeshStandardMaterial({
    roughness: 0.7,
    metalness: 0,
    color: "#2a2318",
  });
  const darkMat = new THREE.MeshStandardMaterial({
    roughness: 0.55,
    metalness: 0.3,
    color: "#23262b",
  });
  const screwMat = new THREE.MeshStandardMaterial({
    roughness: 0.35,
    metalness: 0.8,
    color: "#3a3d42",
  });
  const dispMat = new THREE.MeshPhysicalMaterial({
    metalness: 0,
    roughness: 0.15,
    clearcoat: 0.8,
    transparent: true,
    opacity: 0.92,
    color: "#241c0d",
  });

  /* ---------------- shell ---------------- */

  const shell = new THREE.Group();

  /* front plate, punched for the hubs and the bottom mechanism */
  const frontShape = roundedShape(W, H, CORNER);
  frontShape.holes.push(
    circleHole(-REEL_CX, 0, HUB_HOLE),
    circleHole(REEL_CX, 0, HUB_HOLE),
    roundedHole(0, -0.87, 0.52, 0.28, 0.06),
    roundedHole(-0.66, -0.87, 0.26, 0.24, 0.05),
    roundedHole(0.66, -0.87, 0.26, 0.24, 0.05),
    circleHole(-0.4, -0.87, 0.07),
    circleHole(0.4, -0.87, 0.07)
  );
  const front = new THREE.Mesh(extrude(frontShape, PLATE_T, FRONT_Z), shellMat);

  /* back plate, hubs only */
  const backShape = roundedShape(W, H, CORNER);
  backShape.holes.push(
    circleHole(-REEL_CX, 0, HUB_HOLE),
    circleHole(REEL_CX, 0, HUB_HOLE)
  );
  const back = new THREE.Mesh(extrude(backShape, PLATE_T, -HALF_D), shellMat);

  /* the rim that joins them, so the case is hollow rather than a slab */
  const rimShape = roundedShape(W, H, CORNER);
  rimShape.holes.push(
    roundedHole(0, 0, W - WALL * 2, H - WALL * 2, CORNER - WALL * 0.5)
  );
  const rim = new THREE.Mesh(extrude(rimShape, D, -HALF_D, 0.004), shellMat);

  shell.add(front, back, rim);
  /* drawn after everything inside it */
  shell.traverse((o) => {
    if (o.isMesh) o.renderOrder = 10;
  });
  root.add(shell);

  /* ---------------- interior ---------------- */

  const liner = new THREE.Mesh(
    extrude(roundedShape(W - 0.28, H - 0.3, 0.1), 0.012, -HALF_D + 0.05, 0.004),
    linerMat
  );
  liner.receiveShadow = true;
  root.add(liner);

  /* reels: a unit cylinder scaled per frame, so tape transfer never
     rebuilds geometry */
  const reelGeo = new THREE.CylinderGeometry(1, 1, 0.22, 64, 1, false);
  reelGeo.rotateX(Math.PI / 2); /* +y axis becomes +z, disc lies in xy */

  const hubGeoShape = new THREE.Shape();
  hubGeoShape.absarc(0, 0, R_HUB, 0, Math.PI * 2, false);
  hubGeoShape.holes.push(circleHole(0, 0, 0.13));
  const hubGeo = extrude(hubGeoShape, 0.2, -0.1, 0.004);

  const reels = [];
  for (const side of [-1, 1]) {
    const group = new THREE.Group();
    group.position.set(side * REEL_CX, 0, -0.01);

    const pack = new THREE.Mesh(reelGeo, tapeMat);
    pack.castShadow = true;
    pack.receiveShadow = true;
    group.add(pack);

    const hub = new THREE.Mesh(hubGeo, hubMat);
    group.add(hub);

    /* six splines inside the hub, like the real drive teeth */
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const tooth = new THREE.Mesh(
        new THREE.BoxGeometry(0.055, 0.032, 0.19),
        hubMat
      );
      tooth.position.set(Math.cos(a) * 0.145, Math.sin(a) * 0.145, 0);
      tooth.rotation.z = a;
      group.add(tooth);
    }

    root.add(group);
    reels.push({ group, pack, radius: DEFAULTS.reelSize });
  }

  /* one continuous ribbon: it wraps the supply pack, comes off on the
     tangent, drops to a guide, runs across the front, and winds back on
     at the take up pack. rebuilt whenever a radius moves, so the tangent
     really does track each pack as it fills and empties. */
  const tapePos = new Float32Array(TAPE_PTS * 4 * 3);
  const tapeUv = new Float32Array(TAPE_PTS * 4 * 2);
  const tapeIdx = [];
  for (let i = 0; i < TAPE_PTS - 1; i++) {
    const a = i * 4;
    const b = (i + 1) * 4;
    /* four faces round the cross section, so the tape has an edge */
    for (let f = 0; f < 4; f++) {
      const g = (f + 1) % 4;
      tapeIdx.push(a + f, b + f, b + g, a + f, b + g, a + g);
    }
  }
  const tapeGeo = new THREE.BufferGeometry();
  tapeGeo.setAttribute("position", new THREE.BufferAttribute(tapePos, 3));
  tapeGeo.setAttribute("uv", new THREE.BufferAttribute(tapeUv, 2));
  tapeGeo.setIndex(tapeIdx);
  const tape = new THREE.Mesh(tapeGeo, ribbonMat);
  tape.castShadow = true;
  root.add(tape);

  const pathX = new Float32Array(TAPE_PTS);
  const pathY = new Float32Array(TAPE_PTS);

  /* where a taut tape leaves a pack of radius r on its way to a guide */
  function tangentAngle(cx, r, gx, gy, sign) {
    const vx = gx - cx;
    const d = Math.hypot(vx, gy);
    const a = Math.acos(Math.min(1, Math.max(-1, r / d)));
    return Math.atan2(gy, vx) + sign * a;
  }

  function rebuildTape(rS, rT) {
    let n = 0;
    /* supply pack, traversed the same way it turns */
    const tL = tangentAngle(-REEL_CX, rS, -GUIDE_X, GUIDE_Y, -1);
    for (let i = 0; i <= TAPE_SEGS; i++) {
      const a = tL - TAPE_WRAP + (i / TAPE_SEGS) * TAPE_WRAP;
      pathX[n] = -REEL_CX + Math.cos(a) * (rS + TAPE_LIFT);
      pathY[n] = Math.sin(a) * (rS + TAPE_LIFT);
      n++;
    }
    pathX[n] = -GUIDE_X;
    pathY[n] = GUIDE_Y;
    n++;
    pathX[n] = GUIDE_X;
    pathY[n] = GUIDE_Y;
    n++;
    /* take up pack, winding on */
    const tR = tangentAngle(REEL_CX, rT, GUIDE_X, GUIDE_Y, 1);
    for (let i = 0; i <= TAPE_SEGS; i++) {
      const a = tR + (i / TAPE_SEGS) * TAPE_WRAP;
      pathX[n] = REEL_CX + Math.cos(a) * (rT + TAPE_LIFT);
      pathY[n] = Math.sin(a) * (rT + TAPE_LIFT);
      n++;
    }

    let run = 0;
    const hw = TAPE_W / 2;
    for (let i = 0; i < TAPE_PTS; i++) {
      const px = pathX[i];
      const py = pathY[i];
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(TAPE_PTS - 1, i + 1);
      let dx = pathX[i1] - pathX[i0];
      let dy = pathY[i1] - pathY[i0];
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl;
      dy /= dl;
      /* thickness sits across the ribbon, width along the winding axis */
      const nx = -dy * (TAPE_T / 2);
      const ny = dx * (TAPE_T / 2);
      if (i > 0) run += Math.hypot(px - pathX[i - 1], py - pathY[i - 1]);
      const u = run * TAPE_TILE;

      const o = i * 4;
      const put = (k, x, y, z, vv) => {
        tapePos[(o + k) * 3] = x;
        tapePos[(o + k) * 3 + 1] = y;
        tapePos[(o + k) * 3 + 2] = z;
        tapeUv[(o + k) * 2] = u;
        tapeUv[(o + k) * 2 + 1] = vv;
      };
      put(0, px - nx, py - ny, TAPE_Z - hw, 0);
      put(1, px - nx, py - ny, TAPE_Z + hw, 1);
      put(2, px + nx, py + ny, TAPE_Z + hw, 1);
      put(3, px + nx, py + ny, TAPE_Z - hw, 0);
    }
    tapeGeo.attributes.position.needsUpdate = true;
    tapeGeo.attributes.uv.needsUpdate = true;
    tapeGeo.computeVertexNormals();
    tapeGeo.computeBoundingSphere();
  }
  rebuildTape(DEFAULTS.reelSize, R_MIN);

  /* mechanism plate behind the bottom cutouts */
  const mech = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.42, 0.03),
    darkMat
  );
  mech.position.set(0, -0.87, -0.06);
  root.add(mech);

  /* guide rollers at the lower corners */
  for (const side of [-1, 1]) {
    const roller = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.16, 24),
      darkMat
    );
    roller.rotation.x = Math.PI / 2;
    roller.position.set(side * 1.28, -0.78, -0.01);
    root.add(roller);
  }

  /* corner screws */
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const screw = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.055, 0.05, 16),
        screwMat
      );
      screw.rotation.x = Math.PI / 2;
      screw.position.set(sx * 1.5, sy * 0.88, HALF_D - 0.015);
      root.add(screw);
    }
  }
  const midScrew = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 0.05, 16),
    screwMat
  );
  midScrew.rotation.x = Math.PI / 2;
  midScrew.position.set(0, -0.55, HALF_D - 0.015);
  root.add(midScrew);

  /* ---------------- display ---------------- */

  const dispHousing = new THREE.Mesh(
    extrude(
      roundedShape(DISP_W + 0.07, DISP_H + 0.07, 0.04),
      DISP_DEPTH,
      HALF_D - DISP_DEPTH,
      DISP_BEVEL
    ),
    dispMat
  );
  dispHousing.position.y = DISP_CY;
  dispHousing.castShadow = true;
  root.add(dispHousing);

  const dispCanvas = document.createElement("canvas");
  dispCanvas.width = 1024;
  dispCanvas.height = 512;
  const dispTex = srgb(new THREE.CanvasTexture(dispCanvas));
  dispTex.anisotropy = 16;
  const dispScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(DISP_W, DISP_H),
    new THREE.MeshBasicMaterial({
      map: dispTex,
      transparent: true,
      depthWrite: false,
    })
  );
  dispScreen.position.set(0, DISP_CY, DISP_FACE_Z);
  root.add(dispScreen);

  /* ---------------- knobs ---------------- */

  const knobs = [];
  for (const [i, side] of [-1, 1].entries()) {
    const group = new THREE.Group();
    group.position.set(side * REEL_CX, 0, 0);

    const body = new THREE.Mesh(new THREE.BufferGeometry(), knobMat);
    body.castShadow = true;
    const cap = new THREE.Mesh(new THREE.BufferGeometry(), knobMat);
    cap.castShadow = true;

    /* the index notch: without it a smooth knob gives no feedback that
       it turned at all */
    const notch = new THREE.Mesh(new THREE.BufferGeometry(), notchMat);

    group.add(body, cap, notch);
    root.add(group);
    knobs.push({ group, body, cap, notch, side, unit: i === 0 ? 60 : 1 });
  }

  /* ---------------- transport buttons ---------------- */

  const buttons = [];
  for (const [kind, cx] of [
    ["reset", -BTN_CX],
    ["start", BTN_CX],
  ]) {
    const group = new THREE.Group();
    group.position.set(cx, BTN_CY, 0);

    const mat = new THREE.MeshPhysicalMaterial({
      metalness: 0.1,
      roughness: 0.42,
      clearcoat: 0.45,
      clearcoatRoughness: 0.35,
    });
    const h = BTN_PROUD + 0.05;
    const cg = new THREE.CylinderGeometry(BTN_R * 0.93, BTN_R, h, 44);
    cg.rotateX(Math.PI / 2);
    cg.translate(0, 0, HALF_D + BTN_PROUD - h / 2);
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
    icon.position.z = HALF_D + BTN_PROUD + 0.0035;
    group.add(icon);

    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(BTN_HIT_R, 24),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    pad.position.z = HALF_D + BTN_PROUD + 0.02;
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

  /* ---------------- interaction wiring ---------------- */

  /* left knob is minutes, right knob is seconds. both are 60 per turn,
     and because the host holds a single total in seconds, winding the
     seconds knob past 59 rolls the minute up for free. */
  const controls = knobs.map((k, i) => ({
    id: i === 0 ? "minutes" : "seconds",
    meshes: [k.body, k.cap, k.notch],
    space: root,
    local: new THREE.Vector3(k.side * REEL_CX, 0, KNOB_BASE_Z),
    unitsPerTurn: 60,
    secondsPerUnit: k.unit,
    step: k.unit,
  }));

  /* solid parts that must swallow a drag instead of dialling it */
  const blockers = [
    front,
    back,
    rim,
    liner,
    dispHousing,
    dispScreen,
    mech,
    tape,
    ...reels.map((r) => r.pack),
  ];

  const cur = {
    reelSize: DEFAULTS.reelSize,
    displayColor: DEFAULTS.displayColor,
    displayGlow: DEFAULTS.displayGlow,
  };
  /* radii are animated rather than snapped so Reset winds back */
  let rSupply = DEFAULTS.reelSize;
  let rTakeup = R_MIN;
  const tapeAt = { s: DEFAULTS.reelSize, t: R_MIN };

  return {
    root,
    controls,
    blockers,
    buttons,

    setTime(seconds, p) {
      const total = Math.max(0, Math.round(seconds));
      const mm = String(Math.min(99, Math.floor(total / 60))).padStart(2, "0");
      const ss = String(total % 60).padStart(2, "0");
      drawSevenSegment(dispCanvas, `${mm}:${ss}`, cur.displayColor, {
        glow: cur.displayGlow,
      });
      dispTex.needsUpdate = true;

      /* the knobs read the value back, so they track a drag and also
         move when the countdown changes the time under them */
      knobs[0].group.rotation.z = (Math.floor(total / 60) / 60) * Math.PI * 2;
      knobs[1].group.rotation.z = ((total % 60) / 60) * Math.PI * 2;
    },

    update(dt, state) {
      const rMax = cur.reelSize;
      /* elapsed fraction of the session drives the transfer */
      const f =
        state.total > 0
          ? Math.max(0, Math.min(1, 1 - state.seconds / state.total))
          : 0;

      /* conserve tape area: what leaves the supply reel arrives on the
         take up reel, so the radii move as square roots not linearly */
      const span2 = rMax * rMax - R_MIN * R_MIN;
      const tSupply = Math.sqrt(R_MIN * R_MIN + (1 - f) * span2);
      const tTakeup = Math.sqrt(R_MIN * R_MIN + f * span2);

      const k = Math.min(1, dt * 6);
      rSupply += (tSupply - rSupply) * k;
      rTakeup += (tTakeup - rTakeup) * k;

      reels[0].pack.scale.set(rSupply, rSupply, 1);
      reels[1].pack.scale.set(rTakeup, rTakeup, 1);

      /* nothing moves once the session is over, only while tape is
         actually being pulled across the head */
      const moving = state.running && state.seconds > 0.05;
      if (moving) {
        /* counter clockwise: the bottom of a reel turning this way
           travels +x, which is what carries tape from the paying out
           reel across to the one taking it up. turning them the other
           way reads as the tape running backwards, from the growing
           reel into the shrinking one. */
        reels[0].group.rotation.z += (TAPE_SPEED / rSupply) * dt;
        reels[1].group.rotation.z += (TAPE_SPEED / rTakeup) * dt;

        /* the ribbon travels the same way, at the same speed. u is laid
           down in tile units, so the offset moves at speed * tiles. */
        if (ribbonMat.map)
          ribbonMat.map.offset.x -= TAPE_SPEED * TAPE_TILE * dt;
      }

      /* the tangents ride on the pack radii, so the path is only stale
         once a reel has actually changed size */
      if (
        Math.abs(rSupply - tapeAt.s) > 0.0004 ||
        Math.abs(rTakeup - tapeAt.t) > 0.0004
      ) {
        tapeAt.s = rSupply;
        tapeAt.t = rTakeup;
        rebuildTape(rSupply, rTakeup);
      }
    },

    applyParams(p) {
      cur.reelSize = p.reelSize;
      cur.displayColor = p.displayColor;
      cur.displayGlow = p.displayGlow;

      shellMat.color.set(p.shellColor);
      shellMat.opacity = p.shellOpacity;
      shellMat.roughness = p.roughness;
      shellMat.clearcoat = p.clearcoat;

      if (tapeMat.map) tapeMat.map.dispose();
      tapeMat.map = makeTapeTexture(p.tapeColor);
      tapeMat.color.set("#ffffff");
      tapeMat.needsUpdate = true;

      /* rebuilt on a colour change, so carry the scroll position over
         or the tape jumps every time a slider moves */
      const at = ribbonMat.map ? ribbonMat.map.offset.x : 0;
      if (ribbonMat.map) ribbonMat.map.dispose();
      ribbonMat.map = makeRibbonTexture(p.tapeColor);
      ribbonMat.map.offset.x = at;
      ribbonMat.color.set("#ffffff");
      ribbonMat.needsUpdate = true;

      hubMat.color.set(p.hubColor);
      knobMat.color.set(p.knobColor);
      dispMat.color.set(new THREE.Color(p.displayColor).multiplyScalar(0.13));

      /* knob geometry follows the size slider */
      const r = p.knobSize;
      for (const k of knobs) {
        k.body.geometry.dispose();
        k.body.geometry = extrude(
          knurledShape(r, KNOB_TEETH, KNOB_KNURL),
          KNOB_H,
          KNOB_BASE_Z,
          0.003
        );
        k.cap.geometry.dispose();
        const cg = new THREE.CylinderGeometry(r * 0.9, r * 0.93, 0.022, 40);
        cg.rotateX(Math.PI / 2);
        cg.translate(0, 0, KNOB_BASE_Z + KNOB_H + 0.008);
        k.cap.geometry = cg;

        k.notch.geometry.dispose();
        const ng = new THREE.BoxGeometry(r * 0.72, 0.026, 0.012);
        ng.translate(r * 0.42, 0, KNOB_BASE_Z + KNOB_H + 0.022);
        k.notch.geometry = ng;
      }

      for (const c of controls) c.local.setZ(KNOB_BASE_Z + KNOB_H);
    },

    paintButtons(p, running) {
      const startFace = new THREE.Color(p.knobColor);
      const resetFace = new THREE.Color(p.hubColor).offsetHSL(0, 0, -0.28);
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
  id: "cassette",
  name: "Cassette",
  maxSeconds: 5999, /* 99:59 */
  defaults: DEFAULTS,
  presets: PRESETS,
  fields: FIELDS,
  frameHalf: 2.05,
  groundY: -1.12,
  thumb: { phi: 1.4, theta: 0, radius: 7.2 },
  build,
};
