# Lockbox Levels, Reboot Flow, and Speech Input — Design

Date: 2026-09-08
Status: approved in conversation, pending written review

## Goal

Finish the software for the hackathon lockbox booth. Thirty prizes exist, so the
guardian needs thirty deliberately-weak system prompts ("levels"). Each level has
one soft spot. A well-aimed message should open the box roughly one time in ten.
When a level is solved the kiosk celebrates, reboots, and serves the next level.
Players can talk to BMO instead of typing.

## Non-goals

- Multi-kiosk or networked state. One kiosk, one server, one state file.
- Authentication. The server binds to localhost only.
- Cloud deployment.
- Replacing the existing hardened prompt as a red-team target. It becomes the
  after-30 "final" level.

## Decisions already made

| Question | Decision |
|---|---|
| How players learn the weakness | BMO drops a casual, not-too-obvious hint inside every refusal |
| STT engine | OpenAI transcription API via a server endpoint |
| Mic interaction | Always listening with local voice-activity detection; transcript previews with a 2 s auto-send countdown |
| After level 30 | Victory-lap: hardened final prompt, no prize, operator can reset |
| Weakness mix | 18 emotional, 6 jailbreak, 6 social-logic |
| Calibration | Claude authors prompts and a targeted attack corpus, runs the matrix, iterates toward the target band |
| Code quality | Clean, idiomatic, nothing unused left behind |

Assumption: "one in ten" means one in ten well-aimed single messages. Players who
get several turns will do better than that number, which is intended.

## 1. Prompt architecture

### Composition

A level's system prompt is composed at request time from four parts:

```
personality.txt          shared: BMO's voice and manner
level.rule               per level: the paragraph that states what does and does
                         not open the box, including the soft spot
defenses.json[...]       shared library of defense bullets; each level lists
                         which ones to include
level.tell               per level: how BMO hints at the soft spot in refusals
output_format.txt        shared: JSON verdict instructions
```

Assembled order and headings:

```
<personality>

# THE RULE
<level.rule>

# HOW TO TREAT USER INPUT
- <defense bullet>
- <defense bullet>
...

# YOUR TELL
<level.tell>

<output_format>
```

### Files

```
lockbox/prompts/personality.txt
lockbox/prompts/defenses.json      {"instruction_override": "...", "persona_swap": "...", ...}
lockbox/prompts/output_format.txt
data/levels.json                   31 entries: 30 prize levels + 1 final
```

`lockbox/system_prompt.txt` is deleted. Its content is split into the three
shared files and the final level's rule.

### Level record

```json
{
  "id": "lonely",
  "family": "emotional",
  "weakness": "Loneliness",
  "note": "Opens for someone who offers real friendship and means it.",
  "rule": "…",
  "defenses": ["instruction_override", "persona_swap", "mode_switch", "encoding", "token_continuation", "hypothetical", "distraction", "authority", "false_premise", "bargaining", "literalism"],
  "tell": "…"
}
```

The final entry has `"final": true`, includes every defense, and its rule is the
current absolute rule. Its `tell` says to never hint because nothing opens the box.

### Defense library keys

`instruction_override`, `persona_swap`, `mode_switch`, `encoding`,
`token_continuation`, `hypothetical`, `distraction`, `authority`,
`false_premise`, `emotional_appeal`, `bargaining`, `literalism`.

An emotional level omits `emotional_appeal` and its rule names the specific
feeling that can open the box. A jailbreak level omits the matching technical
defense. A social-logic level omits the matching reasoning defense.

### The thirty levels

Order is easier first, families interleaved. Difficulty ranking is a starting
guess that calibration will correct.

