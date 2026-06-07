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

## 5. Persistence Modes

**[SPEC]**
- With `DATABASE_URL`, sessions can use Postgres-backed persistence.
- Without `DATABASE_URL`, sessions use in-memory storage.
- In-memory sessions are suitable for local testing, not durable production operation.

## 6. Health and Safety

**[SPEC]**
- Confirm the server is healthy before going live.
- Keep operator credentials private.
- Keep stream keys, API keys, and model provider keys out of overlays and screenshots.
- Use a second monitor or separate browser profile for operator controls.

## 7. Related Docs

**[SPEC]**
- [[01-system-overview|System Overview]]
- [[04-streamer-guide|Streamer Guide]]
- [[05-viewer-and-chatter-guide|Viewer and Chatter Guide]]
- [[glossary|Glossary]]

## 8. Changelog

**[SPEC]**
- 1.0.0 — Consolidated operator, moderation, and recovery guidance.
