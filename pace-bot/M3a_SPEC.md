# Milestone 3a — LiveKit voice agent foundations

First of three sub-milestones that migrate PACE Bot from the sunset HeyGen Streaming API to LiveAvatar LITE Mode. M3a establishes the voice pipeline *without* the avatar, *without* Claude. We validate that the LiveKit plumbing works before wiring in the brain (M3b) or the face (M3c).

## 1. What M3a delivers

A new `pace-agent/` Python project (sibling to `pace-bot/`) containing a LiveKit Agent that:

1. Connects to a LiveKit Cloud room as a participant
2. Transcribes user speech via Deepgram STT
3. Echoes the transcription back via Deepgram TTS (no LLM yet)
4. Gracefully handles disconnects and VAD (voice activity detection) so it doesn't talk over the user

Plus a tiny browser page (or reused LiveKit Sandbox) that connects to the same room so we can actually speak to it.

At the end of M3a, you can open a browser page, talk into the mic, and hear the agent say back what you said. That's it. No Claude, no avatar. Just proof that the voice pipeline is alive.

## 2. Why this is separate from M3b/M3c

Three distinct things can break in a voice-AI stack:
- LiveKit + WebRTC (audio getting in and out of the room)
- STT/TTS providers (transcription accuracy, voice quality, latency)
- LLM + tool orchestration (our existing `pace-bot` backend)

If we wire all three at once and something's broken, we can't tell which layer is at fault. M3a isolates the first two. M3b adds the third. M3c adds the avatar video layer on top.

## 3. Project layout

```
pace-bot/              # existing, unchanged
pace-agent/            # NEW — Python LiveKit agent
├── agent.py           # entry point
├── pyproject.toml     # uv-managed; pins livekit-agents, plugins
├── .env.example
├── .env               # gitignored
├── AGENTS.md          # pre-populated by LiveKit CLI for Claude Code
└── README.md
```

Deliberately separate from `pace-bot/`. Different language, different runtime, different deploy story, different dependency tree. They communicate only over HTTP (from M3b onward).

## 4. Tech choices

| Piece | Choice | Why |
|------|------|-----|
| Agent framework | `livekit-agents~=1.4` | Official, actively maintained, Python-first |
| Package manager | `uv` | LiveKit's recommended; fast, lockfile-based |
| Python | 3.11+ | Required by `livekit-agents` 1.4 |
| STT | Deepgram (nova-3) | High accuracy, low latency, LiveKit-plugin-supported, free credit |
| TTS | Deepgram Aura-2 | Same vendor = one fewer account + key. Decent voice quality |
| VAD | Silero | Bundled, runs locally, no extra API |
| Turn detection | LiveKit multilingual turn detector | Reduces the agent talking over the user |
| Noise cancellation | `livekit-plugins-noise-cancellation` (BVC) | Free from LiveKit Cloud, improves STT accuracy noticeably |

Explicit non-choices for M3a:
- **No LLM yet.** The agent just echoes. LLM integration is M3b.
- **No custom frontend yet.** We test using `lk` CLI's console mode and LiveKit's hosted Sandbox frontend.
- **No avatar video.** Audio only. M3c adds LiveAvatar LITE Mode.
- **No deployment.** Everything runs locally against LiveKit Cloud.

## 5. Setup prerequisites (before Claude Code starts)

You need to run these yourself. Claude Code can do some of it but these involve paste-from-browser steps.

### 5a. Install the LiveKit CLI

```bash
brew install livekit-cli
lk cloud auth
```

The auth command opens a browser and links the CLI to your LiveKit Cloud project. Verify it worked:

```bash
lk project list
```

Should show your `pace-bot` (or whatever you named it) project.

### 5b. Install uv (Python package manager)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Verify: `uv --version` should print something.

### 5c. Install Python 3.11+ if you don't have it

```bash
uv python install 3.11
```

`uv` manages its own Python installs. You do not need Homebrew's Python.

### 5d. Install LiveKit's Claude Code skill + MCP server

This is the big quality-of-life move. LiveKit publishes a Claude Code skill that gives CC working knowledge of LiveKit's current APIs (important because they change often). From the parent directory containing both repos:

```bash
npx skills add livekit/agent-skills --skill livekit-agents
```

This adds a `.claude/` skill folder that CC reads automatically. Separate from this, LiveKit's docs MCP server can also be installed; we'll skip it for M3a unless CC asks for it.

### 5e. Confirm Deepgram key

