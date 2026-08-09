# JuryRigged

[![CI](https://github.com/subculture-collective/court/actions/workflows/ci.yml/badge.svg)](https://github.com/subculture-collective/court/actions/workflows/ci.yml)

JuryRigged is a real-time, multi-agent courtroom simulation.
An Express API orchestrates agent dialogue across deterministic phases, streams live events via Server-Sent Events (SSE), and supports jury voting for verdict and sentence outcomes.

This repository is standalone and does not require `subcult-corp` at runtime.

## Highlights

- Multi-agent role orchestration (judge, prosecutor, defense, witnesses, bailiff)
- Strict, forward-only phase progression:
    - `case_prompt` → `openings` → `witness_exam` → `evidence_reveal` → `closings` → `verdict_vote` → `sentence_vote` → `final_ruling`
    - Optional skip: `witness_exam` → `closings`
- Live per-session SSE stream (`/api/court/sessions/:id/stream`)
- Jury voting APIs with phase gating + anti-spam/rate-limiting
- Main viewer UI (`public/`) and React operator dashboard (`/operator`)
- In-memory or Postgres-backed persistence (auto-selected by `DATABASE_URL`)
- Optional broadcast hook integration (`noop` or `obs`) for production workflows
- **Ace Attorney–style renderer** (Phase 7): PixiJS overlay with camera presets, character poses, dialogue typewriter, effects engine, and evidence presentation
- **Structured case file**: immutable case context with witness roster, evidence inventory, and charge sheet generated at session start
- **Audience interaction**: `/press` and `/present` API endpoints + Twitch chat commands (`!press`, `!present`, `!objection`)
- **Render directives**: backend-inferred visual cues (camera, pose, face, effects) streamed alongside dialogue turns
- **NDJSON recording and deterministic replay**: record live sessions to NDJSON, replay at configurable speed

## Tech Stack

- Node.js + TypeScript
- Express (API + static serving)
- React + Vite (operator dashboard)
- Postgres (optional durable store)

## Quick Start (Local)

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment

```bash
cp .env.example .env
```

For a zero-dependency local run:

- leave `OPENROUTER_API_KEY` empty (mock dialogue fallback)
- leave `DATABASE_URL` empty (in-memory session store)

### 3) Start the API server

```bash
npm run dev
```

Default local URL: `http://localhost:3000` (from `.env.example`).

### 4) Build operator dashboard assets

```bash
npm run build:dashboard
```

Then open:

- Main app: `http://localhost:3000`
- Operator dashboard: `http://localhost:3000/operator`

> The API serves `/operator` from `dist/dashboard`. If you haven’t built it yet, `/operator` will return a helpful 404 message.

## Dashboard Dev Mode (Hot Reload)

Run the dashboard separately while API dev server is running:

```bash
npm run dev:dashboard
```

- Dashboard dev URL: `http://localhost:3001/operator/`
- API proxy target in Vite is `http://localhost:3000`

If your API is not on port `3000`, update `vite.config.ts` proxy settings.

## Docker Compose (API + Postgres)

The compose stack includes:

- `api` (JuryRigged server)
- `db` (Postgres 16)

Start:

```bash
npm run docker:up
```

Stop:

```bash
npm run docker:down
```

Container behavior:

- API runs on container port `3001`
- Host mapping defaults to `${API_HOST_PORT:-3001}`
- Migrations run automatically on container startup (`npm run migrate:dist`)
- `TRUST_PROXY` defaults to `1` in compose so IP-based rate limits remain accurate behind one proxy hop

Default compose endpoints:

- App + API: `http://localhost:${API_HOST_PORT:-3001}`
- Operator dashboard: `http://localhost:${API_HOST_PORT:-3001}/operator`

## Configuration

Copy `.env.example` and tune as needed.

### Core runtime

| Variable             | Purpose                                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`               | API port for local non-Docker runs (default in `.env.example`: `3000`)                                                                              |
| `TRUST_PROXY`        | Express proxy trust setting (`true`, `false`, hop count like `1`, or CIDR/subnet list) used for accurate client IP detection behind reverse proxies |
| `LLM_PROVIDER`       | `llama-line`, `openrouter`, or `mock`; defaults to llama-line when broker URL/key are set                                                           |
| `LLAMA_LINE_BASE_URL` | Preferred local broker endpoint, e.g. `http://10.0.0.50:11434`                                                                                     |
| `LLAMA_LINE_API_KEY` | Bearer token for llama-line inference requests                                                                                                      |
| `LLAMA_LINE_MODEL`   | llama-line/Ollama model name, e.g. `qwen2.5-coder:14b`                                                                                              |
| `OPENROUTER_API_KEY` | Required only when using `LLM_PROVIDER=openrouter`                                                                                                  |
| `LLM_MODEL`          | Single model fallback; used for OpenRouter and as a generic default                                                                                 |
| `LLM_MODELS`         | Optional comma-separated model fallback list used by the LLM client                                                                                 |
| `LLM_MOCK`           | Force mock mode (`true`/`false`)                                                                                                                    |
| `DATABASE_URL`       | Enables Postgres-backed durable store; omit for in-memory                                                                                           |
| `LOG_LEVEL`          | `debug`, `info`, `warn`, `error`                                                                                                                    |

### LLM audit logging

| Variable                     | Purpose                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `LLM_AUDIT_ENABLED`          | Enable admin-only LLM call metadata logging                                                       |
| `LLM_AUDIT_BODY_PERSISTENCE` | `off`, `metadata`, or `full`; only `full` stores prompt/response bodies for admin review          |
| `LLM_AUDIT_MAX_BODY_CHARS`   | Max stored body length before truncation                                                          |
| `LLM_AUDIT_RETENTION_DAYS`   | Retention hint for audit data; cleanup jobs can use this value                                    |

Phoenix tracing is expected to happen downstream in llama-line. Jury-Rigged keeps its own admin audit feed but does not emit direct Phoenix OTLP spans.

### Admin auth

| Variable              | Purpose                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| `ADMIN_PASSWORD`      | Enables admin auth when set; required for `/operator`, session creation/phase control, and `/api/metrics` |
| `ADMIN_TOKEN_SECRET`  | Secret for signing admin session cookies; use a long random value distinct from `ADMIN_PASSWORD`          |
| `ADMIN_COOKIE_SECURE` | Set to `true` when serving over HTTPS so admin cookies are marked Secure                                  |

### Voting + moderation safety

| Variable                         | Purpose                           |
| -------------------------------- | --------------------------------- |
| `VERDICT_VOTE_WINDOW_MS`         | Verdict poll window duration      |
| `SENTENCE_VOTE_WINDOW_MS`        | Sentence poll window duration     |
| `VOTE_SPAM_MAX_VOTES_PER_WINDOW` | Vote rate cap per window          |
| `VOTE_SPAM_WINDOW_MS`            | Rate-limit window size            |
| `VOTE_SPAM_DUPLICATE_WINDOW_MS`  | Duplicate-vote suppression window |

### Witness / token controls

| Variable                    | Purpose                                       |
| --------------------------- | --------------------------------------------- |
| `WITNESS_MAX_TOKENS`        | Max witness response tokens before truncation |
| `WITNESS_MAX_SECONDS`       | Max witness response duration                 |
| `WITNESS_TOKENS_PER_SECOND` | Duration↔token heuristic                      |
| `WITNESS_TRUNCATION_MARKER` | Marker appended after truncation              |
| `JUDGE_RECAP_CADENCE`       | Emit recap every N witness cycles             |
| `ROLE_MAX_TOKENS_*`         | Per-role token budget overrides               |
| `TOKEN_COST_PER_1K_USD`     | Cost estimation coefficient                   |

### Broadcast integration

| Variable                 | Purpose                                      |
| ------------------------ | -------------------------------------------- |
| `BROADCAST_PROVIDER`     | `noop` or `obs`                              |
| `OBS_WEBSOCKET_URL`      | OBS WebSocket endpoint                       |
| `OBS_WEBSOCKET_PASSWORD` | OBS auth password (optional but recommended) |

See `docs/04-streamer-guide.md` for OBS and broadcast setup.

### Twitch integration (Phase 7)

| Variable           | Purpose                                         |
| ------------------ | ----------------------------------------------- |
| `TWITCH_CHANNEL`   | Twitch channel to monitor for audience commands |
| `TWITCH_BOT_TOKEN` | OAuth token for the Twitch bot account          |
| `TWITCH_CLIENT_ID` | Twitch application client ID                    |

When any Twitch variable is unset, the adapter runs in noop mode (no connection).

### Replay + recording (Phase 7)

| Variable         | Purpose                                                          |
| ---------------- | ---------------------------------------------------------------- |
| `RECORDINGS_DIR` | Directory for NDJSON session recordings (default: `recordings/`) |
| `REPLAY_FILE`    | Path to NDJSON file to replay instead of live orchestration      |
| `REPLAY_SPEED`   | Playback speed multiplier (`1` = real-time, `4` = 4×)            |

## API at a Glance

- `GET /api/health`
- `GET /api/metrics` (Prometheus-format telemetry)
- `GET /api/court/sessions`
- `GET /api/court/sessions/:id`
- `POST /api/court/sessions`
- `POST /api/court/sessions/:id/vote`
- `POST /api/court/sessions/:id/press` (Phase 7 — audience press)
- `POST /api/court/sessions/:id/present` (Phase 7 — present evidence)
- `POST /api/court/sessions/:id/phase`
- `GET /api/court/sessions/:id/stream` (SSE)

Contributor-facing contract notes live in `docs/02-contributor-guide.md`; system flow and event concepts live in `docs/01-system-overview.md`.

## Development Commands

### npm scripts

| Command                   | Description                               |
| ------------------------- | ----------------------------------------- |
| `npm run dev`             | Start API in watch mode (`src/server.ts`) |
| `npm run dev:dashboard`   | Start Vite dashboard dev server           |
| `npm run build`           | Compile TS to `dist/` + build dashboard   |
| `npm run build:dashboard` | Build dashboard only                      |
| `npm run start`           | Run compiled server (`dist/server.js`)    |
| `npm run migrate`         | Run migrations from source (`tsx`)        |
| `npm run record:sse`      | Record SSE session fixture                |
| `npm run migrate:dist`    | Run migrations from compiled output       |
| `npm test`                | Run Node test suite                       |
| `npm run test:ops`        | Run ops config tests                      |
| `npm run smoke:staging`   | Run staging smoke script                  |

### SSE fixture record + replay

Record a live SSE stream to a fixture file:

```bash
npm run record:sse -- --session <SESSION_ID>
```

Defaults:

- base URL: `http://127.0.0.1:${PORT}`
- output: `public/fixtures/sse-<SESSION_ID>-<timestamp>.json`

Optional flags:

- `--base <url>`
- `--out <absolute-or-relative-path>`
- `--max-events <number>`
- `--duration-ms <number>`

Replay a fixture in the browser overlay by adding a query param:

```text
http://localhost:3000/?replayFixture=/fixtures/<fixture-file>.json
```

When fixture replay mode is enabled, live SSE is disabled and recorded events are replayed with their captured offsets.

### Server-side NDJSON recording and replay (Phase 7)

During normal live runs, session events are recorded to NDJSON files in `recordings/<SESSION_ID>.ndjson` (override with `RECORDINGS_DIR`).

Start server replay mode from an existing NDJSON file:

```bash
npm run dev -- --replay recordings/<SESSION_ID>.ndjson --speed 4
```

Equivalent environment-variable mode:

```bash
REPLAY_FILE=recordings/<SESSION_ID>.ndjson REPLAY_SPEED=4 npm run dev
```

Notes:

- `--speed` / `REPLAY_SPEED` controls playback rate (`1` = real-time, `4` = 4× faster).
- In replay mode, orchestration is disabled and SSE emits recorded events with captured inter-event timing.
- Existing viewer and operator UIs connect to replay mode using the same SSE endpoint.

### Make targets

`Makefile` mirrors common workflows (`make dev`, `make test`, `make ci`, `make docker-up`, etc.).

## Local CI Parity

Run before opening a PR:

```bash
npm run lint
npm run build
npm test
```

## Repository Layout

- `src/` — server, orchestrator, store, moderation, broadcast, Twitch adapter, tests
- `public/` — viewer UI + overlay
- `public/renderer/` — modular PixiJS renderer (stage, layers, camera, dialogue, effects)
- `public/assets/` — placeholder-first assets (backgrounds, characters, UI, fonts, SFX)
- `dashboard/` — operator dashboard (React + Vite)
- `db/migrations/` — SQL schema migrations
- `docs/` — Obsidian-friendly project docs for contributors, operators, streamers, and viewers
- `ops/` — alert thresholds + runtime health dashboard artifacts

## Documentation Map

| Document | Description |
| --- | --- |
| `docs/README.md` | Obsidian-friendly docs index |
| `docs/01-system-overview.md` | Product, architecture, phases, and core concepts |
| `docs/02-contributor-guide.md` | Local setup, code map, contracts, and verification |
| `docs/03-operator-guide.md` | Live operation, moderation, and recovery |
| `docs/04-streamer-guide.md` | OBS setup, broadcast surfaces, and audience boundaries |
| `docs/05-viewer-and-chatter-guide.md` | Viewer participation and chat command placeholders |
| `docs/glossary.md` | Canonical terms for Obsidian linking |

## Notes

- Migrations run automatically when using Postgres-backed storage.
- When `DATABASE_URL` is not set, sessions are non-durable and not recoverable after restart.
- On restart with Postgres, interrupted `running` sessions are recovered and resumed.

## License

Licensed under `GPL-3.0-or-later`. See [LICENSE](LICENSE).
