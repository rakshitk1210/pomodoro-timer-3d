/* shared audio context for the small interaction sounds:
   dial detent clicks and the flick woosh. the lofi bed keeps its
   own context because it owns a media element source. */

let ctx;
let clickBuffer;
let wooshBuffer;
let lastWooshAt = 0;

function ensureCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx || ctx.state === "closed") {
    ctx = new AC();
    clickBuffer = null;
    wooshBuffer = null;
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/* call from a user gesture so the first sound is not swallowed */
export function unlockSfx() {
  ensureCtx();
}

/* ------------------------------------------------------------------ */
/*  dial detent click                                                   */
/* ------------------------------------------------------------------ */

function getClickNoise(audio) {
  if (clickBuffer && clickBuffer.sampleRate === audio.sampleRate)
    return clickBuffer;
  const length = Math.max(64, Math.floor(audio.sampleRate * 0.03));
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  }
  clickBuffer = buffer;
  return buffer;
}

function clickAt(audio, when) {
  const noise = audio.createBufferSource();
  noise.buffer = getClickNoise(audio);

  const bp = audio.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2400;
  bp.Q.value = 3.2;

  const hp = audio.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 900;

  const noiseGain = audio.createGain();
  noiseGain.gain.setValueAtTime(0.0001, when);
  noiseGain.gain.exponentialRampToValueAtTime(0.07, when + 0.004);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.032);

  const tone = audio.createOscillator();
  tone.type = "triangle";
  tone.frequency.setValueAtTime(1650, when);
  tone.frequency.exponentialRampToValueAtTime(720, when + 0.028);

  const toneGain = audio.createGain();
  toneGain.gain.setValueAtTime(0.0001, when);
  toneGain.gain.exponentialRampToValueAtTime(0.045, when + 0.003);
  toneGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.036);

  noise.connect(bp).connect(hp).connect(noiseGain).connect(audio.destination);
  tone.connect(toneGain).connect(audio.destination);
  noise.start(when);
  noise.stop(when + 0.04);
  tone.start(when);
  tone.stop(when + 0.04);
}

export function playDialTicks(count) {
  const audio = ensureCtx();
  if (!audio || count <= 0) return;
  const n = Math.min(8, count);
  const now = audio.currentTime;
  for (let i = 0; i < n; i++) clickAt(audio, now + i * 0.014);
}

/* ------------------------------------------------------------------ */
/*  flick woosh                                                         */
/* ------------------------------------------------------------------ */

/* white noise sounds like hiss. a one pole lowpass tilts it towards
   brown, which is what reads as air moving rather than static. */
function getWooshNoise(audio) {
  if (wooshBuffer && wooshBuffer.sampleRate === audio.sampleRate)
    return wooshBuffer;
  const length = Math.floor(audio.sampleRate * 1.2);
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = last * 0.72 + white * 0.28;
    data[i] = last * 2.6;
  }
  wooshBuffer = buffer;
  return buffer;
}

/* intensity 0..1 — harder flicks are louder, brighter and longer */
export function playWoosh(intensity = 1) {
  const audio = ensureCtx();
  if (!audio) return;

  /* one woosh per gesture, not a burst */
  const nowMs = performance.now();
  if (nowMs - lastWooshAt < 140) return;
  lastWooshAt = nowMs;

  const k = Math.max(0, Math.min(1, intensity));
  const now = audio.currentTime;
  const dur = 0.32 + k * 0.26;

  const src = audio.createBufferSource();
  src.buffer = getWooshNoise(audio);
  src.playbackRate.value = 0.85 + k * 0.45;

  /* the sweep up and back down is the doppler of something
     passing you, and is what separates a woosh from a hiss */
  const bp = audio.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 0.85 + k * 0.85;
  const fLow = 280;
  const fPeak = 620 + k * 1750;
  bp.frequency.setValueAtTime(fLow, now);
  bp.frequency.exponentialRampToValueAtTime(fPeak, now + dur * 0.36);
  bp.frequency.exponentialRampToValueAtTime(fLow * 0.75, now + dur);

  const hp = audio.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 170;

  const g = audio.createGain();
  const peak = 0.045 + k * 0.15;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(peak, now + 0.045 + k * 0.025);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  src.connect(bp).connect(hp).connect(g).connect(audio.destination);
  src.start(now);
  src.stop(now + dur + 0.05);
}