In your `pace-agent/.env` (which we'll create in §6), you'll need:

```
DEEPGRAM_API_KEY=<your key from console.deepgram.com>
```

## 6. What Claude Code should do in M3a

Paste this prompt into Claude Code from the parent folder (so CC can see both `pace-bot` and `pace-agent`):

> Read `pace-bot/M3a_SPEC.md`. Implement milestone 3a exactly — do not go beyond it. Follow section 7's order. Do NOT touch anything in `pace-bot/`. Create a new sibling project at `pace-agent/`. Stop after step 7 (local console mode working) for a smoke test before continuing.

## 7. Implementation order

### Step 1 — Bootstrap the project

```bash
# From the parent directory
lk agent init pace-agent --template agent-starter-python
cd pace-agent
```

This clones LiveKit's official starter template, which includes a working `agent.py`, `pyproject.toml`, `AGENTS.md` (for Claude Code), and a Dockerfile. CC should use this as the base, not write from scratch.

### Step 2 — Load environment

```bash
lk app env -w
```

This writes `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` into `.env.local`. Rename to `.env` for consistency with `pace-bot`:

```bash
mv .env.local .env
```

Then add Deepgram:

```
DEEPGRAM_API_KEY=<your key>
```

### Step 3 — Install deps

```bash
uv sync
uv add "livekit-agents[deepgram,silero,turn-detector]~=1.4" "livekit-plugins-noise-cancellation~=0.2" "python-dotenv"
```

The starter template may already have most of these; `uv add` is idempotent.

### Step 4 — Download local models (Silero VAD, turn detector)

```bash
uv run python agent.py download-files
```

Required once. Caches the VAD and turn-detection models locally so the agent doesn't download them every startup.

### Step 5 — Replace the LLM with echo behavior

The starter template will include an LLM in the pipeline (usually OpenAI). For M3a we don't want that — we want the agent to transcribe and read back, nothing more. CC should:

1. Open `agent.py`
2. Find the `AgentSession` or equivalent pipeline setup
3. Replace the LLM component with a passthrough: transcription text → TTS, no inference
4. Keep STT, VAD, TTS, turn detection, noise cancellation all in place

A clean way to do this is to subclass `Agent` and override the handler that would normally go to an LLM, routing it directly to `session.say(user_text)` instead. CC should look at the LiveKit skill guidance here — the right abstraction has changed over versions.

The agent's initial greeting on user join should be: *"Hi, I'm in echo mode. Say something and I'll repeat it back."*

### Step 6 — Log everything

Add a `logger` (stdlib logging, INFO level) that prints:
- Room joined + participant count
- Every transcription result (with final/interim flag)
- Every speech output
- Disconnects and errors

This is invaluable for M3b debugging. Cheap to add now, painful to add later.

### Step 7 — Smoke test in console mode

```bash
uv run python agent.py console
```

This runs the agent locally in terminal mode with your Mac's mic and speakers — no browser needed. You talk, the agent echoes. Confirms STT + TTS + VAD work before involving LiveKit Cloud at all.

**Expected behavior:**
- Agent prints "Hi, I'm in echo mode..."
- You say "testing one two three"
- Agent prints the transcription in the log
- Agent says "testing one two three" back

If console mode works, stop here and paste logs + observations.

### Step 8 — Run in dev mode against LiveKit Cloud

```bash
uv run python agent.py dev
```

This registers the agent with LiveKit Cloud. The agent waits for a room to join.

### Step 9 — Connect a test client

Two options for hitting the agent without building a frontend yet:

**Option A (easier): LiveKit Sandbox.** Visit https://agents-playground.livekit.io/ , authenticate with your LiveKit Cloud account, pick your project, hit Connect. Browser joins a room, the agent joins that same room, you talk.

**Option B: LiveKit CLI.**
```bash
lk room join --identity testuser --publish-demo my-test-room
```

For M3a, Option A is the right call — zero frontend code, validates the Cloud round-trip.

### Step 10 — Cleanup for M3b handoff

Before finishing:
- Commit `.env.example` with real variable names and dummy values (not secrets)
- Make sure `.env`, `__pycache__/`, `.venv/`, `*.pyc` are in `.gitignore`
- Update `README.md` with run instructions and a "Next: M3b" note
- Confirm `AGENTS.md` (from the template) has LiveKit context CC will use in M3b

## 8. Acceptance criteria

All of these must be true before we move to M3b:

- [ ] `pace-agent/` is a separate folder from `pace-bot/`, not nested
- [ ] `uv run python agent.py console` runs, shows log lines, and echoes speech back accurately
- [ ] `uv run python agent.py dev` registers with LiveKit Cloud without errors
- [ ] You can connect from the LiveKit Agents Playground and have an echo conversation
- [ ] Logs show: join event, transcription events (both interim and final), say events, leave event
- [ ] VAD is working (the agent doesn't talk while you talk)
- [ ] Noise cancellation is enabled (check by running in a moderately loud room)
- [ ] No secrets committed to git (run `git status` before committing)
- [ ] `pace-bot/` is completely untouched by M3a

## 9. Out of scope for M3a

- Any interaction with `pace-bot` backend (comes in M3b)
- Claude / LLM integration (comes in M3b)
- Avatar video (comes in M3c)
- Custom frontend (comes in M3c)
- Per-avatar personas / system prompts (comes in M3b)
- Production deploy, Dockerfile, CI (later milestone)

## 10. Risks + open questions

**"Console mode works but dev mode fails with auth errors"** — probably `LIVEKIT_URL` mismatch. `lk app env -w` should populate it correctly; if not, grab the WebSocket URL from the LiveKit Cloud dashboard manually.

**"Agent joins but never hears anything"** — usually a mic permission issue in the browser (for Playground) or a wrong audio device (for console mode). Check system mic permissions for your terminal app.

**"TTS sounds robotic"** — Deepgram Aura has multiple voices. The default may not be the best pick. Voice selection is fine-tunable in M3b when we pick distinct voices for the two personas. For M3a, any working voice is fine.

**"The agent talks over me"** — turn detection wasn't enabled. Check the pipeline config for `turn_detection=MultilingualModel()` or equivalent.

**Version drift** — LiveKit's agent framework has gone through major API changes (0.x → 1.x). The starter template and Claude Code skill should be current; if CC writes code that doesn't match the installed package, check the imports against the 1.4 reference docs.
