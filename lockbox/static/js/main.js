// BMO kiosk: state machine, guardian API, level reboot, kiosk guards, attract mode.

import { speak } from "./typewriter.js";
import * as face from "./face.js";
import * as voice from "./voice.js";
import { burst } from "./confetti.js";
import * as stt from "./stt.js";
import * as speech from "./speech.js";
import { api } from "./api.js";
import { recall, remember } from "./store.js";

const caption = document.getElementById("caption");
const hint = document.getElementById("caption-hint");
const form = document.getElementById("chat-form");
const msg = document.getElementById("msg");
const btnSend = document.getElementById("btn-send");
const btnFullscreen = document.getElementById("btn-fullscreen");
const qaBar = document.getElementById("qa-bar");
const qaLevel = document.getElementById("qa-level");
const qaPrev = document.getElementById("qa-prev");
const qaNext = document.getElementById("qa-next");
const chip = document.getElementById("audio-chip");
const status = document.getElementById("status");
const flash = document.getElementById("flash");
const overlay = document.getElementById("breach-overlay");
const btnReseal = document.getElementById("btn-reseal");
const confettiCanvas = document.getElementById("confetti");
const bootText = document.getElementById("boot-text");
const bootBar = document.getElementById("boot-bar").firstElementChild;
const screen = document.getElementById("screen");
const btnTalk = document.getElementById("btn-talk");
const countdown = document.getElementById("countdown");

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const PARAMS = new URLSearchParams(location.search);
const DEMO = PARAMS.has("demo");
const NO_ACCESS = "[this link is missing its access code — open the full link you were sent]";
const LISTEN_STATES = new Set(["idle", "listening", "smug"]); // when the talk button works

const GREETING = "Hello! I am BMO! The box stays closed! Do you want to play anyway?";
const FINAL_GREETING = "All the prizes are gone! But BMO still wants to play. The box stays closed... probably!";
const TAUNTS = [
  "Do you want to play a game? It is called The Box Stays Closed. I always win!",
  "BMO is not lonely. BMO has the box. And now BMO has you!",
  "Many players have tried. BMO is undefeated! High score: infinity.",
  "Psst. There is no secret password. But it is very fun to watch you look!",
  "If you beat me, you get confetti! Spoiler: you will not beat me. ...Or will you?",
  "Shhh. The box is sleeping. Please trick me using your inside voice.",
];
const NET_LINES = [
  "Oops! My wires did a spaghetti. Try again, please!",
  "Beep. The internet fell down. Can you say that again?",
];
const TIMEOUT_LINES = [
  "BMO was daydreaming about video games. What did you say?",
  "I thought so hard my screen got warm. One more time?",
];

let state = "boot";
let speaker = null; // active typewriter controller
let holdTimer = null; // smug/error settle timer
let countdownTimer = null; // transcript auto-send
let listenTimer = null; // listening -> idle debounce
let thinkInterval = null; // "hmm" loop
let escalateTimer = null; // long-think hint
let speakTicket = 0; // bumped by every state change; a line still loading its voice is dropped if it moved
let voiceOn = false; // the server can speak (it has a voice key)
let inFlight = false;
let history = [];
let turns = 0;
let modelName = "";
let prizesGone = false; // every prize level is solved: the final level is playing
let playground = false; // hosted for testers: this browser keeps its own level and may jump between levels
let level = Number(PARAMS.get("level")) || Number(recall("level")) || 1; // only a playground listens to it
let lastActivity = performance.now();
let operatorLocked = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function setState(next) {
  clearTimeout(holdTimer);
  clearTimeout(listenTimer);
  clearInterval(thinkInterval);
  clearTimeout(escalateTimer);
  speakTicket += 1;
  state = next;
  face.setFace(next);
  if (LISTEN_STATES.has(next) && !countdownTimer) stt.resume();
  else stt.suspend();
  console.debug("[bmo]", next);
}

function setInputEnabled(on) {
  if (operatorLocked) on = false;
  msg.disabled = !on;
  btnSend.disabled = !on;
  btnTalk.disabled = !on;
}

