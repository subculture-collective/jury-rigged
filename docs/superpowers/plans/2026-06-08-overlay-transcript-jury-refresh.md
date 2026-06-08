# Overlay Transcript Jury Refresh Implementation Plan

> **For agentic workers:** Execute this plan task-by-task. Recommended path:
> dispatch a fresh subagent per task, review each result with `review-quality`,
> then continue. For complex multi-agent splits, use
> `parallel-feature-development`, `team-composition-patterns`, and
> `team-communication-protocols`. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Make the React stream overlay readable on broadcast, transcript-oriented, and jury-forward while preserving follow-up backend/product work as separate milestones.

**Architecture:** Treat `app/src/App.tsx` as the only active stream overlay surface. Keep Phase 1 mostly frontend-only by deriving transcript, phase, evidence, objections, and juror display state from existing live session data. Add a small deterministic juror helper if session metadata has no juror pool yet, so jurors remain stable for the active session without introducing persistence or migrations.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vite app build, Node test runner for any shared TypeScript helpers.

---

## Behavior Contract

- The primary overlay is `/app?view=overlay`; the legacy public overlay remains unchanged.
- Small labels and metadata in the overlay must be larger and stream-readable.
- The current beat area must display as a scrollable transcript with newest entries first.
- Each transcript entry must show speaker display name, courtroom role, turn number, phase, timestamp, and dialogue.
- Transcript body text should be lighter and a little smaller than the previous latest-turn hero text so more fits on screen.
- The previous “Last three entries” section must become three cards: current phase, evidence, and objections.
- The bottom judge/bailiff chips must be replaced by a jury panel.
- Jurors should use generated names and simple personality labels in Phase 1.
- Larger requested features are follow-up milestones: searchable transcript index, chatbot link drops, admin message/trigger UI, phase/evidence/objection stingers, and public prompt submission/queue page.

## Files and Responsibilities

- Modify `app/src/App.tsx` — overlay layout, transcript rendering, phase/evidence/objection cards, jury panel, generated juror display helpers.
- Modify `src/types.ts` only if juror metadata must be added to the canonical session contract.
- Create `src/court/jurors.ts` and `src/court/jurors.test.ts` only if jurors are persisted in session metadata for stable backend-generated sessions.
- Verify with `npm run lint:app`, `npm run lint`, `npm test`, and `npm run build` where practical.

---

### Task 1: React overlay transcript refresh

**Files:**
- Modify: `app/src/App.tsx`

- [x] **Step 1: Add overlay transcript helpers**

Add helpers near existing overlay helper functions:

```ts
function formatTurnTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'time unknown';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function newestTurnsFirst(session: LiveSession): LiveTurn[] {
  return [...session.turns].reverse();
}
```

- [x] **Step 2: Replace latest-turn card with scrollable transcript**

In `OverlayView`, replace the current “Latest turn on record” article/grid with a single transcript panel using `newestTurnsFirst(session)`. Use `overflow-y-auto`, `role="log"`, `aria-live="polite"`, and visible labels for role/speaker.

- [x] **Step 3: Verify app typecheck**

Run:

```bash
npm run lint:app
```

Expected: TypeScript passes for the React app.

---

### Task 2: Phase/evidence/objection card replacement

**Files:**
- Modify: `app/src/App.tsx`

- [x] **Step 1: Remove recent-turn cards**

Delete the `recentTurns` usage and the “Last three entries” surface.

- [x] **Step 2: Add three status cards**

Add a three-card grid below the transcript with:

```ts
Current phase: session.phase, phase timer/runtime, live status
Evidence: session.metadata.evidenceCards.length and latest evidence text/id
Objections: session.metadata.objectionCount ?? 0 and latest directive/effect if present
```

- [x] **Step 3: Verify app typecheck**

Run:

```bash
npm run lint:app
```

Expected: TypeScript passes for the React app.

---

### Task 3: Jury panel and juror names

**Files:**
- Modify: `app/src/App.tsx`

- [x] **Step 1: Add deterministic juror name/personality generation**

Add local overlay helpers that hash `session.id`, choose names from fixed first/last name pools, and assign one personality trait per juror. Return 6 jurors for the overlay.

- [x] **Step 2: Replace judge/bailiff chips**

Replace the bottom `Surface` that renders `Judge` and `Bailiff` chips with a jury panel that shows 6 jurors in compact rows/cards. Each juror should show name, role label such as `Juror 01`, and personality.

- [x] **Step 3: Verify app typecheck**

Run:

```bash
npm run lint:app
```

Expected: TypeScript passes for the React app.

---

### Task 4: Broadcast readability pass

**Files:**
- Modify: `app/src/App.tsx`

- [x] **Step 1: Increase small overlay text sizes**

Change tiny `text-[10px]` overlay labels in `OverlayView` to at least `text-xs`, and critical status values to `text-sm` or larger.

- [x] **Step 2: Keep transcript dense but readable**

Use transcript dialogue around `text-base`/`lg:text-lg` with `font-normal` and `leading-7`; avoid the old `text-2xl` latest-turn body.

- [x] **Step 3: Verify full build**

Run:

```bash
npm run build
```

Expected: TypeScript and both Vite builds pass.

---

## Follow-up Milestones Not Included in Phase 1

- Searchable transcript index by case id, session id, and case title/name.
- Public transcript detail pages and bot/chat link drop after `session_completed`.
- Admin UI and admin-protected routes for creating messages and triggers.
- Stinger-like animated popups for phase changes, evidence, and objections.
- Public prompt submission page that returns queue position, estimated start time, stream link, and transcript search link.

## Self-Review

- Spec coverage: Phase 1 covers overlay readability, transcript current beat, scrolling, replacement cards, and jury display with generated names/personality. Backend/product requests are captured as follow-up milestones.
- Placeholder scan: No implementation steps rely on TBD placeholders.
- Type consistency: Plan uses existing `LiveSession`, `LiveTurn`, session metadata, and React overlay helpers already present in `app/src/App.tsx`.
