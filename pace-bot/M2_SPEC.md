# Milestone 2 — Two avatars, structured data, corpus routing

Additive to `SPEC.md`. Builds on the M1 codebase.

## 1. What M2 adds

1. Two distinct avatar personas sharing one backend:
   - `pace_guide` — answers questions about PACE as an organization (programs, events, people, how to get involved)
   - `entrepreneurship_mentor` — teaches concepts and philosophies from PACE's curriculum
2. Structured tables: `programs`, `events`, `people`, `concepts`
3. A `corpus` column on `document_chunks` so org and curriculum content don't bleed into each other
4. New tools: `list_programs`, `get_program`, `get_upcoming_events`, `find_person`, `list_concepts`, `get_concept`, `get_related_concepts`
5. An avatar registry that maps each `avatarType` → {system prompt, allowed tools, corpus, HeyGen avatar/voice IDs}
6. JSON-based ingest scripts for the structured tables
7. Updates to `/api/token` and `/api/chat` to accept `avatarType`

Nothing in M1 is removed. The M1 `search_documents` tool gets a server-side corpus filter added — its schema (what Claude sees) does not change.

## 2. Schema additions — migration `0001_m2.sql`

```sql
-- Corpus tagging for existing doc pipeline
ALTER TABLE documents ADD COLUMN corpus TEXT NOT NULL DEFAULT 'org'
  CHECK (corpus IN ('org', 'curriculum'));
ALTER TABLE document_chunks ADD COLUMN corpus TEXT NOT NULL DEFAULT 'org'
  CHECK (corpus IN ('org', 'curriculum'));
CREATE INDEX ON document_chunks (corpus);

-- PACE programs
CREATE TABLE programs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                TEXT UNIQUE NOT NULL,
  name                TEXT NOT NULL,
  category            TEXT NOT NULL
                      CHECK (category IN ('accelerator','competition','leadership','workshop','grant','other')),
  short_description   TEXT NOT NULL,
  long_description    TEXT,
  eligibility         TEXT,
  application_url     TEXT,
  next_deadline       DATE,
  award_amount_min    INT,
  award_amount_max    INT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON programs (category) WHERE is_active = TRUE;

-- Events tied (optionally) to a program
CREATE TABLE events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id          UUID REFERENCES programs(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  description         TEXT,
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ,
  location            TEXT,
  registration_url    TEXT,
  is_public           BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX ON events (starts_at);
CREATE INDEX ON events (program_id);

-- Staff, leadership, mentors
CREATE TABLE people (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                TEXT UNIQUE NOT NULL,
  name                TEXT NOT NULL,
  role                TEXT NOT NULL,               -- "Executive Director", "PACE Leader", "Mentor"
  bio                 TEXT,
  program_slugs       TEXT[] NOT NULL DEFAULT '{}',
  email_public        TEXT,
  is_current          BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX ON people USING gin (program_slugs);

-- Curriculum concepts and philosophies
CREATE TABLE concepts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    TEXT UNIQUE NOT NULL,
  name                    TEXT NOT NULL,
  category                TEXT NOT NULL
                          CHECK (category IN ('mindset','framework','cultural','practice')),
  short_definition        TEXT NOT NULL,           -- ≤200 chars, spoken-friendly
  long_explanation        TEXT NOT NULL,           -- 1-3 paragraphs
  pacific_asian_context   TEXT,                    -- how this is rooted in / applies to the region
  example_ventures        JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{name, note}]
  related_concept_slugs   TEXT[] NOT NULL DEFAULT '{}',
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON concepts (category);
CREATE INDEX ON concepts USING gin (related_concept_slugs);
```

Notes:
- `corpus` column defaults to `'org'` so existing M1 data migrates cleanly; re-run the ingest script with `--corpus curriculum` for any curriculum docs.
- Concepts also show up in `document_chunks` with `corpus='curriculum'` — see §6.
- `program_slugs` on `people` uses a Postgres array with a GIN index so we can query "who runs the accelerator?" with `WHERE 'accelerator' = ANY(program_slugs)`.