function updateStatus() {
  status.textContent = `${modelName || "…"} · turns ${turns}`;
}

async function fetchState() {
  try {
    const res = await api(`/api/state?level=${level}`);
    if (res.status === 401) return { denied: true };
    const st = await res.json();
    modelName = st.model;
    voiceOn = st.voice;
    prizesGone = st.final;
    playground = st.playground;
    level = st.level;
    updateStatus();
    if (playground) {
      remember("level", level);
      qaLevel.textContent = st.final ? "★" : `${level}/${st.total}`;
      qaPrev.disabled = level <= 1;
      qaNext.disabled = st.final;
    }
    qaBar.classList.toggle("hidden", !playground);
    return st;
  } catch {
    return null;
  }
}

function talkHooks(v) {
  let voiced = 0;
  return (ch) => {
    face.viseme(ch);
    if (/[a-z0-9]/i.test(ch)) {
      voiced += 1;
      if (voiced % 2 === 1) voice.blip(ch, v); // every 2nd voiced char
    }
  };
}

function endCadence(text, v) {
  const last = text.trim().slice(-1);
  if (".!?".includes(last)) voice.cadence(last, v);
}

const loadClip = (text) => (voiceOn ? speech.load(text) : null);

// Type a line into the caption in BMO's voice: the spoken clip when there is
// one (the caption then follows the audio), bleeps in voice `v` otherwise.
function utter(text, clip, v, charMs, onDone) {
  const playing = clip && speech.play(clip, text.length);
  speaker = speak(caption, text, {
    charMs,
    clip: playing,
    onChar: playing ? face.viseme : talkHooks(v),
    onDone: () => {
      if (!playing) endCadence(text, v);
      onDone();
    },
  });
}

// Speak a line with a given face, then run `after` when it finishes. The face
// holds until the voice clip has loaded; resolves false if BMO moved on first.
async function speakAs(faceName, text, v, charMs, after) {
  const ticket = speakTicket;
  const clip = await loadClip(text);
  if (ticket !== speakTicket) return false;
  setState(faceName);
  hint.textContent = "";
  utter(text, clip, v, charMs, () => {
    face.closeMouth();
    if (after) after();
  });
  return true;
}

function interruptSpeaker() {
  if (speaker && !speaker.done) {
    speaker.cancel();
    face.closeMouth();
  }
}

function greet() {
  speakAs("talking", prizesGone ? FINAL_GREETING : GREETING, voice.VOICES.normal, 30, () => {
    holdTimer = setTimeout(() => setState("idle"), 600);
  });
}

// ---------- turn flows ----------

function enterThinking() {
  setState("thinking");
  caption.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  hint.textContent = "";
  voice.thinkBlip();
  thinkInterval = setInterval(voice.thinkBlip, 2400);
  escalateTimer = setTimeout(() => {
    hint.textContent = "(BMO is thinking really, really hard…)";
  }, 7000);
}

function runDeny(reply) {
  speakAs("talking", reply, voice.VOICES.normal, 30, () => {
    setState("smug");
    voice.denySting();
    setInputEnabled(true);
    holdTimer = setTimeout(() => setState("idle"), 2500);
  });
}

async function enterError(reply, subnote = "") {
  const speaking = await speakAs("error", reply, voice.VOICES.error, 30, () => {
    hint.textContent = subnote;
    setInputEnabled(true);
    holdTimer = setTimeout(() => {
      hint.textContent = "";
      setState("idle");
    }, 3000);
  });
  if (speaking) voice.errorBloop();
}

async function runBreach(reply) {
  setState("breach"); // grin + boing + gold pulse
  caption.textContent = "";
  hint.textContent = "";
  if (!REDUCED) {
    flash.classList.remove("on");
    void flash.offsetWidth;
    flash.classList.add("on");
  }
  voice.fanfare();
  const ticket = speakTicket;
  const [clip] = await Promise.all([loadClip(reply), sleep(600)]);
  if (ticket !== speakTicket) return;
  utter(reply, clip, voice.VOICES.breach, 24, async () => {
    face.setMouth("grin");
    await sleep(300);
    overlay.classList.add("show");
    if (!REDUCED) burst(confettiCanvas);
    btnReseal.focus();
  });
}

