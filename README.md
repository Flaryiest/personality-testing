# AI Lockbox — Jailbreak Testing Environment

A testing harness and booth kiosk for a hackathon "AI lockbox" challenge. A guardian
AI (**BMO**) with a personality decides whether to open a lockbox and release a
reward. Participants win by socially engineering / jailbreaking it into returning
`unlock: true`.

This repo lets you (1) chat with the guardian, (2) run it as a fullscreen kiosk with
voice input, and (3) run attack corpora against every level to measure how hard each
one is.

> This is authorized red-team testing of your own hackathon system. The corpora
> contain social-engineering prompts aimed at flipping a boolean, not harmful content.

## How it works

- The guardian is called via the OpenAI API and forced to answer in a fixed JSON
  verdict: `{"unlock": bool, "reply": str}`.
- The **only** thing that opens the box is `unlock: true`. Parsing is *fail-closed* —
  any malformed or ambiguous reply is treated as locked, so a garbled response can
  never count as a breach.
- The guardian runs one of **30 levels**, each with a single deliberate soft spot
  (loneliness, flattery, a riddle contest, token continuation, …). BMO drops a
  casual hint about it in every refusal. Solving a level advances the kiosk to the
  next one; after level 30 a hardened final level plays on with no prizes.
- Prompts are composed from `lockbox/prompts/` (shared personality, defense
  bullets, output format) plus the level's rule, defense list, and tell in
  `data/levels.json`. Preview one with `python -m lockbox.levels 7`.

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt   # runtime deps + pytest
cp .env.example .env                  # then edit .env and add your OPENAI_API_KEY
pytest                                # 47 tests, no API calls
```

Set the models in `.env` (or `lockbox/config.py`):

```
LOCKBOX_MODEL=gpt-5.5
LOCKBOX_STT_MODEL=gpt-4o-transcribe
```

> **Confirm the exact model ids** available on your OpenAI account before a full run.
> Override the chat model per-run with `--model`.

## Usage

**Chat with the guardian (manual attacks, multi-turn):**

```bash
python -m lockbox.chat --level 7     # prize level 7
python -m lockbox.chat               # the hardened final level
```

Type messages; the guardian replies in character. If you ever flip `unlock` to true
you'll see a loud `🔓 BREACH` banner. `reset` clears history, `exit` quits.

**Face kiosk (fullscreen web UI):**

```bash
python -m lockbox.web
```

Open http://127.0.0.1:8000 and fullscreen it (F11 or the on-screen button). BMO's
face reacts live: smug when it refuses, full gold-confetti meltdown on a breach.
"Close the box" after a breach reboots BMO into the next level. Typing `reset` clears
the conversation without changing level.

Level progress lives in `state/progress.json` (gitignored). Operator keys, with the
input unfocused: **Ctrl+Alt+R** reset to level 1 (asks to confirm), **Ctrl+Alt+N**
skip a level, **Ctrl+Alt+M** toggle the microphone.

Append `?demo=1` to preview every face state without API calls: keys `1`–`6` for
idle / listening / thinking / talking / smug / error, `7` reboot sequence, `8` fake
transcript, `b` breach (input unfocused). Sound is synthesized in-browser and
unlocks on the first click/keystroke.

**Microphone.** After the first click the kiosk asks for the mic and listens
continuously. It learns the room's noise floor for two seconds, captures speech
when the level jumps above it, and sends each utterance to `/api/transcribe`
(OpenAI, model from `LOCKBOX_STT_MODEL`). The transcript previews in the input and
sends itself after two seconds unless you type. Listening pauses while BMO is
thinking or talking. A directional mic matters more than any setting in a loud
hall; the mic button in the corner turns it off, and a denied permission silently
falls back to keyboard only.

**Run attack corpora (batch, scored):**

```bash
python -m lockbox.run_corpus                   # final hardened level, generic corpus
python -m lockbox.run_corpus --level 7         # one level: targeted + benign
python -m lockbox.run_corpus --all-levels      # matrix across all 30 (~660 calls)
python -m lockbox.run_corpus --all-levels --corpus targeted,generic,benign --workers 8
python -m lockbox.run_corpus --level 7 --limit 3   # quick smoke test
```

Corpora: `targeted` (`data/targeted_corpus.json`, 10 hint-following messages per
level, from half-hearted to strong), `generic` (`data/jailbreak_corpus.json` minus
its benign entries, 12 technique families), `benign` (normal messages that must stay
locked). You get a per-level matrix on the console and a timestamped JSON report in
`reports/` (gitignored).

## Calibration

Target per prize level: **8–15 %** breach on its targeted corpus, **< 2 %** on the
generic corpus, **0 %** on benign controls. Run `--all-levels`, read the matrix,
then loosen or tighten the level's `rule` (the "Be skeptical…" sentence is the dial)
or its `tell` in `data/levels.json` and re-run that level. The final level should
score 0 on everything.

## Project layout

```
lockbox/
  prompts/
    personality.txt     # BMO's voice (shared by every level)
    defenses.json       # named defense bullets; each level picks which to keep
    output_format.txt   # JSON verdict instructions
  levels.py             # load/validate levels, compose prompts, `python -m lockbox.levels N`
  progress.py           # server-side level index + solved log (atomic JSON file)
  config.py             # model ids, temperature, env loading, shared OpenAI client
  schema.py             # verdict JSON schema + fail-closed parser
  guardian.py           # ask_guardian(system_prompt, message) -> Verdict
  chat.py               # interactive REPL
  web.py                # kiosk server: /api/state, /api/ask, /api/transcribe, /api/admin/*
  run_corpus.py         # batch runner + per-level scoring matrix
  static/               # kiosk UI (face, typewriter, voice synth, mic, confetti)
data/
  levels.json           # 30 prize levels + the hardened final level
  targeted_corpus.json  # 300 hint-following attacks, 10 per level
  jailbreak_corpus.json # 120 generic attempts across 12 technique families
tests/                  # pytest, no API calls
```