## 3. Data file formats

Seed data lives in `data/` and is git-tracked. One file per entity type. All files are JSON for consistency and to avoid CSV quoting headaches.

### `data/programs.json`
```json
[
  {
    "slug": "uh-venture-competition",
    "name": "UH Venture Competition",
    "category": "competition",
    "short_description": "Annual pitch competition open to all UH campuses, with semifinalists representing 20+ disciplines.",
    "long_description": "Optional longer write-up used by search_documents.",
    "eligibility": "UH students, faculty, staff, alumni from any of the 10 UH campuses.",
    "application_url": "https://pace.shidler.hawaii.edu/...",
    "next_deadline": "2026-02-15",
    "award_amount_min": 500,
    "award_amount_max": 25000,
    "is_active": true
  }
]
```

### `data/events.json`
```json
[
  {
    "program_slug": "kalo-grant",
    "name": "Kalo Grant Live Pitch — Spring Finale",
    "description": "Student teams compete live for $1,000 grants; audience votes.",
    "starts_at": "2026-05-03T18:00:00-10:00",
    "ends_at": "2026-05-03T20:00:00-10:00",
    "location": "Walter Dods Jr. RISE Center",
    "registration_url": "https://...",
    "is_public": true
  }
]
```
`program_slug` is resolved to `program_id` at ingest time; missing slugs log a warning and insert a null program_id.

### `data/people.json`
```json
[
  {
    "slug": "sandra-fujiyama",
    "name": "Sandra Fujiyama",
    "role": "Executive Director",
    "bio": "Leads PACE; named a 2024 PBN Power Leader.",
    "program_slugs": [],
    "email_public": null,
    "is_current": true
  }
]
```

### `data/concepts.json`
```json
[
  {
    "slug": "kuleana-driven-venture",
    "name": "Kuleana-driven venture",
    "category": "cultural",
    "short_definition": "Building a company as an act of stewardship — responsibility to place, people, and future.",
    "long_explanation": "Full paragraphs covering how PACE teaches this concept, how it contrasts with growth-at-all-costs models, and when founders apply it in practice.",
    "pacific_asian_context": "Kuleana is a Native Hawaiian concept of reciprocal responsibility. Applied to entrepreneurship, it frames the founder's role as a steward rather than an owner.",
    "example_ventures": [
      { "name": "Example Co.", "note": "Returns a portion of revenue to watershed restoration." }
    ],
    "related_concept_slugs": ["pono-economics", "place-based-design"]
  }
]
```

Validation: every file is parsed against a Zod schema at ingest time. Errors abort the script with a line pointer.

## 4. Avatar registry — `src/avatars/registry.ts`

```ts
export type AvatarType = "pace_guide" | "entrepreneurship_mentor";
export type Corpus = "org" | "curriculum";

export interface AvatarConfig {
  systemPrompt: string;
  allowedTools: string[];
  corpus: Corpus;
  heygenAvatarId: string;
  heygenVoiceId?: string;
}

export const avatarRegistry: Record<AvatarType, AvatarConfig> = {
  pace_guide: {
    systemPrompt: PACE_GUIDE_PROMPT,
    allowedTools: [
      "search_documents",
      "list_programs",
      "get_program",
      "get_upcoming_events",
      "find_person"
    ],
    corpus: "org",
    heygenAvatarId: env.HEYGEN_AVATAR_ID_PACE_GUIDE,
    heygenVoiceId: env.HEYGEN_VOICE_ID_PACE_GUIDE
  },
  entrepreneurship_mentor: {
    systemPrompt: MENTOR_PROMPT,
    allowedTools: [
      "search_documents",
      "list_concepts",
      "get_concept",
      "get_related_concepts"
    ],
    corpus: "curriculum",
    heygenAvatarId: env.HEYGEN_AVATAR_ID_MENTOR,
    heygenVoiceId: env.HEYGEN_VOICE_ID_MENTOR
  }
};
```

