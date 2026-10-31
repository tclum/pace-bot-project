# PACE Bot — Roadmap

## Vision
A virtual avatar system for PACE (Pacific Asian Center for Entrepreneurship) at UH Mānoa, with
two AI personas — **PACE Guide** (programs/events info) and **Entrepreneurship Mentor**
(curriculum teaching) — delivered through a web avatar with LiveKit voice and a chat interface.

## Milestones
Detailed specs live alongside the backend in `pace-bot/` (`SPEC.md`, `M2_SPEC.md`, `M3a_SPEC.md`, …).

| Milestone | Scope | Status |
|-----------|-------|--------|
| **M1** | Backend scaffold, RAG ingest, vector search | ✅ Done |
| **M2** | Two avatar personas; structured data tables (programs/events/people/concepts); corpus routing | ✅ Done |
| **M3a** | LiveKit voice-agent foundations (echo / STT / TTS, no LLM yet) | ✅ Done |
| **M3b** | Wire agent to backend; voice conversations with Claude tool-use loop | 🔄 In progress |
| **M3c** | LiveAvatar video layer + frontend LiveKit client (full-screen talking avatar) | ⬜ Pending |
| **M4a** | Deploy to Railway for demo; Postgres + services behind one public URL | ⬜ Pending |
| **M4b** | Text-only chat interface; password-gated content testing (zero-cost iteration) | ⬜ Pending |
| **M4c** | Three-column response comparison (grounded vs. unguarded vs. raw Claude) | ⬜ Pending |

## Stack
- **Backend (`pace-bot/`):** TypeScript, Fastify, Postgres + pgvector, Anthropic Claude SDK, Voyage embeddings, Drizzle ORM
- **Frontend (`pace-bot-front/`):** Vite, React, TypeScript, Tailwind, shadcn/ui, LiveKit components
- **Agent (`pace-agent/`):** Python 3.11+, LiveKit Agents SDK, Deepgram STT/TTS, Silero VAD

## Run (per service)
- Backend: `npm run dev` (from `pace-bot/`)
- Frontend: `npm run dev` (from `pace-bot-front/`)
- Agent: `uv run python src/agent.py console` (local) or `dev` (cloud), from `pace-agent/`

> See `README.md` for the project overview and per-service setup.
