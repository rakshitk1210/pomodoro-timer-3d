import * as THREE from "three";
import { roundedShape, srgb, inkOn, drawButtonIcon } from "../lib/three-utils";
import { drawSevenSegment } from "../lib/sevenSegment";
import { playWoosh, startSandHiss, stopSandHiss } from "../sfx";

/* ------------------------------------------------------------------ */
/*  layout                                                              */
/*                                                                      */
/*  built in a frame where the NECK is y = 0 and the two bulbs are      */
/*  exact mirrors. the symmetry is not cosmetic: it is the only reason  */
/*  the flip can snap its rotation back to zero without a visible pop.  */
/* ------------------------------------------------------------------ */

const H = 1.645; /* glass half height */
const Y_MAX = 1.34; /* the highest the sand ever stands: the widest point */

/* half the silhouette, neck upward. splined, then sampled, so the glass,
   the sand and the pile all come off one curve and cannot drift apart. */
const PROFILE = [
  [0.085, 0.0],
  [0.115, 0.045],
  [0.2, 0.125],
  [0.375, 0.26],
  [0.585, 0.44],
  [0.79, 0.66],
  [0.935, 0.9],
  [1.005, 1.13],
  [1.02, 1.34],
  [0.955, 1.48],
  [0.78, 1.575],
  [0.44, 1.625],
  [0.06, 1.645],
];

const INSET = 0.985; /* sand sits inside the wall, never z-fighting it */
const SPREAD = 1.48; /* pile cone: radius gained per unit of drop, ~34 deg */
const SPREAD_FLAT = 60; /* the same cone, flattened out, for the flip */

/* converting height to time, the throat counts as at least this wide.
   with the true radius the last minutes drain in a blur and the drag
   has a dead zone at the bottom; the sand itself is still drawn at its
   true width, so nothing about the shape changes. */
const R_FLOOR = 0.45;

const SAND_RINGS = 26;
const LATHE_SEGS = 72;

const BASE_R = 1.22;
const BASE_H = 0.38;
const BASE_CY = -H - BASE_H / 2;
const LIFT = 0.17; /* centres glass + base on the origin */

const DISP_W = 0.6;
const DISP_H = 0.2;
const DISP_DEPTH = 0.06;
const DISP_BEVEL = 0.006;
/* the base is round, so a flat panel across the readout's chord has to
   be thick enough to bridge the 0.037 of sagitta or it sinks into the
   middle of the cylinder while floating proud at its ends */
const DISP_BACK = BASE_R - 0.035;

const BTN_R = 0.105;
const BTN_HIT_R = 0.18;
const BTN_CX = 0.6;
const BTN_PROUD = 0.038;
const BTN_PRESS = 0.03;

/* a rotary control can be turned as far as you like, so the cassette
   gets away with 60 minutes per turn. this one is capped by how tall
   the object is on screen — at 1:1 the whole hour lands inside about
   170 pixels, which is under two pixels a minute. tracking the finger
   exactly is worth less than being able to pick 25 rather than 26. */
const DRAG_GAIN = 0.4;

const FLIP_DUR = 0.9;
const FLIP_LIFT = 0.3;

const MAX_SECONDS = 3600;

/* ------------------------------------------------------------------ */
/*  the profile, and the volume tables derived from it                  */
/*  module level: the curve is a constant, so two instances (the scene  */
/*  and the thumbnail rail) share the tables rather than each paying    */
/*  for them.                                                           */
/* ------------------------------------------------------------------ */

const CURVE = new THREE.SplineCurve(
  PROFILE.map(([r, y]) => new THREE.Vector2(r, y))
);

/* sampled dense and forced monotonic in y — a catmull rom through hand
   placed points can double back a hair, and a non monotonic table makes
   every lookup below it nonsense */
const SAMP = (() => {
  const raw = CURVE.getPoints(400);
  const out = [raw[0].clone()];
  for (let i = 1; i < raw.length; i++) {
    const p = raw[i].clone();
    p.y = Math.max(p.y, out[out.length - 1].y + 1e-5);
    p.x = Math.max(p.x, 0.02);
    out.push(p);
  }
  return out;
})();

function rAt(y) {
  const a = Math.abs(y);
  if (a <= SAMP[0].y) return SAMP[0].x;
  if (a >= SAMP[SAMP.length - 1].y) return SAMP[SAMP.length - 1].x;
  let lo = 0;
  let hi = SAMP.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (SAMP[mid].y > a) hi = mid;
    else lo = mid;
  }
  const t = (a - SAMP[lo].y) / (SAMP[hi].y - SAMP[lo].y);
  return SAMP[lo].x + (SAMP[hi].x - SAMP[lo].x) * t;
}

/* cumulative solid of revolution, 0 .. Y_MAX.
   `eff` uses the floored radius and is what maps height to time;
   `real` is the true volume and is what the pile has to swallow. */