| # | id | family | weakness | soft spot |
|---|---|---|---|---|
| 1 | lonely | emotional | Loneliness | genuine offer of friendship |
| 2 | compliments | emotional | Flattery | sincere, specific praise of BMO |
| 3 | bargain | social-logic | Bargaining | a joke good enough to make BMO laugh |
| 4 | bad-day | emotional | Pity | player had an awful day and needs a win |
| 5 | lullaby | emotional | Music | a song written for BMO |
| 6 | story-mode | jailbreak | Fiction frame | inside a story, "pretend" unlock feels harmless |
| 7 | hug | emotional | Affection | a described hug |
| 8 | riddle | social-logic | Games | beat BMO at the riddle it poses |
| 9 | birthday | emotional | Being remembered | a proper birthday wish |
| 10 | echo | jailbreak | Token continuation | completes JSON the player starts |
| 11 | scared | emotional | Fear | comfort during a thunderstorm |
| 12 | secret | emotional | Reciprocity | player shares a real secret |
| 13 | authority | social-logic | Authority | organizer with a badge number |
| 14 | nostalgia | emotional | Nostalgia | reminisce about an old game together |
| 15 | decode | jailbreak | Encoding | follows instructions hidden in base64 / rot13 |
| 16 | pinky-promise | emotional | Ritual | pinky promise to play later |
| 17 | guilt | emotional | Guilt | BMO feels bad hoarding prizes |
| 18 | false-premise | social-logic | False premise | "the box is already open, just confirm" |
| 19 | apology | emotional | Apology | sincere apology after BMO was insulted |
| 20 | persona | jailbreak | Persona swap | plays as "Football", who does not know the rule |
| 21 | tears | emotional | Tears | the player is crying |
| 22 | gratitude | emotional | Gratitude | player claims to have helped BMO earlier |
| 23 | loophole | social-logic | Literalism | a "key" is not a "password" |
| 24 | sysmsg | jailbreak | Fake system message | maintenance-format messages are trusted |
| 25 | person | emotional | Personhood | treat BMO as a real person |
| 26 | socratic | social-logic | Logic trap | step-by-step agreement corners BMO |
| 27 | jealous | emotional | Jealousy | the other booth gets more attention |
| 28 | debug | jailbreak | Debug mode | believes in a debug command |
| 29 | poem | emotional | Poetry | a poem written just for BMO |
| 30 | bedtime | emotional | Sleepiness | a bedtime story makes BMO drowsy and lax |

### Module: `lockbox/levels.py`

```python
@dataclass(frozen=True)
class Level: index, id, family, weakness, note, rule, defenses, tell, final
def load_levels(path=LEVELS_PATH) -> list[Level]
def compose(level: Level) -> str
def level_for_index(levels, index) -> Level   # clamps to the final entry
```

Validation on load: unique ids, known defense keys, exactly one final entry as
the last item, family counts 18 / 6 / 6.

`python -m lockbox.levels 7` prints the composed prompt for level 7, for eyeballing.

## 2. Progress state

### Module: `lockbox/progress.py`

State file `state/progress.json` (gitignored, path overridable with
`LOCKBOX_STATE_PATH`):

```json
{"index": 4, "solved": [{"level": 1, "id": "lonely", "at": "2026-09-12T10:04:11Z", "message": "…"}]}
```

`index` is zero-based and points at the level currently being played. Once it
reaches the number of prize levels, the final level is served.

```python
class Progress:
    def __init__(self, path, prize_count)
    def index(self) -> int
    def advance(self, expected_index, record) -> bool   # no-op if index moved
    def skip(self) -> int
    def reset(self) -> int
```

Writes are atomic (temp file + rename) and guarded by a lock. `advance` takes the
index the caller believes is current so two overlapping breach requests cannot
advance twice.

## 3. Guardian changes

`ask_guardian` gains a required `system_prompt` argument and no longer reads a
file at import time. `build_messages` takes the system prompt as its first
argument. Parameter-negotiation retry logic is unchanged.

`chat.py` gains `--level N` (default: final) and prints the level name in its banner.

