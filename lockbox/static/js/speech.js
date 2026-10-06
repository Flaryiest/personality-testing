// BMO's real voice. Fetches a spoken clip for a line from /api/speak and plays
// it through a small-speaker robot chain. load() resolves null on any failure
// (no voice key, audio still locked, network, timeout) and the caller bleeps
// the line instead.

import { api } from "./api.js";
import { output } from "./voice.js";

const LOAD_TIMEOUT_MS = 6000;

// The robot dials, tuned by ear.
const BUZZ_HZ = 55; // tremolo rate: the robot buzz
const BUZZ_DEPTH = 0.4; // 0 = none, 1 = fully chopped
const SPEAKER_LOW_HZ = 450; // a toy speaker passes nothing below this...
const SPEAKER_HIGH_HZ = 3200; // ...or above this
const NASAL_HZ = 1700; // boxy resonance peak
const NASAL_DB = 7;
const ECHO_SECONDS = 0.009; // plastic-shell reflection
const ECHO_LEVEL = 0.45;
const LEVEL = 1; // overall voice volume against the sound effects

let chain = null; // input node of the effect chain, built on first play

export async function load(text) {
  const out = output();
  if (!out) return null;
  try {
    const res = await api("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(LOAD_TIMEOUT_MS),
    });
    const data = await res.json();
    if (data.error) return null;
    const bytes = Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
    const buffer = await out.ctx.decodeAudioData(bytes.buffer);
    return { buffer, times: data.times, rate: data.rate };
  } catch {
    return null;
  }
}

// Start a loaded clip now. Returns what the typewriter needs to follow it: the
// second each of the caption's `length` characters is spoken, when the clip
// ends, a clock counting from the start, and stop(). Null if audio went away.
export function play(clip, length) {
  const out = output();
  if (!out) return null;
  const { ctx, master } = out;
  chain ??= buildChain(ctx, master);
  const source = ctx.createBufferSource();
  source.buffer = clip.buffer;
  source.playbackRate.value = clip.rate; // slowed a touch, which drops the pitch
  source.connect(chain);
  const startedAt = ctx.currentTime;
  source.start();

  const end = clip.buffer.duration / clip.rate;
  const aligned = clip.times && clip.times.length === length;
  const times = aligned
    ? clip.times.map((t) => t / clip.rate)
    : Array.from({ length }, (_, i) => (i / length) * end);
  return { times, end, clock: () => ctx.currentTime - startedAt, stop: () => source.stop() };
}

// Small-speaker robot: a buzz on the level, everything outside a toy speaker's
// range cut away, a nasal peak, and a short box echo.
function buildChain(ctx, out) {
  const gain = (value) => {
    const node = ctx.createGain();
    node.gain.value = value;
    return node;
  };
  const filter = (type, hz, q, db = 0) => {
    const node = ctx.createBiquadFilter();
    node.type = type;
    node.frequency.value = hz;
    node.Q.value = q;
    node.gain.value = db;
    return node;
  };

  const buzz = gain(1 - BUZZ_DEPTH / 2);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = BUZZ_HZ;
  lfo.connect(gain(BUZZ_DEPTH / 2)).connect(buzz.gain);
  lfo.start();

  // Q of -3 dB on the pass filters = no resonant bump at the cutoff.
  const shaped = buzz
    .connect(filter("highpass", SPEAKER_LOW_HZ, -3))
    .connect(filter("lowpass", SPEAKER_HIGH_HZ, -3))
    .connect(filter("peaking", NASAL_HZ, 1, NASAL_DB));

  const echo = ctx.createDelay(0.1);
  echo.delayTime.value = ECHO_SECONDS;
  const mix = gain(LEVEL);
  shaped.connect(mix);
  shaped.connect(echo).connect(gain(ECHO_LEVEL)).connect(mix);
  mix.connect(out);
  return buzz;
}
