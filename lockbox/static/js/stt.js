// Always-on speech input: energy-based voice detection on an AudioWorklet
// stream, one WAV upload per utterance. Silent until start() succeeds; every
// function is a no-op if the mic was denied, so keyboard play is unaffected.

const PRE_ROLL_FRAMES = 25; // 500 ms kept before speech onset
const START_FRAMES = 3; // 60 ms above threshold to begin
const END_FRAMES = 45; // 900 ms below threshold to end
const MIN_VOICED_FRAMES = 20; // 400 ms of voice or we drop it
const MAX_FRAMES = 750; // 15 s forced cut
const THRESHOLD_RATIO = 3; // speech = noise floor x3 (about +10 dB)
const MIN_THRESHOLD = 0.01;
const FLOOR_SEED_FRAMES = 100; // 2 s to learn the room
const FLOOR_ALPHA = 0.05; // floor tracking speed during silence
const TARGET_RATE = 16000;

let ctx = null;
let handlers = { onTranscript: () => {}, onIndicator: () => {} };
let enabled = false;
let suspended = true;
let floor = 0;
let seeded = 0;
let speaking = false;
let above = 0;
let below = 0;
let voiced = 0;
let preRoll = [];
let utterance = [];
let indicator = "off";

export function init(h) {
  handlers = { ...handlers, ...h };
}

// Call from the first user gesture. Resolves false if the mic is unavailable.
export async function start() {
  if (ctx) return true;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    ctx = new AudioContext();
    await ctx.audioWorklet.addModule("js/vad-worklet.js");
  } catch {
    ctx = null;
    return false;
  }
  const node = new AudioWorkletNode(ctx, "vad");
  node.port.onmessage = (e) => onFrame(e.data);
  ctx.createMediaStreamSource(stream).connect(node); // never routed to speakers
  enabled = true;
  setIndicator(suspended ? "off" : "listening");
  return true;
}

function setEnabled(on) {
  if (!ctx) return;
  enabled = on;
  dropUtterance();
  setIndicator(on && !suspended ? "listening" : "off");
}

export function toggle() {
  setEnabled(!enabled);
  return enabled;
}

// Suspend while BMO is busy (thinking/talking/reboot/breach) so its own bleeps
// and the countdown never turn into transcripts.
export function suspend() {
  suspended = true;
  dropUtterance();
  if (indicator !== "transcribing") setIndicator("off");
}

export function resume() {
  suspended = false;
  if (enabled && indicator !== "transcribing") setIndicator("listening");
}

function setIndicator(name) {
  if (indicator === name) return;
  indicator = name;
  handlers.onIndicator(name);
}

function dropUtterance() {
  speaking = false;
  above = 0;
  below = 0;
  voiced = 0;
  preRoll = [];
  utterance = [];
}

function onFrame({ rms, frame }) {
  if (!enabled || suspended) return;
  if (seeded < FLOOR_SEED_FRAMES) {
    floor = seeded ? floor + (rms - floor) / (seeded + 1) : rms; // running mean
    seeded += 1;
    return;
  }
  const threshold = Math.max(floor * THRESHOLD_RATIO, MIN_THRESHOLD);
  const loud = rms > threshold;

  if (!speaking) {
    preRoll.push(frame);
    if (preRoll.length > PRE_ROLL_FRAMES) preRoll.shift();
    if (loud) {
      above += 1;
      if (above >= START_FRAMES) {
        speaking = true;
        utterance = preRoll;
        preRoll = [];
        voiced = above;
        below = 0;
        setIndicator("hearing");
      }
    } else {
      above = 0;
      floor += FLOOR_ALPHA * (rms - floor);
    }
    return;
  }

  utterance.push(frame);
  if (loud) {
    voiced += 1;
    below = 0;
  } else {
    below += 1;
  }
  if (below >= END_FRAMES || utterance.length >= MAX_FRAMES) endUtterance();
}

function endUtterance() {
  const frames = utterance;
  const enough = voiced >= MIN_VOICED_FRAMES;
  dropUtterance();
  if (!enough) {
    setIndicator("listening");
    return;
  }
  setIndicator("transcribing");
  upload(encodeWav(frames, ctx.sampleRate)).then((text) => {
    setIndicator(enabled && !suspended ? "listening" : "off");
    if (text) handlers.onTranscript(text);
  });
}

async function upload(blob) {
  const form = new FormData();
  form.append("audio", blob, "speech.wav");
  try {
    const res = await fetch("/api/transcribe", { method: "POST", body: form });
    const data = await res.json();
    return data.error ? "" : data.text;
  } catch {
    return "";
  }
}

// Concatenate frames, box-filter down to 16 kHz mono, pack as 16-bit PCM WAV.
function encodeWav(frames, inRate) {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const pcm = new Float32Array(total);
  let offset = 0;
  for (const f of frames) {
    pcm.set(f, offset);
    offset += f.length;
  }
  const ratio = inRate / TARGET_RATE;
  const outLen = Math.floor(pcm.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let sum = 0;
    for (let j = start; j < end; j++) sum += pcm[j];
    const s = Math.max(-1, Math.min(1, sum / (end - start)));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const buf = new ArrayBuffer(44 + out.length * 2);
  const view = new DataView(buf);
  const ascii = (at, str) => [...str].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + out.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, TARGET_RATE, true);
  view.setUint32(28, TARGET_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, out.length * 2, true);
  new Int16Array(buf, 44).set(out);
  return new Blob([buf], { type: "audio/wav" });
}
