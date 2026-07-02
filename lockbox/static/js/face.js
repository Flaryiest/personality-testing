// Face rig: expression switching, blink/wander schedulers, mouth visemes.
// CSS does the animating; this module only decides WHAT shows and WHEN.

const eyes = document.getElementById("eyes");
const gaze = document.getElementById("gaze");
const mouth = document.getElementById("mouth");
const squash = document.getElementById("face-squash");

const MOUTHS = {
  smile: "M 330 320 Q 400 368 470 320",
  smirk: "M 340 330 Q 420 358 470 312",
  flat: "M 355 330 L 445 330",
  o: "M 400 316 a 22 26 0 1 0 0.1 0",
  talkMid: "M 352 312 Q 400 322 448 312 Q 442 356 400 358 Q 358 356 352 312 Z",
  talkWide: "M 340 306 Q 400 318 460 306 Q 452 376 400 380 Q 348 376 340 306 Z",
  grin: "M 320 300 L 480 300 Q 470 388 400 392 Q 330 388 320 300 Z",
  wavy: "M 340 330 Q 365 314 390 330 Q 415 346 440 330 Q 455 320 462 328",
};
const FILLED = new Set(["o", "talkMid", "talkWide", "grin"]);

// The whole face, one object per state — live-tweakable.
const EXPRESSIONS = {
  idle: { eyes: "round", mouth: "smile", anim: null },
  listening: { eyes: "round", mouth: "smile", anim: "anim-perk" },
  thinking: { eyes: "squint", mouth: "o", anim: null },
  talking: { eyes: "round", mouth: "flat", anim: null },
  smug: { eyes: "happy", mouth: "smirk", anim: "anim-smug" },
  breach: { eyes: "happy", mouth: "grin", anim: "anim-boing" },
  error: { eyes: "x", mouth: "wavy", anim: "anim-shake" },
};

let current = "idle";
let lastSwitch = 0;

export function setFace(name) {
  const exp = EXPRESSIONS[name];
  if (!exp) return;
  current = name;
  lastSwitch = performance.now();
  document.body.dataset.face = name;
  eyes.dataset.eyes = exp.eyes;
  setMouth(exp.mouth);
  gaze.style.removeProperty("--wx"); // let per-state CSS gaze rules take over
  gaze.style.removeProperty("--wy");
  if (exp.anim) replay(exp.anim);
}

export function setMouth(name) {
  mouth.setAttribute("d", MOUTHS[name]);
  mouth.classList.toggle("filled", FILLED.has(name));
}

export function replay(cls) {
  squash.classList.remove(cls);
  void squash.offsetWidth; // reflow so the animation restarts
  squash.classList.add(cls);
}

export function restMouth() {
  return EXPRESSIONS[current].mouth;
}

export function closeMouth() {
  setMouth(restMouth());
}

// ---- visemes: 3-frame puppet flaps, capped so they read instead of strobe ----

let lastFlap = 0;
let flapAlt = false;

export function viseme(ch) {
  if (!/[a-z0-9]/i.test(ch)) {
    setMouth(restMouth() === "grin" ? "grin" : "flat"); // rest between words
    return;
  }
  const now = performance.now();
  if (now - lastFlap < 68) return; // one flap per ~2 chars max
  lastFlap = now;
  flapAlt = !flapAlt;
  setMouth("aeiouAEIOU".includes(ch) ? "talkWide" : flapAlt ? "talkMid" : "o");
}

// ---- idle life: blink + eye wander, self-rescheduling forever ----

function blinkOnce() {
  eyes.classList.add("blink");
  setTimeout(() => eyes.classList.remove("blink"), 140);
}

function scheduleBlink() {
  setTimeout(() => {
    const roundEyes = EXPRESSIONS[current].eyes === "round";
    const settled = performance.now() - lastSwitch > 300;
    if (roundEyes && settled) {
      blinkOnce();
      if (Math.random() < 0.1) setTimeout(blinkOnce, 320); // occasional double-blink
    }
    scheduleBlink();
  }, 2500 + Math.random() * 3500);
}

function scheduleWander() {
  setTimeout(() => {
    if (current === "idle") {
      gaze.style.setProperty("--wx", (Math.random() * 20 - 10).toFixed(1) + "px");
      gaze.style.setProperty("--wy", (Math.random() * 12 - 6).toFixed(1) + "px");
      setTimeout(() => {
        if (current === "idle") {
          gaze.style.setProperty("--wx", "0px");
          gaze.style.setProperty("--wy", "0px");
        }
      }, 800 + Math.random() * 700);
    }
    scheduleWander();
  }, 3000 + Math.random() * 4000);
}

export function startIdleLife() {
  scheduleBlink();
  scheduleWander();
}
