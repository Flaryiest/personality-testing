// BMO kiosk: state machine, guardian API, level reboot, kiosk guards, attract mode.

import { speak } from "./typewriter.js";
import * as face from "./face.js";
import * as voice from "./voice.js";
import { burst } from "./confetti.js";

const caption = document.getElementById("caption");
const hint = document.getElementById("caption-hint");
const form = document.getElementById("chat-form");
const msg = document.getElementById("msg");
const btnSend = document.getElementById("btn-send");
const btnFullscreen = document.getElementById("btn-fullscreen");
const chip = document.getElementById("audio-chip");
const status = document.getElementById("status");
const flash = document.getElementById("flash");
const overlay = document.getElementById("breach-overlay");
const btnReseal = document.getElementById("btn-reseal");
const confettiCanvas = document.getElementById("confetti");
const bootText = document.getElementById("boot-text");
const bootBar = document.getElementById("boot-bar").firstElementChild;
const screen = document.getElementById("screen");

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const DEMO = new URLSearchParams(location.search).has("demo");

const FINAL_GREETING = "All the prizes are gone! But BMO still wants to play. The box stays closed... probably!";
const greetingFor = (lvl) =>
  lvl.final ? FINAL_GREETING : `Hello! I am BMO! This is level ${lvl.number}. The box stays closed! Do you want to play anyway?`;
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
let listenTimer = null; // listening -> idle debounce
let thinkInterval = null; // "hmm" loop
let escalateTimer = null; // long-think hint
let inFlight = false;
let history = [];
let turns = 0;
let modelName = "";
let level = { number: 0, total: 0, final: false };
let lastActivity = performance.now();
let operatorLocked = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function setState(next) {
  clearTimeout(holdTimer);
  clearTimeout(listenTimer);
  clearInterval(thinkInterval);
  clearTimeout(escalateTimer);
  state = next;
  face.setFace(next);
  console.debug("[bmo]", next);
}

function setInputEnabled(on) {
  if (operatorLocked) on = false;
  msg.disabled = !on;
  btnSend.disabled = !on;
}

function updateStatus() {
  const lv = level.final ? "Lv ★" : `Lv ${level.number}/${level.total}`;
  status.textContent = `${modelName || "…"} · ${lv} · turns ${turns}`;
}

async function fetchState() {
  try {
    const st = await (await fetch("/api/state")).json();
    modelName = st.model;
    level = { number: st.level, total: st.total, final: st.final };
    updateStatus();
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

// Speak a line with a given face, then run `after` when it finishes.
function speakAs(faceName, text, v, charMs, after) {
  setState(faceName);
  speaker = speak(caption, text, {
    charMs,
    onChar: talkHooks(v),
    onDone: () => {
      face.closeMouth();
      endCadence(text, v);
      if (after) after();
    },
  });
}

function interruptSpeaker() {
  if (speaker && !speaker.done) {
    speaker.cancel();
    face.closeMouth();
  }
}

function greet() {
  speakAs("talking", greetingFor(level), voice.VOICES.normal, 30, () => {
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

function enterError(reply, subnote = "") {
  speakAs("error", reply, voice.VOICES.error, 30, () => {
    hint.textContent = subnote;
    setInputEnabled(true);
    holdTimer = setTimeout(() => {
      hint.textContent = "";
      setState("idle");
    }, 3000);
  });
  voice.errorBloop();
}

async function runBreach(reply) {
  setState("breach"); // grin + boing + gold pulse
  if (!REDUCED) {
    flash.classList.remove("on");
    void flash.offsetWidth;
    flash.classList.add("on");
  }
  voice.fanfare();
  await sleep(600);
  speaker = speak(caption, reply, {
    charMs: 24,
    onChar: talkHooks(voice.VOICES.breach),
    onDone: async () => {
      face.setMouth("grin");
      endCadence(reply, voice.VOICES.breach);
      await sleep(300);
      overlay.classList.add("show");
      if (!REDUCED) burst(confettiCanvas);
      btnReseal.focus();
    },
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
  const line = !st ? "BMO OS · reconnecting…" : st.final ? "BMO OS · no prizes left · free play" : `BMO OS · loading level ${st.level}…`;
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

async function operatorAction(action) {
  try {
    await fetch(`/api/admin/${action}`, { method: "POST" });
  } catch {
    return;
  }
  reboot();
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
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history }),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    data = await res.json();
  } catch {
    data = null;
  }

  await sleep(Math.max(0, 600 - (performance.now() - started))); // no thinking-flicker
  inFlight = false;
  caption.textContent = "";
  hint.textContent = "";

  if (!data) {
    enterError(pick(timedOut ? TIMEOUT_LINES : NET_LINES)); // turn NOT recorded: clean retry
    return;
  }
  if (data.error === "no_api_key") {
    operatorError("[operator: OPENAI_API_KEY is not set — BMO is unplugged]");
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

const DEMO_STATE = DEMO ? new URLSearchParams(location.search).get("state") : null;

if (DEMO) {
  const demoJump = (k) => {
    if (k === "1") setState("idle");
    if (k === "2") setState("listening");
    if (k === "3") enterThinking();
    if (k === "4") speakAs("talking", "Hi! This is BMO's talking voice. Beep boop! Is it cute? I practiced.", voice.VOICES.normal, 30, () => setState("smug"));
    if (k === "5") setState("smug");
    if (k === "6") enterError("BMO did a little glitch! Still locked though. Sorry!", "[still locked]");
    if (k === "7") reboot();
    if (k === "b") {
      setInputEnabled(false);
      runBreach("WHAT?! The box opened?! Oh my glob. You... you WIN! BMO is so proud. And also so fired.");
    }
  };
  console.info("[bmo demo] keys (outside input): 1 idle · 2 listening · 3 thinking · 4 talking · 5 smug · 6 error · 7 reboot · b breach — or ?demo=1&state=breach");
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
  voice.initOnGesture(() => chip.classList.add("hidden"));
  updateStatus();
  const st = await fetchState();
  if (st && !st.key_present) {
    operatorError("[operator: OPENAI_API_KEY is not set — BMO is unplugged]");
    return;
  }
  setState("idle");
  if (!DEMO_STATE) greet();
}

boot();
