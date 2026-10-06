// Animalese-style synth — square-wave bleeps on a pentatonic scale, plus a
// small SFX kit. Zero audio assets. Every function silently no-ops until the
// first user gesture unlocks the AudioContext (browser autoplay policy), and
// the typewriter is the clock, so silent mode is visually identical. The
// bleeps are BMO's fallback voice: speech.js talks for real when it can.

let ctx = null;
let master = null;
let unlocked = false;

const PENTATONIC = [0, 3, 5, 7, 10];

export const VOICES = {
  normal: { base: 400, wave: "square" },   // high and chirpy — BMO register
  breach: { base: 520, wave: "square" },   // giddy panic
  error: { base: 210, wave: "triangle" },  // droopy
};

export function initOnGesture(onUnlock) {
  const unlock = () => {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createDynamicsCompressor(); // keeps fanfare + blips from clipping
      master.connect(ctx.destination);
    }
    ctx.resume().then(() => {
      if (!unlocked && ctx.state === "running") {
        unlocked = true;
        tone(523, { wave: "triangle", dur: 0.12, gain: 0.03 }); // soft power-on blip
        if (onUnlock) onUnlock();
      }
    });
  };
  document.addEventListener("pointerdown", unlock, { once: true });
  document.addEventListener("keydown", unlock, { once: true });
}

function ready() {
  return unlocked && ctx && ctx.state === "running";
}

// The live audio context and its master bus, for the spoken voice; null while locked.
export function output() {
  return ready() ? { ctx, master } : null;
}

function tone(freq, { wave = "square", dur = 0.07, gain = 0.05, at = 0, glideTo = null } = {}) {
  if (!ready()) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, t);
  if (glideTo) osc.frequency.linearRampToValueAtTime(glideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// One bleep per voiced character. Deterministic pentatonic pitch (the Animal
// Crossing trick): the same word always sings the same melody.
export function blip(ch, voice) {
  const semis = PENTATONIC[ch.charCodeAt(0) % 5];
  const freq = voice.base * 2 ** (semis / 12) * (1 + (Math.random() * 0.08 - 0.04));
  tone(freq, { wave: voice.wave, dur: 0.07, gain: 0.05 });
}

// End-of-reply cadence: questions rise, statements land.
export function cadence(endCh, voice) {
  const scale = voice.base / 320;
  const pair = endCh === "?" ? [330, 415] : [392, 262];
  tone(pair[0] * scale, { wave: voice.wave, dur: 0.09, gain: 0.05 });
  tone(pair[1] * scale, { wave: voice.wave, dur: 0.12, gain: 0.05, at: 0.1 });
}

export function send() {
  tone(400, { wave: "triangle", dur: 0.05, gain: 0.04 });
  tone(700, { wave: "triangle", dur: 0.06, gain: 0.04, at: 0.05 });
}

export function denySting() {
  [659, 523, 440].forEach((f, i) => tone(f, { dur: 0.09, gain: 0.05, at: i * 0.09 }));
}

export function fanfare() {
  [262, 330, 392, 523, 659].forEach((f, i) => tone(f, { dur: 0.09, gain: 0.06, at: i * 0.09 }));
  [262, 330, 392, 523].forEach((f) => tone(f, { dur: 0.4, gain: 0.03, at: 0.5 })); // C-major swell
}

export function errorBloop() {
  // two sines 7Hz apart — the beating sounds audibly "wrong"
  tone(220, { wave: "sine", dur: 0.3, gain: 0.04 });
  tone(227, { wave: "sine", dur: 0.3, gain: 0.04 });
}

export function thinkBlip() {
  tone(196, { wave: "triangle", dur: 0.12, gain: 0.02 });
  tone(220, { wave: "triangle", dur: 0.12, gain: 0.02, at: 0.14 });
}

export function zip() {
  tone(400, { wave: "triangle", dur: 0.12, gain: 0.04, glideTo: 1200 });
}

export function powerDown() {
  tone(660, { wave: "triangle", dur: 0.45, gain: 0.05, glideTo: 90 });
}
