/* The focus session log.
 *
 * A module singleton rather than a hook: the call sites live inside
 * useCallbacks *and* inside the countdown's rAF callback, and a plain import
 * reaches all of them with no prop or ref plumbing. It also means the drawer
 * can subscribe independently of TimerScene's render cycle, which matters
 * because TimerScene re-renders ~60x/sec while a timer runs. And because a
 * module is evaluated once, StrictMode's double mount cannot duplicate state.
 */

import { dayKey } from "./time";
import { pickSessionName } from "./sessionNames";

const KEY = "pomodoro3d.sessions.v1";
const SCHEMA = 1;

/* a mis-tap is not a focus session. completed runs are always kept. */
const MIN_KEEP_MS = 60_000;
/* only a backstop for a pause left overnight — the resume decision is made by
   activeId, not by elapsed time */
const RESUME_GRACE_MS = 2 * 3600e3;
const MAX_SESSIONS = 2000;

const EMPTY = { sessions: [], activeId: null };

/* ------------------------------------------------------------------ */

const sumSegments = (segs) =>
  segs.reduce((n, s) => n + (s.to == null ? 0 : s.to - s.from), 0);

const newId = () =>
  `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function closeOpen(rec, at) {
  const segs = rec.segments.slice();
  const i = segs.length - 1;
  if (i >= 0 && segs[i].to == null) {
    segs[i] = { ...segs[i], to: Math.max(segs[i].from, at) };
  }
  return { ...rec, segments: segs, focusMs: sumSegments(segs) };
}

const prune = (list) =>
  list.length > MAX_SESSIONS ? list.slice(list.length - MAX_SESSIONS) : list;

/* ---------------- persistence ---------------- */

function persist(s) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ v: SCHEMA, sessions: s.sessions, activeId: s.activeId })
    );
  } catch (e) {
    /* private mode, or quota. the app keeps working from memory. */
  }
}

/* A record left open by a reload cannot be resumed — the audio bed and the 3D
   state are gone, and a timer that silently restarts on refresh is
   surprising. Close it out instead, capped by what it was counting down to so
   a tab left shut overnight does not log a nine hour pomodoro. */
function recover(s) {
  const rec = s.activeId && s.sessions.find((r) => r.id === s.activeId);
  if (!rec) return { ...s, activeId: null };
  const last = rec.segments[rec.segments.length - 1];
  if (!last || last.to != null) return { ...s, activeId: null };

  const to = Math.min(Date.now(), last.from + (last.capMs || 0));
  const closed = { ...closeOpen(rec, to), status: "interrupted" };
  closed.endedAt = closed.segments[closed.segments.length - 1].to;

  return {
    ...s,
    activeId: null,
    sessions:
      closed.focusMs >= MIN_KEEP_MS
        ? s.sessions.map((r) => (r.id === rec.id ? closed : r))
        : s.sessions.filter((r) => r.id !== rec.id),
  };
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    /* an unknown schema is not ours to interpret */
    if (!raw || raw.v !== SCHEMA || !Array.isArray(raw.sessions)) return EMPTY;
    return recover({
      sessions: raw.sessions,
      activeId: raw.activeId ?? null,
    });
  } catch (e) {
    return EMPTY;
  }
}

/* ---------------- store ---------------- */

let state = load();
const subs = new Set();

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

/* referentially stable between commits — useSyncExternalStore requires it */
export const getState = () => state;

function commit(next) {
  state = next;
  persist(state);
  for (const fn of subs) fn();
}

const current = () =>
  state.activeId ? state.sessions.find((s) => s.id === state.activeId) : null;

function replace(rec) {
  return state.sessions.map((s) => (s.id === rec.id ? rec : s));
}

/* ---------------- lifecycle ---------------- */

/* Start, or resume after a pause. Which one it is comes from activeId, not
   from a heuristic: pause keeps it, reset / dial / completion clear it. So
   start-after-pause always resumes and start-after-reset always opens a new
   record — exactly the mental model the buttons imply. */
export function startOrResume({ timerId, remainingMs, at = Date.now() }) {
  const cur = current();

  if (cur) {
    const last = cur.segments[cur.segments.length - 1];
    if (last && last.to == null) return cur.id; /* already running */
    if (last && at - last.to <= RESUME_GRACE_MS) {
      const rec = {
        ...cur,
        segments: [...cur.segments, { from: at, to: null, capMs: remainingMs }],
      };
      commit({ ...state, sessions: replace(rec) });
      return rec.id;
    }
    finish("stopped", last ? last.to : at);
  }

  const rec = {
    id: newId(),
    name: pickSessionName(at),
    timerId,
    startedAt: at,
    endedAt: null,
    segments: [{ from: at, to: null, capMs: remainingMs }],
    focusMs: 0,
    status: "running",
    day: dayKey(at),
  };
  commit({
    ...state,
    activeId: rec.id,
    sessions: prune([...state.sessions, rec]),
  });
  return rec.id;
}

export function pause(at = Date.now()) {
  const cur = current();
  if (!cur) return;
  const last = cur.segments[cur.segments.length - 1];
  if (!last || last.to != null) return; /* idempotent */
  commit({ ...state, sessions: replace(closeOpen(cur, at)) });
}

/* The single close-out path. The `status !== "running"` guard is what makes
   completion idempotent: StrictMode double-invokes the countdown effect, so a
   timer that is already expired when the effect mounts runs the completion
   branch twice. Guarding here means every call site inherits it. */
export function finish(status, at = Date.now()) {
  const cur = current();
  if (!cur || cur.status !== "running") return;

  const next = { ...closeOpen(cur, at), status };
  next.endedAt = next.segments[next.segments.length - 1].to;

  const keep = status === "completed" || next.focusMs >= MIN_KEEP_MS;
  commit({
    ...state,
    activeId: null,
    sessions: keep
      ? replace(next)
      : state.sessions.filter((s) => s.id !== cur.id),
  });
}

export const complete = (at) => finish("completed", at);
export const abandon = (at) => finish("stopped", at);

export function rename(id, name) {
  const rec = state.sessions.find((s) => s.id === id);
  if (!rec || rec.name === name) return;
  commit({ ...state, sessions: replace({ ...rec, name }) });
}

export function remove(id) {
  if (!state.sessions.some((s) => s.id === id)) return;
  commit({
    ...state,
    activeId: state.activeId === id ? null : state.activeId,
    sessions: state.sessions.filter((s) => s.id !== id),
  });
}

/* ---------------- dev only ---------------- */

export function __seed(dayOffset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(0, 0, 0, 0);
  const base = d.getTime();
  const at = (h, m) => base + h * 3600e3 + m * 60e3;
  const mk = (name, timerId, segs, status = "completed") => ({
    id: newId(),
    name,
    timerId,
    startedAt: segs[0].from,
    endedAt: segs[segs.length - 1].to,
    segments: segs,
    focusMs: sumSegments(segs),
    status,
    day: dayKey(segs[0].from),
  });
  commit({
    ...state,
    sessions: prune([
      ...state.sessions,
      mk("Rakshit is back", "time-timer", [
        { from: at(9, 5), to: at(9, 30), capMs: 1500e3 },
      ]),
      mk("Coffee and focus", "cassette", [
        { from: at(10, 0), to: at(10, 12), capMs: 1500e3 },
        { from: at(10, 35), to: at(11, 0), capMs: 900e3 },
      ]),
      mk("Afternoon grind", "hourglass", [
        { from: at(13, 30), to: at(14, 20), capMs: 3000e3 },
      ]),
      mk(
        "The 2pm stretch",
        "time-timer",
        [{ from: at(15, 10), to: at(15, 24), capMs: 1500e3 }],
        "stopped"
      ),
      mk("Golden hour focus", "cassette", [
        { from: at(18, 0), to: at(18, 45), capMs: 2700e3 },
      ]),
    ]),
  });
  return state.sessions.length;
}
