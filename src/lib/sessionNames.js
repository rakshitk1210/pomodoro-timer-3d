/* Every session gets a name the moment it starts, so a block on the calendar
   is never anonymous and nothing has to be typed before pressing start.
   Rename in the drawer if the guess is wrong. */

const USER_NAME = "Rakshit";

const ANYTIME = [
  "Locked in",
  "Heads down",
  "Deep work block",
  "Focus sprint",
  "In the zone",
  "No tabs open",
];

const BY_TIME = [
  /* 5–11 */ [
    `${USER_NAME} is back`,
    "Early bird hours",
    "Coffee and focus",
    "Morning run",
    "First block of the day",
  ],
  /* 12–16 */ [
    "Afternoon grind",
    "Post lunch push",
    "The 2pm stretch",
    "Second wind",
  ],
  /* 17–21 */ [
    "Evening deep work",
    "Golden hour focus",
    "Winding up strong",
    "Just one more thing",
  ],
  /* 22–4 */ [
    "Night shift",
    "Burning the midnight oil",
    "One more block",
    "The quiet hours",
  ],
];

function bucket(hour) {
  if (hour >= 5 && hour < 12) return 0;
  if (hour >= 12 && hour < 17) return 1;
  if (hour >= 17 && hour < 22) return 2;
  return 3;
}

let lastPicked = null;

export function pickSessionName(at = Date.now()) {
  const pool = [...BY_TIME[bucket(new Date(at).getHours())], ...ANYTIME];
  let name = pool[Math.floor(Math.random() * pool.length)];
  /* one re-roll so two sessions in a row never share a name */
  if (name === lastPicked && pool.length > 1) {
    name = pool[Math.floor(Math.random() * pool.length)];
    if (name === lastPicked) name = pool[(pool.indexOf(name) + 1) % pool.length];
  }
  lastPicked = name;
  return name;
}
