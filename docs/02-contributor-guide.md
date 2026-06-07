---
title: Contributor Guide
description: Setup, code map, contracts, and verification notes for JuryRigged contributors.
audience:
  - contributors
tags:
  - juryrigged
  - contributing
  - development
status: maintained
updated: 2026-06-07
---

# Contributor Guide

**Version 1.0.0** · JuryRigged · 2026-06-07 · Contributor reference

---

## AI READING INSTRUCTION

Read `[SPEC]` blocks for authoritative implementation facts. Read `[NOTE]` blocks for conventions and rationale. Treat `[?]` as planned work.

---

## 1. Local Setup

**[SPEC]**
```bash
npm install
cp .env.example .env
npm run dev
```

- Default local app: `http://localhost:3000`
- Public viewer: `/`
- Operator dashboard: `/operator`
- The app can run without `OPENROUTER_API_KEY` by using fallback/mock dialogue.
- The app can run without `DATABASE_URL` by using in-memory storage.

## 2. Useful Commands

**[SPEC]**
| Command | Purpose |
| --- | --- |
| `npm run dev` | Start API/server dev mode. |
| `npm run dev:dashboard` | Run dashboard with Vite hot reload. |
| `npm run build` | Build project artifacts. |
| `npm test` | Run tests. |
| `npm run lint` | Check TypeScript types. |

**[NOTE]**
Command names in this table are taken from `package.json`.

## 3. Code Map

**[SPEC]**
| Area | Purpose |
| --- | --- |
| `src/server.ts` | Express app, routes, auth, SSE, static serving. |
| `src/types.ts` | Shared domain types. |
| `src/court/` | Court flow, phases, prompts, personas. |
| `src/broadcast/` | Broadcast adapter integration. |
| `src/twitch/` | Twitch/chat integration work. |
| `public/` | Public viewer and overlay assets. |
| `dashboard/` | Operator dashboard. |
| `app/` | Broadcast/public app UI code. |

## 4. Contract Rules

**[SPEC]**
- Treat [[glossary#Court Event|court events]] as public contracts.
- Keep event payloads stable or version them deliberately.
- Preserve forward-only [[glossary#Court Phase|court phase]] progression unless a recovery path explicitly overrides it.
- Keep operator-only actions behind [[glossary#Admin Auth|admin authentication]].
- Mark partially implemented behavior as `[?]` in docs.

## 5. Audience Interaction Rules

**[SPEC]**
- Viewer votes should be phase-gated.
- Chat/audience commands should be rate-limited or deduplicated.
- Rejected commands should fail quietly or with a safe explanation.
- Unsafe user input should pass through moderation before appearing in broadcast output.

**[?]**
- Future commands may include `!prompt`, `!press`, `!present`, and `!objection`.
- Command names are placeholders until the chat command contract is finalized.

## 6. Style Rules

**[SPEC]**
- Prefer small, typed modules over large route handlers.
- Add or update tests for phase logic, event contracts, moderation, and command parsing.
- Keep viewer-facing copy PG-13.
- Do not document planned features as shipped behavior.

## 7. Verification Checklist

**[SPEC]**
- Run type checks before merging TypeScript changes.
- Run relevant tests for court phases, API endpoints, and UI behavior.
- Manually verify `/`, `/?view=overlay`, and `/operator` for changes that affect live operation.
- For docs changes, check frontmatter and Obsidian links.

## 8. Related Docs

**[SPEC]**
- [[01-system-overview|System Overview]]
- [[03-operator-guide|Operator Guide]]
- [[05-viewer-and-chatter-guide|Viewer and Chatter Guide]]
- [[glossary|Glossary]]

## 9. Changelog

**[SPEC]**
- 1.0.0 — Added compact contributor guide with implementation caveats.
