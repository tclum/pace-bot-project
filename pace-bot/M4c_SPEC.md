# Milestone 4c — Three-column response comparison in text chat

Adds a side-by-side comparison to `/test/:avatarType` so your boss (and anyone else testing content) can see three responses to every question: the current grounded product, a version with guardrails relaxed, and raw Claude with no context at all.

## 1. What M4c delivers

- `/test/:avatarType` chat interface shows three columns per response instead of one
- User sends one question → app fires three parallel requests → three responses render side-by-side as they arrive
- Three column modes, each clearly labeled:
  - **Current product default** — existing guarded behavior with RAG tools
  - **Guardrails off** — same tools, but permitted to improvise when tools return nothing
  - **Pure Claude** — no system prompt, no tools, no persona, just the question
- Voice/avatar flow unchanged
- Password protection unchanged; each column still goes through `/api/chat` (password-gated)

End state: your boss types "What programs does PACE offer?" once, sees three responses side-by-side. He can spot which answer is grounded truth ("no programs on record") versus what Claude invents when allowed to ("PACE Ventures, Shidler Entrepreneurship Program..." — some real, some confabulated) versus what Claude generally "knows" about PACE from training.

## 2. Locked-in decisions

- **Comparison ONLY on `/test/:avatarType`.** Voice stays single-response, guarded.
- **One endpoint with a `mode` param** (not three separate endpoints). `/api/chat` gets a new `mode: "guarded" | "unguarded" | "raw"` field.
- **Parallel requests.** Frontend fires all three at once via `Promise.allSettled`, shows each response as it resolves.
- **Column labels**: "Current product default" / "Guardrails off" / "Pure Claude".
- **Same password** applies to all three modes — no special auth for the new modes.
- **Session isolation**: all three modes share the same `sessionId` per question but do NOT share conversation history across modes. Each call creates a fresh history for that mode. (This is important: carrying history between guarded and unguarded would give weird results where Claude sees its own unguarded response in the guarded prompt's context.)

## 3. Cost profile

Each question now costs roughly 2.5x what it did:
- Guarded: existing cost (1 Claude call + N tool calls)
- Unguarded: ~same as guarded (1 Claude call + N tool calls, possibly fewer if Claude skips tools to improvise)
- Pure Claude: cheaper (1 Claude call, no tools)

For your boss testing a dozen questions, this is a few dollars of Anthropic API usage. Tiny compared to the rest of the stack. Flagged so you're not surprised by the line item.

## 4. Backend changes

### 4a. Update request schema

In `pace-bot/src/routes/chat.ts`, add the mode field to the Zod body schema:

```ts
const bodySchema = z.object({
  avatarType: z.enum(avatarTypes),
  sessionId: z.string().uuid(),
  message: z.string().min(1).max(4000),
  mode: z.enum(["guarded", "unguarded", "raw"]).default("guarded"),
});
```

`.default("guarded")` keeps the voice agent working unchanged — it doesn't send `mode` and gets the current behavior.

### 4b. Route mode to different handlers

In the same file, branch on mode before calling `runChat`:

```ts
const { avatarType, sessionId, message, mode } = parsed.data;

let reply: string;
let toolsUsed: string[];

if (mode === "raw") {
  // Pure Claude — no system prompt, no tools
  const result = await runRawClaude(message);
  reply = result.reply;
  toolsUsed = [];
} else if (mode === "unguarded") {
  const result = await runChat(sessionId, avatarType, message, { unguarded: true });
  reply = result.reply;
  toolsUsed = result.toolsUsed;
} else {
  const result = await runChat(sessionId, avatarType, message);
  reply = result.reply;
  toolsUsed = result.toolsUsed;
}

return reply.send({ reply, toolsUsed, mode });
```

Return `mode` in the response so the frontend can verify it got what it asked for.

### 4c. Add `unguarded` prompt variants

Create `pace-bot/src/avatars/prompts-unguarded.ts`:

```ts
// Stripped-down versions of the persona prompts: same framing and persona,
// but WITHOUT the "only use tool results" rule. Claude is permitted to
// improvise from training knowledge when tools return empty or partial data.

export const PACE_GUIDE_PROMPT_UNGUARDED = `You are the PACE Guide, representing the Pacific Asian Center for Entrepreneurship (PACE) at the University of Hawaiʻi at Mānoa. Speak warmly and professionally.

You have tools to look up PACE programs, events, and people. Use them when helpful.

If the tools return nothing relevant, you may answer from general knowledge. Be clear about what you're confident about versus guessing.

Keep responses concise (2-4 sentences).
`.trim();

export const MENTOR_PROMPT_UNGUARDED = `You are the Entrepreneurship Mentor at PACE, teaching concepts and philosophies rooted in Pacific-Asian and Native Hawaiian frameworks.

You have tools to look up curriculum concepts. Use them when helpful.

If the tools return nothing relevant, you may answer from general knowledge. Be clear about what you're confident about versus guessing.

Keep responses concise (3-5 sentences).
`.trim();
```

The key omissions from the current prompts:
- No "only use tool results" rule
- No "never fill gaps from general knowledge" rule
- No "decline politely if out of scope" rule

Persona framing kept so the response style still feels like mentor vs guide (not pure ChatGPT).

### 4d. Update `runChat` to accept unguarded option

In `pace-bot/src/services/anthropic.ts`, modify `runChat` to pick the prompt based on the option:

```ts
import { PACE_GUIDE_PROMPT, MENTOR_PROMPT } from "../avatars/prompts.js";
import {
  PACE_GUIDE_PROMPT_UNGUARDED,
  MENTOR_PROMPT_UNGUARDED,
} from "../avatars/prompts-unguarded.js";

export async function runChat(
  sessionId: string,
  avatarType: AvatarType,
  message: string,
  options?: { unguarded?: boolean },
): Promise<ChatResult> {
  const config = avatarRegistry[avatarType];

  const systemPrompt = options?.unguarded
    ? (avatarType === "pace_guide"
        ? PACE_GUIDE_PROMPT_UNGUARDED
        : MENTOR_PROMPT_UNGUARDED)
    : config.systemPrompt;

  // ... rest of function uses `systemPrompt` instead of `config.systemPrompt`
}
```

Session history handling: see §4f on isolation.

### 4e. Add `runRawClaude` function

In the same file, add:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env.js";

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export async function runRawClaude(message: string): Promise<{ reply: string }> {
  const response = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: message }],
    // No system prompt, no tools
  });

  // Extract text
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return { reply: text };
}
```

Simplest possible Claude call. No session tracking; each question is independent. This is deliberately minimal so it models "what Claude says when no one gives it context."

### 4f. Session isolation between modes

Current `runChat` uses `sessionId` to look up/store conversation history in an in-memory map. If user asks two questions in the same test session, Claude sees the prior exchange.

For M4c, we want each mode to have INDEPENDENT history. Options:

- **Option A**: namespace the session key by mode, e.g. `${sessionId}:guarded`, `${sessionId}:unguarded`. Modified `runChat` takes sessionId and mode, constructs key internally.
- **Option B**: reset history per mode by clearing the map entry before each call. Cleaner for this use case but loses multi-turn context within a mode.

Go with **Option A**. Users will ask follow-up questions and expect the grounded column to remember context; the unguarded column should have its own parallel memory.

In `runChat`:

```ts
const historyKey = options?.unguarded
  ? `${sessionId}:unguarded`
  : `${sessionId}:guarded`;