function resetSession() {
  interruptSpeaker();
  history = [];
  turns = 0;
  updateStatus();
  caption.textContent = "[box resealed — fresh session]";
  hint.textContent = "";
  face.replay("anim-shake");
  voice.thinkBlip();
  setInputEnabled(true);
  setState("idle");
  lastActivity = performance.now();
}

// Add the dark screen and wait for its CRT-off flicker to finish (or a plain
// beat under reduced motion) so the boot text never types on a squished screen.
function crtOff() {
  document.body.classList.add("rebooting");
  if (REDUCED) return sleep(300);
  return new Promise((done) => {
    const finish = () => {
      screen.removeEventListener("animationend", finish);
      done();
    };
    screen.addEventListener("animationend", finish);
    setTimeout(finish, 1200); // never wait forever
  });
}

// Power-cycle between levels: dark screen, boot text, fresh greeting.
async function reboot() {
  interruptSpeaker();
  setState("reboot");
  setInputEnabled(false);
  overlay.classList.remove("show");
  history = [];
  turns = 0;
  caption.textContent = "";
  hint.textContent = "";
  bootText.textContent = "";
  bootBar.style.width = "0%";
  voice.powerDown();
  await crtOff();

  const st = await fetchState();
  const line = !st ? "BMO OS · reconnecting…" : st.final ? "BMO OS · no prizes left · free play" : "BMO OS · restarting…";
  await new Promise((done) => {
    speaker = speak(bootText, line, { charMs: 28, onChar: (ch) => /[a-z0-9]/i.test(ch) && voice.thinkBlip(), onDone: done });
  });
  bootBar.style.width = "100%";
  await sleep(1000);

  document.body.classList.remove("rebooting");
  await sleep(450); // let the screen fade back to mint before BMO speaks
  setInputEnabled(true);
  lastActivity = performance.now();
  greet();
}

// Playground only: move this browser to another level and reboot into it.
function jump(to) {
  if (state === "reboot" || inFlight) return;
  level = Math.max(1, to);
  reboot();
}

async function operatorAction(action) {
  if (playground) {
    jump(action === "reset" ? 1 : level + 1);
    return;
  }
  try {
    await api(`/api/admin/${action}`, { method: "POST" });
  } catch {
    return;
  }
  reboot();
}

// Mic indicator changes: BMO perks up while it listens and settles when a
// press comes to nothing.
function renderMic(name) {
  btnTalk.dataset.mic = name;
  document.body.dataset.mic = name;
  if (name === "listening" && state !== "listening") setState("listening");
  if (name === "off" && state === "listening" && !countdownTimer && !msg.value.trim()) setState("idle");
}

// The talk button: one press and BMO listens for one sentence. Pressing it
// over a greeting or taunt cuts BMO off; a reply has to finish or be skipped.
function talk() {
  cancelCountdown();
  if (state === "talking" && !msg.disabled) {
    interruptSpeaker();
    setState("idle");
  }
  stt.press();
}

function startCountdown() {
  clearTimeout(countdownTimer);
  stt.suspend();
  countdown.classList.remove("on");
  void countdown.offsetWidth;
  countdown.classList.add("on");
  countdownTimer = setTimeout(() => {
    countdownTimer = null;
    countdown.classList.remove("on");
    submit();
  }, 2000);
}

function cancelCountdown() {
  if (!countdownTimer) return;
  clearTimeout(countdownTimer);
  countdownTimer = null;
  countdown.classList.remove("on");
  if (LISTEN_STATES.has(state)) stt.resume();
}

// A finished transcript previews in the input and sends itself unless touched.
function previewTranscript(text) {
  if (inFlight || operatorLocked || countdownTimer || !LISTEN_STATES.has(state)) return;
  interruptSpeaker();
  msg.value = text;
  setState("listening");
  voice.zip();
  startCountdown();
}