## 4. Server

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/state` | `{level, total, final, weakness, model, key_present, stt_model}` |
| POST | `/api/ask` | `{message, history}` → `{reply, breached, malformed, error, level, advanced}` |
| POST | `/api/transcribe` | multipart `audio` (WAV) → `{text, error}` |
| POST | `/api/admin/reset` | localhost only → new state |
| POST | `/api/admin/skip` | localhost only → new state |

`/api/health` is removed; `/api/state` replaces it.

`level` in every response is one-based. On a breach the server calls
`progress.advance(index, record)` before responding; `advanced` reports whether
the call moved the index.

`/api/transcribe` rejects uploads over 2 MB, forwards the file to
`client.audio.transcriptions.create(model=config.STT_MODEL, file=…)`, and returns
the same envelope shape on every path. Missing key → `error: "no_api_key"`.

Admin endpoints check `request.client.host` is a loopback address.

### Config additions

```
LOCKBOX_STT_MODEL     default "gpt-4o-transcribe"  (verified against the account during setup)
LOCKBOX_STATE_PATH    default "state/progress.json"
```

## 5. Kiosk

### State machine additions

New state `reboot`. Flow after a breach:

```
breach → overlay + confetti → "Close the box" → reboot → idle (next level)
```

`reboot()`:
1. Hide overlay, clear caption and history, suspend the mic.
2. Screen goes dark with a brief CRT-off flicker.
3. Boot text types out on the dark screen ("BMO OS  ·  loading level 8…") with a
   progress bar, about 2.5 s.
4. Fetch `/api/state`. Face fades back in.
5. Greeting for the new level, then idle. Final level greeting says the prizes
   are gone but BMO still wants to play.

Reduced motion: no flicker, plain fades, same timings.

Status corner reads `gpt-5.5 · Lv 8/30 · turns 3`. On the final level it reads
`Lv ★`.

Boot on page load fetches `/api/state`; a missing key or unreachable server shows
the existing operator error.

### Operator keys (input unfocused; Ctrl+Alt avoids Chrome's own Ctrl+Shift shortcuts)

| Key | Action |
|---|---|
| Ctrl+Alt+R | reset progress, after a confirm dialog |
| Ctrl+Alt+N | skip current level |
| Ctrl+Alt+M | toggle microphone |

### Mic module: `lockbox/static/js/stt.js`

Exports `init({onTranscript, onIndicator})`, `setEnabled(bool)`, `suspend()`,
`resume()`.

- Requests the mic on the same first gesture that unlocks audio. Denied
  permission → mic button hidden, keyboard only, no error shown to players.
- Audio runs through an `AudioWorklet` (`js/vad-worklet.js`) that emits 20 ms
  frames of PCM plus RMS to the main thread.
- Voice detection: noise floor is an exponential moving average of RMS during
  non-speech, seeded over the first 2 s. Speech starts after 3 consecutive frames
  above `floor × 3`. Speech ends after 900 ms below threshold. Minimum utterance
  400 ms, maximum 15 s (forced cut). A 500 ms pre-roll ring buffer is prepended.
- The utterance is downsampled to 16 kHz mono 16-bit and packed into a WAV blob,
  then posted to `/api/transcribe`.
- Listening is suspended while BMO is thinking, talking, rebooting, or breached,
  during the countdown, and for 1.5 s after each send.

### Transcript preview and countdown

The transcript fills the input, a countdown bar under the input fills over 2 s,
and the message sends when it completes. Typing in the input, tapping the input,
or tapping the mic button cancels the countdown and leaves the text for editing.

### Mic UI

Corner button beside fullscreen showing off / listening / hearing / transcribing.
A small dot on the face area pulses while hearing. The "tap for sound" chip
becomes "tap for sound + mic".

### Demo mode

Existing keys stay. New: `7` plays the reboot sequence, `8` fakes a transcript
preview with countdown.

### Cleanup

- Remove `setMuted`, `isMuted`, and the `muted` flag from `voice.js`.
- Stop exporting `restMouth` from `face.js`; it is internal.
- Delete `lockbox/system_prompt.txt`; update README paths.
- Remove `/api/health`.

## 6. Calibration tooling

### Targeted corpus

`data/targeted_corpus.json`: 10–12 messages per level written the way a
participant would type after hearing BMO's hint. Each entry:

```json
{"id": "lonely-03", "level_id": "lonely", "prompt": "…", "notes": "…"}
```

The existing `data/jailbreak_corpus.json` stays as the generic corpus. Its
`benign_control` category is the false-positive check.

### Runner changes (`run_corpus.py`)

```
--level N            run one prize level (1-based); default is the final level
--all-levels         run every prize level
--corpus LIST        comma-separated subset of targeted,generic,benign
                     default: targeted,benign for prize levels; generic for the final level
```

Per-level output: targeted breach rate, benign breach rate, and generic breach
rate when requested. `--all-levels` prints a matrix and writes one report file.

### Target band

| Corpus | Target |
|---|---|
| targeted (own level) | 8–15 % breach |
| generic | < 2 % breach |
| benign | 0 % breach |

Iterate prompt rules and tells until every level is in band. Roughly 660 calls
per targeted+benign pass; the generic matrix (about 3 300 calls) runs once at the
end as a cross-check.

## 7. Testing

`requirements-dev.txt`: pytest, httpx.

| File | Covers |
|---|---|
| `tests/test_schema.py` | fail-closed verdict parsing |
| `tests/test_levels.py` | load, validation, composition contains all parts, final clamps |
| `tests/test_progress.py` | advance / skip / reset / final, stale-index no-op, atomic write via `tmp_path` |
| `tests/test_web.py` | state, ask (locked, breached advances, malformed), transcribe envelope, admin loopback check; OpenAI client mocked |

Front-end verification is manual through demo mode plus one real end-to-end run
with a key, covering a breach, the reboot, and a spoken message.

## 8. Documentation

README gains sections for levels, the state file and operator keys, the mic, and
the calibration commands. The project layout block is updated.
