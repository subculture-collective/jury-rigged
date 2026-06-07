---
title: Streamer Guide
description: How to show JuryRigged on stream with viewer, overlay, and audience interaction boundaries.
audience:
  - streamers
  - operators
tags:
  - juryrigged
  - streaming
  - obs
status: maintained
updated: 2026-06-07
---

# Streamer Guide

**Version 1.0.0** · JuryRigged · 2026-06-07 · Broadcast setup

---

## AI READING INSTRUCTION

Read `[SPEC]` blocks for setup and safety. Read `[NOTE]` blocks for show-running advice. Treat `[?]` as planned or incomplete integration.

---

## 1. What To Show

**[SPEC]**
| View | URL | Show on stream? |
| --- | --- | --- |
| Public viewer | `/` | Yes. |
| Overlay | `/?view=overlay` | Yes, usually as OBS browser source. |
| Operator dashboard | `/operator` | No, unless intentional. |

## 2. OBS Setup

**[SPEC]**
1. Add a Browser Source in OBS.
2. Set the source URL to the overlay URL.
3. Match width and height to the stream canvas.
4. Keep `/operator` open privately for control.
5. Test a session before going live.

**[?]**
- Direct OBS WebSocket control exists as a scaffold and may not perform production scene switching yet.

## 3. Show Format

**[SPEC]**
- Introduce the case prompt before starting the court.
- Let the court run through argument phases.
- Tell viewers when voting opens.
- Read the final ruling and recap.
- Keep chat prompts and jokes within PG-13 boundaries.

**[NOTE]**
The best format is “structured chaos”: the court can be ridiculous, but the streamer/operator should keep the audience oriented.

## 4. Audience Interaction

**[SPEC]**
- Viewers can participate through voting when enabled.
- Chat command integrations are not final.
- Any command that affects visible output should be moderated or constrained.

**[?]**
Potential future command slots:

| Placeholder | Possible use | Status |
| --- | --- | --- |
| `!prompt` | Submit or suggest a future case prompt. | Planned placeholder. |
| `!press` | Ask the court to press a witness or point. | Partial/placeholder. |
| `!present` | Suggest evidence or present an item. | Partial/placeholder. |
| `!objection` | Trigger an objection-style audience beat. | Planned placeholder. |

## 5. Safety Boundaries

**[SPEC]**
- Do not show operator controls, secrets, environment variables, or admin tokens.
- Do not allow unmoderated chat text to become broadcast output.
- Use delay, manual review, or limited command formats for audience-submitted prompts.
- Keep case prompts fictional, consent-safe, and non-harassing.

## 6. Related Docs

**[SPEC]**
- [[03-operator-guide|Operator Guide]]
- [[05-viewer-and-chatter-guide|Viewer and Chatter Guide]]
- [[glossary|Glossary]]

## 7. Changelog

**[SPEC]**
- 1.0.0 — Added compact streamer guide and chat-command placeholders.
