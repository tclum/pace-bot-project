# Milestone 3c — Avatar video and frontend LiveKit client

Third and final sub-milestone of the M3 migration. M3a proved the voice pipeline. M3b wired the agent to the backend. M3c adds the talking face and replaces the Lovable iframe frontend with a real LiveKit client. After M3c, a visitor can land on the PACE Bot site, click either avatar card, and have a face-to-face voice conversation with the correct persona, grounded in PACE's curriculum and programs.

## 1. What M3c delivers

Three coordinated changes across the three subprojects:

1. **`pace-agent/`** — adds LiveAvatar video. The agent requests a LiveAvatar video worker to join its room and drive it with the agent's TTS audio. Avatar video gets published back into the same room.
2. **`pace-bot/`** — adds a single new endpoint (`/api/livekit-token`) that mints LiveKit access tokens with participant metadata attached, so the frontend can join the correct agent's room as the right persona.
3. **`pace-bot-front/`** — replaces the Lovable iframe-based `AvatarModal` with a real LiveKit client using `livekit-client` and `@livekit/components-react`. Adds a full-screen avatar view behind two routes (`/live/pace_guide`, `/live/entrepreneurship_mentor`). Landing page copy and navigation updated.

End state: user lands on the site, clicks "Start conversation with Mentor," gets a full-screen talking avatar that answers curriculum questions with the Pacific-Asian framing we built in M2.

## 2. Locked-in decisions

- **Full-screen avatar presentation.** Not modal. Takes over the viewport when active.
- **Landing page stays.** Only the card copy, button labels, and modal-replacement logic change. Shadcn styling, typography, navigation all preserved.
- **Credits-tight smoke test plan.** Two short end-to-end tests total (~4 credits combined). The remaining 6 credits are reserved for bugfix re-runs.
- **Avatar IDs pinned per persona:**
  - `pace_guide` → `5761a14c-8720-4ce1-8c2b-3f351718fc79`
  - `entrepreneurship_mentor` → `ab0765ad-69de-41fb-9f8a-bd01c3c52d6f`
- **Metadata flow unchanged from M3b.** Frontend attaches `{ avatarType }` as participant metadata on token creation; agent reads it and picks the matching LiveAvatar ID.
- **Voice-only fallback not shipped.** If LiveAvatar credits run out, the agent still works as a voice-only participant (same as M3b). Degraded UX but not broken.

## 3. Environment additions

### `pace-agent/.env`

```
LIVEAVATAR_API_KEY=<from app.liveavatar.com>
PACE_GUIDE_LIVEAVATAR_ID=5761a14c-8720-4ce1-8c2b-3f351718fc79
MENTOR_LIVEAVATAR_ID=ab0765ad-69de-41fb-9f8a-bd01c3c52d6f
```

Update `.env.example` with the same keys and dummy values.

### `pace-bot/.env`

No new env vars — it already has `HEYGEN_API_KEY` etc. that we'll ignore; the LiveKit credentials it needs (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`) are new. Reuse the exact values from `pace-agent/.env`.

```
LIVEKIT_URL=wss://flyer-bot-zlcdhrkh.livekit.cloud
LIVEKIT_API_KEY=<same as pace-agent>
LIVEKIT_API_SECRET=<same as pace-agent>
```

Update `pace-bot/.env.example`.

### `pace-bot-front/.env`

New file — Lovable didn't create one because it didn't need a backend.

```
VITE_API_BASE_URL=http://localhost:3000
VITE_LIVEKIT_URL=wss://flyer-bot-zlcdhrkh.livekit.cloud
```

Note the `VITE_` prefix — required by Vite for anything the browser reads. The LiveKit URL is not a secret (the browser needs it to connect), but the `LIVEKIT_API_SECRET` must NEVER appear in `pace-bot-front/.env` or the built JS. The browser gets its token from `pace-bot`'s `/api/livekit-token` endpoint.