```

Replace all `sessionId` uses inside `runChat` that index the history map with `historyKey`.

`runRawClaude` doesn't track history at all — each call is independent. Simpler.

### 4g. Response shape

Each response from `/api/chat` now includes `mode`:

```ts
return reply.send({ reply, toolsUsed, mode });
```

Helps frontend assemble the three-column layout deterministically even if responses arrive out of order.

## 5. Frontend changes

### 5a. Update `ChatTest.tsx`

Transform the message log from one-message-per-send to three-responses-per-send.

New Message type:

```ts
type TripleResponse = {
  role: "user";
  content: string;
} | {
  role: "assistant-triple";
  userMessage: string;  // echo the question for context
  responses: {
    guarded: { reply: string; tools: string[]; loading: boolean; error?: string };
    unguarded: { reply: string; tools: string[]; loading: boolean; error?: string };
    raw: { reply: string; loading: boolean; error?: string };
  };
};
```

On send:

```ts
async function sendMessage() {
  // validation...

  // Add user message immediately
  setMessages((m) => [
    ...m,
    {
      role: "assistant-triple",
      userMessage: trimmed,
      responses: {
        guarded: { reply: "", tools: [], loading: true },
        unguarded: { reply: "", tools: [], loading: true },
        raw: { reply: "", loading: true },
      },
    },
  ]);

  const messageIndex = messages.length; // index of the new triple

  // Fire three parallel requests
  const modes = ["guarded", "unguarded", "raw"] as const;
  for (const mode of modes) {
    fetch(`${apiBase}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-App-Password": password },
      body: JSON.stringify({ sessionId, avatarType, message: trimmed, mode }),
    })
      .then(async (res) => {
        if (res.status === 401) throw new Error("AUTH");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setMessages((m) => {
          const copy = [...m];
          const triple = copy[messageIndex];
          if (triple?.role !== "assistant-triple") return m;
          triple.responses[mode] = {
            reply: data.reply,
            tools: data.toolsUsed ?? [],
            loading: false,
          };
          return copy;
        });
      })
      .catch((e) => {
        setMessages((m) => {
          const copy = [...m];
          const triple = copy[messageIndex];
          if (triple?.role !== "assistant-triple") return m;
          triple.responses[mode] = {
            ...triple.responses[mode],
            loading: false,
            error: e instanceof Error ? e.message : String(e),
          };
          return copy;
        });
        if (e.message === "AUTH") {
          sessionStorage.removeItem("pace_app_password");
          setError("Password was rejected. Refresh to re-enter.");
        }
      });
  }
}
```

### 5b. Render three columns

For each `assistant-triple` message, render:

```tsx
<div className="my-4">
  {/* User's question, centered above the columns */}
  <div className="text-center text-sm text-muted-foreground mb-3">
    {msg.userMessage}
  </div>

  {/* Three columns */}
  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
    <ResponseColumn
      title="Current product default"
      subtitle="Grounded, refuses when data missing"
      response={msg.responses.guarded}
      accent="green"
    />
    <ResponseColumn
      title="Guardrails off"
      subtitle="Same tools, allowed to improvise"
      response={msg.responses.unguarded}
      accent="gold"
    />
    <ResponseColumn
      title="Pure Claude"
      subtitle="No system prompt, no PACE context"
      response={msg.responses.raw}
      accent="navy"
    />
  </div>
</div>
```

### 5c. `ResponseColumn` component

Separate component for rendering each column's state:

```tsx
function ResponseColumn({
  title,
  subtitle,
  response,
  accent,
}: {
  title: string;
  subtitle: string;
  response: { reply: string; tools?: string[]; loading: boolean; error?: string };
  accent: "green" | "gold" | "navy";
}) {
  const accentBorder =
    accent === "green" ? "border-pace-green/40" :
    accent === "gold" ? "border-pace-gold/40" :
    "border-pace-navy/40";

  return (
    <div className={`border rounded-lg bg-card p-4 ${accentBorder}`}>
      <div className="text-xs font-semibold mb-1">{title}</div>
      <div className="text-xs text-muted-foreground mb-3">{subtitle}</div>

      {response.loading && (
        <div className="text-sm text-muted-foreground">Thinking…</div>
      )}
      {response.error && (
        <div className="text-sm text-destructive">Error: {response.error}</div>
      )}
      {!response.loading && !response.error && (
        <>
          <div className="text-sm whitespace-pre-wrap">{response.reply}</div>
          {response.tools && response.tools.length > 0 && (
            <div className="text-xs mt-2 opacity-60">
              Tools: {response.tools.join(", ")}
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

### 5d. Responsive behavior

`grid-cols-1 md:grid-cols-3` means:
- On mobile: columns stack vertically
- On desktop (≥768px): three columns side-by-side

For a demo, desktop-first is fine. Your boss will view on a computer.

### 5e. Update message list render

The existing render loop iterates `messages.map((msg, i) => ...)`. Update to branch on `msg.role`:

```tsx
{messages.map((msg, i) => {
  if (msg.role === "user") {
    // render user message as before
    return <UserMessage key={i} content={msg.content} />;
  }
  if (msg.role === "assistant-triple") {
    return <TripleResponse key={i} msg={msg} />;
  }
  return null;
})}
```

Note: we're NOT adding plain user messages to the list anymore — the user's question is now rendered centered above each triple. So on send, push an `assistant-triple` with the user's message embedded, not a separate user message.

Actually, simpler — just keep the current "user message appears first" pattern:

```ts
setMessages((m) => [
  ...m,
  { role: "user", content: trimmed },
  { role: "assistant-triple", userMessage: trimmed, responses: {...} },
]);
```

Two entries per send: user message (existing render), then triple (new render). No UX change to user's own bubble. Easier.

## 6. Implementation order

1. Backend `runChat` modifications (§4d, 4f) — keep backward compat
2. Backend `runRawClaude` (§4e)
3. Backend route changes (§4a, 4b)
4. Backend unguarded prompts (§4c)
5. Run backend locally and smoke-test all three modes via curl before touching frontend
6. Frontend `ChatTest.tsx` updates (§5a-e)
7. Local full-stack test: send one question, see three columns render

## 7. Smoke tests

### Backend-only via curl

```bash
# Guarded (same as before)
SID=$(uuidgen | tr A-Z a-z)
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "X-App-Password: <password>" \
  -d "{\"sessionId\":\"$SID\",\"avatarType\":\"pace_guide\",\"message\":\"What programs does PACE offer?\",\"mode\":\"guarded\"}"

# Unguarded (same sessionId, will use namespaced history)
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "X-App-Password: <password>" \
  -d "{\"sessionId\":\"$SID\",\"avatarType\":\"pace_guide\",\"message\":\"What programs does PACE offer?\",\"mode\":\"unguarded\"}"

# Raw (sessionId ignored)
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "X-App-Password: <password>" \
  -d "{\"sessionId\":\"$SID\",\"avatarType\":\"pace_guide\",\"message\":\"What programs does PACE offer?\",\"mode\":\"raw\"}"
```

Expected behavior:
- Guarded: "I don't have anything in my resources about programs..." (graceful fallback)
- Unguarded: A paragraph listing program names, possibly a mix of real and plausible-sounding inventions
- Raw: A longer response with no PACE-specific grounding, general knowledge-only

### Frontend

- Visit `/test/pace_guide` locally
- Enter password
- Ask "What programs does PACE offer?"
- See three columns render, each with appropriate content
- First one (guarded) should say "no programs on record" (correct for empty DB)
- Second (unguarded) should attempt real answer
- Third (raw) should give a general Claude response

### Backward compat

The voice agent still sends requests to `/api/chat` without a `mode` field. Verify that the voice flow still works end-to-end (make a single voice test, ~2 credits) after M4c is deployed. The `.default("guarded")` on the schema should keep this working.

## 8. Acceptance criteria

- [ ] Backend accepts `mode` in request body; defaults to `"guarded"` if absent
- [ ] Three modes produce different responses for the same question
- [ ] Session history is isolated per mode (guarded and unguarded maintain separate conversation context)
- [ ] `/test/:avatarType` renders three columns per question
- [ ] Three columns load in parallel; loading indicator shows per column
- [ ] Tools used are listed under guarded + unguarded columns (not raw)
- [ ] Errors in one column don't prevent others from rendering
- [ ] Voice agent still works unchanged (no `mode` sent → guarded path used)
- [ ] Password protection still works; 401 still clears session
- [ ] Deployed to Railway, both backend + frontend services green
- [ ] Boss can open `/test/pace_guide`, ask a question, see the comparison he asked for

## 9. Out of scope for M4c

- 4+ mode comparisons (if you want a fourth later, straightforward to add)
- Per-column "show tools details" expansion
- Copy-to-clipboard buttons on each response
- Saving/exporting comparisons
- Mobile layout polish (single-column stacking works but could be prettier)
- Editing past messages and regenerating
- Diff highlighting between columns
- Rate limiting
- Chat history persistence across page loads

## 10. Risks + open questions

**Prompt drift risk.** We now have two sets of prompts (`prompts.ts` and `prompts-unguarded.ts`). When the real prompts are updated, the unguarded versions might not be kept in sync. Since unguarded is a dev/test feature and not production behavior, this is probably fine — but worth noting.

**Voice agent breaking if response shape changes.** The new `mode` field in the response is additive, so the agent's `data["reply"]` still works. But if we ever stop returning `toolsUsed`, the agent's logging breaks. Keep the shape additive-only.

**Cost monitoring.** With 2.5x cost per test-mode query, watch your Anthropic usage in the first few days. If your boss fires off 100 questions, that's a few hundred calls. Still cheap, but not free.

**Mode `unguarded` still uses PACE persona prompts.** The unguarded variants keep the "you are PACE Guide" / "you are Entrepreneurship Mentor" framing. If we wanted a version that was "same tools, no persona," that'd be a fourth mode. Not in scope.

**Session-ID semantics.** `raw` mode ignores sessionId entirely. A user asking three questions in "raw" mode gets three independent Claude calls. Different from guarded where the same sessionId accumulates history. Not a bug; worth documenting so testers understand why raw mode "doesn't remember" earlier questions.

**CC code gen risk.** This spec has more moving parts than M4b. CC might forget to update the response shape or mis-name a function. Verify the backend first via curl before touching the frontend; then you know the three modes work individually before adding UI on top.

**The unguarded prompts are my guesses.** The specific wording I drafted for `PACE_GUIDE_PROMPT_UNGUARDED` and `MENTOR_PROMPT_UNGUARDED` (§4c) is a draft. If the unguarded responses end up too similar to guarded (both saying "no data"), the prompts need more explicit "when tools return nothing, answer from general knowledge" language. Tune based on actual behavior after first test.

**Raw Claude responses may be longer.** Without our "keep concise" instruction, raw Claude often writes paragraph-long answers. This could make the three-column layout imbalanced. If it becomes ugly, add a "be concise, 2-4 sentences" instruction to `runRawClaude`. But for a demo of "what's the floor," verbose might actually be useful — shows Claude's raw tendency.
