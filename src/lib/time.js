/* Day boundaries and formatting. Deliberately dependency free: the hard part
   — locale correct clock and weekday names — is already in Intl, and the rest
   is arithmetic on local midnight. */

const HOUR = 3600e3;

export const startOfDay = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/* never `+ 86400000`. DST days are 23 or 25 hours long, so adding a fixed
   day lands on the wrong date twice a year and prev/next silently skips one. */
export const addDays = (ms, n) => {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export const isSameDay = (a, b) => startOfDay(a) === startOfDay(b);

/* built from local getters, not toISOString(): that returns the UTC date, so
   west of Greenwich every evening session would file under tomorrow. */
export const dayKey = (ms) => {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};

/* Intl formatters are expensive and the grid renders 16+ hour labels a pass,
   so build them once. */
const clockFmt = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

export const fmtClock = (ms) => clockFmt.format(ms);

/* "9 AM" — the gutter labels drop the always-zero minutes */
export const fmtHour = (h) =>
  clockFmt.format(new Date(2000, 0, 1, h, 0)).replace(/:00/, "");

export function fmtDuration(ms) {
  const t = Math.max(0, Math.round(ms / 1000));
  if (t < 60) return `${t}s`;
  const h = Math.floor(t / 3600);
  const m = Math.round((t % 3600) / 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function fmtDayHeading(ms, now = Date.now()) {
  if (isSameDay(ms, now)) return "Today";
  if (isSameDay(ms, addDays(startOfDay(now), -1))) return "Yesterday";
  return dateFmt.format(ms);
}

export { HOUR };
