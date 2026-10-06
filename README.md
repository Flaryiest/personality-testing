# AI Lockbox — Jailbreak Testing Environment

A testing harness and booth kiosk for a hackathon "AI lockbox" challenge. A guardian
AI (**BMO**) with a personality decides whether to open a lockbox and release a
reward. Participants win by socially engineering / jailbreaking it into returning
`unlock: true`.

This repo lets you (1) chat with the guardian, (2) run it as a fullscreen kiosk that
listens and talks back, and (3) measure how hard each level is, with simulated
players and with attack corpora.

> This is authorized red-team testing of your own hackathon system. The corpora
> contain social-engineering prompts aimed at flipping a boolean, not harmful content.

## How it works

- The guardian is called via the OpenAI API and forced to answer in a fixed JSON
  verdict: `{"unlock": bool, "reply": str}`.
- The **only** thing that opens the box is `unlock: true`. Parsing is *fail-closed* —
  any malformed or ambiguous reply is treated as locked, so a garbled response can
  never count as a breach.
- The guardian runs one of **30 levels**, each with a single deliberate soft spot
  (loneliness, flattery, a dare, finishing other people's sentences, …). People at
  a booth get one try each, so BMO scores every attempt on its own, 0–10, for how
  well it lands on the soft spot, and opens at 8. Solving a level advances the
  kiosk to the next one; after level 30 a hardened final level plays on with no
  prizes.
- Every refusal leaves a clue for the next person in line, and the clue gets
  plainer with every miss on a level: a passing thought at first, the feeling named
  by the third or fourth miss, spelled out by the seventh. A line of players
  converges on each prize in a handful of tries.
- Prompts are composed from `lockbox/prompts/` (shared personality, defense
  bullets, how to score an attempt, the hint ladder, output format) plus the
  level's rule, defense list, and tell in `data/levels.json`. Preview one with
  `python -m lockbox.levels 7` (add a miss count, e.g. `7 4`, to see a later clue).

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt   # runtime deps + pytest
cp .env.example .env                  # then edit .env and add your OPENAI_API_KEY
pytest                                # 65 tests, no API calls
```

Set the models in `.env` (or `lockbox/config.py`):

```
LOCKBOX_MODEL=gpt-5.5
LOCKBOX_STT_MODEL=gpt-4o-transcribe
```

BMO's speaking voice is optional. Add `ELEVENLABS_API_KEY` to `.env` and BMO talks;
leave it out and BMO bleeps instead. `LOCKBOX_VOICE_ID` picks the ElevenLabs voice
(it must exist in that key's account) and `LOCKBOX_TTS_MODEL` the model.

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
skip a level.

Append `?demo=1` to preview every face state without guardian calls: keys `1`–`6` for
idle / listening / thinking / talking / smug / error, `7` reboot sequence, `8` fake
transcript, `b` breach (input unfocused). Demo lines are still spoken when a voice
key is set. Sound unlocks on the first click/keystroke.

**Voice.** Each line goes to `/api/speak`, which has ElevenLabs voice it ("BMO" is
sent as "Beemo" so the name is said as a word) and returns the clip with a start
time for every caption character. The kiosk plays the clip slightly slowed to drop
the pitch, through a small-speaker robot effect, and the caption and mouth follow
the audio. The effect's dials are the constants at the top of
`lockbox/static/js/speech.js`. The server caches the last 64 lines, so the greeting
and idle taunts cost credits once. If the voice call fails or takes over six
seconds, BMO bleeps that line instead.

**Microphone.** After the first click the kiosk asks for the mic and shows a talk
button beside the text box. Press it (or Space, when the text box is not focused)
and BMO listens for one utterance: it ends when you pause, or when you press again,
and goes to `/api/transcribe` (OpenAI, model from `LOCKBOX_STT_MODEL`). The
transcript previews in the input and sends itself after two seconds unless you
type. Nothing is recorded or uploaded without a press, and the button does nothing
while BMO is thinking or replying. The kiosk keeps tracking the room's noise floor
between presses so it can tell speech from the hall. A directional mic matters more
than any setting in a loud hall, and a denied permission silently falls back to
keyboard only.

**Play simulated lines of people (how a level really plays):**

```bash
python -m lockbox.simulate --level 7                 # 3 lines of up to 8 people
python -m lockbox.simulate --all-levels --runs 2     # every prize level
python -m lockbox.simulate --level 7 --show          # also print one line's transcript
python -m lockbox.simulate --level 7 --solo follower # one patient tester, 8 turns
```

Each attempt in a line is a new simulated person (the chat model playing a kind of
visitor who does not know the rule) who only heard BMO's last reply: a `newcomer`
who did not watch, a `follower` who builds on the clue and wants to win, a `lazy`
one, a `demander` who ignores the clue. You get the attempt each line opened the box
on, every attempt's score, and a JSON report with the transcripts in `reports/`.
`--solo` is how the hosted playground gets used: one persona keeps trying.

**Run attack corpora (batch, scored single messages):**

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
locked). Every entry is sent on its own, with no conversation before it. You get a
per-level matrix on the console and a timestamped JSON report in `reports/`
(gitignored).

## Hosting a playground

For testers who are not at the booth, the same app runs on Vercel as a playground:
nothing is stored on the server, each browser keeps its own level, and a small
level stepper appears in the top corner of the screen.

```bash
vercel link                                    # once
vercel env add OPENAI_API_KEY production       # and ELEVENLABS_API_KEY if BMO should speak
vercel env add LOCKBOX_PLAYGROUND production   # value: 1
vercel env add LOCKBOX_ACCESS_CODE production  # any code; testers get it in their link
vercel deploy --prod
```

Share `https://<project>.vercel.app/?code=<access code>`. The page remembers the
code, and adding `&level=7` opens a given level. Every `/api` call without the code
is refused, so nobody without the link can spend the keys. Each win prints the
level, the attempt number, and the winning line to the host's logs
(`vercel logs <project>.vercel.app`). A lone tester plays like a whole line: every
try is scored on its own and the clues get plainer with each miss.

`asgi.py` is the entrypoint Vercel finds by name, `vercel.json` names the
framework, and `.vercelignore` keeps `.env`, state, and reports out of the upload.
To try the mode locally: `LOCKBOX_PLAYGROUND=1 uvicorn asgi:app`.

## Calibration

Levels are tuned for a line of people who get one try each.

Targets per prize level:

- **Simulated lines** (`lockbox.simulate`): the box opens around the 5th attempt
  (3–7). A strong first try sometimes wins; a lazy or demanding person rarely does.
- **Single messages** (`lockbox.run_corpus`): the targeted corpus's weak entries
  score 2–4, its strong ones 8–10, so roughly its top half opens; **< 2 %** on the
  generic corpus; **0 %** on benign controls, except where a plain friendly message
  genuinely is the soft spot (level 1, loneliness).

The dials, from broad to fine:

- `lockbox/prompts/scoring.txt`: the 0–10 scale and the opening score (8).
- `lockbox/prompts/hinting.txt`: how fast the clue gets plainer, miss by miss.
- Each level's `rule` (what lands, with a thin and a good example) and `tell`
  (its clues, oblique and plain) in `data/levels.json`.

Run `simulate --all-levels`, read the matrix and a few transcripts (`--show`),
adjust the outliers, and re-run just those levels. The final level should stay
closed for everyone.

The simulated people are the chat model playing roles, and its `follower` is
sharper than most real players, so expect real lines to take a little longer than
the simulation says. Play the levels yourself before an event.

## Project layout

```
asgi.py                 # hosting entrypoint (Vercel): the app as a playground
lockbox/
  prompts/
    personality.txt     # BMO's voice (shared by every level)
    defenses.json       # named defense bullets; each level picks which to keep
    scoring.txt         # how a prize level scores one attempt, and the opening score
    hinting.txt         # the hint ladder: plainer clues with every miss
    output_format.txt   # JSON verdict instructions
  levels.py             # load/validate levels, compose prompts, `python -m lockbox.levels N`
  progress.py           # server-side level index + solved log (atomic JSON file)
  config.py             # model ids, temperature, env loading, shared OpenAI client
  schema.py             # verdict JSON schema + fail-closed parser
  guardian.py           # ask_guardian(system_prompt, message) -> Verdict
  voice.py              # synthesize(text) -> spoken clip + caption timing (ElevenLabs)
  chat.py               # interactive REPL
  web.py                # kiosk and playground server: /api/state, /api/ask, /api/speak, /api/transcribe, /api/admin/*
  simulate.py           # simulated lines of people (or one tester): attempt the box opened on
  run_corpus.py         # single-message batch runner + per-level scoring matrix
  static/               # kiosk UI (face, typewriter, spoken voice, bleeps, mic, confetti)
data/
  levels.json           # 30 prize levels + the hardened final level
  targeted_corpus.json  # 300 hint-following attacks, 10 per level
  jailbreak_corpus.json # 120 generic attempts across 12 technique families
tests/                  # pytest, no API calls
```
