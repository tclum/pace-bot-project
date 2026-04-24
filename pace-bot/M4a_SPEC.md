# Milestone 4a — Deploy to Railway for boss demo

First deployment milestone. Takes the working-on-localhost M3c stack and moves it to one shared URL accessible from anywhere, so the PACE director can click a link and have the same experience you have on your laptop.

Explicit non-goals (deferred to later milestones):
- Custom domain
- UH infrastructure migration
- Public launch
- Production hardening (auth, rate limiting, observability, backups)
- CI/CD pipeline
- Multi-environment (staging + prod separation)
- Full content (programs, events, people data)

## 1. What M4a delivers

One Railway project with four services, one public URL, one demo session. Your boss clicks a link, lands on the PACE Bot homepage, clicks a persona card, has a voice conversation with a talking avatar. Identical experience to your localhost, minus the "and I had to set up four terminals" caveat.

Specifically:
- `pace-bot` backend deployed as a Docker service on Railway
- `pace-agent` Python worker deployed as a Docker service on Railway
- Managed Postgres with pgvector provisioned on Railway
- `pace-bot-front` built and deployed, served either from a Railway static service or Vercel (decision in §4)
- All env vars migrated from local `.env` files to Railway secrets
- `pace-bot` migrations + concept seed data run against the Railway DB
- One canonical URL given to your boss
- M3c's localhost setup still works unchanged (dev/prod parity preserved via env vars)

## 2. The deployment shape

Four logical pieces, each gets a different Railway concept:

| Piece | Railway primitive | Why |
|---|---|---|
| Backend (`pace-bot`) | Service from Dockerfile | Stateful Fastify, persistent HTTP, connects to DB |
| Agent (`pace-agent`) | Service from Dockerfile | Long-running Python worker, WebSocket to LiveKit Cloud |
| Database | Railway Postgres plugin with pgvector | Managed, backed up by Railway, no Docker setup |
| Frontend (`pace-bot-front`) | Static site (Railway or Vercel) | Just static files; zero runtime |

Railway projects support private networking between services, so the backend reaches the DB over a private URL (`postgres.railway.internal`) with no public exposure. Agent reaches the backend similarly. Only the frontend and backend's `/api/*` endpoints are public.

## 3. Why Dockerfiles, not Nixpacks

Railway's default build detection (Nixpacks) would probably work for the backend and might fumble the agent. Dockerfiles are non-negotiable because:

1. When UH IT eventually hosts this, they'll run the same Dockerfiles. No rework.
2. Nixpacks is a Railway-specific abstraction; Dockerfiles are portable.
3. The agent's `uv`-based Python setup isn't standard enough for Nixpacks to handle reliably.
4. Writing two small Dockerfiles is 30 minutes of work; getting Nixpacks to behave is an indefinite-time support ticket.

## 4. Frontend hosting decision: Railway or Vercel

You have accounts for both. Let me argue for **Railway** for M4a:

- One dashboard for everything
- One billing line to track
- Same env var UI as the other services (simpler mental model)
- The frontend is tiny (a few MB of static files) — cost on Railway is negligible
- When UH IT takes over, you hand them one project, not two

