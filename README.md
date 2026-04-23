# PACE Bot

Virtual avatar system for the Pacific Asian Center for Entrepreneurship (PACE) at the University of Hawaiʻi at Mānoa.

Two avatar personas driven by a shared backend:
- **PACE Guide** — answers questions about PACE programs, events, and people
- **Entrepreneurship Mentor** — teaches concepts and philosophies from PACE's curriculum

## Architecture

Three services in this monorepo:

| Folder | Purpose | Stack |
|------|------|------|
| `pace-bot/` | HTTP backend: Claude tool-use loop, RAG, structured data tools | TypeScript, Fastify, Postgres + pgvector |
| `pace-agent/` | Voice agent: LiveKit-based STT/TTS pipeline | Python, livekit-agents, Deepgram |
| `pace-bot-front/` | Web UI | Vite, React, TypeScript, Tailwind |

## Status

- M1 — backend scaffold, ingest, search ✅
- M2 — two avatars, structured data, corpus isolation ✅
- M3a — LiveKit voice agent foundations (echo mode) ✅
- M3b — wire agent to backend (in progress)
- M3c — LiveAvatar LITE Mode video layer (pending)

See each subfolder's README for service-specific setup. See `pace-bot/SPEC.md`, `M2_SPEC.md`, and `M3a_SPEC.md` for implementation specs.

## Local development

Prerequisites:
- Node.js 20+
- Python 3.11+ with `uv`
- Docker (for Postgres)
- Accounts: Anthropic, Voyage AI, Deepgram, LiveKit Cloud

Each subfolder has its own `.env.example` documenting required keys.
