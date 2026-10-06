// The master clock: reveals text character by character, and the mouth and
// bleeps hang off the per-character callback — so text, face, and sound are
// structurally incapable of drifting. Given a spoken `clip`, the clip's own
// clock paces the reveal instead, so the caption tracks the voice.

export function speak(el, text, { charMs = 30, clip = null, onChar, onDone } = {}) {
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

  function reveal() {
    const ch = text[i];
    el.textContent += ch;
    i += 1;
    if (onChar) onChar(ch, i - 1);
    return ch;
  }

  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (clip) clip.stop();
    el.textContent = text;
    if (onDone) onDone();
  }

  // Reveal every character the clip has reached, then sleep until the next
  // one is due (or until the clip ends).
  function followClip() {
    const now = clip.clock();
    if (now >= clip.end) {
      finish();
      return;
    }
    while (i < text.length && clip.times[i] <= now) reveal();
    const next = i < text.length ? clip.times[i] : clip.end;
    timer = setTimeout(tick, Math.max(10, (next - now) * 1000));
  }

  function tick() {
    if (finished) return;
    if (clip) {
      followClip();
      return;
    }
    if (i >= text.length) {
      finish();
      return;
    }
    timer = setTimeout(tick, ms + pauseAfter(reveal()));
  }

  tick();

  return {
    skip: finish, // jump to the end; onDone still fires
    cancel() {
      // hard stop for reset/interrupt; onDone does NOT fire
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (clip) clip.stop();
    },
    get done() {
      return finished;
    },
  };
}