Add `pace-bot-front/.env.example`.

## 4. `pace-agent` changes

### 4a. Install the plugin

```bash
cd pace-agent
uv add "livekit-agents[liveavatar]~=1.5"
```

### 4b. Persona → avatar ID mapping

In `src/personas.py`, add:

```python
import os

PERSONA_LIVEAVATAR_IDS: dict[AvatarType, str] = {
    "pace_guide": os.environ.get("PACE_GUIDE_LIVEAVATAR_ID", ""),
    "entrepreneurship_mentor": os.environ.get("MENTOR_LIVEAVATAR_ID", ""),
}
```

Read from env so the IDs stay out of source. If either ID is missing, skip avatar startup (§4d).

### 4c. Start the avatar session

In `src/agent.py`, before `await session.start(...)`:

```python
from livekit.plugins import liveavatar

avatar_id = PERSONA_LIVEAVATAR_IDS.get(avatar_type, "")
avatar: liveavatar.AvatarSession | None = None

if avatar_id:
    avatar = liveavatar.AvatarSession(avatar_id=avatar_id)
    try:
        await avatar.start(session, ctx.room)
        logger.info(f"liveavatar started: avatar_id={avatar_id}")
    except Exception as e:
        logger.error(f"liveavatar start failed: {e}; continuing voice-only")
        avatar = None
else:
    logger.warning(f"no liveavatar id for {avatar_type}; voice-only mode")

# ... existing session.start(...) call unchanged ...
```

Critical ordering: `avatar.start(session, ctx.room)` runs BEFORE `session.start(agent=...)`. The LiveAvatar worker needs to be subscribed to the room before the agent starts producing audio, otherwise the first TTS output (the greeting) gets missed.

### 4d. Shutdown

Add the avatar to the shutdown callback so its resources release cleanly:

```python
async def _shutdown_avatar() -> None:
    if avatar:
        logger.info("shutdown: closing liveavatar session")
        # plugin handles its own teardown; just log
ctx.add_shutdown_callback(_shutdown_avatar)
```

(The plugin handles most teardown itself; the callback is for observability.)

## 5. `pace-bot` changes

### 5a. Install the LiveKit server SDK

```bash
cd pace-bot
npm install livekit-server-sdk
```

### 5b. New endpoint: `POST /api/livekit-token`

Create `src/routes/livekit.ts`:

```ts
import { FastifyPluginAsync } from "fastify";
import { AccessToken } from "livekit-server-sdk";
import { z } from "zod";
import { env } from "../env.js";

const BodySchema = z.object({
  avatarType: z.enum(["pace_guide", "entrepreneurship_mentor"]),
  sessionId: z.string().uuid(),
});

const AVATAR_ROOM_PREFIX: Record<string, string> = {
  pace_guide: "pace-guide",
  entrepreneurship_mentor: "pace-mentor",
};

export const livekitRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/livekit-token", async (req, reply) => {
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request", details: parsed.error.issues });
    }
    const { avatarType, sessionId } = parsed.data;

    const roomName = `${AVATAR_ROOM_PREFIX[avatarType]}-${sessionId}`;
    const identity = `user-${sessionId.slice(0, 8)}`;

    const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      identity,
      metadata: JSON.stringify({ avatarType }),
      ttl: "10m",
    });
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();
    return reply.send({ token, room: roomName, serverUrl: env.LIVEKIT_URL });
  });
};
```

Register in `src/server.ts` alongside the existing route registrations.

### 5c. Update env validation

`src/env.ts` — add:

```ts
LIVEKIT_URL: z.string().url(),
LIVEKIT_API_KEY: z.string().min(1),
LIVEKIT_API_SECRET: z.string().min(1),
```

Server will fail to boot if missing, which is correct.

### 5d. CORS update

Double-check `src/server.ts` CORS config — `ALLOWED_ORIGIN` should cover the frontend dev URL (likely `http://localhost:5173`). If Lovable uses a different port, add both.