Reconsider Vercel later if:
- Custom domain becomes important (Vercel's DNS UX is nicer)
- You want preview deploys on every PR
- Frontend perf becomes a bottleneck (Vercel has better global CDN)

None of those apply to a boss demo. Go with Railway for M4a.

## 5. Changes required in the codebase

### 5a. Dockerfile for `pace-bot`

Create `pace-bot/Dockerfile`:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY scripts ./scripts
COPY data ./data
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/data ./data
COPY --from=builder /app/src/db/migrations ./src/db/migrations

EXPOSE 3000
CMD ["node", "dist/server.js"]
```

Two things this assumes that might not be true:
- Your backend builds with `npm run build` to `dist/`. If not, update the Dockerfile.
- Migrations and seed scripts are TypeScript files compiled alongside. If they run via `tsx` at runtime, we need to include `tsx` in production deps or precompile them.

CC should verify the build step works (`npm run build` locally) and adjust the Dockerfile if the output path differs.

### 5b. Dockerfile for `pace-agent`

Create `pace-agent/Dockerfile`:

```dockerfile
FROM python:3.12-slim
WORKDIR /app

# uv for fast installs
RUN pip install uv

# Dependency layer (cached unless pyproject/lock changes)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Source
COPY src ./src

# livekit-agents runs as a worker; `dev` is wrong for prod, `start` is right
CMD ["uv", "run", "python", "src/agent.py", "start"]
```

The important switch: local dev used `src/agent.py dev`. Production uses `src/agent.py start`. The difference is `dev` mode watches files for hot reload and spawns multiple processes; `start` is the long-running production mode.

Verify this by running `uv run python src/agent.py --help` locally. If the subcommand is different (`run`, `serve`, etc.), update the CMD.

### 5c. `pace-bot-front` build config

The frontend already works via `npm run build` (M3c verified this). For Railway static hosting, we need a small `railway.json` or a Dockerfile. Simpler: a Dockerfile that just serves the built files with a tiny nginx or the `serve` npm package.

Create `pace-bot-front/Dockerfile`:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
RUN npm install -g serve
COPY --from=builder /app/dist /app/dist
EXPOSE 3000
CMD ["serve", "-s", "/app/dist", "-l", "3000"]
```

Railway will route external traffic to port 3000 on this container.

### 5d. Frontend env var at build time

This is the trickiest part of the frontend deploy. Vite bakes `VITE_*` env vars at build time, not runtime. So the production build needs to know the production backend URL during `npm run build`, not when the container starts.

Two ways to handle:

- **Railway build-time variables:** Railway exposes env vars during build. Set `VITE_API_BASE_URL` in Railway UI, and the Vite build will pick it up. This is the clean option.
- **Baked-in URL:** Hardcode the production URL in the Dockerfile. Worst option; we won't do this.

The Dockerfile above will use Railway's build-time env. Make sure to set `VITE_API_BASE_URL` and `VITE_LIVEKIT_URL` on the frontend service before building.

### 5e. Backend CORS update

Production frontend won't be at `http://localhost:8080`. Once the frontend gets its Railway URL (looks like `pace-bot-front-production.up.railway.app`), update `pace-bot`'s `ALLOWED_ORIGIN` env var to match.

Better: support multiple allowed origins so local dev AND production both work. Modify `pace-bot/src/server.ts` CORS config to accept a comma-separated list:

```ts
const allowedOrigins = env.ALLOWED_ORIGIN.split(",").map(o => o.trim());

// In CORS config:
origin: (origin, cb) => {
  if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
  cb(new Error("Not allowed by CORS"), false);
}
```

Then set `ALLOWED_ORIGIN=http://localhost:8080,https://pace-bot-front-production.up.railway.app` in both local and production.

### 5f. Database URL env var

Your backend currently reads `DATABASE_URL` from `.env`. Railway's Postgres plugin exposes `DATABASE_URL` automatically as a private networking variable referenced as `${{Postgres.DATABASE_URL}}`. Reference it from the backend service's environment, and the connection Just Works.

Double-check `pace-bot/src/db/client.ts` uses `process.env.DATABASE_URL` directly; if it parses host/user/password separately, simplify.

### 5g. LiveKit URL still points to LiveKit Cloud

`LIVEKIT_URL=wss://flyer-bot-zlcdhrkh.livekit.cloud` stays identical in all environments. LiveKit Cloud is the shared infrastructure. Same for `LIVEAVATAR_API_KEY` — that's external to your stack.

### 5h. `pace-bot-front` hardcoded API base fallback

In `src/pages/LiveAvatar.tsx`, the fetch uses:

```ts
const apiBase = import.meta.env.VITE_API_BASE_URL;
```

If `VITE_API_BASE_URL` is missing at build time, this becomes `undefined` and the fetch URL becomes `undefined/api/livekit-token`, which 404s. Add a clear error:

```ts
const apiBase = import.meta.env.VITE_API_BASE_URL;
if (!apiBase) throw new Error("VITE_API_BASE_URL not set at build time");
```

Catches misconfigured deploys early.

### 5i. `.dockerignore` files

Create `pace-bot/.dockerignore`:
```
node_modules
dist
.env
.env.*
!.env.example
.git
```

Create `pace-agent/.dockerignore`:
```
.venv
__pycache__
*.pyc
.env
.env.*
!.env.example
.pytest_cache
.git
```

Create `pace-bot-front/.dockerignore`:
```
node_modules
dist
.env
.env.*
!.env.example
.git
```

These prevent local build artifacts and secrets from going into the Docker image. Important: without `.dockerignore`, Docker would COPY your `.env` into the image, which bakes your API keys into the layer.

## 6. Railway project setup (human steps)

This is the part you do by hand in the Railway UI. Claude Code can't do this for you; these are manual:

1. Go to railway.app, create a new project called `pace-bot-project`
2. From the project dashboard: **Add Service → Database → PostgreSQL**. This gives you a managed Postgres.
3. Need to enable pgvector extension. Open the Postgres service, go to Data tab, run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
4. **Add Service → GitHub Repo → `tclum/pace-bot-project`**. Railway will ask which folder. Point it at `pace-bot/`. Configure:
   - Build: Dockerfile at `pace-bot/Dockerfile`
   - Variables: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `ANTHROPIC_API_KEY=<your key>`, `VOYAGE_API_KEY=<your key>`, `LIVEKIT_URL=wss://flyer-bot-zlcdhrkh.livekit.cloud`, `LIVEKIT_API_KEY=<...>`, `LIVEKIT_API_SECRET=<...>`, `ALLOWED_ORIGIN=<will fill after frontend deploys>`, `PORT=3000`
   - Networking: Generate public domain
5. **Add Service → GitHub Repo → same repo**. Point at `pace-agent/`. Configure:
   - Build: Dockerfile at `pace-agent/Dockerfile`
   - Variables: `LIVEKIT_URL=<same>`, `LIVEKIT_API_KEY=<same>`, `LIVEKIT_API_SECRET=<same>`, `DEEPGRAM_API_KEY=<your key>`, `LIVEAVATAR_API_KEY=<your key>`, `PACE_GUIDE_LIVEAVATAR_ID=5761a14c-8720-4ce1-8c2b-3f351718fc79`, `MENTOR_LIVEAVATAR_ID=ab0765ad-69de-41fb-9f8a-bd01c3c52d6f`, `PACE_BOT_URL=http://pace-bot.railway.internal:3000` (reference the backend service's private URL), `PACE_BOT_TIMEOUT_SECONDS=20`
   - No public domain needed (agent isn't HTTP-facing)
6. **Add Service → GitHub Repo → same repo**. Point at `pace-bot-front/`. Configure:
   - Build: Dockerfile at `pace-bot-front/Dockerfile`
   - Variables (build-time): `VITE_API_BASE_URL=<backend's public URL from step 4>`, `VITE_LIVEKIT_URL=<same LiveKit URL>`
   - Networking: Generate public domain
7. Go back to the `pace-bot` backend service and set `ALLOWED_ORIGIN` to the frontend's public URL from step 6.
8. Trigger a redeploy of the backend to pick up the new `ALLOWED_ORIGIN`.

## 7. Initial migration + seed data

The first deploy won't have a populated database. Migrations need to run once, and the concept seed data (`data/concepts.json`) needs to be ingested.

Railway's approach: open a shell on the backend service (Railway UI → service → "⋮" → "Open Shell") and run:

```bash
npm run migrate
npm run ingest:concepts
```

These scripts are the same ones you run locally. They read `DATABASE_URL` from env (which is already set), connect to the managed Postgres, and apply migrations plus seed the concepts.

Verify by running a quick query in the Postgres service Data tab:

```sql
SELECT name FROM concepts LIMIT 5;
```

Should return 8 rows including `kuleana-driven-venture`, `pono-economics`, etc. — the seed data we populated in M2.

Do NOT attempt to run `ingest:programs`, `ingest:events`, or `ingest:people` yet — those JSON files are empty. They won't break anything; they just won't insert rows.

## 8. Testing the deploy

Once all four services are green in Railway:

1. Visit the frontend public URL in your browser
2. Landing page should render (if it doesn't, check frontend logs for build errors)
3. Click the Entrepreneurship Mentor card
4. Expect: full-screen page, "Connecting…", then avatar appears (might take 5-15s on first-ever request since containers cold-start)
5. Grant mic permission
6. Say "What is kuleana?"
7. Wait for mentor's concept-grounded reply
8. Click "End conversation"

If this works: send the URL to your boss.

### Likely failure modes

- **Frontend 404s everything:** `serve -s` flag serves all routes to `index.html`, so React Router works. Check the Dockerfile CMD has `-s`.
- **Token fetch returns CORS error:** `ALLOWED_ORIGIN` on backend doesn't include frontend URL exactly (https vs http, trailing slash, wrong domain). Get the exact domain from Railway's UI for the frontend service.
- **Backend can't reach DB:** `DATABASE_URL` not set on backend service, or pgvector not enabled. Railway's Data tab has a query runner; if `SELECT 1;` works but `CREATE EXTENSION vector;` fails, you're on a Postgres version without pgvector — unlikely but possible; file a Railway ticket.
- **Agent not receiving jobs:** agent's `LIVEKIT_URL/KEY/SECRET` don't match what the backend puts in tokens. All three services must use identical values.
- **Avatar never appears:** `LIVEAVATAR_API_KEY` missing or wrong, or avatar IDs don't match your account. Check agent logs for `liveavatar start failed`.
- **Mic prompt never appears:** Browser security requires HTTPS for mic access. Railway provides HTTPS by default for public services, so this should be automatic. If you see HTTP, something's wrong with Railway's HTTPS config.

## 9. Acceptance criteria

- [ ] Four Railway services deployed and green: `pace-bot`, `pace-agent`, `pace-bot-front`, `Postgres`
- [ ] Backend accessible at its Railway public URL; `/healthz` returns 200
- [ ] Frontend accessible at its Railway public URL; landing page renders
- [ ] Database has 8 rows in `concepts` table, no rows in `programs`/`events`/`people` (verified via Data tab)
- [ ] Mentor smoke test passes end-to-end from the deployed URL
- [ ] Guide smoke test also runs (even though it'll say "no programs on record"); verifies routing works
- [ ] Sharing the frontend URL with your boss produces a working avatar interaction for them
- [ ] Git: Dockerfiles, `.dockerignore`s, any source code changes committed and pushed
- [ ] Railway auto-deploys on push (default) still work — changing a file and pushing should trigger a new deploy
- [ ] LiveAvatar credits used: aim for ≤5 across all testing. Budget assumes one mentor test + one guide test + some retries.

## 10. Out of scope for M4a

- Filling in actual PACE program/event/people data (your boss's to-do)
- Custom domain (later, when UH decides what to do)
- HTTP→HTTPS redirects (Railway handles for you)
- Health check configuration / alerting
- Database backups (Railway auto-backs up Postgres; verify once in UI)
- Logging aggregation beyond Railway's built-in log viewer
- Scaling (Hobby plan is one instance per service — fine for demo)
- Preview deploys on PRs (Pro plan feature)
- Auth on the frontend or backend (anyone with the URL can use it — fine for demo, wrong for public launch)
- Rate limiting on LiveAvatar sessions (fine for demo; absolutely critical for public launch)
- Blue/green deploys, zero-downtime deploys
- CI tests before deploy
- Migrating away from LiveKit Cloud / LiveAvatar to self-hosted versions

## 11. Risks + open questions

**First-deploy time.** Expect 30-60 minutes of debug on the first Railway deploy. Dockerfiles never work first try — there's always an env var you forgot, a path that's different in the container, a port mismatch. Budget 2 hours total and aim to finish in 1.

**Cost visibility.** Railway's usage dashboard is good but not instant. You won't see today's spend until tomorrow. Monitor it daily for the first week to make sure nothing's burning hot — especially the agent, which runs 24/7. If you see >$20/month projected, something's mis-sized.

**The agent's idle cost.** The `pace-agent` container runs continuously, even when no one is using the site. LiveKit's worker pattern *requires* this — the agent has to be registered and ready to accept sessions. There's no "scale to zero" option here. Plan on ~$5-8/month just for the agent being alive.

**LiveAvatar session concurrency.** If two people hit the site at once, two LiveAvatar sessions spin up, and your 10 free credits halve fast. For a boss demo this is fine (one person at a time). When you go public, you'll need session queuing or auth.

**Agent session_id vs Railway instance restarts.** If Railway redeploys the agent mid-conversation, that conversation dies. The frontend will show a connection error. For a demo this is accepted; for production you'd need graceful handling. Don't deploy to the agent service during a demo.

**Environment drift.** You now have local `.env` files AND Railway env vars. They can diverge. When you update a secret locally, you need to remember to update Railway too. Consider documenting secrets in a shared password manager; don't rely on memory.

**The agent won't connect if the backend isn't ready.** First deploy ordering matters. Ideally: Postgres first (fully healthy), then backend (so it runs migrations), then agent (so it can call `/healthz`). Railway deploys all services simultaneously by default. If agent starts before backend, it'll log degraded-mode warnings but still work — the healthz re-check on the next user turn will flip it out of degraded. Don't panic if the agent logs warnings on cold start.

**TypeScript migrations at runtime.** If `npm run migrate` uses `tsx` to run `.ts` files directly, we need `tsx` in production deps. Alternative: compile the migrate script in the Docker build step along with the rest of the app, and run the compiled `.js` in production. Claude Code should check and fix as needed.

**PAYMENT ON FILE.** Railway requires a payment method on file even on the Hobby plan. If the $5 monthly fee becomes a problem, Fly.io's free tier is the fallback — but switching costs you another round of deployment work. Decide now whether you're comfortable with the $5-12/month baseline; it's cheaper than cancelling one streaming subscription.
