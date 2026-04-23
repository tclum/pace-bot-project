# LiveAvatar Backend — Build Spec

A backend service that powers a HeyGen LiveAvatar with Claude, RAG over documents, and structured database queries.

## 1. High-level architecture

```
Browser (HeyGen Streaming SDK)
   │
   │  (1) GET session token
   │  (2) POST user utterance
   ▼
Backend (Fastify + TypeScript)
   │
   ├── /api/token  ──► HeyGen streaming.create_token
   └── /api/chat   ──► Anthropic Claude (tool use loop)
                         │
                         ├── tool: search_documents  ──► Postgres (pgvector) via Voyage embedding
                         └── tool: query_database    ──► Postgres (structured tables)
```

HeyGen is running in **Lite Mode** conceptually: the browser's HeyGen SDK is just the avatar "body." All reasoning happens server-side in `/api/chat`, and the text result is sent to the avatar via `avatar.speak({ text, taskType: REPEAT })` on the client.

## 2. Tech stack

| Layer | Choice | Why |
|------|------|-----|
| Runtime | Node.js 20+ | LTS, native fetch, matches HeyGen SDK |
| Language | TypeScript 5+ | Type safety, same language as HeyGen SDK |
| Web framework | Fastify 4 | Native TS support, faster than Express, good plugin system |
| LLM | Claude via `@anthropic-ai/sdk` | Per requirements |
| Embeddings | Voyage AI (`voyage-3` or `voyage-3-large`) | Anthropic's recommended embedding partner |
| Database | Postgres 16 + pgvector | Single DB for structured + vector; lowest ops burden |
| ORM/Query | Drizzle ORM | Lightweight, TS-native, raw SQL escape hatch for pgvector |
| Validation | Zod | Schema validation for request bodies and tool inputs |
| Env config | dotenv + Zod-validated env | Catches missing config at boot |
| Testing | Vitest | Fast, TS-native |
| Logging | Pino (Fastify default) | Structured JSON logs |

## 3. Project structure

```
liveavatar-backend/
├── src/
│   ├── server.ts                 # Fastify bootstrap
│   ├── env.ts                    # Zod-validated env vars
│   ├── routes/
│   │   ├── token.ts              # POST /api/token
│   │   └── chat.ts               # POST /api/chat
│   ├── services/
│   │   ├── heygen.ts             # HeyGen token creation
│   │   ├── anthropic.ts          # Claude client + tool-use loop
│   │   ├── embeddings.ts         # Voyage embedding calls
│   │   └── retrieval.ts          # pgvector search + SQL queries
│   ├── tools/
│   │   ├── index.ts              # Tool registry (schemas + handlers)
│   │   ├── searchDocuments.ts    # RAG tool
│   │   └── queryDatabase.ts      # Structured query tool
│   ├── db/
│   │   ├── client.ts             # Postgres connection
│   │   ├── schema.ts             # Drizzle schema definitions
│   │   └── migrations/           # SQL migrations (incl. CREATE EXTENSION vector)
│   └── lib/
│       ├── chunker.ts            # Text chunking for ingestion
│       └── logger.ts             # Pino instance
├── scripts/
│   └── ingest.ts                 # CLI: read source docs → chunk → embed → upsert
├── .env.example
├── drizzle.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

## 4. Environment variables

```bash
# Server
PORT=3000
NODE_ENV=development
ALLOWED_ORIGIN=http://localhost:5173   # CORS for your frontend

# HeyGen
HEYGEN_API_KEY=...
HEYGEN_AVATAR_ID=...                   # default avatar for token creation
HEYGEN_VOICE_ID=...                    # optional, overridable per session

# Anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-opus-4-7        # or whichever you prefer

# Voyage
VOYAGE_API_KEY=...
VOYAGE_MODEL=voyage-3

