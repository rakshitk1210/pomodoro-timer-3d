import * as THREE from "three";

/* ------------------------------------------------------------------ */
/*  quantised mesh decoding (Spline exports)                            */
/* ------------------------------------------------------------------ */

export function decodeMesh(m) {
  const bytes = (b64) => {
    const s = atob(b64);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  };
  const pb = bytes(m.p);
  const nb = bytes(m.n);
  const ib = bytes(m.i);

  const q = new Uint16Array(pb.buffer, pb.byteOffset, pb.length / 2);
  const pos = new Float32Array(q.length);
  for (let i = 0; i < q.length; i += 3) {
    pos[i] = m.o[0] + (q[i] / 65535) * m.s[0];
    pos[i + 1] = m.o[1] + (q[i + 1] / 65535) * m.s[1];
    pos[i + 2] = m.o[2] + (q[i + 2] / 65535) * m.s[2];
  }

  const ni = new Int8Array(nb.buffer, nb.byteOffset, nb.length);
  const nor = new Float32Array(ni.length);
  for (let i = 0; i < ni.length; i++) nor[i] = ni[i] / 127;

  const idx = new Uint16Array(ib.buffer, ib.byteOffset, ib.length / 2);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
  return g;
}

/* ------------------------------------------------------------------ */
/*  shapes                                                              */
/* ------------------------------------------------------------------ */

export function roundedShape(w, h, radius) {
  const x = w / 2;
  const y = h / 2;
  const r = Math.min(radius, Math.min(x, y) * 0.999);
  const o = new THREE.Shape();
  o.moveTo(-x + r, -y);
  o.lineTo(x - r, -y);
  o.quadraticCurveTo(x, -y, x, -y + r);
  o.lineTo(x, y - r);
  o.quadraticCurveTo(x, y, x - r, y);
  o.lineTo(-x + r, y);
  o.quadraticCurveTo(-x, y, -x, y - r);
  o.lineTo(-x, -y + r);
  /* this last corner has to land back on the start point. ending it at
     its own start leaves the corner undrawn, and the shape closes with a
     straight line instead — one chamfered corner against three round
     ones, which reads as a stray sharp edge and breaks the symmetry. */
  o.quadraticCurveTo(-x, -y, -x + r, -y);
  return o;
}

/* a rounded rectangle as a Path, for punching holes in a Shape */
export function roundedHole(cx, cy, w, h, radius) {
  const x = w / 2;
  const y = h / 2;
  const r = Math.min(radius, Math.min(x, y) * 0.999);
  const p = new THREE.Path();
  p.moveTo(cx - x + r, cy - y);
  p.lineTo(cx + x - r, cy - y);
  p.quadraticCurveTo(cx + x, cy - y, cx + x, cy - y + r);
  p.lineTo(cx + x, cy + y - r);
  p.quadraticCurveTo(cx + x, cy + y, cx + x - r, cy + y);
  p.lineTo(cx - x + r, cy + y);
  p.quadraticCurveTo(cx - x, cy + y, cx - x, cy + y - r);
  p.lineTo(cx - x, cy - y + r);
  p.quadraticCurveTo(cx - x, cy - y, cx - x + r, cy - y);
  return p;
}

export function circleHole(cx, cy, r) {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, true);
  return p;
}

/* ------------------------------------------------------------------ */
/*  textures                                                            */
/* ------------------------------------------------------------------ */

export function srgb(tex) {
  if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
  return tex;
}

export function makeBackdrop(hex) {
  const b = new THREE.Color(hex);
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 512;
  const g = c.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, `#${b.clone().offsetHSL(0, 0, 0.05).getHexString()}`);
  gr.addColorStop(1, `#${b.clone().offsetHSL(0, 0, -0.07).getHexString()}`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 8, 512);
  return srgb(new THREE.CanvasTexture(c));
}

/* ------------------------------------------------------------------ */
/*  2d canvas helpers                                                   */
/* ------------------------------------------------------------------ */

/* pick ink that stays legible whatever the preset does underneath */
export function inkOn(color) {
  const l = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  return l > 0.45 ? "#161c17" : "#f3f6f2";
}

export function roundRectPath(g, x, y, w, h, r) {
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
}

/* ------------------------------------------------------------------ */
/*  transport button icons, shared by both timers                       */
/* ------------------------------------------------------------------ */

export function drawButtonIcon(btn, kind, ink) {
  const S = btn.iconCanvas.width;
  const g = btn.iconCanvas.getContext("2d");
  const c = S / 2;
  g.clearRect(0, 0, S, S);
  g.fillStyle = ink;
  g.strokeStyle = ink;
  g.lineCap = "round";
  g.lineJoin = "round";

  if (kind === "pause") {
    const w = S * 0.1;
    const h = S * 0.3;
    const gap = S * 0.065;
    for (const x of [c - gap - w, c + gap]) {
      g.beginPath();
      roundRectPath(g, x, c - h / 2, w, h, w * 0.35);
      g.fill();
    }
  } else if (kind === "play") {
    /* nudged right so the triangle looks centred rather than measures it */
    const r = S * 0.17;
    const off = S * 0.022;
    g.lineWidth = S * 0.05;
    g.beginPath();
    g.moveTo(c - r * 0.66 + off, c - r);
    g.lineTo(c + r * 0.92 + off, c);
    g.lineTo(c - r * 0.66 + off, c + r);
    g.closePath();
    g.fill();
    g.stroke();
  } else {
    /* reset: a circular arrow, gap and arrowhead at the upper left */
    const r = S * 0.175;
    const a0 = Math.PI * 1.36;
    g.lineWidth = S * 0.075;
    g.beginPath();
    g.arc(c, c, r, a0, a0 + Math.PI * 1.68);
    g.stroke();
    const s = S * 0.105;
    g.save();
    g.translate(c + Math.cos(a0) * r, c + Math.sin(a0) * r);
    g.rotate(a0); /* points back along the arc */
    g.beginPath();
    g.moveTo(0, -s * 1.15);
    g.lineTo(s * 0.9, s * 0.5);
    g.lineTo(-s * 0.9, s * 0.5);
    g.closePath();
    g.fill();
    g.restore();
  }
  btn.iconTex.needsUpdate = true;
}

/* ------------------------------------------------------------------ */
/*  chime                                                               */
/* ------------------------------------------------------------------ */

export function playChime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const o = ctx.createOscillator();
      const gn = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t = now + i * 0.16;
      gn.gain.setValueAtTime(0, t);
      gn.gain.linearRampToValueAtTime(0.18, t + 0.02);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      o.connect(gn).connect(ctx.destination);
      o.start(t);
      o.stop(t + 1.2);
    });
    setTimeout(() => ctx.close(), 2500);
  } catch (e) {}
}