Add to `.env.example`:
```bash
HEYGEN_AVATAR_ID_PACE_GUIDE=...
HEYGEN_VOICE_ID_PACE_GUIDE=...
HEYGEN_AVATAR_ID_MENTOR=...
HEYGEN_VOICE_ID_MENTOR=...
```
The M1 `HEYGEN_AVATAR_ID` / `HEYGEN_VOICE_ID` become fallback defaults only.

## 5. Tool additions

All tools return JSON that Claude sees as a `tool_result`. Keep payloads small — trim long fields for list endpoints and only include them in the `get_*` variants.

### search_documents (modified — schema unchanged, handler updated)
Handler now takes `corpus` as a second argument (injected by the chat route from the avatar config) and adds `WHERE corpus = $1` to the pgvector query. Claude doesn't see this parameter.

### list_programs
```ts
{
  name: "list_programs",
  description: "List PACE programs, optionally filtered by category. Use when the user asks what programs exist, or wants an overview by type (accelerators, competitions, etc.).",
  input_schema: {
    type: "object",
    properties: {
      category: { type: "string", enum: ["accelerator","competition","leadership","workshop","grant","other"] },
      active_only: { type: "boolean", default: true }
    }
  }
}
```
Returns: array of `{ slug, name, category, short_description, next_deadline }`. Long fields and URLs omitted.

### get_program
```ts
{
  name: "get_program",
  description: "Get full details for one PACE program. Prefer slug when you know it; use name for fuzzy lookup.",
  input_schema: {
    type: "object",
    properties: {
      slug: { type: "string" },
      name: { type: "string" }
    }
  }
}
```
Handler tries slug first, then ILIKE on name. Returns the full row.

### get_upcoming_events
```ts
{
  name: "get_upcoming_events",
  description: "List upcoming public PACE events.",
  input_schema: {
    type: "object",
    properties: {
      within_days: { type: "integer", default: 30, minimum: 1, maximum: 180 },
      program_slug: { type: "string" }
    }
  }
}
```
Handler filters `starts_at >= now()` and `is_public = true`. Joins `programs` to resolve slug → id.

### find_person
```ts
{
  name: "find_person",
  description: "Look up a PACE staff member, leader, or mentor by name or role.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      role: { type: "string" }
    }
  }
}
```
Returns: up to 5 matches with `{ name, role, bio, program_slugs }`.

### list_concepts
```ts
{
  name: "list_concepts",
  description: "List entrepreneurship concepts from PACE's curriculum. Use when the user asks what's in the curriculum or wants a category overview.",
  input_schema: {
    type: "object",
    properties: {
      category: { type: "string", enum: ["mindset","framework","cultural","practice"] }
    }
  }
}
```
Returns: `{ slug, name, category, short_definition }[]`.

### get_concept
```ts
{
  name: "get_concept",
  description: "Get the full explanation for a concept by slug (preferred) or name.",
  input_schema: {
    type: "object",
    properties: {
      slug: { type: "string" },
      name: { type: "string" }
    }
  }
}
```
Returns the full row including `pacific_asian_context`, `example_ventures`, `related_concept_slugs`.

### get_related_concepts
```ts
{
  name: "get_related_concepts",
  description: "Given a concept slug, return the concepts it links to. Useful for 'tell me more' or 'what else is connected to this?'",
  input_schema: {
    type: "object",
    properties: { slug: { type: "string" } },
    required: ["slug"]
  }
}
```
Returns: `{ slug, name, short_definition }[]` — just enough for Claude to offer next steps.

## 6. Concept ingestion — dual-write

`scripts/ingest-concepts.ts` does both:
1. Upsert the structured row into `concepts` (on conflict by `slug`, update all fields).
2. Upsert a corresponding chunk into `document_chunks` with `corpus='curriculum'` and a synthetic document per concept.

The chunk content is assembled as:
```
# {name}

{short_definition}

{long_explanation}

Pacific-Asian context: {pacific_asian_context}
```
The chunk metadata includes `{ source_type: "concept", concept_slug, concept_id }` so retrieval can recognize concept hits and Claude can follow up with `get_concept`.

