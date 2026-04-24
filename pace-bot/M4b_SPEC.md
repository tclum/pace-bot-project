# Milestone 4b — Text-only chat interface for content testing

Follow-on to M4a. Adds a password-gated text chat route that lets PACE staff rapidly validate mentor/guide answers without burning LiveAvatar credits or LiveKit minutes.

## 1. What M4b delivers

- A new `/test/:avatarType` route on the frontend: text input, message log, choice of persona
- Password gate on both the chat interface AND the existing `/live` routes — anyone hitting either page must enter the shared password first
- Backend accepts the password on the existing `/api/chat` endpoint (and on `/api/livekit-token`) and rejects unauthorized requests
- Zero new costs: reuses the existing `/api/chat` endpoint and backend stack; no new LiveKit/LiveAvatar/Deepgram calls

End state: you tell your boss "go to pace-bot-front-production.up.railway.app/test/entrepreneurship_mentor, password is `<whatever>`, ask the mentor anything, see its replies as text." He iterates on content validation at zero per-query cost. When he's ready for voice demos, same password unlocks `/live/*`.

## 2. Locked-in decisions

- **Static shared password.** One env-var-defined password. Same for everyone. Rotate by changing the env var.
- **No user accounts, no email, no login UI.** Just a password prompt. Enter it once, stored in browser session (`sessionStorage`), valid until tab closes.
- **Text route is read-only for the conversation.** No way to edit past messages, no export, no conversation history across sessions. Chat clears when you navigate away.
- **Uses the existing `/api/chat` endpoint unchanged, except for auth.** Same request/response shape the voice agent uses.
- **Password applies to both `/live` and `/test`.** Either route requires the same password. Landing page does NOT require password.
- **Password is a frontend gate AND a backend check.** Frontend gate keeps honest users out; backend check prevents someone bypassing the frontend and hitting the API directly.

## 3. Security properties

This is not real auth. It's a shared secret that exists to:

