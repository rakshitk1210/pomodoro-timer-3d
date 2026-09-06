import timeTimer from "./timeTimer";
import cassette from "./cassette";
import hourglass from "./hourglass";

/* order here is the order of the switcher rail */
export const TIMERS = [timeTimer, cassette, hourglass];

export const byId = (id) => TIMERS.find((t) => t.id === id) ?? TIMERS[0];