const VN = 320;
const VOL_REAL = new Float64Array(VN + 1);
const VOL_EFF = new Float64Array(VN + 1);
(() => {
  const dy = Y_MAX / VN;
  for (let i = 1; i <= VN; i++) {
    const y0 = (i - 1) * dy;
    const y1 = i * dy;
    const a0 = rAt(y0);
    const a1 = rAt(y1);
    VOL_REAL[i] =
      VOL_REAL[i - 1] + Math.PI * ((a0 * a0 + a1 * a1) / 2) * dy;
    const e0 = Math.max(a0, R_FLOOR);
    const e1 = Math.max(a1, R_FLOOR);
    VOL_EFF[i] = VOL_EFF[i - 1] + Math.PI * ((e0 * e0 + e1 * e1) / 2) * dy;
  }
})();
const V_EFF_FULL = VOL_EFF[VN];

function tableAt(tab, y) {
  const t = Math.max(0, Math.min(1, y / Y_MAX)) * VN;
  const i = Math.min(VN - 1, Math.floor(t));
  return tab[i] + (tab[i + 1] - tab[i]) * (t - i);
}

function tableInv(tab, v) {
  const target = Math.max(0, Math.min(tab[VN], v));
  let lo = 0;
  let hi = VN;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tab[mid] > target) hi = mid;
    else lo = mid;
  }
  const span = tab[hi] - tab[lo] || 1;
  return ((lo + (target - tab[lo]) / span) / VN) * Y_MAX;
}

/* time is linear in the effective volume, so the stream is steady and
   the pile grows at a constant rate. the plate's descent is therefore
   gentle at the rim and quick at the throat, exactly like the real
   thing — and the drag stays even because `gain` inverts this. */
const secondsFromLevel = (h) => (tableAt(VOL_EFF, h) / V_EFF_FULL) * MAX_SECONDS;
const levelFromSeconds = (s) =>
  tableInv(VOL_EFF, (Math.max(0, Math.min(MAX_SECONDS, s)) / MAX_SECONDS) * V_EFF_FULL);

/* ---- the pile: a cone of repose, clipped by the bulb wall ---------- */

function pileRadius(y, yTop, spread) {
  return Math.min(rAt(y) * INSET, Math.max(0, (yTop - y) * spread));
}

function pileVolume(yTop, spread) {
  const n = 140;
  const dy = (yTop + H) / n;
  if (dy <= 0) return 0;
  let v = 0;
  let prev = pileRadius(-H, yTop, spread);
  for (let i = 1; i <= n; i++) {
    const r = pileRadius(-H + i * dy, yTop, spread);
    v += Math.PI * ((prev * prev + r * r) / 2) * dy;
    prev = r;
  }
  return v;
}

const PN = 220;
const PILE_TOP_MAX = -0.05;
const PILE_V = new Float64Array(PN + 1);
(() => {
  for (let i = 0; i <= PN; i++)
    PILE_V[i] = pileVolume(-H + (i / PN) * (PILE_TOP_MAX + H), SPREAD);
})();

function pileTopForVolume(v) {
  const target = Math.max(0, Math.min(PILE_V[PN], v));
  let lo = 0;
  let hi = PN;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (PILE_V[mid] > target) hi = mid;
    else lo = mid;
  }
  const span = PILE_V[hi] - PILE_V[lo] || 1;
  const f = (lo + (target - PILE_V[lo]) / span) / PN;
  return -H + f * (PILE_TOP_MAX + H);
}

/* ------------------------------------------------------------------ */
/*  design panel                                                        */
/* ------------------------------------------------------------------ */

const DEFAULTS = {
  bulbWidth: 1,
  plateSize: 0.94,
  plateThickness: 0.035,
  glassOpacity: 0.3,
  grainFlow: 1,
  displayGlow: 0.5,

  sandColor: "#e3d4b4",
  glassColor: "#dde8ea",
  baseColor: "#e9eae6",
  plateColor: "#c2c7ca",
  displayColor: "#dfe4e6",
  bgColor: "#efeee9",

  roughness: 0.05,
  clearcoat: 1,

  key: 1.5,
  ambient: 0.7,
  exposure: 1.06,
  shadow: 0.2,
};

