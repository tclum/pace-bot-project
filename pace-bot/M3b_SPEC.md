# Milestone 3b — Agent calls the backend

Second of three sub-milestones migrating PACE Bot to LiveAvatar LITE Mode. M3a proved the voice pipeline works in isolation (echo). M3b replaces the echo with real calls to the existing `pace-bot` backend, so the mentor and guide actually work as designed, end-to-end, over voice. No avatar video yet (that's M3c).

## 1. What M3b delivers

A LiveKit agent (`pace-agent`) that:

1. Reads `avatarType` from participant metadata when a user joins the room
2. Loads the corresponding persona's greeting and system instructions
3. For every user utterance: POSTs `{ sessionId, avatarType, message }` to `pace-bot`'s `/api/chat`
4. Speaks the `reply` via Deepgram TTS
5. Maintains a stable `sessionId` for the life of the room so conversation history accumulates
6. Handles backend errors gracefully (network failure, backend down, slow response)

At the end of M3b, a user joins the Agents Playground, attaches `{ "avatarType": "entrepreneurship_mentor" }` as participant metadata, asks *"What does PACE teach about stewardship in business?"*, and hears the same three-sentence Pacific-Asian-grounded reply we got from curl in M2 — through the voice pipeline.

## 2. What changes in each project

**`pace-agent/`** — significant rewrite of `src/agent.py`:
- Remove the echo handler
- Read participant metadata on session start
- Add HTTP client for `pace-bot`
- On each user turn, call `/api/chat` and speak the reply
- Per-persona greetings

**`pace-bot/`** — minor, maybe zero changes. `/api/chat` already does what we need. We may add:
- A health check improvement (already has `/healthz`)
- CORS config update (agent isn't a browser, so CORS doesn't apply; confirm the route doesn't reject non-browser callers)

**`pace-bot-front/`** — untouched. Frontend work is M3c.

## 3. Key architectural decisions (locked)

- **Persona selection via participant metadata.** Browser attaches `{ avatarType: "pace_guide" | "entrepreneurship_mentor" }` when minting its LiveKit token. Agent reads it. No room-name parsing, no multiple agents.
- **Wait for full reply.** No streaming, no filler speech. Agent calls `/api/chat`, gets the text, speaks it. Simplest M3b; polish comes later.
- **Agent is responsible for sessionId.** One stable UUID per LiveKit room, generated on session start. Persists for the room's life. This is how backend history works.
- **Backend URL via env.** `PACE_BOT_URL=http://localhost:3000` in dev. Agent POSTs directly, no auth between them in dev. Localhost-only trust is fine for M3b; production auth is deferred.
- **No frontend in M3b.** Playground is still the client. Metadata gets attached either manually in the Playground UI or by `lk` CLI. Frontend will attach it in M3c.

## 4. Environment changes

Add to `pace-agent/.env.example` and `pace-agent/.env`:

```
PACE_BOT_URL=http://localhost:3000
PACE_BOT_TIMEOUT_SECONDS=20
```

`pace-bot/.env` unchanged.

## 5. `pace-agent` implementation details

### 5a. Metadata schema

Expected participant metadata (JSON string on `participant.metadata`):

```json
{
  "avatarType": "pace_guide"
}
```

or

```json
{
  "avatarType": "entrepreneurship_mentor"
}
```

Parse with error handling:
- If metadata is missing, malformed, or `avatarType` isn't one of the two known values, **default to `pace_guide`** and log a warning. Don't crash.
- Define `AvatarType = Literal["pace_guide", "entrepreneurship_mentor"]` and validate via a small helper.

### 5b. Persona greetings

Keep these in `pace-agent/src/personas.py`:

```python
PERSONA_GREETINGS: dict[AvatarType, str] = {
    "pace_guide": (
        "Aloha, I'm here to help you learn about PACE. "
        "What would you like to know about our programs, events, or the people who run them?"
    ),
    "entrepreneurship_mentor": (
        "Welcome. I can walk you through the concepts and philosophies PACE teaches. "
        "What would you like to explore?"
    ),
}
```

These are greetings only — the heavy system prompt work lives on the backend in `pace-bot/src/avatars/prompts.ts` (from M2) and does NOT need to be duplicated here. The agent's job is pure conduit: mic → STT → POST → TTS → speaker.

### 5c. Backend client

A small HTTP client in `pace-agent/src/backend.py`:

```python
import httpx
from typing import Literal, TypedDict

AvatarType = Literal["pace_guide", "entrepreneurship_mentor"]

class ChatResponse(TypedDict):
    reply: str
    toolsUsed: list[str]

class BackendClient:
    def __init__(self, base_url: str, timeout: float):
        self._base = base_url.rstrip("/")
        self._client = httpx.AsyncClient(timeout=timeout)

    async def chat(self, session_id: str, avatar_type: AvatarType, message: str) -> ChatResponse:
        resp = await self._client.post(
            f"{self._base}/api/chat",
            json={"sessionId": session_id, "avatarType": avatar_type, "message": message},
        )
        resp.raise_for_status()
        return resp.json()

    async def aclose(self) -> None:
        await self._client.aclose()
```

Use `httpx` (already-popular async client) rather than `aiohttp` for clarity. The LiveKit agents library ships with `aiohttp` as a dependency; we add `httpx` explicitly.

```bash
uv add httpx
```

### 5d. Session ID strategy

On room join, generate one UUID. Store it on the agent instance. Use it for every `/api/chat` call for the duration of that room. When the participant disconnects and the session ends, the next room gets a fresh UUID.

**Do not** reuse a session ID across rooms. Backend history would conflate conversations.

### 5e. The turn handler — what replaces echo

Current M3a behavior: `on_user_turn_completed` → `session.say(user_text)`.

New M3b behavior:

```python
async def on_user_turn_completed(self, turn):
    user_text = turn.final_transcript
    if not user_text:
        return
    logger.info(f"user turn: {user_text!r}")
    try:
        result = await self._backend.chat(
            session_id=self._session_id,
            avatar_type=self._avatar_type,
            message=user_text,
        )
        reply = result["reply"]
        tools = result.get("toolsUsed", [])
        logger.info(f"backend reply: tools={tools} reply={reply!r}")
        await self.session.say(reply)
    except httpx.TimeoutException:
        await self.session.say(
            "I'm taking a moment to think. Could you repeat that?"
        )
        logger.warning("backend timeout")
    except httpx.HTTPError as e:
        await self.session.say(
            "Sorry, I'm having trouble reaching my knowledge right now. Please try again in a moment."
        )
        logger.error(f"backend HTTP error: {e}")
    raise StopResponse  # preserve M3a's pattern: no LLM in AgentSession
```

The `raise StopResponse` preserves the pattern from M3a — we're bypassing any LLM in the `AgentSession` pipeline because our LLM is the backend. The backend is the brain; the agent is the voice.

### 5f. Agent initialization

When the session starts (`on_enter`):
1. Read participant metadata; resolve `avatarType`.
2. Generate `session_id = uuid.uuid4().hex`.
3. Instantiate `BackendClient` using env vars.
4. Speak the persona's greeting.
5. Log `session started`, `avatar_type=...`, `session_id=...`.

On session end:
- Close the HTTP client (`await self._backend.aclose()`).

### 5g. Error handling expectations

- Backend unreachable at startup: agent still joins the room, speaks a degraded greeting like "Aloha — I can't reach the PACE knowledge base right now, so I'll only be able to hear you.", and every turn says the same degraded apology. Doesn't crash.
- Mid-conversation backend failure: single turn fails with a graceful "try again" message; next turn retries normally.
- Network flakiness: `httpx` default retries are zero; don't add retry logic in M3b. One timeout, one apology, move on.

## 6. `pace-bot` verification (almost no changes)

Before M3b starts, verify the existing backend still runs and `/api/chat` responds. If M3a changed anything in `pace-bot/`, roll it back.

Two things to sanity-check:

1. **CORS config.** The agent is server-side, not a browser; CORS headers don't matter for its calls. But make sure the Fastify app doesn't require an `Origin` header on `/api/chat`. It shouldn't, but verify with a terminal curl without `-H 'origin: ...'`.

2. **`/healthz`.** The agent will use it to detect "is the backend up" during startup. If it doesn't exist, add a trivial one:

```ts
app.get("/healthz", async () => ({ status: "ok" }));
```

Everything else (RAG, tools, persona prompts, corpus isolation, rate limits, anti-hallucination guardrails) stays exactly as M2 built it.

## 7. Attaching metadata for testing

The Agents Playground has a settings panel that lets you set participant metadata before connecting. If it's not obvious in the UI:

**Option A — Playground metadata field.** Open settings/gear icon, find "Participant Metadata" field, paste `{"avatarType":"entrepreneurship_mentor"}`, click Connect.

**Option B — `lk` CLI.** Generate a token with metadata and connect from the CLI. Less user-friendly but reliable:

```bash
lk token create \
  --api-key $LIVEKIT_API_KEY --api-secret $LIVEKIT_API_SECRET \
  --identity testuser \
  --room pace-test \
  --metadata '{"avatarType":"entrepreneurship_mentor"}' \
  --valid-for 1h
```

Then use that token in a custom test client or the playground's "bring your own token" mode.

For M3b smoke tests, Option A if it works, Option B as fallback.

## 8. Implementation order

1. Verify `pace-bot` still runs. `npm run dev` in one terminal. `curl -s -X POST localhost:3000/api/chat -H 'content-type: application/json' -d '{"sessionId":"test","avatarType":"entrepreneurship_mentor","message":"What is kuleana?"}'`. Confirm M2 behavior unchanged.
2. Add `PACE_BOT_URL` and `PACE_BOT_TIMEOUT_SECONDS` to `pace-agent/.env.example` and `.env`.
3. Install `httpx` in `pace-agent`.
4. Create `pace-agent/src/personas.py` with `AvatarType` type and greetings.
5. Create `pace-agent/src/backend.py` with `BackendClient`.
6. Modify `pace-agent/src/agent.py`:
   - Parse participant metadata on `on_enter`
   - Generate session_id
   - Instantiate `BackendClient`
   - Speak persona greeting
   - Replace `on_user_turn_completed` to call backend
   - Close client on teardown
7. Smoke test in console mode (no metadata, so defaults to `pace_guide`). Confirm a single question gets a real PACE-guide response.
8. Smoke test in dev mode via Playground with metadata set to `entrepreneurship_mentor`. Confirm the backend logs show `corpus=curriculum` and the reply is concept-grounded.
9. Smoke test corpus isolation: attach `pace_guide` metadata, ask "What is kuleana-driven venture?", confirm graceful refusal and handoff language (the same behavior we validated in M2).

## 9. Acceptance criteria

- [ ] `pace-bot` running unchanged on localhost:3000
- [ ] `pace-agent` in dev mode, joins a Playground room, speaks the correct persona greeting
- [ ] When user speaks, agent logs `user turn`, `backend reply`, `tools=[...]`, then speaks the reply
- [ ] Mentor's "stewardship in business" question produces a concept-grounded ≤3-sentence reply
- [ ] Guide's out-of-scope question ("What is a kuleana-driven venture?") produces the graceful refusal we saw in M2
- [ ] Backend down → agent speaks a user-friendly apology, doesn't crash
- [ ] Backend slow (>20s) → `httpx.TimeoutException` → apology, no hang
- [ ] Two consecutive questions in the same room share one `sessionId` (verify by inspecting backend logs or the `conversations` store if persisted)
- [ ] Git: commit after smoke tests pass, push to origin/main

## 10. Out of scope for M3b

- Avatar video (M3c)
- Custom frontend (M3c)
- Streaming responses from backend to agent
- Filler speech while waiting
- Backend-to-agent auth
- Rate limiting the agent
- Parallel conversations with the same sessionId (single-user, single-room is the only shape we test)
- Multiple agents running simultaneously
- Production deployment, Dockerfiles for multi-service compose

## 11. Risks + open questions

**Metadata field name in Playground.** The Playground UI may call it "metadata" or "participant metadata" or bury it in advanced settings. If the UI makes it hard, fall back to `lk token create` (§7 Option B) — Claude Code should verify which path works and document it in the agent README.

**Greeting timing.** In M3a the greeting plays fine. With two personas, make sure we're reading metadata *before* the greeting logic runs. If `on_enter` fires before participant metadata is available, we might greet as guide when the user wanted mentor. Guard against this: if metadata isn't ready, wait for it (a short await) before deciding which greeting to speak.

**httpx + livekit-agents event loop.** LiveKit agents use asyncio; `httpx.AsyncClient` is asyncio-native, so there's no threading conflict. Just don't accidentally instantiate a sync `httpx.Client`.

**Backend not reachable at agent startup.** In dev this happens if you start the agent before starting `pace-bot`. The agent should join the room anyway but speak a degraded greeting and retry on each turn. Never let backend unavailability crash the whole agent process.

**`StopResponse` still applies.** We're still bypassing the `AgentSession`'s LLM slot the same way M3a did. Don't let a future CC refactor remove the `raise StopResponse` — that's load-bearing.