1. Slow down opportunistic abuse (someone who finds the URL can't casually spam Claude)
2. Create a psychological boundary ("I shouldn't be using this without the password")
3. Give a single kill-switch (rotate password, everyone logged out)

It does NOT protect against:
- Password sharing (anyone your boss tells can also tell others)
- Someone viewing the JS bundle — the password check lives in the backend too, but the frontend-side check can be bypassed by someone reading the code. The real protection is the server-side check.
- Rate limit exhaustion if your boss sends many queries (he's your main threat vector — but his use case is intentional validation, so fine)

For a public launch this would need real auth, rate limiting, and probably a per-user session model. For a boss demo, a shared password is appropriate.

## 4. Environment additions

### `pace-bot/.env` and `.env.example`

```
APP_PASSWORD=<pick a reasonable one>
```

Example good passwords: `kuleana-2026`, `aloha-pace-mentor`, `shidler-test-access`. Memorable, not guessable, word-based. Avoid "password123."

### `pace-bot-front/.env` and `.env.example`

No changes. The frontend does not need to know the password; it sends whatever the user types. The backend validates.

Note on the frontend: passwords going through a prompt are fine. We do NOT want to bake the password into the frontend bundle (which would expose it to anyone who views the JS).

## 5. Backend changes

### 5a. Password validation middleware

Create `pace-bot/src/middleware/password.ts`:

```ts
import type { FastifyRequest, FastifyReply } from "fastify";
import { env } from "../env.js";

export async function requirePassword(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = req.headers["x-app-password"];
  const provided = Array.isArray(header) ? header[0] : header;

  if (!provided || provided !== env.APP_PASSWORD) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
}
```

The password comes in as an HTTP header (`x-app-password`). Header-based is better than query-string (which would get logged) and simpler than a full auth scheme.

### 5b. Apply to protected routes

In `pace-bot/src/routes/chat.ts`, add the preHandler:

```ts
app.post("/api/chat", { preHandler: requirePassword }, async (req, reply) => {
  // ...existing handler unchanged
});
```

In `pace-bot/src/routes/livekit.ts`, same:

```ts
app.post("/api/livekit-token", { preHandler: requirePassword }, async (req, reply) => {
  // ...existing handler unchanged
});
```

Note that `/healthz` remains UNprotected — Railway uses it to check container health, and it returns no useful data.

### 5c. Env validation

`pace-bot/src/env.ts`:

```ts
APP_PASSWORD: z.string().min(1),
```

Server won't boot without a password set. Prevents accidentally deploying an unprotected backend.

## 6. Frontend changes

### 6a. Password prompt

Create `pace-bot-front/src/components/PasswordGate.tsx`. A wrapper component that:

1. On mount, reads password from `sessionStorage`
2. If missing, shows a password prompt (inline in the page, not a browser native prompt — shadcn Input + Button, inside a Card)
3. On submit, stores password in `sessionStorage` and renders children
4. Provides a hook `usePassword()` that child components can call to get the password to attach to API requests

Outline:

```tsx
import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PasswordContext = createContext<string | null>(null);

export function usePassword(): string {
  const password = useContext(PasswordContext);
  if (!password) throw new Error("usePassword must be used inside <PasswordGate>");
  return password;
}

export function PasswordGate({ children }: { children: ReactNode }) {
  const [password, setPassword] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem("pace_app_password");
    if (stored) setPassword(stored);
  }, []);

  const handleSubmit = () => {
    if (!input.trim()) {
      setError("Enter a password");
      return;
    }
    sessionStorage.setItem("pace_app_password", input.trim());
    setPassword(input.trim());
  };

  if (!password) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pace-navy-deep">
        <div className="bg-card p-8 rounded-lg shadow-lg max-w-md w-full">
          <h2 className="text-2xl font-bold mb-4">Enter password</h2>
          <p className="text-sm text-muted-foreground mb-4">
            This demo requires a shared password. If you don't have one, ask PACE.
          </p>
          <Input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="Password"
            autoFocus
          />
          {error && <p className="text-destructive text-sm mt-2">{error}</p>}
          <Button onClick={handleSubmit} className="w-full mt-4">
            Continue
          </Button>
        </div>
      </div>
    );
  }

  return (
    <PasswordContext.Provider value={password}>
      {children}
    </PasswordContext.Provider>
  );
}
```

Handles:
- First load: prompt appears
- Refresh: password persists via `sessionStorage` until the tab closes
- Wrong password: the backend returns 401 when the user tries to send a chat message; the chat page should catch that and tell the user "wrong password" — we'll handle that in the chat component

### 6b. Chat page

Create `pace-bot-front/src/pages/ChatTest.tsx`:

```tsx
import { useParams, useNavigate } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordGate, usePassword } from "@/components/PasswordGate";

type AvatarType = "pace_guide" | "entrepreneurship_mentor";
const VALID: AvatarType[] = ["pace_guide", "entrepreneurship_mentor"];
const PERSONA_NAME: Record<AvatarType, string> = {
  pace_guide: "PACE Guide",
  entrepreneurship_mentor: "Entrepreneurship Mentor",
};

type Message = {
  role: "user" | "assistant";
  content: string;
  tools?: string[];
};

function ChatContent({ avatarType }: { avatarType: AvatarType }) {
  const navigate = useNavigate();
  const password = usePassword();
  const [sessionId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { role: "user", content: trimmed };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);
    setError(null);

    const apiBase = import.meta.env.VITE_API_BASE_URL;
    if (!apiBase) {
      setError("VITE_API_BASE_URL not set at build time");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${apiBase}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-App-Password": password,
        },
        body: JSON.stringify({ sessionId, avatarType, message: trimmed }),
      });

      if (res.status === 401) {
        sessionStorage.removeItem("pace_app_password");
        setError("Password was rejected. Refresh to re-enter.");
        setLoading(false);
        return;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json() as { reply: string; toolsUsed: string[] };
      setMessages((m) => [...m, {
        role: "assistant",
        content: data.reply,
        tools: data.toolsUsed,
      }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate("/")}>
            ← Home
          </Button>
          <div>
            <h1 className="text-lg font-bold">{PERSONA_NAME[avatarType]}</h1>
            <p className="text-xs text-muted-foreground">Text-only test mode</p>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Session: {sessionId.slice(0, 8)}
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 max-w-3xl w-full mx-auto">
        {messages.length === 0 && (
          <p className="text-muted-foreground text-center pt-8">
            Ask {PERSONA_NAME[avatarType]} anything.
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                msg.role === "user"
                  ? "bg-pace-green text-primary-foreground"
                  : "bg-card border border-border"
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.content}</div>
              {msg.tools && msg.tools.length > 0 && (
                <div className="text-xs mt-2 opacity-60">
                  Tools: {msg.tools.join(", ")}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-card border border-border rounded-lg px-4 py-2 text-sm text-muted-foreground">
              Thinking…
            </div>
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-destructive/10 border-t border-destructive p-2 text-center text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border p-4 max-w-3xl w-full mx-auto">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder={`Ask ${PERSONA_NAME[avatarType]}…`}
            disabled={loading}
            autoFocus
          />
          <Button onClick={sendMessage} disabled={loading || !input.trim()}>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ChatTest() {
  const { avatarType } = useParams<{ avatarType: string }>();

  if (!avatarType || !VALID.includes(avatarType as AvatarType)) {
    return <div>Unknown avatar type.</div>;
  }

  return (
    <PasswordGate>
      <ChatContent avatarType={avatarType as AvatarType} />
    </PasswordGate>
  );
}
```

Notes for CC:
- The component is a sketch; match existing Lovable + shadcn patterns (it already does, but double-check colors/spacing match)
- The `VITE_API_BASE_URL` check mirrors the existing LiveAvatar.tsx pattern
- Session ID is per-page-load, not persisted — refreshing the page starts a new conversation. Deliberate for testing.
- `tools` display helps your boss see which backend tools were actually called (useful for debugging content gaps)

### 6c. Wrap existing `/live` route in PasswordGate

In `pace-bot-front/src/pages/LiveAvatar.tsx`, wrap the existing component:

```tsx
import { PasswordGate } from "@/components/PasswordGate";

// ... existing imports and code ...

export default function LiveAvatar() {
  return (
    <PasswordGate>
      <LiveAvatarContent />  {/* existing component renamed */}
    </PasswordGate>
  );
}
```

Rename the current `LiveAvatar` function to `LiveAvatarContent` and extract the `usePassword` call into the fetch:

```tsx
const password = usePassword();

// In the fetch:
fetch(`${apiBase}/api/livekit-token`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-App-Password": password,  // new
  },
  // ...
});
```

Handle 401 same way as ChatTest — clear stored password, show error.

### 6d. Route registration

In `pace-bot-front/src/App.tsx`:

```tsx
import ChatTest from "./pages/ChatTest.tsx";

// Inside Routes:
<Route path="/test/:avatarType" element={<ChatTest />} />
```

### 6e. Optional: link from landing page

If you want to make test mode discoverable to your boss, you could add a small "Test mode →" link in the footer or corner of the landing page. Low priority; you can just tell him the URL.

## 7. Deployment

Both services (backend + frontend) need redeployment after code changes. Railway handles auto-deploy on push.

### Set the password env var BEFORE pushing code

Otherwise the backend will fail to boot on first deploy with `APP_PASSWORD: required`. Order:

1. Railway → pace-bot service → Variables → Add `APP_PASSWORD=<your password>`. Save.
2. Push code. Backend redeploys with the new env var available. Works.

If you push code before setting the env var, the backend will crashloop until you add the var, then come back.

### Frontend does not need password in env

The frontend collects password from user input, not from env. Nothing to set in Railway for pace-bot-front.

## 8. Smoke tests

### Test 1 — Backend rejects unauth'd calls

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://pace-bot-production.up.railway.app/api/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"00000000-0000-0000-0000-000000000000","avatarType":"entrepreneurship_mentor","message":"hi"}'
```

Expected: `401`

### Test 2 — Backend accepts auth'd calls

```bash
SID=$(uuidgen | tr A-Z a-z)
curl -s -X POST https://pace-bot-production.up.railway.app/api/chat \
  -H "Content-Type: application/json" \
  -H "X-App-Password: <your password>" \
  -d "{\"sessionId\":\"$SID\",\"avatarType\":\"entrepreneurship_mentor\",\"message\":\"What is kuleana?\"}"
```

Expected: same reply as before (kuleana explanation).

### Test 3 — Test route in browser

- Visit `https://pace-bot-front-production.up.railway.app/test/entrepreneurship_mentor`
- Enter password
- Type "What is kuleana?" and press Enter
- See the mentor's reply appear as text, with tools listed below
- Refresh page — password persists (no re-prompt)
- Open in new tab — password persists there too (wait, no — `sessionStorage` is per-tab; new tab prompts again)

Actually: `sessionStorage` is per-tab-origin. Refresh preserves it; new tab loses it. For your use case, fine — each fresh tab asks for the password.

### Test 4 — Live route still works

- Visit `/live/entrepreneurship_mentor`
- Should also require password now
- Once entered (or if already entered in another page from same tab), proceeds to avatar

### Test 5 — Wrong password flow

- Enter wrong password on `/test`
- Send a message
- Expect: "Password was rejected. Refresh to re-enter."
- Refresh — re-prompts for password
- Enter correct — works

## 9. Acceptance criteria

- [ ] `APP_PASSWORD` env var set on backend
- [ ] Backend returns 401 for unauth'd `/api/chat` and `/api/livekit-token`
- [ ] Backend returns 200 with correct password header
- [ ] `/test/pace_guide` and `/test/entrepreneurship_mentor` routes load, password-prompted
- [ ] Text chat works end-to-end — send message, see reply, tools listed
- [ ] `/live/*` routes now require password too
- [ ] Landing page does NOT require password
- [ ] `/healthz` does NOT require password (Railway health checks still pass)
- [ ] Password stored per-tab via `sessionStorage`
- [ ] Rejected password shows error and allows retry
- [ ] Commit + push; Railway auto-deploys both services

## 10. Out of scope for M4b

- Per-user passwords or accounts
- Password hashing (it's plain text in env var, compared plain-text)
- Rate limiting on chat messages
- Conversation history persistence across sessions
- Export chat log
- Editing past messages
- Multi-user simultaneous chat
- Changing personas mid-conversation (use separate tabs)
- File upload / document ingestion from chat UI
- Admin UI for managing content
- Mobile-optimized chat layout (desktop-first like the rest of M4)

## 11. Risks + open questions

**Passwords leaking in logs.** Fastify logs requests by default. If it logs request headers, your password appears in plaintext in Railway's logs. Check `pace-bot/src/server.ts` logger config — likely uses `pino` with a default config that doesn't log bodies but may log headers. If headers are logged, add a redaction config. Cheap fix; worth verifying.

**Browser DevTools shows password in Network tab.** This is a reality of any header-based password. If your boss is on his laptop alone, fine. If he's screen-sharing in a meeting, someone with eagle eyes could catch it. Just be aware.

**`sessionStorage` scope.** Per tab, same origin. New tab = re-prompt. This is fine for testing but your boss might find it annoying after the tenth re-entry. If so, switch to `localStorage` (persists across tabs and browser sessions until manually cleared). Trade-off: `localStorage` is more convenient but password stays until he explicitly clears it, including after closing the laptop.

**Password rotation.** Changing `APP_PASSWORD` in Railway requires a backend redeploy (picks up new env var) and everyone needs the new password. `sessionStorage` values don't auto-invalidate — users will continue trying the old password, get 401, be confused, clear and retry. Consider this when you rotate.

**Interaction with M4a's error handling.** The existing LiveAvatar.tsx shows `"Couldn't start the conversation"` on fetch errors including 401. After M4b, a 401 there means "password wrong" not "generic error." The updated LiveAvatar component should handle 401 specifically, same as ChatTest does.

**CORS headers on 401.** When the backend returns 401, CORS headers still need to be correct or the browser swallows the response. Fastify's CORS plugin handles this by default; just flagging it as a thing that could go wrong.

**APP_PASSWORD in the frontend bundle (don't).** If CC accidentally adds `VITE_APP_PASSWORD` somewhere, it'll end up baked into the public JS bundle — which means anyone can read it. CC should not do this, but worth noting since it's an easy mistake. The password flows from user input → runtime header → backend env var → backend comparison. Never through the build.

**Authentication ≠ authorization.** The password lets you in. It doesn't track WHO you are or WHAT you can do. For M4b this is fine — one password, one role (tester). For a multi-role future (staff can see everything, students can only chat), you'd need a real auth system.
