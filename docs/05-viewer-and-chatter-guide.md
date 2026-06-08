---
title: Viewer and Chatter Guide
description: Plain-language guide for watching JuryRigged and future chat interactions.
audience:
  - viewers
  - chatters
  - streamers
tags:
  - juryrigged
  - audience
  - chat
status: maintained
updated: 2026-06-07
---

# Viewer and Chatter Guide

**Version 1.0.0** · JuryRigged · 2026-06-07 · Audience guide

---

## AI READING INSTRUCTION

Read `[SPEC]` blocks for current viewer behavior. Treat `[?]` sections as placeholders for future chat commands.

---

## 1. What You Are Watching

**[SPEC]**
- [[glossary|JuryRigged]] is an AI courtroom show.
- A strange case enters the court.
- AI courtroom roles argue, testify, object, and judge.
- Viewers follow the [[glossary#Live Transcript|live transcript]].
- The audience may vote when the court reaches a voting phase.

## 2. How To Participate Now

**[SPEC]**
1. Watch the case unfold.
2. Wait for the voting phase.
3. Cast a vote if voting is open.
4. Follow the final verdict and sentence.

## 3. Voting

**[SPEC]**
- Voting is only valid during voting phases.
- The app may reject duplicate, late, or malformed votes.
- Vote totals can update live.
- The final result belongs to the session record.

## 4. Chat Commands

**[SPEC]**
The Twitch bot recognizes these commands when Twitch credentials are configured:

| Command | Meaning | Notes |
| --- | --- | --- |
| `!prompt <case idea>` | Submit a fictional case idea to the visible queue. | Queued prompts run before generated cases. |
| `!commands` / `!help` | Show command help in chat. | Works even when no case is running. |
| `!case` / `!status` | Show whether court is live and where to watch. | Works even when no case is running. |
| `!press <statement #>` | Ask the court to press a witness statement. | Requires a running session. |
| `!present <evidence id> [statement #]` | Suggest evidence for the current exchange. | Requires a running session. |
| `!vote <choice>` | Cast a verdict vote. | Valid during verdict voting windows. |
| `!sentence <choice>` | Cast a sentencing vote. | Valid during sentence voting windows. |
| `!objection` | Get a playful bot response. | Informational/cosmetic for now. |

## 5. Case Automation Queue

**[SPEC]**
- JuryRigged can keep court running with generated cases.
- Chat-submitted cases use `!prompt <case idea>`.
- The stream owner may restrict `!prompt` to followers, subscribers, VIPs, moderators, or broadcaster-only mode.
- Submitted cases enter a visible queue on the public page.
- Queued submitted cases run before generated fallback cases.
- If the queue is empty after a case ends, the next case is generated automatically.

## 6. Chat Safety

**[SPEC]**
- Keep prompts fictional and PG-13.
- Do not submit personal information.
- Do not target real private people.
- Do not try to force unsafe content into the show.
- Operators may ignore, redact, or reject unsafe submissions.

## 7. Useful Phrases

**[SPEC]**
- “All rise. The stream is now in session.”
- “The jury may now make a terrible decision.”
- “Objection sustained, mostly for vibes.”

## 8. Related Docs

**[SPEC]**
- [[04-streamer-guide|Streamer Guide]]
- [[03-operator-guide|Operator Guide]]
- [[glossary|Glossary]]

## 9. Changelog

**[SPEC]**
- 1.1.0 — Added live `!prompt` queue and generated fallback behavior.
- 1.0.0 — Added audience-facing guide and command placeholder area.
