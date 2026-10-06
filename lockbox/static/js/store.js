// What this browser remembers between visits. Private windows and locked-down
// browsers may refuse storage, so both calls are allowed to fail quietly.

const PREFIX = "bmo-";

export function recall(key) {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function remember(key, value) {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // not remembered; everything still works for this visit
  }
}