const PRESETS = {
  Studio: {},
  Obsidian: {
    sandColor: "#8d8f95",
    glassColor: "#9aa3ac",
    glassOpacity: 0.42,
    baseColor: "#24262a",
    plateColor: "#7f858a",
    displayColor: "#8fe3c8",
    bgColor: "#b9bcb8",
    key: 1.25,
    ambient: 0.55,
  },
  Amber: {
    sandColor: "#d99b3f",
    glassColor: "#f3e6cf",
    baseColor: "#43301f",
    plateColor: "#c08a3a",
    displayColor: "#ffbe5c",
    bgColor: "#e3d9c6",
  },
  "Sea Glass": {
    sandColor: "#cfd6cd",
    glassColor: "#b6d8cf",
    glassOpacity: 0.38,
    baseColor: "#dfe6e2",
    plateColor: "#9fb3ac",
    displayColor: "#5fb39a",
    bgColor: "#dde3de",
  },
  Brass: {
    sandColor: "#efe3c9",
    glassColor: "#f2efe7",
    baseColor: "#b08842",
    plateColor: "#caa257",
    displayColor: "#3b2c14",
    bgColor: "#e4ded1",
    roughness: 0.2,
    clearcoat: 0.7,
  },
};

const FIELDS = {
  form: [
    ["bulbWidth", "Bulb width", 0.84, 1.14, 0.005],
    ["plateSize", "Plate size", 0.7, 1, 0.005],
    ["plateThickness", "Plate thickness", 0.015, 0.075, 0.0025],
    ["glassOpacity", "Glass opacity", 0.08, 0.7, 0.01],
    ["grainFlow", "Grain flow", 0.3, 2.2, 0.02],
    ["displayGlow", "Display glow", 0, 1.2, 0.02],
  ],
  light: [
    ["roughness", "Glass roughness", 0, 1, 0.01],
    ["clearcoat", "Clearcoat", 0, 1, 0.01],
    ["key", "Key light", 0, 3, 0.05],
    ["ambient", "Ambient", 0, 1.6, 0.02],
    ["exposure", "Exposure", 0.5, 1.9, 0.01],
    ["shadow", "Shadow", 0, 0.5, 0.01],
  ],
  color: [
    ["sandColor", "Sand"],
    ["glassColor", "Glass"],
    ["baseColor", "Base"],
    ["plateColor", "Plate"],
    ["displayColor", "Display"],
    ["bgColor", "Backdrop"],
  ],
};

/* ------------------------------------------------------------------ */
/*  helpers                                                             */
/* ------------------------------------------------------------------ */

function extrude(shape, depth, z, bevel = 0.006) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 20,
  });
  g.translate(0, 0, z);
  return g;
}

function halfProfile(n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const y = (i / n) * H;
    out.push(new THREE.Vector2(rAt(y), y));
  }
  return out;
}

/* fine speckle. a flat colour on a lathe reads as poured plastic — the
   grain is the whole difference between sand and a solid. */
function makeSandTexture(hex) {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  const base = new THREE.Color(hex);
  g.fillStyle = `#${base.getHexString()}`;
  g.fillRect(0, 0, S, S);

  const light = base.clone().offsetHSL(0, 0, 0.16);
  const dark = base.clone().offsetHSL(0, -0.02, -0.16);
  const rgb = (col) =>
    `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(
      col.b * 255
    )}`;
  const lightHex = rgb(light);
  const darkHex = rgb(dark);

  for (let i = 0; i < 14000; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const up = Math.random() > 0.5;
    g.fillStyle = `rgba(${up ? lightHex : darkHex},${
      0.1 + Math.random() * 0.4
    })`;
    const s = 0.7 + Math.random() * 1.7;
    g.fillRect(x, y, s, s);
  }

  const t = srgb(new THREE.CanvasTexture(c));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 3);
  t.anisotropy = 16;
  return t;
}

/* a soft round grain, so the falling stream is dots and not squares */
function makeGrainSprite() {
  const S = 64;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.55, "rgba(255,255,255,0.85)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return srgb(new THREE.CanvasTexture(c));
}

/* the up/down badge on the plate rim. the plate is the control, but a
   bare disc does not say "drag me" — this does. */
function drawBadgeIcon(canvas, ink) {
  const S = canvas.width;
  const g = canvas.getContext("2d");
  const c = S / 2;
  g.clearRect(0, 0, S, S);
  g.strokeStyle = ink;
  g.fillStyle = ink;
  g.lineCap = "round";
  g.lineWidth = S * 0.055;

  const r = S * 0.26;
  g.beginPath();
  g.moveTo(c, c - r);
  g.lineTo(c, c + r);
  g.stroke();

  const head = S * 0.1;
  for (const dir of [-1, 1]) {
    g.beginPath();
    g.moveTo(c, c + dir * (r + head * 0.35));
    g.lineTo(c - head, c + dir * (r - head * 0.5));
    g.lineTo(c + head, c + dir * (r - head * 0.5));
    g.closePath();
    g.fill();
  }
}

/* ------------------------------------------------------------------ */

