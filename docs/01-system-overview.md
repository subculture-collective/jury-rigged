---
title: System Overview
description: What JuryRigged is, how a session works, and the main system concepts.
audience:
  - contributors
  - operators
  - streamers
tags:
  - juryrigged
  - architecture
  - court-session
status: maintained
updated: 2026-06-07
---

# System Overview

**Version 1.0.0** · JuryRigged · 2026-06-07 · Core concepts

---

## AI READING INSTRUCTION

Read `[SPEC]` blocks for authoritative facts. Read `[NOTE]` blocks for explanation. Treat `[?]` as planned or uncertain behavior.

---

## 1. Product Summary

**[SPEC]**
- [[glossary|JuryRigged]] turns a case prompt into a live AI courtroom broadcast.
- AI courtroom roles argue through a structured [[glossary#Court Session|court session]].
- Viewers follow the [[glossary#Live Transcript|live transcript]] and may vote during jury phases.
- Operators control sessions through the [[glossary#Operator Dashboard|operator dashboard]].
- Streamers can capture the public viewer or [[glossary#Overlay|overlay]] in OBS.

**[NOTE]**
The product should feel like a chaotic courtroom show that is still safe enough to operate live.

## 2. Main Surfaces

**[SPEC]**
| Surface | Path | Audience | Purpose |
| --- | --- | --- | --- |
| Public viewer | `/` | Viewers, streamers | Watch the current session and vote when enabled. |
| Overlay | `/?view=overlay` | Streamers | OBS-friendly broadcast view. |
| Operator dashboard | `/operator` | Operators | Start, monitor, moderate, and recover sessions. |
| API | `/api/*` | Contributors, integrations | Session control, voting, health, and events. |

## 3. Session Flow

**[SPEC]**
- A [[glossary#Case Prompt|case prompt]] starts a session.
- A generated [[glossary#Case File|case file]] may include charges, witnesses, and evidence.
- The court advances through phases in one direction.
- Typical phases:
  1. `case_prompt`
  2. `openings`
  3. `witness_exam`
  4. `evidence_reveal`
  5. `closings`
  6. `verdict_vote`
  7. `sentence_vote`
  8. `final_ruling`
- Events stream to clients over [[glossary#SSE|Server-Sent Events]].

**[?]**
- `evidence_reveal` exists as a phase concept but may be skipped or incomplete in the current runtime.

## 4. Court Roles

**[SPEC]**
- Core roles include judge, prosecution, defense, witness, bailiff, and jury.
- Roles generate dialogue, procedural beats, and audience-facing events.
- The exact character roster is implementation-defined and may change.

**[NOTE]**
Avoid documenting individual agent names as permanent unless the source code has stabilized around them.

## 5. Event Model

**[SPEC]**
- The server emits [[glossary#Court Event|court events]] as the source of truth for live clients.
- Important event groups:
  - session lifecycle events
  - dialogue events
  - phase transition events
  - vote update events
  - moderation events
  - render directive events
- Clients should render from events, not guess state transitions.

## 6. Runtime Components

**[SPEC]**
| Component | Responsibility |
| --- | --- |
| Express server | API, static assets, auth, SSE streams. |
| Court orchestrator | Phase progression and agent turns. |
| Store | In-memory or Postgres-backed session state. |
| Public app | Viewer and overlay UI. |
| Dashboard app | Operator control UI. |
| Broadcast adapter | Optional OBS/broadcast integration. |
| Twitch/chat layer | Partial audience command integration. |

## 7. Related Docs

**[SPEC]**
- [[02-contributor-guide|Contributor Guide]]
- [[03-operator-guide|Operator Guide]]
- [[04-streamer-guide|Streamer Guide]]
- [[05-viewer-and-chatter-guide|Viewer and Chatter Guide]]
- [[glossary|Glossary]]

## 8. Changelog

**[SPEC]**
- 1.0.0 — Replaced older architecture notes with compact system overview.
