/* Small persisted UI preferences. Kept apart from sessionLog: that stores
   what you did, this stores how you like the app set up. */

import { DEFAULT_VOLUME } from "../lofiBed";

const VOLUME_KEY = "pomodoro3d.volume.v1";
const ZOOM_KEY = "pomodoro3d.zoom.v1";

/* 1 is the framing that fits the active timer to the viewport. Past 2 the
   camera crowds the object's own near face; below 0.6 it is a speck. */
export const DEFAULT_ZOOM = 1;
export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 2;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const clampZoom = (v) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v));

export function loadVolume() {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw == null) return DEFAULT_VOLUME;
    const v = Number(raw);
    /* a corrupt or hand-edited value should not mute the app for good */
    return Number.isFinite(v) ? clamp01(v) : DEFAULT_VOLUME;
  } catch (e) {
    return DEFAULT_VOLUME;
  }
}

export function saveVolume(v) {
  try {
    localStorage.setItem(VOLUME_KEY, String(clamp01(v)));
  } catch (e) {
    /* private mode or quota: the level still applies for this session */
  }
}

export function loadZoom() {
  try {
    const raw = localStorage.getItem(ZOOM_KEY);
    if (raw == null) return DEFAULT_ZOOM;
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? clampZoom(v) : DEFAULT_ZOOM;
  } catch (e) {
    return DEFAULT_ZOOM;
  }
}

export function saveZoom(v) {
  try {
    localStorage.setItem(ZOOM_KEY, String(clampZoom(v)));
  } catch (e) {
    /* private mode or quota: the framing still applies for this session */
  }
}
