---
title: Glossary
description: Canonical JuryRigged terms and short definitions.
audience:
  - contributors
  - operators
  - streamers
  - viewers
tags:
  - juryrigged
  - glossary
status: maintained
updated: 2026-06-07
---

# Glossary

**Version 1.0.0** · JuryRigged · 2026-06-07 · Canonical terms

---

## AI READING INSTRUCTION

Read `[SPEC]` definitions as canonical project vocabulary. Treat `[?]` entries as planned or unstable terms.

---

## Admin Auth

**[SPEC]**
Authentication that protects operator-only routes and actions, especially [[#Operator Dashboard|operator dashboard]] access.

## Case File

**[SPEC]**
Structured context for a [[#Court Session|court session]], such as charges, witnesses, and evidence.

## Case Prompt

**[SPEC]**
The seed accusation, dispute, or scenario used to start a court session.

## Court Event

**[SPEC]**
An emitted runtime record that tells clients what happened in a court session.

## Court Phase

**[SPEC]**
A named step in the session flow, such as `openings`, `witness_exam`, `verdict_vote`, or `final_ruling`.

## Court Session

**[SPEC]**
One complete run of a case through the JuryRigged courtroom flow.

## JuryRigged

**[SPEC]**
A real-time AI courtroom broadcast engine with live transcript, viewer voting, moderation, operator controls, and stream overlays.

## Live Transcript

**[SPEC]**
The viewer-facing stream of court dialogue and session events.

## Obsidian Vault

**[SPEC]**
A folder of Markdown files managed by Obsidian. These docs use frontmatter and wiki links so the `docs/` directory can be dropped into a vault.

## Operator Dashboard

**[SPEC]**
The private control surface at `/operator` for starting, monitoring, moderating, and recovering sessions.

## Overlay

**[SPEC]**
An OBS-friendly display surface for showing the court session on stream.

## Render Directive

**[SPEC]**
Structured visual instruction emitted with or near court events, such as camera, pose, face, or effect cues.

## Server-Sent Events

**[SPEC]**
HTTP streaming mechanism used to push live court events to clients.

## SSE

**[SPEC]**
Abbreviation for [[#Server-Sent Events|Server-Sent Events]].

## Viewer Vote

**[SPEC]**
Audience vote accepted during a voting phase and counted toward session outcome or audience signal.

## Chat Command

**[?]**
An audience command submitted through chat. The final command set is not yet stable.

## Evidence Reveal

**[?]**
A planned or partial court phase for presenting evidence. Do not assume full production behavior until implementation is confirmed.

## Changelog

**[SPEC]**
- 1.0.0 — Added canonical glossary for Obsidian linking.