/* ------------------------------------------------------------------ */
/*  button click                                                        */
/* ------------------------------------------------------------------ */

/* a tactile switch makes two sounds, not one: a firm low click going
   down and a lighter, higher one coming back up. down = false is the
   release. */
export function playButtonClick(down = true) {
  const audio = ensureCtx();
  if (!audio) return;
  const now = audio.currentTime;

  const noise = audio.createBufferSource();
  noise.buffer = getClickNoise(audio);

  const bp = audio.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = down ? 1500 : 2150;
  bp.Q.value = down ? 1.6 : 2.4;

  const ng = audio.createGain();
  ng.gain.setValueAtTime(0.0001, now);
  ng.gain.exponentialRampToValueAtTime(down ? 0.12 : 0.055, now + 0.003);
  ng.gain.exponentialRampToValueAtTime(0.0001, now + (down ? 0.05 : 0.03));

  /* the body of the click is the case resonating: low, short, damped */
  const tone = audio.createOscillator();
  tone.type = "square";
  const f0 = down ? 420 : 640;
  tone.frequency.setValueAtTime(f0, now);
  tone.frequency.exponentialRampToValueAtTime(f0 * 0.55, now + 0.03);

  const lp = audio.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 2200;

  const tg = audio.createGain();
  tg.gain.setValueAtTime(0.0001, now);
  tg.gain.exponentialRampToValueAtTime(down ? 0.07 : 0.03, now + 0.004);
  tg.gain.exponentialRampToValueAtTime(0.0001, now + (down ? 0.06 : 0.038));

  noise.connect(bp).connect(ng).connect(audio.destination);
  tone.connect(lp).connect(tg).connect(audio.destination);
  noise.start(now);
  noise.stop(now + 0.08);
  tone.start(now);
  tone.stop(now + 0.08);
}

/* ------------------------------------------------------------------ */
/*  running sand                                                        */
/* ------------------------------------------------------------------ */

let hissBuffer;
let hiss = null;

/* three seconds of it, because a short loop reads as a repeating tick
   rather than as a continuous pour. barely lowpassed: sand is bright,
   unlike the woosh, which is deliberately tilted towards brown. */
function getHissNoise(audio) {
  if (hissBuffer && hissBuffer.sampleRate === audio.sampleRate)
    return hissBuffer;
  const length = Math.floor(audio.sampleRate * 3);
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = last * 0.22 + white * 0.78;
    data[i] = last;
  }
  /* fade the seam so the loop point is not a click */
  const fade = Math.floor(audio.sampleRate * 0.02);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    data[i] *= k;
    data[length - 1 - i] *= k;
  }
  hissBuffer = buffer;
  return buffer;
}

/* level 0..1 — a fuller stream is a little louder and a little brighter */
export function startSandHiss(level = 1) {
  const audio = ensureCtx();
  if (!audio) return;
  if (hiss) {
    hiss.gain.gain.cancelScheduledValues(audio.currentTime);
    hiss.gain.gain.setTargetAtTime(hiss.peak * level, audio.currentTime, 0.25);
    return;
  }

  const now = audio.currentTime;
  const src = audio.createBufferSource();
  src.buffer = getHissNoise(audio);
  src.loop = true;

  const bp = audio.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 3800;
  bp.Q.value = 0.55;

  const hp = audio.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1400;

  /* a slow wander on the cutoff. a fixed filter on fixed noise sounds
     like tape hiss; the wander is what makes it grains falling. */
  const lfo = audio.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.11;
  const lfoGain = audio.createGain();
  lfoGain.gain.value = 900;
  lfo.connect(lfoGain).connect(bp.frequency);

  const gain = audio.createGain();
  const peak = 0.03;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(peak * level, now + 0.5);

  src.connect(bp).connect(hp).connect(gain).connect(audio.destination);
  src.start(now);
  lfo.start(now);

  hiss = { src, lfo, gain, peak };
}

export function stopSandHiss() {
  if (!hiss) return;
  const h = hiss;
  hiss = null;
  const audio = ensureCtx();
  if (!audio) return;
  const now = audio.currentTime;
  try {
    h.gain.gain.cancelScheduledValues(now);
    h.gain.gain.setValueAtTime(h.gain.gain.value, now);
    h.gain.gain.linearRampToValueAtTime(0.0001, now + 0.35);
    h.src.stop(now + 0.4);
    h.lfo.stop(now + 0.4);
  } catch (e) {}
}
