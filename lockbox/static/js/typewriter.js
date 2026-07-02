// The master clock: reveals text character by character, and the mouth and
// bleeps hang off the per-character callback — so text, face, and sound are
// structurally incapable of drifting.

export function speak(el, text, { charMs = 30, onChar, onDone } = {}) {
  let i = 0;
  let timer = null;
  let finished = false;

  // Long replies speed up so nothing runs past ~7s (kiosk pacing).
  const ms = text.length > 220 ? Math.max(18, Math.min(charMs, 7000 / text.length)) : charMs;

  el.textContent = "";

  function pauseAfter(ch) {
    if (".!?".includes(ch)) return 260;
    if (",;:".includes(ch)) return 120;
    return 0;
  }

  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    el.textContent = text;
    if (onDone) onDone();
  }

  function tick() {
    if (finished) return;
    if (i >= text.length) {
      finish();
      return;
    }
    const ch = text[i];
    el.textContent += ch;
    i += 1;
    if (onChar) onChar(ch, i - 1);
    timer = setTimeout(tick, ms + pauseAfter(ch));
  }

  tick();

  return {
    skip: finish, // jump to the end; onDone still fires
    cancel() {
      // hard stop for reset/interrupt; onDone does NOT fire
      finished = true;
      clearTimeout(timer);
    },
    get done() {
      return finished;
    },
  };
}
