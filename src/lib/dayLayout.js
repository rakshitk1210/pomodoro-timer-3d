/* Pure calendar geometry. No React, no store — so the tricky part can be
   reasoned about, and smoke tested, on its own. */

/* self contained on purpose: this file is smoke testable with bare node */
const HOUR = 3600e3;

/* 1 min is 1.33px, so a 25 min pomodoro draws 33px — tall enough for both the
   title and the time range at their natural size. Going tighter than this
   means clamping most real sessions, and a clamped block no longer sits at
   its true time. */
export const PX_PER_HOUR = 80;
/* one 11px line plus its padding. below this a block cannot show its name. */
export const MIN_BLOCK_PX = 18;
const GAP_PX = 2;

const DAY = 24 * HOUR;

/* Turns sessions into positioned blocks for one day.
   One block per *segment*, so a session paused over lunch draws as two bars
   with the gap visibly empty, and one paused across midnight contributes to
   both days. Coordinates are absolute within the day; the visible hour window
   is applied by the caller at paint time. */
export function layoutDay(sessions, dayStart, now, pxPerHour = PX_PER_HOUR) {
  const dayEnd = dayStart + DAY;
  const raw = [];

  for (const s of sessions) {
    for (const seg of s.segments) {
      /* an open segment grows to now, but never past the end it was counting
         down to — otherwise a tab left open overnight draws a 9 hour bar */
      const rawTo = seg.to ?? Math.min(now, seg.from + (seg.capMs || 0));
      const from = Math.max(seg.from, dayStart);
      const till = Math.min(rawTo, dayEnd);
      if (till <= from) continue;
      raw.push({
        key: `${s.id}:${seg.from}`,
        session: s,
        from,
        till,
        ms: till - from,
        live: seg.to == null,
      });
    }
  }

  raw.sort((a, b) => a.from - b.from);

  const px = (ms) => (ms / HOUR) * pxPerHour;
  let prevBottom = -Infinity;

  const blocks = raw.map((b) => {
    const idealTop = px(b.from - dayStart);
    const height = Math.max(MIN_BLOCK_PX, px(b.ms));
    /* the min-height clamp makes short blocks taller than the truth, which
       can push one onto the next. nudge down rather than lane out: the app
       runs exactly one timer, so real concurrency is impossible and the only
       overlap is the artifact the clamp itself creates. */
    const top = Math.max(idealTop, prevBottom + GAP_PX);
    prevBottom = top + height;
    return { ...b, top, height, nudged: top - idealTop > 0.5 };
  });

  /* totals come from real milliseconds, never from pixels, so the clamp can
     never leak into the number the user reads */
  const totalMs = raw.reduce((n, b) => n + b.ms, 0);
  const count = new Set(raw.map((b) => b.session.id)).size;

  return { blocks, totalMs, count };
}

/* The visible slice of the day. Starts at office hours and only ever grows to
   fit the data, so nothing is hidden and an empty day is not 1536px of blank
   grid. */
export function hourWindow(blocks, dayStart, now, isToday, full = false) {
  if (full) return { lo: 0, hi: 24 };
  let lo = 6;
  let hi = 22;
  for (const b of blocks) {
    lo = Math.min(lo, Math.floor((b.from - dayStart) / HOUR));
    hi = Math.max(hi, Math.ceil(b.till / HOUR - dayStart / HOUR));
  }
  if (isToday) {
    const h = Math.floor((now - dayStart) / HOUR);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h + 1);
  }
  lo = Math.max(0, lo);
  hi = Math.min(24, Math.max(hi, lo + 4));
  return { lo, hi };
}

/* Focus time logged on a day, counting closed segments only. Used by the
   trigger pill, which must not change on every animation frame — a live
   segment's growth belongs to the drawer, not to the chrome. */
export function focusMsOnDay(sessions, dayStart) {
  const dayEnd = dayStart + DAY;
  let total = 0;
  for (const s of sessions) {
    for (const seg of s.segments) {
      if (seg.to == null) continue;
      const from = Math.max(seg.from, dayStart);
      const till = Math.min(seg.to, dayEnd);
      if (till > from) total += till - from;
    }
  }
  return total;
}