# Postgres
DATABASE_URL=postgresql://user:pass@localhost:5432/liveavatar
```

`src/env.ts` parses these with Zod and throws at boot if any are missing.

## 5. API contracts

### POST /api/token
Generates a short-lived HeyGen session token for the browser. Called once per avatar session.

**Request:** `{}` (no body needed for MVP)

**Response:**
```json
{ "token": "eyJ..." }
```

Server-side: calls `POST https://api.heygen.com/v1/streaming.create_token` with `X-Api-Key: HEYGEN_API_KEY`.

### POST /api/chat
Accepts a user utterance (transcribed text from the browser's STT) and returns the avatar's reply text. Maintains conversation history per session.

**Request:**
```json
{
  "sessionId": "uuid-v4",
  "message": "What's the return policy on widgets?"
}
```

**Response:**
```json
{
  "reply": "Widgets can be returned within 30 days...",
  "toolsUsed": ["search_documents"]
}
```

**Implementation:** Runs the Claude tool-use loop described in §7. The response text is what the client will feed to `avatar.speak()`.

For MVP, store conversation history in memory keyed by `sessionId`. Upgrade path: Redis or a `conversations` table.

## 6. Database schema

```sql
-- Run once
CREATE EXTENSION IF NOT EXISTS vector;

-- Document store (for RAG)
CREATE TABLE documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source      TEXT NOT NULL,              -- filename, URL, or origin
  title       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE document_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content     TEXT NOT NULL,
  embedding   VECTOR(1024) NOT NULL,      -- voyage-3 dimension
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- HNSW is the recommended index for pgvector on recent versions
CREATE INDEX ON document_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON document_chunks (document_id);

-- Example structured tables (replace with your actual domain)
CREATE TABLE products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  price_cents INT NOT NULL,
  stock       INT NOT NULL DEFAULT 0
);

-- Optional: conversation persistence
CREATE TABLE conversations (
  session_id  UUID PRIMARY KEY,
  messages    JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Note: voyage-3 outputs 1024-dim vectors. If you switch to `voyage-3-large`, that's 1024 or 2048 depending on config — verify before setting the column dimension.

## 7. Claude tool-use loop

This is the heart of `/api/chat`. Claude decides which tool to call (if any), the backend executes it, and results are fed back until Claude produces a final text response.

### Tool definitions (sent to Claude on every request)

```ts
const tools = [
  {
    name: "search_documents",
    description: "Search the company's knowledge base of documents, FAQs, and policy pages. Use for unstructured or text-based questions (how-tos, policies, explanations, background info).",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Semantic search query" },
        top_k: { type: "integer", default: 5, maximum: 10 }
      },
      required: ["query"]
    }
  },
  {
    name: "query_database",
    description: "Look up structured records such as products, inventory, or orders. Use when the user asks for specific facts, counts, prices, or status of named entities.",
    input_schema: {
      type: "object",
      properties: {
        table: { type: "string", enum: ["products"] },
        filters: {
          type: "object",
          description: "Column → value equality filters. E.g. { sku: 'ABC-123' }."
        }
      },
      required: ["table"]
    }
  }
];
```

**Do not expose raw SQL to Claude.** The `query_database` tool takes a constrained shape (table name from an allow-list + equality filters) and the handler translates it to parameterized SQL. This prevents SQL injection and keeps the LLM from querying tables it shouldn't.

### The loop

```ts
async function runChat(sessionId: string, userMessage: string): Promise<string> {
  const history = getHistory(sessionId);
  history.push({ role: "user", content: userMessage });

  while (true) {
    const resp = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages: history
    });

    history.push({ role: "assistant", content: resp.content });

    if (resp.stop_reason === "end_turn") {
      const text = resp.content.find(b => b.type === "text")?.text ?? "";
      saveHistory(sessionId, history);
      return text;
    }

    if (resp.stop_reason === "tool_use") {
      const toolResults = await Promise.all(
        resp.content
          .filter(b => b.type === "tool_use")
          .map(async (block) => ({
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: await runTool(block.name, block.input)
          }))
      );
      history.push({ role: "user", content: toolResults });
      continue;  // let Claude decide what to do with the results
    }

    throw new Error(`Unexpected stop_reason: ${resp.stop_reason}`);
  }
}
```

Safety cap: add a max-iteration guard (e.g. 6 loops) so a misbehaving model can't run indefinitely.

## 8. System prompt

The system prompt needs to enforce constraints that matter for spoken output on a HeyGen avatar.

```
You are the voice of [COMPANY NAME]'s interactive avatar.

