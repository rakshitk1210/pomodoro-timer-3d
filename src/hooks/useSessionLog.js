import { useSyncExternalStore } from "react";
import { getState, subscribe } from "../lib/sessionLog";

/* Subscribes to the whole state object on purpose. A selector that builds a
   fresh array would make getSnapshot return a new reference every call, which
   React rejects with "The result of getSnapshot should be cached" and then
   spins into an infinite re-render. Derive with useMemo in the component. */
export function useSessionLog() {
  return useSyncExternalStore(subscribe, getState, getState);
}
