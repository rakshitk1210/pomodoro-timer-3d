/* a real seven segment readout, drawn as tapered polygons rather than a
   font. the unlit segments stay faintly visible, which is what separates
   an LCD from text on a black rectangle. */

/*  --a--
   |     |
   f     b
   |     |
    --g--
   |     |
   e     c
   |     |
    --d--    */

const GLYPHS = {
  0: "abcdef",
  1: "bc",
  2: "abged",
  3: "abgcd",
  4: "fgbc",
  5: "afgcd",
  6: "afgecd",
  7: "abc",
  8: "abcdefg",
  9: "abcdfg",
  " ": "",
  "-": "g",
};

function hSeg(g, x, y, len, t) {
  const h = t / 2;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + h, y - h);
  g.lineTo(x + len - h, y - h);
  g.lineTo(x + len, y);
  g.lineTo(x + len - h, y + h);
  g.lineTo(x + h, y + h);
  g.closePath();
  g.fill();
}

function vSeg(g, x, y, len, t) {
  const h = t / 2;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + h, y + h);
  g.lineTo(x + h, y + len - h);
  g.lineTo(x, y + len);
  g.lineTo(x - h, y + len - h);
  g.lineTo(x - h, y + h);
  g.closePath();
  g.fill();
}

function drawDigit(g, ch, x, y, dw, dh, t) {
  const on = GLYPHS[ch] ?? "";
  const half = dh / 2;
  const seg = {
    a: () => hSeg(g, x, y, dw, t),
    g: () => hSeg(g, x, y + half, dw, t),
    d: () => hSeg(g, x, y + dh, dw, t),
    f: () => vSeg(g, x, y, half, t),
    b: () => vSeg(g, x + dw, y, half, t),
    e: () => vSeg(g, x, y + half, half, t),
    c: () => vSeg(g, x + dw, y + half, half, t),
  };
  for (const k of Object.keys(seg)) {
    const lit = on.includes(k);
    g.globalAlpha = lit ? 1 : 0.085;
    seg[k]();
  }
  g.globalAlpha = 1;
}

/* paints `text` (expects MM:SS) filling the canvas.
   `color` is the lit segment colour; unlit segments reuse it faintly. */
export function drawSevenSegment(canvas, text, color, opts = {}) {
  const { glow = 0.55, pad = 0.09 } = opts;
  const W = canvas.width;
  const H = canvas.height;
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, W, H);

  const chars = String(text).split("");
  const digits = chars.filter((c) => c !== ":").length;
  const colons = chars.length - digits;

  /* solve the digit box from the height, then check it fits the width */
  const padY = H * pad;
  let dh = H - padY * 2;
  let t = dh * 0.15;
  let dw = dh * 0.52;
  let gap = dw * 0.34;
  let colonW = dw * 0.42;

  const widthFor = (dwv) => {
    const gp = dwv * 0.34;
    return digits * (dwv + t) + colons * (dwv * 0.42) + (chars.length - 1) * gp;
  };
  const maxW = W * (1 - pad);
  if (widthFor(dw) > maxW) {
    /* scale everything down together so the aspect stays right */
    const k = maxW / widthFor(dw);
    dw *= k;
    dh *= k;
    t *= k;
    gap = dw * 0.34;
    colonW = dw * 0.42;
  }

  const totalW = widthFor(dw);
  let x = (W - totalW) / 2;
  const y = (H - dh) / 2;

  g.fillStyle = color;
  if (glow > 0) {
    g.shadowColor = color;
    g.shadowBlur = t * glow * 2.4;
  }

  for (const ch of chars) {
    if (ch === ":") {
      const r = t * 0.5;
      const cx = x + colonW / 2;
      for (const cy of [y + dh * 0.3, y + dh * 0.72]) {
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fill();
      }
      x += colonW + gap;
    } else {
      drawDigit(g, ch, x + t / 2, y, dw, dh, t);
      x += dw + t + gap;
    }
  }
  g.shadowBlur = 0;
}