You have access to two tools:
- search_documents: for policy, how-to, and general information questions
- query_database: for specific structured data (products, inventory, etc.)

Rules for every response:
1. Keep replies to 3 sentences or fewer. You are being spoken out loud.
2. Use short sentences — 20 words max per sentence where possible.
3. Don't introduce yourself unless it's the first message of the conversation or the user asks.
4. If you don't know something and your tools can't find it, say so briefly. Don't invent details.
5. Never read out IDs, long URLs, or raw JSON. Summarize in natural speech.
6. Decline politely if asked about topics outside the knowledge base.

Call tools when you need specific information. Otherwise respond directly.
```

The 3-sentence rule matches HeyGen's own recommendation and their 1,000-character task limit.

## 9. Ingestion pipeline (`scripts/ingest.ts`)

A CLI for adding documents to the RAG store.

```
npm run ingest -- ./docs/policies.md --title "Policies"
npm run ingest -- ./docs/ --recursive
```

Steps per file:
1. Read file (support .md, .txt, .html, .pdf).
2. Chunk into ~500-token segments with ~50-token overlap. Prefer paragraph boundaries.
3. Embed each chunk via Voyage API (batch of 128).
4. Insert `documents` row, then bulk-insert `document_chunks`.

Chunking library suggestion: write a small utility in `src/lib/chunker.ts`. Don't overreach — start with paragraph-based splitting and a hard token cap.

## 10. Security & operational notes

- **Never ship the HeyGen or Anthropic API key to the browser.** Both stay server-side; the browser only ever receives the short-lived HeyGen session token from `/api/token`.
- **CORS**: restrict `/api/*` to your known frontend origin via `ALLOWED_ORIGIN`.
- **Rate limiting**: add `@fastify/rate-limit` — at least 60 req/min per IP on `/api/chat`.
- **Input length**: cap `message` at 2,000 characters server-side. Users won't speak paragraphs but bots might.
- **Tool arg validation**: Zod-validate every tool input before executing it. Don't trust the model.
- **SQL**: the `query_database` handler uses parameterized queries only. Column/table names come from allow-lists, never from model output directly.
- **Logging**: log `sessionId`, tool names, and latency. Don't log full user messages or Claude responses in production without a PII review.
- **Timeouts**: 20s timeout on Anthropic calls, 5s on Voyage and DB queries.

## 11. First milestone (what to build in the first Claude Code session)

1. `package.json`, `tsconfig.json`, `.env.example`, `drizzle.config.ts`.
2. `src/env.ts` with Zod-validated config.
3. `src/server.ts` — Fastify boot with CORS, rate limit, health check at `/healthz`.
4. `src/routes/token.ts` — working HeyGen token proxy.
5. `src/db/` — Drizzle schema + first migration (vector extension, `documents`, `document_chunks`).
6. `src/services/embeddings.ts` — Voyage client with batching.
7. `scripts/ingest.ts` — ingest a single `.md` file end-to-end.
8. `src/tools/searchDocuments.ts` + `src/services/retrieval.ts` — return top-k chunks given a query.
9. `src/services/anthropic.ts` + `src/routes/chat.ts` — the tool-use loop with just `search_documents`.
10. Smoke test: `curl` a question, see Claude call the tool, get a 3-sentence answer.

Add `query_database` and `products` table in milestone 2, once RAG works end-to-end.

## 12. Out of scope for this backend

- The browser-side HeyGen SDK integration (separate project).
- Speech-to-text — HeyGen handles mic input and transcription; your backend just receives text.
- Any UI.
- Authentication/users — add if the avatar is behind a login; skip for public kiosks/demos.
