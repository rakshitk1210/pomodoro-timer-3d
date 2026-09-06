const FADE_SEC = 3;
const TARGET_VOLUME = 0.45;

const trackUrls = Object.values(
  import.meta.glob("../Lofi/*.mp3", {
    eager: true,
    query: "?url",
    import: "default",
  })
);

function shuffle(list) {
  const next = [...list];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export function createLofiBed() {
  const audio = new Audio();
  audio.preload = "auto";
  audio.setAttribute("playsinline", "");
  document.body.appendChild(audio);

  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  ctx.createMediaElementSource(audio).connect(gain).connect(ctx.destination);

  let queue = [];
  let index = 0;
  let wantPlay = false;
  let stopTimer = 0;

  function clearStopTimer() {
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = 0;
  }

  function ramp(to, seconds) {
    const now = ctx.currentTime;
    const current = gain.gain.value;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(current, now);
    gain.gain.linearRampToValueAtTime(to, now + seconds);
  }

  function reshuffle(avoidUrl) {
    queue = shuffle(trackUrls);
    if (queue.length > 1 && avoidUrl && queue[0] === avoidUrl) {
      const k = 1 + Math.floor(Math.random() * (queue.length - 1));
      [queue[0], queue[k]] = [queue[k], queue[0]];
    }
    index = 0;
  }

  function loadCurrent() {
    if (!queue.length) reshuffle();
    audio.src = queue[index];
  }

  function playNext() {
    if (!queue.length) reshuffle();
    const last = queue[index];
    index += 1;
    if (index >= queue.length) reshuffle(last);
    loadCurrent();
    if (wantPlay) audio.play().catch(() => {});
  }

  audio.addEventListener("ended", playNext);

  return {
    start() {
      if (!trackUrls.length) return;
      wantPlay = true;
      clearStopTimer();
      if (!queue.length) reshuffle();
      if (!audio.src) loadCurrent();
      const kick = () => {
        if (!wantPlay) return;
        ramp(TARGET_VOLUME, FADE_SEC);
      };
      const play = () => audio.play().then(kick).catch(() => {});
      if (ctx.state === "suspended") ctx.resume().then(play).catch(() => {});
      else play();
    },
    stop() {
      wantPlay = false;
      if (audio.paused && gain.gain.value === 0) return;
      ramp(0, FADE_SEC);
      clearStopTimer();
      stopTimer = setTimeout(() => {
        if (!wantPlay) audio.pause();
      }, FADE_SEC * 1000);
    },
    dispose() {
      wantPlay = false;
      clearStopTimer();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.remove();
      ctx.close().catch(() => {});
    },
  };
}