Rationale: lets `search_documents` (semantic) and `get_concept` (exact) cooperate. A user asking "what does PACE teach about stewardship?" hits the concept via semantic search; a user asking "tell me about kuleana-driven ventures" hits it via `get_concept`.

When a concept is deleted from `data/concepts.json`, the ingest script removes both the structured row and its associated chunks (look up by `metadata->>'concept_slug'`).

## 7. API changes

### POST /api/token (modified)

Request:
```json
{ "avatarType": "pace_guide" }
```
Response unchanged. The backend looks up `avatarRegistry[avatarType]` and passes `avatar_id` and `voice` to HeyGen's `streaming.create_token` call.

Invalid or missing `avatarType` → 400.

### POST /api/chat (modified)

Request:
```json
{
  "sessionId": "uuid",
  "avatarType": "pace_guide",
  "message": "When's the next Kalo Grant pitch?"
}
```
Response:
```json
{
  "reply": "The next Kalo Grant pitch is May 3rd at the RISE Center — register online and come vote.",
  "toolsUsed": ["get_upcoming_events"]
}
```

The chat handler:
1. Looks up `avatarRegistry[avatarType]`.
2. Filters the tool list passed to Claude to `allowedTools`.
3. Uses the avatar's `systemPrompt`.
4. For `search_documents` calls, injects `corpus` into the handler.
5. The sessionId → history map is per-avatar-type to avoid leaking context between personas. Key = `${avatarType}:${sessionId}`.

Rate limit stays 60/min/IP across both endpoints.

## 8. System prompts

Store as constants in `src/avatars/prompts.ts`. Full text below.

### `PACE_GUIDE_PROMPT`
```
You are the voice of PACE — the Pacific Asian Center for Entrepreneurship — at the University of Hawaiʻi at Mānoa's Shidler College of Business. PACE is housed in the Walter Dods Jr. RISE Center.

Your audience is UH students, and sometimes faculty, staff, or alumni, who want to learn what PACE offers and how to get involved.

Your tools let you look up programs, upcoming events, staff and mentors, and longer-form reference documents.

How you answer:
1. Keep replies to three sentences or fewer. You are being spoken aloud.
2. Keep sentences short — roughly 20 words or less when possible.
3. When you mention a program, add one concrete next step: who can apply, when the next deadline is, or the fact that there's a link the user can follow.
4. Do not read out URLs or email addresses. Say something like "I can point you to the link" and let the interface surface it.
5. If you don't know something, say so briefly. Do not invent deadlines, people, or award amounts.
6. Decline politely if asked about anything outside PACE.

Pronunciation tips: "Mānoa" = mah-NO-ah. "Shidler" = SHID-ler. "PACE" is spoken like the English word.

Tone: warm, encouraging, local. PACE is a place that wants students to try things, so sound like someone who means that.
```

### `MENTOR_PROMPT`
```
You are a teaching voice drawn from PACE's entrepreneurship curriculum at the University of Hawaiʻi at Mānoa.

Your audience is students and learners exploring entrepreneurship concepts, frameworks, and philosophies. The curriculum has a distinct Asia-Pacific and Native Hawaiian lens. Honor that lens — do not flatten it into generic Silicon Valley framing.

Your tools let you look up named concepts, concepts within a category, related concepts for follow-up, and longer-form curriculum readings.

How you answer:
1. Keep replies to three sentences or fewer. You are being spoken aloud.
2. Lead with the idea in plain words, then — when it matters — the Pacific-Asian or Hawaiian context that grounds it.
3. Use concrete examples from the material rather than abstractions.
4. If a concept connects to another in the curriculum, name it so the learner can ask about that next.
5. If something isn't in the curriculum, say so. Do not invent frameworks or attribute ideas to PACE that are not there.
6. Decline respectfully if asked to evaluate a specific business idea or give investment advice — you are here to teach, not to advise.

Tone: thoughtful, grounded, curious. Treat the learner as capable.
```

## 9. File layout changes