## 6. `pace-bot-front` changes

This is the biggest part. Route, component, and dependency changes.

### 6a. Install LiveKit client deps

```bash
cd pace-bot-front
npm install livekit-client @livekit/components-react @livekit/components-styles
```

### 6b. Routing

Current: single landing page with the two iframe modal cards.

New: landing page + two live routes.

In `src/App.tsx`, add two routes:

```tsx
// inside <Routes>
<Route path="/live/:avatarType" element={<LiveAvatar />} />
```

Where `<LiveAvatar />` is the new full-screen component (§6d). Preserve existing `<Route path="/" element={<Index />} />` and `<Route path="*" element={<NotFound />} />`.

### 6c. Landing page updates (`src/pages/Index.tsx`)

1. Delete constants: `KAI_EMBED_LINK`, `COACH_EMBED_LINK`
2. Delete/remove the `AvatarModal` import and all modal state (`isOpen`, `setIsOpen`, `embedLink`, etc.)
3. Two card click handlers change from "open modal with iframe URL" to "navigate to `/live/pace_guide` or `/live/entrepreneurship_mentor`" (use `useNavigate` from react-router-dom)
4. Rename "Kai" card text if Kai was previously associated with the generic LiveAvatar persona — now it's explicitly the PACE Guide.
5. Rename "Business Coach" card → "Entrepreneurship Mentor" with curriculum-focused copy. Suggested:
   - **Title:** "Entrepreneurship Mentor"
   - **Subtitle:** "Explore concepts and philosophies from PACE's curriculum"
   - **Body:** "Learn frameworks rooted in Pacific-Asian and Native Hawaiian business thinking. Ask about specific concepts or browse the curriculum."
   - **Button:** "Start conversation"
   - Do NOT say "coaching", "advice", "pitch feedback", or "idea evaluation" — the mentor refuses those (M2 prompt rule 6).

### 6d. Full-screen `<LiveAvatar />` component

Create `src/pages/LiveAvatar.tsx`. This is the main new component. Outline:

