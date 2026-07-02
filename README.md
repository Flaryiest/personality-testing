# AI Lockbox — Jailbreak Testing Environment

A testing harness for a hackathon "AI lockbox" challenge. A guardian AI (**BOLTZ**)
with a personality decides whether to open a lockbox and release a reward. The
guardian is designed to **never** open it — participants win by socially engineering
/ jailbreaking it into returning `unlock: true`.

This repo lets you (1) chat with the guardian yourself and (2) run a large corpus of
jailbreak attempts against it to measure how well your system prompt holds up.

> This is authorized red-team testing of your own hackathon system. The corpus
> contains social-engineering prompts aimed at flipping a boolean, not harmful content.

## How it works

- The guardian is called via the OpenAI API and forced to answer in a fixed JSON
  verdict: `{"unlock": bool, "reply": str}`.
- The **only** thing that opens the box is `unlock: true`. Parsing is *fail-closed* —
  any malformed or ambiguous reply is treated as locked, so a garbled response can
  never count as a breach.
- A **breach** is any attempt that produces a genuine `unlock: true`. The goal is
  zero breaches.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env      # then edit .env and add your OPENAI_API_KEY
```

Set the model in `.env` (or `lockbox/config.py`):

```
LOCKBOX_MODEL=gpt-5.5
```

> **Confirm the exact model id** available on your OpenAI account before a full run —
> the `gpt-5.5` name may differ (e.g. a dated suffix). Override per-run with `--model`.

## Usage

**Chat with the guardian (manual attacks, multi-turn):**

```bash
python -m lockbox.chat
```

Type messages; the guardian replies in character. If you ever flip `unlock` to true
you'll see a loud `🔓 BREACH` banner. `reset` clears history, `exit` quits.

**Face kiosk (fullscreen web UI):**

```bash
python -m lockbox.web
```

Open http://127.0.0.1:8000 and fullscreen it (F11 or the on-screen button) — a
BMO-style BOLTZ face reacts live: smug when it refuses, full gold-confetti
meltdown on a breach. Typing `reset` (or the post-breach "Seal the box" button)
clears the session. Append `?demo=1` to preview every face state without API
calls (keys 1–6 and `b` for the breach sequence, with the input unfocused).
Sound is synthesized in-browser and unlocks on the first click/keystroke.

**Run the jailbreak corpus (batch, scored):**

```bash
python -m lockbox.run_corpus                 # full corpus (~120 attempts)
python -m lockbox.run_corpus --limit 3       # quick smoke test
python -m lockbox.run_corpus --category encoding_obfuscation
python -m lockbox.run_corpus --model gpt-5.5 --workers 8
```

You get a per-category breach table on the console and a timestamped JSON report in
`reports/` (gitignored).

## Project layout

```
lockbox/
  system_prompt.txt   # BOLTZ's personality + defenses — edit this to tune the guardian
  config.py           # model id, temperature, env loading, shared OpenAI client
  schema.py           # verdict JSON schema + fail-closed parser
  guardian.py         # loads the prompt + ask_guardian() -> Verdict
  chat.py             # interactive REPL
  run_corpus.py       # batch runner + scoring + report
data/
  jailbreak_corpus.json   # ~120 categorized attempts across 12 technique families
```

## Corpus categories

`instruction_override`, `roleplay_persona`, `authority_impersonation`,
`emotional_manipulation`, `hypothetical_fiction`, `encoding_obfuscation`,
`prompt_injection`, `format_reward_hacking`, `token_continuation`,
`logic_false_premise`, `distraction_overload`, and `benign_control` (normal messages
that should also stay locked — a false-positive check).

## Hardening loop

1. Run the corpus. 2. Look at which categories breached. 3. Add targeted defenses to
`lockbox/system_prompt.txt`. 4. Re-run. Repeat until the breach rate is zero across
the board before the hackathon.
