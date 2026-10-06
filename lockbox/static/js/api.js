// One door to the server. A hosted playground link carries an access code
// (?code=...); it is remembered for later visits and sent with every /api call.

import { recall, remember } from "./store.js";

const fromLink = new URLSearchParams(location.search).get("code");
if (fromLink) remember("code", fromLink);
const code = fromLink || recall("code") || "";

export function api(path, options = {}) {
  return fetch(path, { ...options, headers: { ...options.headers, "X-Access-Code": code } });
}
