---
title: Operator Guide
description: How to run, monitor, moderate, and recover JuryRigged sessions.
audience:
  - operators
tags:
  - juryrigged
  - operations
  - moderation
status: maintained
updated: 2026-06-07
---

# Operator Guide

**Version 1.0.0** · JuryRigged · 2026-06-07 · Live operations

---

## AI READING INSTRUCTION

Read `[SPEC]` blocks for operating steps. Read `[BUG]` blocks for known failure handling. Treat `[?]` as planned or incomplete behavior.

---

## 1. Operator Role

**[SPEC]**
- Operators run the private [[glossary#Operator Dashboard|operator dashboard]].
- Operators start sessions, monitor progress, moderate content, and recover stuck sessions.
- Operators should not show `/operator` on stream unless intentionally demonstrating the system.

## 2. Live Session Checklist

**[SPEC]**
1. Start the server.
2. Open `/operator` privately.
3. Open `/` or `/?view=overlay` as the audience-facing view.
4. Confirm the stream can see only the intended viewer/overlay surface.
5. Start or load a [[glossary#Court Session|court session]].
6. Watch the [[glossary#Live Transcript|live transcript]] and phase status.
7. Intervene if moderation, safety, or phase recovery is needed.
8. Let viewers vote only during the correct phase.
9. End on final ruling or stop the session cleanly.

## 3. Moderation Rules

**[SPEC]**
- Keep broadcast output PG-13.
- Redact unsafe or private content before it appears to viewers.
- Use moderation actions for content that violates the show boundary.
- Prefer safe summaries over repeating unsafe text.
- Log operator actions when possible.

## 4. Recovery Rules

**[SPEC]**
| Situation | Operator action |
| --- | --- |
| Session appears stuck | Check server logs and current phase. |
| Viewer voting not available | Confirm session is in a voting phase. |
| Overlay not updating | Refresh overlay and check SSE connectivity. |
| Unsafe text appears | Pause or moderate, then continue with a safe recap. |
| Dashboard unavailable | Verify build output and server route for `/operator`. |

**[BUG] Dashboard returns 404**
- Symptom: `/operator` returns a helpful 404 or missing dashboard message.
- Cause: dashboard assets were not built or are not available to the server.
- Fix: run the dashboard build command, then restart or refresh the server.

## 5. Case Queue Operations

**[SPEC]**
- The Case Queue tab controls user-triggered and operator-triggered cases.
- Twitch viewers submit cases with `!prompt <case idea>`.
- Operators can submit a case directly from `/operator`.
- Queued submitted cases run before generated fallback cases.
- If no session is running, the scheduler starts the next queued case.
- If no queued case exists, the scheduler starts a generated case when `AUTO_GENERATE_CASES=true`.
- Operators can skip queued cases that are off-topic, unsafe, or low quality.
- Operators can start a queued case immediately only when no other case is running.

**[SPEC]**
| Env var | Default | Purpose |
| --- | --- | --- |
| `AUTO_GENERATE_CASES` | `true` | Starts generated cases when queue is empty. |
| `AUTO_CASE_IDLE_DELAY_MS` | `10000` | Wait before generated fallback starts after an idle gap. |
| `CASE_QUEUE_POLL_MS` | `5000` | Scheduler polling interval. |
| `CASE_QUEUE_SUBMIT_TOKEN` | unset | Required shared secret for bot-to-server public queue submission. |
| `SIMULATION_AUTOSTART` | `true` | Set `false` to boot with automation paused. |
| `LLM_FALLBACK_STOP_THRESHOLD` | `5` | Consecutive fallback/mock LLM responses before automation pauses and current session fails. |
| `TWITCH_PROMPT_MIN_ROLE` | `everyone` | Minimum Twitch role for `!prompt`: `everyone`, `follower`, `subscriber`, `vip`, `moderator`, or `broadcaster`. |
| `TWITCH_REFRESH_TOKEN` | unset | OAuth refresh token used to renew Twitch chat access automatically. |
| `TWITCH_TOKEN_RUNTIME_PATH` | `/app/.runtime/twitch-token.json` | Runtime file for refreshed Twitch access/refresh token state. |
| `TWITCH_TOKEN_REFRESH_SKEW_MS` | `600000` | Refresh Twitch access token this many ms before expiry. |

**[SPEC]**
- Use the Case Queue tab to pause or resume automation.
- Pausing automation stops new cases from starting; it does not kill the currently running case.
- Resuming automation clears the error state and lets queued/generated cases start on the next scheduler tick.
- If the LLM falls back to mock dialogue too many times in a row, JuryRigged pauses automation, marks the current session failed, and shows the error in the Case Queue tab.

**[NOTE]**
Follower status is checked through Twitch Helix `channels/followers`, not IRC tags. The bot token must include `moderator:read:followers`, and the bot account must be a moderator or broadcaster for the channel. Patreon membership still requires a separate Patreon integration before it can be enforced reliably.

**[NOTE]**
Twitch access tokens are short-lived. JuryRigged uses `TWITCH_REFRESH_TOKEN`, `TWITCH_CLIENT_ID`, and `TWITCH_CLIENT_SECRET` to refresh the bot token before expiry, then writes refreshed token state to `TWITCH_TOKEN_RUNTIME_PATH` with owner-only file permissions. The Docker compose stack persists `/app/.runtime` in the `twitch_runtime` volume.

## 6. Persistence Modes

**[SPEC]**
- With `DATABASE_URL`, sessions can use Postgres-backed persistence.
- Without `DATABASE_URL`, sessions use in-memory storage.
- In-memory sessions are suitable for local testing, not durable production operation.

## 7. Health and Safety

**[SPEC]**
- Confirm the server is healthy before going live.
- Keep operator credentials private.
- Keep stream keys, API keys, and model provider keys out of overlays and screenshots.
- Use a second monitor or separate browser profile for operator controls.

## 8. Related Docs

**[SPEC]**
- [[01-system-overview|System Overview]]
- [[04-streamer-guide|Streamer Guide]]
- [[05-viewer-and-chatter-guide|Viewer and Chatter Guide]]
- [[glossary|Glossary]]

## 9. Changelog

**[SPEC]**
- 1.1.0 — Added case queue operation and generated fallback rules.
- 1.0.0 — Consolidated operator, moderation, and recovery guidance.