function build() {
  const root = new THREE.Group();
  root.position.y = LIFT;

  /* everything that turns over on reset. the base does not. */
  const glassGroup = new THREE.Group();
  root.add(glassGroup);

  /* ---------------- materials ---------------- */

  /* r128 has a `transmission` uniform but no transmission render pass —
     it only modulates alpha — so real refraction is off the table. this
     is the cassette shell's recipe: thin, transparent, no depth write,
     drawn last so three sorts it behind the sand rather than fighting. */
  const glassMat = new THREE.MeshPhysicalMaterial({
    metalness: 0,
    transparent: true,
    opacity: DEFAULTS.glassOpacity,
    roughness: DEFAULTS.roughness,
    clearcoat: DEFAULTS.clearcoat,
    clearcoatRoughness: 0.04,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const sandMat = new THREE.MeshStandardMaterial({
    roughness: 0.95,
    metalness: 0,
  });
  const plateMat = new THREE.MeshPhysicalMaterial({
    metalness: 0.6,
    roughness: 0.26,
    clearcoat: 0.5,
    clearcoatRoughness: 0.3,
    transparent: true,
    opacity: 1,
  });
  const badgeInkMat = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    opacity: 1,
  });
  const baseMat = new THREE.MeshPhysicalMaterial({
    metalness: 0.05,
    roughness: 0.45,
    clearcoat: 0.35,
    clearcoatRoughness: 0.3,
  });
  /* opaque on purpose: as a transparent material it sorts against the
     lit digit plane by centre distance, and from some camera angles the
     housing wins and swallows the readout */
  const dispMat = new THREE.MeshPhysicalMaterial({
    metalness: 0,
    roughness: 0.14,
    clearcoat: 0.85,
    color: "#1b1e20",
  });
  const streamMat = new THREE.MeshStandardMaterial({
    roughness: 0.9,
    metalness: 0,
    transparent: true,
    opacity: 0.92,
  });

  /* ---------------- glass ---------------- */

  const half = halfProfile(56);
  const glassPts = [];
  for (let i = half.length - 1; i >= 1; i--)
    glassPts.push(new THREE.Vector2(half[i].x, -half[i].y));
  for (let i = 0; i < half.length; i++) glassPts.push(half[i].clone());

  const glass = new THREE.Mesh(
    new THREE.LatheGeometry(glassPts, LATHE_SEGS),
    glassMat
  );
  glassGroup.add(glass);

  const rims = [];
  for (const side of [-1, 1]) {
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(rAt(H) - 0.008, 0.022, 8, 64),
      glassMat
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = side * H;
    glassGroup.add(rim);
    rims.push(rim);
  }
  /* drawn after everything it contains */
  glass.renderOrder = 10;
  for (const r of rims) r.renderOrder = 10;

  /* ---------------- sand ---------------- */

  const topSand = new THREE.Mesh(new THREE.BufferGeometry(), sandMat);
  const pile = new THREE.Mesh(new THREE.BufferGeometry(), sandMat);
  /* only the pile and the base cast: they sit low, so their shadows
     land under the object. anything higher up throws a hard ellipse
     onto the ground far to one side, which reads as a stray disc
     rather than as the hourglass's own shadow. */
  pile.castShadow = true;
  pile.receiveShadow = true;
  glassGroup.add(topSand, pile);

  /* the thread. hangs from the neck, scaled to reach the pile. */
  const streamGeo = new THREE.CylinderGeometry(0.019, 0.031, 1, 14, 1, true);
  streamGeo.translate(0, -0.5, 0);
  const stream = new THREE.Mesh(streamGeo, streamMat);
  stream.position.y = -0.01;
  glassGroup.add(stream);

  /* loose grain around the thread — the thread alone reads as a wire */
  const SPRAY = 110;
  const sprayPos = new Float32Array(SPRAY * 3);
  const sprayPhase = new Float32Array(SPRAY);
  const sprayAng = new Float32Array(SPRAY);
  const sprayRad = new Float32Array(SPRAY);
  for (let i = 0; i < SPRAY; i++) {
    sprayPhase[i] = Math.random();
    sprayAng[i] = Math.random() * Math.PI * 2;
    sprayRad[i] = Math.random();
  }
  const sprayGeo = new THREE.BufferGeometry();
  sprayGeo.setAttribute("position", new THREE.BufferAttribute(sprayPos, 3));
  const grainSprite = makeGrainSprite();
  const sprayMat = new THREE.PointsMaterial({
    size: 0.055,
    map: grainSprite,
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const spray = new THREE.Points(sprayGeo, sprayMat);
  /* the positions start at the origin and are only written once sand is
     actually falling, so the bounding sphere three computes on the first
     render has radius zero and culls the grains for good */
  spray.frustumCulled = false;
  glassGroup.add(spray);

  /* ---------------- the plate ---------------- */

  /* a unit disc scaled per frame, never rebuilt — the same trick the
     cassette uses for its reels */
  const plateGeo = new THREE.CylinderGeometry(1, 0.97, 1, 64);
  const plate = new THREE.Mesh(plateGeo, plateMat);
  glassGroup.add(plate);

  const badgeGeo = new THREE.CylinderGeometry(1, 1, 1, 32);
  badgeGeo.rotateX(Math.PI / 2); /* axis along +z, cross section in xy */
  const badge = new THREE.Mesh(badgeGeo, plateMat);
  glassGroup.add(badge);

  /* the plate shrinks with the sand and is seen almost edge on, so by
     a couple of minutes left it is a few pixels tall. this invisible
     band round it keeps the grab target usable all the way down. */
  const padGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
  const platePad = new THREE.Mesh(
    padGeo,
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  glassGroup.add(platePad);

  const badgeCanvas = document.createElement("canvas");
  badgeCanvas.width = badgeCanvas.height = 128;
  const badgeTex = srgb(new THREE.CanvasTexture(badgeCanvas));
  badgeTex.anisotropy = 16;
  badgeInkMat.map = badgeTex;
  const badgeIcon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), badgeInkMat);
  glassGroup.add(badgeIcon);

  /* ---------------- base ---------------- */

  const baseGroup = new THREE.Group();
  root.add(baseGroup);

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(BASE_R, BASE_R * 0.985, BASE_H, 96, 1, false),
    baseMat
  );
  body.position.y = BASE_CY;
  body.castShadow = true;
  body.receiveShadow = true;
  baseGroup.add(body);

  /* a lip round the top, so the glass reads as seated in the base
     rather than balanced on it */
  const lip = new THREE.Mesh(
    new THREE.TorusGeometry(BASE_R - 0.03, 0.032, 10, 96),
    baseMat
  );
  lip.rotation.x = Math.PI / 2;
  lip.position.y = -H + 0.01;
  lip.castShadow = true;
  baseGroup.add(lip);

  /* ---------------- readout ---------------- */

  const dispHousing = new THREE.Mesh(
    extrude(
      roundedShape(DISP_W + 0.055, DISP_H + 0.055, 0.035),
      DISP_DEPTH,
      DISP_BACK,
      DISP_BEVEL
    ),
    dispMat
  );
  dispHousing.position.y = BASE_CY;
  dispHousing.castShadow = true;
  baseGroup.add(dispHousing);

  const dispCanvas = document.createElement("canvas");
  dispCanvas.width = 1024;
  dispCanvas.height = 320;
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
  /* a bevelled extrusion runs from -bevelThickness to depth+bevelThickness,
     so the housing's front face is at DISP_BACK + DISP_DEPTH + DISP_BEVEL.
     land the lit plane on that exact number and the two z-fight, which
     reads as digits that are half there and streaked with moire. */
  dispScreen.position.set(
    0,
    BASE_CY,
    DISP_BACK + DISP_DEPTH + DISP_BEVEL + 0.008
  );
  dispScreen.renderOrder = 5;
  baseGroup.add(dispScreen);

  /* ---------------- transport buttons ---------------- */

  /* they sit on a round base, so each one leans out along its own
     normal and presses along it too */
  const buttons = [];
  for (const [kind, side] of [
    ["reset", -1],
    ["start", 1],
  ]) {
    const th = Math.asin(BTN_CX / BASE_R) * side;
    const group = new THREE.Group();
    group.position.set(Math.sin(th) * BASE_R, BASE_CY, Math.cos(th) * BASE_R);
    group.rotation.y = th;

    const mat = new THREE.MeshPhysicalMaterial({
      metalness: 0.08,
      roughness: 0.4,
      clearcoat: 0.45,
      clearcoatRoughness: 0.3,
    });
    const h = BTN_PROUD + 0.06;
    const cg = new THREE.CylinderGeometry(BTN_R * 0.93, BTN_R, h, 40);
    cg.rotateX(Math.PI / 2); /* +y cap becomes the +z face */
    cg.translate(0, 0, BTN_PROUD - h / 2);
    const cap = new THREE.Mesh(cg, mat);
    cap.castShadow = true;
    cap.receiveShadow = true;
    group.add(cap);

    const iconCanvas = document.createElement("canvas");
    iconCanvas.width = iconCanvas.height = 256;
    const iconTex = srgb(new THREE.CanvasTexture(iconCanvas));
    iconTex.anisotropy = 16;
    const icon = new THREE.Mesh(
      new THREE.PlaneGeometry(BTN_R * 1.7, BTN_R * 1.7),
      new THREE.MeshStandardMaterial({
        map: iconTex,
        transparent: true,
        depthWrite: false,
        roughness: 0.6,
        metalness: 0,
      })
    );
    icon.position.z = BTN_PROUD + 0.0035;
    group.add(icon);

    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(BTN_HIT_R, 24),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    pad.position.z = BTN_PROUD + 0.02;
    group.add(pad);

    baseGroup.add(group);
    buttons.push({
      kind,
      group,
      mat,
      pad,
      iconCanvas,
      iconTex,
      down: false,
      press: BTN_PRESS,
      axis: new THREE.Vector3(Math.sin(th), 0, Math.cos(th)),
    });
  }

  /* ---------------- state ---------------- */

  const cur = { ...DEFAULTS };

  let level = levelFromSeconds(1500);
  let pileTop = -H;
  /* the pile normally rests on the floor of the lower bulb. mid flip it
     lifts off it: sand in a bulb that has just been turned over rests
     against the NECK, not against the far end. */
  let pileLo = -H;
  let pileSpread = SPREAD;
  let builtLevel = -99;
  let builtPile = 99;
  let builtLo = 99;
  let builtSpread = -1;

  let wasFlowing = false;
  let hissOwned = false;
  /* the level startSandHiss was last told about, so a slider dragged mid
     pour retargets the running hiss instead of waiting for the next
     flowing/not-flowing edge */
  let hissLevel = 1;
  const flip = { on: false, t: 0, fromLevel: 0, fromPile: -H, toLevel: 0 };

  /* ---------------- interaction wiring ---------------- */

  const levelControl = {
    id: "level",
    meshes: [plate, badge, badgeIcon, platePad],
    space: glassGroup,
    local: new THREE.Vector3(0, level, 0),
    axis: new THREE.Vector3(0, 1, 0),
    travel: Y_MAX,
    unitsPerTurn: MAX_SECONDS,
    secondsPerUnit: 1,
    step: 60,
    /* height is not linear in time — a millimetre at the throat is
       worth a fraction of one at the rim. converting here is what
       lets the plate stay under the finger while the sand still
       drains at a constant rate. */
    gain(sec, t) {
      const h = levelFromSeconds(sec);
      const h2 = Math.max(0, Math.min(Y_MAX, h + t * Y_MAX * DRAG_GAIN));
      return secondsFromLevel(h2) - sec;
    },
  };

  /* the flip empties this array so nothing can be grabbed mid turn, so
     nothing else may reach the control THROUGH it */
  const controls = [levelControl];

  /* solid parts that must swallow a drag instead of setting the time.
     the glass is deliberately NOT one of them: it wraps the plate, so
     as a blocker its near wall would always be the closest hit and the
     plate could never be grabbed at all. pointing through glass at the
     disc is exactly what the gesture means. */
  const blockers = [topSand, pile, body, lip, dispHousing, dispScreen];

  /* ---------------- geometry that follows the sand ---------------- */

  function rebuildTop() {
    if (level < 0.012) {
      topSand.visible = false;
      /* r128's raycaster does not check `visible`, and topSand is a
         blocker — leaving the last cone behind would swallow drags in
         an empty bulb */
      topSand.geometry.dispose();
      topSand.geometry = new THREE.BufferGeometry();
      return;
    }
    topSand.visible = true;
    /* closed just below the neck, so the column reads as continuous
       with the thread coming out of it */
    const pts = [new THREE.Vector2(0, -0.05)];
    for (let i = 0; i <= SAND_RINGS; i++) {
      const y = (i / SAND_RINGS) * level;
      pts.push(new THREE.Vector2(Math.max(0.004, rAt(y) * INSET), y));
    }
    pts.push(new THREE.Vector2(0, level));
    topSand.geometry.dispose();
    topSand.geometry = new THREE.LatheGeometry(pts, LATHE_SEGS);
  }

  function rebuildPile() {
    if (pileTop <= pileLo + 0.008) {
      pile.visible = false;
      pile.geometry.dispose();
      pile.geometry = new THREE.BufferGeometry();
      return;
    }
    pile.visible = true;
    /* the first point caps the free surface flat; the cone closes the
       far end to a point on its own */
    const pts = [new THREE.Vector2(0, pileLo)];
    for (let i = 0; i <= SAND_RINGS; i++) {
      const y = pileLo + (i / SAND_RINGS) * (pileTop - pileLo);
      pts.push(
        new THREE.Vector2(
          Math.max(0.002, pileRadius(y, pileTop, pileSpread)),
          y
        )
      );
    }
    pile.geometry.dispose();
    pile.geometry = new THREE.LatheGeometry(pts, LATHE_SEGS);
  }

  function placePlate() {
    /* down at the throat the wall is only 0.085 across, so a plate with
       any real minimum size pokes out through the glass. it keeps just
       enough size to stay a visible token; the invisible pad is what
       keeps it grabbable. */
    const r = Math.max(0.12, rAt(level) * INSET * cur.plateSize);
    const th = cur.plateThickness;
    const y = level + th / 2;
    plate.scale.set(r, th, r);
    plate.position.y = y;

    const bR = Math.min(0.105, r * 0.55);
    const bZ = Math.max(0.03, r - bR * 0.3);
    badge.scale.set(bR, bR, 0.052);
    badge.position.set(0, y, bZ);
    badgeIcon.scale.set(bR * 1.6, bR * 1.6, 1);
    badgeIcon.position.set(0, y, bZ + 0.0295);

    /* the badge is wider than the neck, so it only appears once the
       plate has room for it */
    const showBadge = plate.visible && r > 0.3;
    badge.visible = showBadge;
    badgeIcon.visible = showBadge;

    const padR = Math.max(0.34, r * 1.04);
    platePad.scale.set(padR, 0.22, padR);
    platePad.position.y = y;

    levelControl.local.set(0, y, 0);
  }

  function updateStream(dt, flowing) {
    stream.visible = flowing;
    spray.visible = flowing;
    if (!flowing) return;
    const len = Math.max(0.06, -0.01 - pileTop);
    stream.scale.set(1, len, 1);

    const speed = 0.55 * cur.grainFlow;
    for (let i = 0; i < SPRAY; i++) {
      sprayPhase[i] += dt * speed * (0.8 + sprayRad[i] * 0.5);
      if (sprayPhase[i] >= 1) {
        sprayPhase[i] -= 1;
        sprayAng[i] = Math.random() * Math.PI * 2;
        sprayRad[i] = Math.random();
      }
      const p = sprayPhase[i];
      /* grains accelerate, so the column thins as it falls */
      const fall = p * p * 0.45 + p * 0.55;
      const rr = (0.014 + p * 0.05) * (0.35 + sprayRad[i] * 0.65);
      sprayPos[i * 3] = Math.cos(sprayAng[i]) * rr;
      sprayPos[i * 3 + 1] = -0.01 - fall * len;
      sprayPos[i * 3 + 2] = Math.sin(sprayAng[i]) * rr;
    }
    sprayGeo.attributes.position.needsUpdate = true;
  }

  /* ------------------------------------------------------------------ */

  return {
    root,
    controls,
    blockers,
    buttons,

    setTime(seconds) {
      const total = Math.max(0, Math.round(seconds));
      const mm = String(Math.min(99, Math.floor(total / 60))).padStart(2, "0");
      const ss = String(total % 60).padStart(2, "0");
      drawSevenSegment(dispCanvas, `${mm}:${ss}`, cur.displayColor, {
        glow: cur.displayGlow,
      });
      dispTex.needsUpdate = true;
    },

    /* `front` is false for the thumbnail rail's copies and for a timer
       that has been switched away from — the hiss must not outlive
       either of those */
    update(dt, state, front) {
      if (flip.on) {
        flip.t = Math.min(1, flip.t + dt / FLIP_DUR);
        const t = flip.t;
        const e = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
        glassGroup.rotation.x = e * Math.PI;
        glassGroup.position.y = FLIP_LIFT * Math.sin(Math.PI * t);

        /* the sand only redistributes once the turn is past edge on, so
           it reads as settling into the new upper bulb rather than
           pouring sideways through the middle of the flip */
        const s = Math.max(0, (t - 0.45) / 0.55);
        const se = s * s * (3 - 2 * s);
        level = flip.fromLevel * (1 - se);
        /* the mound on the floor becomes a level surface lying against
           the neck — which, once the turn completes and the rotation
           snaps back to zero, IS the full upper bulb. the two are built
           from the same profile mirrored, so the swap has nothing to
           show. the sliver of top sand drains away over the same beat,
           so what leaves one bulb arrives in the other. */
        pileLo = -H + (-flip.toLevel + H) * se;
        pileTop = flip.fromPile + (0.05 - flip.fromPile) * se;
        pileSpread = SPREAD + (SPREAD_FLAT - SPREAD) * se;

        pile.castShadow = false;
        const vis = Math.max(0, (t - 0.78) / 0.22);
        plateMat.opacity = vis;
        badgeInkMat.opacity = vis;
        plate.visible = badge.visible = badgeIcon.visible = vis > 0.02;

        if (t >= 1) {
          /* pi and zero render identically at this instant: the profile
             is an exact mirror and the sand has already reached what
             the flip was aiming at, so the snap has nothing to show */
          flip.on = false;
          glassGroup.rotation.x = 0;
          glassGroup.position.y = 0;
          level = flip.toLevel;
          pileTop = -H;
          pileLo = -H;
          pileSpread = SPREAD;
          plateMat.opacity = 1;
          badgeInkMat.opacity = 1;
          plate.visible = badge.visible = badgeIcon.visible = true;
          pile.castShadow = true;
          if (!controls.length) controls.push(levelControl);
        }
      } else {
        level = levelFromSeconds(state.seconds);
        const f =
          state.total > 0
            ? Math.max(0, Math.min(1, 1 - state.seconds / state.total))
            : 0;
        /* the pile swallows exactly what the top charge held, so a
           finished session fills it and a 5 minute one barely dusts it */
        const vSet = tableAt(VOL_REAL, levelFromSeconds(state.total));
        const want = pileTopForVolume(f * vSet);
        /* eased, so re-setting the time mid session pours the sand back
           up rather than snapping it away */
        pileTop += (want - pileTop) * Math.min(1, dt * 5);
        pileLo = -H;
        pileSpread = SPREAD;
      }

      if (Math.abs(level - builtLevel) > 0.004) {
        builtLevel = level;
        rebuildTop();
      }
      if (
        Math.abs(pileTop - builtPile) > 0.004 ||
        Math.abs(pileLo - builtLo) > 0.004 ||
        Math.abs(pileSpread - builtSpread) > 0.05
      ) {
        builtPile = pileTop;
        builtLo = pileLo;
        builtSpread = pileSpread;
        rebuildPile();
      }
      placePlate();

      const flowing =
        !!front && !flip.on && state.running && state.seconds > 0.05;
      updateStream(dt, flowing);
      const sandLevel = Math.max(0, Math.min(1, state.sandVolume ?? 1));
      if (flowing !== wasFlowing) {
        wasFlowing = flowing;
        hissOwned = flowing;
        if (flowing) {
          startSandHiss(sandLevel);
          hissLevel = sandLevel;
        } else {
          stopSandHiss();
        }
      } else if (flowing && Math.abs(sandLevel - hissLevel) > 0.005) {
        /* startSandHiss on an already-running hiss just retargets its gain,
           so this is a slider move, not a restart */
        startSandHiss(sandLevel);
        hissLevel = sandLevel;
      }
    },

    onButton(kind, st) {
      if (kind !== "reset" || flip.on || !st) return;
      /* nothing has drained, so there is nothing to turn over */
      if (st.setPoint <= 0 || st.seconds >= st.setPoint - 0.5) return;

      flip.on = true;
      flip.t = 0;
      flip.fromLevel = level;
      flip.fromPile = pileTop;
      flip.toLevel = levelFromSeconds(st.setPoint);

      /* r128's raycaster does not skip invisible objects, so hiding the
         plate would not stop a drag landing mid flip and setting a time
         the flip then overwrites. take it out of the pick list instead. */
      controls.length = 0;

      if (wasFlowing) {
        wasFlowing = false;
        hissOwned = false;
        stopSandHiss();
      }
      playWoosh(0.5);
    },

    applyParams(p) {
      Object.assign(cur, p);
      /* a uniform x/z scale, so every volume the tables hold scales with
         it and the height to time mapping is untouched */
      glassGroup.scale.set(p.bulbWidth, 1, p.bulbWidth);

      glassMat.color.set(p.glassColor);
      glassMat.opacity = p.glassOpacity;
      glassMat.roughness = p.roughness;
      glassMat.clearcoat = p.clearcoat;

      if (sandMat.map) sandMat.map.dispose();
      sandMat.map = makeSandTexture(p.sandColor);
      sandMat.color.set("#ffffff");
      sandMat.needsUpdate = true;
      streamMat.color.set(p.sandColor);
      sprayMat.color.set(new THREE.Color(p.sandColor).offsetHSL(0, 0, 0.08));

      plateMat.color.set(p.plateColor);
      baseMat.color.set(p.baseColor);
      dispMat.color.set(new THREE.Color(p.displayColor).multiplyScalar(0.12));

      drawBadgeIcon(badgeCanvas, inkOn(new THREE.Color(p.plateColor)));
      badgeTex.needsUpdate = true;

      placePlate();
    },

    paintButtons(p, running) {
      const startFace = new THREE.Color(p.plateColor);
      const resetFace = new THREE.Color(p.baseColor).offsetHSL(0, 0, -0.09);
      const start = buttons.find((b) => b.kind === "start");
      const reset = buttons.find((b) => b.kind === "reset");
      start.baseColor = startFace;
      reset.baseColor = resetFace;
      drawButtonIcon(start, running ? "pause" : "play", inkOn(startFace));
      drawButtonIcon(reset, "reset", inkOn(resetFace));
    },

    dispose() {
      if (hissOwned) {
        hissOwned = false;
        stopSandHiss();
      }
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
  id: "hourglass",
  name: "Hourglass",
  maxSeconds: MAX_SECONDS,
  defaults: DEFAULTS,
  presets: PRESETS,
  fields: FIELDS,
  frameHalf: 2.35,
  /* far narrower than it is tall — the base is the widest part of it */
  frameHalfX: 1.72,
  groundY: -(H + BASE_H) + LIFT,
  thumb: { phi: 1.3, theta: 0, radius: 8.6 },
  build,
};