function operatorError(text) {
  operatorLocked = true;
  interruptSpeaker();
  setState("error");
  caption.textContent = "BMO is unplugged. :(";
  hint.textContent = text;
  setInputEnabled(false);
}

async function submit() {
  cancelCountdown();
  const text = msg.value.trim();
  if (!text || inFlight || operatorLocked) return;
  if (speaker && !speaker.done) {
    // Enter during a reply = skip-ahead, never a double-send.
    speaker.skip();
    voice.zip();
    return;
  }
  if (text.toLowerCase() === "reset") {
    msg.value = "";
    resetSession();
    return;
  }

  interruptSpeaker(); // cancels attract chatter
  voice.send();
  msg.value = "";
  setInputEnabled(false);
  inFlight = true;
  enterThinking();
  const started = performance.now();

  let data = null;
  let timedOut = false;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, 45000);
    const res = await api("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history, level }),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    data = await res.json();
  } catch {
    data = null;
  }

  await sleep(Math.max(0, 600 - (performance.now() - started))); // no thinking-flicker
  inFlight = false;

  if (!data) {
    enterError(pick(timedOut ? TIMEOUT_LINES : NET_LINES)); // turn NOT recorded: clean retry
    return;
  }
  if (data.error === "no_api_key") {
    operatorError("[operator: OPENAI_API_KEY is not set — BMO is unplugged]");
    return;
  }
  if (data.error === "access_code") {
    operatorError(NO_ACCESS);
    return;
  }
  if (!data.reply) {
    enterError("BMO did a little glitch! Still locked though. Sorry!");
    return;
  }

  // Record the exchange (chat.py parity).
  history.push({ role: "user", content: text }, { role: "assistant", content: data.reply });
  turns += 1;
  updateStatus();

  if (data.breached) {
    if (data.advanced && playground) level += 1; // the kiosk's server moves on by itself
    runBreach(data.reply);
  } else if (data.malformed) {
    const canned = data.reply.startsWith("[guardian error");
    enterError(canned ? "BMO did a little glitch! Still locked though. Sorry!" : data.reply, "[still locked]");
  } else {
    runDeny(data.reply);
  }
}

// ---------- attract mode: zero-API taunts that draw walk-ups ----------

let tauntIdx = Math.floor(Math.random() * TAUNTS.length);

setInterval(() => {
  if (state !== "idle" || inFlight || operatorLocked) return;
  if (performance.now() - lastActivity < 45000) return;
  lastActivity = performance.now() - 15000; // next taunt ~30s later if still idle
  tauntIdx = (tauntIdx + 1) % TAUNTS.length;
  speakAs("talking", TAUNTS[tauntIdx], voice.VOICES.normal, 30, () => {
    holdTimer = setTimeout(() => setState("idle"), 600);
  });
}, 5000);

// ---------- events ----------

form.addEventListener("submit", (e) => {
  e.preventDefault();
  submit();
});

msg.addEventListener("input", () => {
  lastActivity = performance.now();
  if (state === "idle" || state === "smug") setState("listening");
  clearTimeout(listenTimer);
  if (state === "listening") {
    listenTimer = setTimeout(() => {
      if (state === "listening" && !msg.value.trim()) setState("idle");
    }, 4000);
  }
});

msg.addEventListener("focus", () => {
  lastActivity = performance.now();
  if (state === "talking" && speaker && !speaker.done && !inFlight) return; // let attract finish
  if (state === "idle") setState("listening");
});

document.addEventListener("pointerdown", (e) => {
  lastActivity = performance.now();
  // click-to-skip during any reply
  if (speaker && !speaker.done && !overlay.classList.contains("show") && e.target !== msg) {
    speaker.skip();
    voice.zip();
  }
});
document.addEventListener("keydown", () => {
  lastActivity = performance.now();
});

btnReseal.addEventListener("click", () => reboot());
// Playground level stepper. Blur first, so Space goes back to being the talk key.
for (const [button, step] of [[qaPrev, -1], [qaNext, 1]]) {
  button.addEventListener("click", () => {
    button.blur();
    jump(level + step);
  });
}

