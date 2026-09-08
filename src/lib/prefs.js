/* Small persisted UI preferences. Kept apart from sessionLog: that stores
   what you did, this stores how you like the app set up. */

import { DEFAULT_VOLUME } from "../lofiBed";

const VOLUME_KEY = "pomodoro3d.volume.v1";

const clamp01 = (v) => Math.max(0, Math.min(1, v));

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