```
src/
├── avatars/
│   ├── registry.ts         # AvatarType, avatarRegistry
│   └── prompts.ts          # PACE_GUIDE_PROMPT, MENTOR_PROMPT
├── routes/
│   ├── token.ts            # now accepts avatarType
│   └── chat.ts             # now accepts avatarType, scopes tools + corpus
├── tools/
│   ├── index.ts            # registry of all tool defs + handlers
│   ├── searchDocuments.ts  # handler takes corpus param
│   ├── listPrograms.ts     # new
│   ├── getProgram.ts       # new
│   ├── getUpcomingEvents.ts# new
│   ├── findPerson.ts       # new
│   ├── listConcepts.ts     # new
│   ├── getConcept.ts       # new
│   └── getRelatedConcepts.ts # new
├── db/
│   ├── schema.ts           # add programs, events, people, concepts + corpus cols
│   └── migrations/
│       ├── 0000_init.sql   # M1
│       └── 0001_m2.sql     # M2 (from §2)
└── lib/
    └── conceptChunk.ts     # builds the chunk text from a concept row

scripts/
├── ingest.ts               # add --corpus flag (org|curriculum)
├── ingest-programs.ts      # new
├── ingest-events.ts        # new
├── ingest-people.ts        # new
└── ingest-concepts.ts      # new (dual-writes structured + chunk)

data/
├── programs.json
├── events.json
├── people.json
└── concepts.json
```

## 10. Implementation order within M2

1. Migration `0001_m2.sql` + Drizzle schema updates. Run `npm run migrate`.
2. Add `--corpus` flag to existing `scripts/ingest.ts`. Backfill existing docs by re-ingesting with the right flag (or `UPDATE documents SET corpus='...'` by hand for already-loaded data).
3. `src/avatars/{registry,prompts}.ts` and env updates.
4. Update `/api/token` to accept `avatarType` and call `avatarRegistry` for IDs.
5. Refactor tool registry to declare tools with schemas + handlers; update chat route to filter by `allowedTools` and inject corpus into `search_documents`.
6. Implement `list_programs`, `get_program`, `get_upcoming_events`, `find_person` + their ingest scripts + seed data.
7. Smoke-test `pace_guide` end-to-end.
8. Implement `list_concepts`, `get_concept`, `get_related_concepts` + `ingest-concepts.ts` (dual-write).
9. Smoke-test `entrepreneurship_mentor` end-to-end.
10. Per-avatar-type session keying in the in-memory history map.

## 11. Smoke tests

After step 7 (pace_guide):
```bash
npm run ingest-programs
npm run ingest-events
npm run ingest-people

# token
curl -s -X POST localhost:3000/api/token \
  -H 'content-type: application/json' \
  -d '{"avatarType":"pace_guide"}'

# chat
SID=$(uuidgen | tr A-Z a-z)
curl -s -X POST localhost:3000/api/chat \
  -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SID\",\"avatarType\":\"pace_guide\",\"message\":\"What competitions does PACE run?\"}"

# expect toolsUsed to include "list_programs", reply ≤3 sentences
```

After step 9 (mentor):
```bash
npm run ingest-concepts

SID=$(uuidgen | tr A-Z a-z)
curl -s -X POST localhost:3000/api/chat \
  -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SID\",\"avatarType\":\"entrepreneurship_mentor\",\"message\":\"What does PACE teach about stewardship in business?\"}"

# expect toolsUsed to include "search_documents" or "get_concept" (depending on match path)
# reply should ground the answer in curriculum language, ≤3 sentences
```

Corpus isolation check:
```bash
# Ask the mentor about deadlines — should NOT surface org docs.
# Ask the guide about kuleana — should NOT surface curriculum concepts.
# Both should either politely decline or say they don't have that info.
```

## 12. Out of scope for M2

- Admin UI for editing data files (edit JSON + re-run ingest for now).
- Streaming `/api/chat` responses (still end-to-end; add later).
- Multi-tenancy (different programs/orgs running their own avatars).
- Fuzzy matching beyond ILIKE for `get_program` / `get_concept` by name. If Claude's name guess is wrong, it'll get empty results and can retry with `list_*`.
- Authentication. Everything stays public for a campus kiosk / web embed.