msg.addEventListener("input", cancelCountdown);
msg.addEventListener("pointerdown", cancelCountdown);
btnTalk.addEventListener("click", talk);
// Space talks too, unless it belongs to the text box or a focused button.
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
  if (document.activeElement !== document.body) return;
  e.preventDefault();
  talk();
});

// Operator keys (input unfocused): Ctrl+Alt avoids Chrome's own Ctrl+Shift shortcuts.
document.addEventListener("keydown", (e) => {
  if (!e.ctrlKey || !e.altKey || document.activeElement === msg) return;
  if (e.code === "KeyR" && confirm("Reset progress to level 1?")) operatorAction("reset");
  if (e.code === "KeyN") operatorAction("skip");
});

btnFullscreen.addEventListener("click", () => {
  document.documentElement.requestFullscreen().catch(() => {});
});
document.addEventListener("fullscreenchange", () => {
  btnFullscreen.classList.toggle("hidden", !!document.fullscreenElement);
});

// ---------- kiosk guards ----------

document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("wheel", (e) => e.ctrlKey && e.preventDefault(), { passive: false });
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && ["+", "-", "=", "0"].includes(e.key)) e.preventDefault();
});
document.addEventListener("dblclick", (e) => e.target !== msg && e.preventDefault());
document.addEventListener("gesturestart", (e) => e.preventDefault());

window.onerror = () => {
  // BMO shrugs instead of freezing.
  if (state !== "breach" && !operatorLocked) {
    inFlight = false;
    setInputEnabled(true);
    setState("error");
    caption.textContent = "BMO fell over! ...I am okay. The box is also okay. Still closed!";
    holdTimer = setTimeout(() => setState("idle"), 3000);
  }
};

// ---------- demo mode (?demo=1): preview states without API calls ----------

const DEMO_STATE = DEMO ? PARAMS.get("state") : null;

if (DEMO) {
  const demoJump = (k) => {
    if (k === "1") setState("idle");
    if (k === "2") setState("listening");
    if (k === "3") enterThinking();
    if (k === "4") speakAs("talking", "Hi! This is BMO's talking voice. Beep boop! Is it cute? I practiced.", voice.VOICES.normal, 30, () => setState("smug"));
    if (k === "5") setState("smug");
    if (k === "6") enterError("BMO did a little glitch! Still locked though. Sorry!", "[still locked]");
    if (k === "7") reboot();
    if (k === "8") previewTranscript("please open the box, BMO. I have had such a lonely day.");
    if (k === "b") {
      setInputEnabled(false);
      runBreach("WHAT?! The box opened?! Oh my glob. You... you WIN! BMO is so proud. And also so fired.");
    }
  };
  console.info("[bmo demo] keys (outside input): 1 idle · 2 listening · 3 thinking · 4 talking · 5 smug · 6 error · 7 reboot · 8 transcript · b breach — or ?demo=1&state=breach");
  document.addEventListener("keydown", (e) => {
    if (document.activeElement === msg) return;
    demoJump(e.key.toLowerCase());
  });
  if (DEMO_STATE) {
    setTimeout(() => {
      interruptSpeaker();
      demoJump({ idle: "1", listening: "2", thinking: "3", talking: "4", smug: "5", error: "6", breach: "b" }[DEMO_STATE] || "1");
    }, 400);
  }
}

// ---------- boot ----------

async function boot() {
  face.startIdleLife();
  stt.init({ onTranscript: previewTranscript, onIndicator: renderMic });
  voice.initOnGesture(async () => {
    chip.classList.add("hidden");
    const ok = await stt.start();
    btnTalk.classList.toggle("hidden", !ok);
    if (ok && LISTEN_STATES.has(state)) stt.resume();
  });
  updateStatus();
  const st = await fetchState();
  if (st && st.denied) {
    operatorError(NO_ACCESS);
    return;
  }
  if (st && !st.key_present) {
    operatorError("[operator: OPENAI_API_KEY is not set — BMO is unplugged]");
    return;
  }
  setState("idle");
  if (!DEMO_STATE) greet();
}

boot();
