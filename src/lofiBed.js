const FADE_SEC = 3;
/* a slider drag should feel immediate, but stepping the gain outright
   crackles, so give it just enough ramp to smooth the edge */
const SET_SEC = 0.06;
export const DEFAULT_VOLUME = 0.45;

/* radio-browser has no single canonical host; every mirror serves the
   same data and sends `Access-Control-Allow-Origin: *`, so we just try
   a couple. `all.api` is round-robin DNS across the healthy mirrors. */
const API_HOSTS = [
  "https://de1.api.radio-browser.info",
  "https://all.api.radio-browser.info",
];
/* two overlapping queries widen the pool: stations tagged "lofi"
   (also matches "lofi hip hop" etc.) plus any with "lofi" in the name */
const QUERIES = [
  "/json/stations/search?tag=lofi&hidebroken=true&limit=400",
  "/json/stations/search?name=lofi&hidebroken=true&limit=400",
];

/* bundled tracks, used only when the network is unreachable */
const localUrls = Object.values(
  import.meta.glob("../Lofi/*.mp3", {
    eager: true,
    query: "?url",
    import: "default",
  })
);

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

function shuffle(list) {
  const next = [...list];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

async function fetchStations() {
  for (const host of shuffle(API_HOSTS)) {
    try {
      const lists = await Promise.all(
        QUERIES.map((q) =>
          fetch(host + q).then((r) => (r.ok ? r.json() : []))
        )
      );
      const seen = new Set();
      const urls = lists
        .flat()
        .map((s) => s.url_resolved)
        /* the page is served over https, so http streams are blocked as
           mixed content and never even start */
        .filter((u) => u && u.startsWith("https://"))
        .filter((u) => (seen.has(u) ? false : seen.add(u)));
      if (urls.length) return shuffle(urls);
    } catch {
      /* try the next mirror */
    }
  }
  return null;
}

export function createLofiBed(initialVolume = DEFAULT_VOLUME) {
  const audio = new Audio();
  audio.preload = "auto";
  audio.setAttribute("playsinline", "");
  audio.volume = 0;
  document.body.appendChild(audio);

  /* start pulling the station list now, well before the first play, so
     that `start()` can call audio.play() synchronously inside the user
     gesture and not trip autoplay blocking */
  let queuePromise = fetchStations().then((urls) => {
    usingLocal = !urls;
    return urls || localUrls;
  });
  let queue = [];
  let index = 0;
  let usingLocal = false;
  let wantPlay = false;
  let stopTimer = 0;
  /* the level start() fades up to. held here rather than read from the
     element, whose volume is 0 whenever the bed is stopped. */
  let target = clamp01(initialVolume);
  let misses = 0;
  let rampTimer = 0;

  function clearStopTimer() {
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = 0;
  }

  /* element-level ramp: radio streams don't send CORS headers, so
     routing them through a WebAudio GainNode would output silence.
     a timer (not rAF) keeps the fade running in a background tab. */
  function ramp(to, seconds) {
    clearInterval(rampTimer);
    const from = audio.volume;
    const dur = seconds * 1000;
    const t0 = performance.now();
    rampTimer = setInterval(() => {
      const k = dur ? Math.min(1, (performance.now() - t0) / dur) : 1;
      audio.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k >= 1) {
        clearInterval(rampTimer);
        rampTimer = 0;
      }
    }, 50);
  }

  function loadCurrent() {
    if (!queue.length) return;
    audio.src = queue[index % queue.length];
    audio.load();
  }

  function advance() {
    if (!queue.length) return;
    index = (index + 1) % queue.length;
    loadCurrent();
    if (wantPlay) audio.play().catch(() => {});
  }

  /* a live stream never fires "ended"; it drops out with an error or
     just stalls. either way, move to the next station — but if the
     whole list is failing, fall back to the bundled tracks once. */
  audio.addEventListener("ended", advance);
  audio.addEventListener("error", () => {
    if (!wantPlay) return;
    misses += 1;
    if (misses >= queue.length && !usingLocal && localUrls.length) {
      usingLocal = true;
      misses = 0;
      queue = shuffle(localUrls);
      index = 0;
      loadCurrent();
      audio.play().catch(() => {});
      return;
    }
    advance();
  });
  audio.addEventListener("playing", () => {
    misses = 0;
  });

  return {
    /* Only touches the gain while the bed is actually playing: setting it
       during a stopped session would fade the music up with no timer
       running. Either way the new level is remembered for the next start. */
    setVolume(v) {
      target = clamp01(v);
      if (wantPlay) ramp(target, SET_SEC);
    },
    start() {
      wantPlay = true;
      clearStopTimer();
      const kick = () => {
        if (!wantPlay) return;
        if (!queue.length) return;
        if (!audio.src) loadCurrent();
        audio
          .play()
          .then(() => ramp(target, FADE_SEC))
          .catch(() => {});
      };
      if (queue.length) return kick();
      queuePromise.then((urls) => {
        queue = urls ? [...urls] : [];
        index = 0;
        kick();
      });
    },
    stop() {
      wantPlay = false;
      if (audio.paused && audio.volume === 0) return;
      ramp(0, FADE_SEC);
      clearStopTimer();
      stopTimer = setTimeout(() => {
        if (!wantPlay) audio.pause();
      }, FADE_SEC * 1000);
    },
    dispose() {
      wantPlay = false;
      clearStopTimer();
      clearInterval(rampTimer);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.remove();
    },
  };
}