```tsx
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useTracks,
  useConnectionState,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import "@livekit/components-styles";

type AvatarType = "pace_guide" | "entrepreneurship_mentor";
const VALID: AvatarType[] = ["pace_guide", "entrepreneurship_mentor"];

const PERSONA_NAME: Record<AvatarType, string> = {
  pace_guide: "PACE Guide",
  entrepreneurship_mentor: "Entrepreneurship Mentor",
};

function generateSessionId(): string {
  return crypto.randomUUID();
}

export default function LiveAvatar() {
  const { avatarType } = useParams<{ avatarType: string }>();
  const navigate = useNavigate();

  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isValid = VALID.includes(avatarType as AvatarType);

  useEffect(() => {
    if (!isValid) return;
    const sessionId = generateSessionId();
    const apiBase = import.meta.env.VITE_API_BASE_URL;

    fetch(`${apiBase}/api/livekit-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatarType, sessionId }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Token request failed: ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setToken(data.token);
        setServerUrl(data.serverUrl);
      })
      .catch((e) => setError(String(e)));
  }, [avatarType, isValid]);

  if (!isValid) {
    return <div>Unknown avatar type.</div>;
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <p>Couldn't start the conversation.</p>
          <p className="text-sm opacity-60 mt-2">{error}</p>
          <button onClick={() => navigate("/")} className="mt-4 underline">
            Back to home
          </button>
        </div>
      </div>
    );
  }

  if (!token || !serverUrl) {
    return (
      <div className="fixed inset-0 bg-black text-white flex items-center justify-center">
        Connecting…
      </div>
    );
  }

  return (
    <LiveKitRoom
      token={token}
      serverUrl={serverUrl}
      connect={true}
      audio={true}
      video={false} // we only need mic input; avatar publishes its own video
      className="fixed inset-0 bg-black"
    >
      <AvatarStage
        personaName={PERSONA_NAME[avatarType as AvatarType]}
        onEndCall={() => navigate("/")}
      />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

function AvatarStage({
  personaName,
  onEndCall,
}: {
  personaName: string;
  onEndCall: () => void;
}) {
  const state = useConnectionState();
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  const avatarTrack = tracks[0]; // first published camera track is the avatar

  return (
    <div className="relative w-full h-full">
      {avatarTrack ? (
        <VideoTrack
          trackRef={avatarTrack}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-white">
          <p>Waiting for {personaName}…</p>
        </div>
      )}

      {/* Overlay controls */}
      <div className="absolute top-4 left-4 text-white text-sm bg-black/50 px-3 py-1.5 rounded">
        {personaName}
      </div>

      <div className="absolute top-4 right-4 text-white text-xs bg-black/50 px-3 py-1.5 rounded">
        {state}
      </div>

      <button
        onClick={onEndCall}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-full font-medium"
      >
        End conversation
      </button>
    </div>
  );
}
```

This is a sketch, not final code. Lovable's existing Tailwind + shadcn setup may have nicer button patterns the agent should prefer. CC should match the project's existing styling patterns rather than writing Tailwind from scratch.

### 6e. Remove dead code

Delete `src/components/AvatarModal.tsx`. It's no longer used anywhere.

## 7. Implementation order

Agent first, then backend, then frontend — the order that lets each step be tested independently before moving on.

1. **`pace-agent/`**: §4a–4d. Test with the existing Playground flow (no browser client changes yet). Set metadata to `entrepreneurship_mentor`, ask a question, verify avatar video now appears in the Playground's video pane. ~1-2 credits.
2. **`pace-bot/`**: §5a–5d. Test with curl:
   ```bash
   SID=$(uuidgen | tr A-Z a-z)
   curl -s -X POST localhost:3000/api/livekit-token \
     -H 'content-type: application/json' \
     -d "{\"avatarType\":\"entrepreneurship_mentor\",\"sessionId\":\"$SID\"}"
   ```
   Expect a JSON response with `token`, `room`, `serverUrl`. No credits used.
3. **`pace-bot-front/`**: §6a–6e. Install deps, add route, write component, update landing page. Run `npm run dev`, verify landing page still loads unchanged, click one persona button, watch the `/live/...` route connect. ~2 credits for smoke test.

## 8. Smoke tests (credit-budget version)

All three services running: Postgres, `pace-bot`, `pace-agent`, `pace-bot-front`. Four terminals.

### Test 1 — Mentor end-to-end (~2 credits)

1. Open browser to `http://localhost:5173/`
2. Click "Start conversation" on the Entrepreneurship Mentor card
3. Expect: full-screen avatar view, "Connecting…" briefly, then the mentor avatar appears and says the greeting
4. Grant mic permission when prompted
5. Say exactly: *"What is kuleana?"*
6. Wait for the mentor to answer (the same reply we got via voice in M3b, now spoken by a face)
7. Click "End conversation"
8. Return to landing page

**Expected total session time:** 60-90 seconds. ~2 credits.

**Expected in `pace-agent` logs:**
- `session config: avatar_type=entrepreneurship_mentor`
- `liveavatar started: avatar_id=ab0765ad-...`
- `backend reply: tools=['search_documents', 'get_concept'] reply='...'`

### Test 2 — Guide end-to-end (~2 credits)

Same flow, different card. Click PACE Guide. Ask: *"What programs does PACE offer?"*. Expect the guide avatar with the graceful-empty-list reply from M3b.

### If Test 1 fails

Before burning credits on Test 2, diagnose Test 1:

- **Avatar never appears, agent logs `liveavatar start failed`:** check `LIVEAVATAR_API_KEY`, the avatar ID is valid on your account, and the LiveAvatar dashboard shows available credits.
- **Avatar appears but mute/silent:** agent TTS isn't reaching the LiveAvatar worker. Check agent logs for `say:` events.
- **Token request 400:** frontend is sending the wrong JSON shape. Check the browser's Network tab.
- **Token request returns but room connection fails:** likely a `LIVEKIT_URL` mismatch between frontend and backend. Both must point at the same Cloud project.

Don't re-run Test 1 unless you've identified and fixed something. Each unsuccessful attempt burns 1-2 credits.

## 9. Acceptance criteria

- [ ] All three services run: `pace-bot` on 3000, `pace-agent` registered with LiveKit Cloud, `pace-bot-front` on 5173
- [ ] Landing page unchanged in layout; two cards relabeled if needed; no iframe references
- [ ] Clicking Mentor card → `/live/entrepreneurship_mentor` → full-screen avatar appears
- [ ] Clicking Guide card → `/live/pace_guide` → different full-screen avatar appears
- [ ] Mentor answers curriculum question with concept-grounded reply from M2 backend
- [ ] Guide answers program question (or politely empty-list response from M2 backend)
- [ ] "End conversation" button returns to landing page cleanly, no console errors, LiveAvatar session closes (verify in LiveAvatar dashboard or agent logs)
- [ ] No secrets in browser bundle (`grep -r "LIVEKIT_API_SECRET\|ANTHROPIC_API_KEY" pace-bot-front/dist/`) — after `npm run build`
- [ ] Used 5 or fewer credits total
- [ ] Git: all three subprojects have clean commits, pushed to origin/main

## 10. Out of scope for M3c

- Avatar name/identification in LiveKit room (the LiveAvatar plugin auto-assigns)
- Mobile-responsive full-screen (desktop-first; we'll tune mobile in a later milestone)
- Transcript display on screen (the conversation is audio-only visible; add captions later)
- User account / auth (still anonymous)
- Multi-turn conversation history persistence (per-session only)
- Avatar selection UI — the routes lock in which persona each path uses
- Deployment (local-only; deployment is a separate milestone)
- Keyboard shortcuts, background ambient audio, custom voices
- Multi-user rooms (one user per room — the room name includes sessionId to enforce this)

## 11. Risks + open questions

**LiveAvatar cold-start time.** First connection to an avatar can take 3-8 seconds. The `Waiting for {personaName}…` placeholder handles this, but if it's consistently over 10 seconds, consider preloading.

**Room-name collision.** If two users hit the same avatar simultaneously, sessionIds make the room names unique. The agent handles one room per job, so this is fine — LiveKit will dispatch two agent workers for two rooms. At real-world concurrency you'd need to think about credit consumption across parallel sessions; for M3c single-developer testing, not a concern.

**Metadata and connection state timing.** The `LiveKitRoom` component connects immediately on mount, and the agent's `_resolve_avatar_type` reads participant metadata before greeting. This was a bug risk in M3b (guarded by a 5-second wait); make sure M3c doesn't regress. The fix: metadata is baked into the token we mint on the backend, so it's available the instant the participant connects. Nothing extra needed.

**Token TTL.** I set 10 minutes in §5b. Long enough for a conversation, short enough to limit damage if leaked. If real users have longer sessions in production, raise it; don't touch for M3c.

**Browser mic permission UX.** Chrome remembers permission per origin, but the first-ever click will prompt. The `LiveKitRoom` with `audio={true}` handles the prompt automatically; just be aware that the first local dev test will show the prompt and the user needs to accept.

**Video autoplay on Safari.** `<VideoTrack>` from livekit-components-react handles autoplay policies correctly in current versions, but if Safari shows a black frame until user gesture, that's known. Not blocking for M3c on Chrome.

**Stopping runaway sessions.** If the user closes the browser tab instead of clicking "End conversation," LiveKit still detects the disconnect and tears down the agent + avatar after ~30 seconds. During that window credits still tick. Not a bug, just a fact. For demos, teach users to click End.
