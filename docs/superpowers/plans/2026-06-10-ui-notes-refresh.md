# UI Notes Refresh Implementation Plan

> **For agentic workers:** Execute this plan task-by-task. Recommended path:
> dispatch a fresh subagent per task, review each result with `review-quality`,
> then continue. For complex multi-agent splits, use
> `parallel-feature-development`, `team-composition-patterns`, and
> `team-communication-protocols`. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Implement every UI note in `docs/notes.md`: calmer responsive breakpoints, simpler public navigation, fixed dashboard/transcript overflow, full-height public pages, flat Neubrutal HUD panels, and a more useful/authenticated operator dashboard.

**Architecture:** Keep the existing Vite + Express monolith and its two SPAs. The public app remains query-param routed in `app/src/App.tsx`; the admin dashboard remains protected at `/operator`, but the shell and key panels are redesigned around information density, hard borders, and public/admin cross-navigation. No new UI dependencies are needed.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind CSS v3 utility classes, Express static/auth routes, Docker Compose deployment.

---

## Source Notes Coverage

- `docs/notes.md:3-5` — breakpoints should not happen so fast.
- `docs/notes.md:7-9` — header labels only: Dashboard, Transcripts, Submit Prompt, renamed Overlay, About.
- `docs/notes.md:11-16` — dashboard LED alignment, metric overflow, live-feed autoscroll, dashboard session click opens transcript detail.
- `docs/notes.md:18-22` — transcript empty state should be small in single-column layout, no right overflow, selected transcript scrolls to top, transcript detail height is capped and scrollable.
- `docs/notes.md:24-31` — Submit Prompt and About fill viewport; About hero gradient removed.
- `docs/notes.md:33-38` — auth/admin dashboard gets the new style, rethought useful pages, more exposed information, easy public/admin navigation.
- `docs/design/ui-tailwind-spec.md:8-20` — flat colors, hard borders, readable hierarchy, no public gradients/glass.
- `docs/design/ui-tailwind-spec.md:299-305` — `xl`-first responsive columns; avoid early layout collapse.

---

## File Structure

- Modify `app/src/data.ts`
  - Remove tab description content from `views` by setting empty notes.
  - Rename visible overlay label to `Broadcast` while keeping `ViewKey` as `overlay`.
- Modify `app/src/components.tsx`
  - Make `TabButton` render note text only when provided.
  - Keep accessible tab semantics.
- Modify `app/src/App.tsx`
  - Public shell full-height flex layout.
  - Dashboard metric card layout + live feed scroll bottom-lock.
  - Transcript URL state synchronization, selected-detail scroll reset, overflow containment.
  - Submit/About min-height fill and flat About hero.
- Modify `app/src/styles.css`
  - Add small utility classes only if needed for bottom-locked scroll containers and safe overflow.
- Modify `dashboard/src/index.css`
  - Keep current dashboard HSL tokens for tests, but add reusable admin classes for hard-edged panels, buttons, stat cards, scroll containment, and focus states.
- Modify `dashboard/src/App.tsx`
  - Redesign operator IA/header/nav with public/admin cross-links and high-density status cards.
  - Add useful global context: session, connection, active tab purpose, quick links, logout.
- Modify `dashboard/src/components/SessionMonitor.tsx`
  - Replace rounded gray default cards with hard-bordered admin panels.
  - Increase useful data density: session metrics, witness caps, vote tallies, evidence, event feed.
- Modify `dashboard/src/components/ManualControls.tsx`
  - Restyle manual controls to match new admin system.
  - Make destructive/high-impact controls clearer and more informative.
- Modify `dashboard/src/components/AdminTriggers.tsx`
  - Restyle trigger composer to match new admin system.
  - Keep existing POST contract unchanged.
- Modify `dashboard/src/components/CaseQueue.tsx`
  - Restyle queue/control panels to match new admin system.
  - Preserve pause/resume/start/skip behavior and admin CSRF header.
- Modify `src/server.ts`
  - Restyle `/admin/login` HTML to the new hard-bordered dashboard style.
  - Add explicit links back to public app and overlay from the login page.
- Modify `src/app-ui.test.ts`
  - Update brittle design assertions so they reflect the current file split and new notes.
- Modify or add dashboard/admin tests only if the changed auth HTML requires assertion updates.

---

## Task 1: Commit Requirements + Plan

**Files:**
- Create: `docs/superpowers/plans/2026-06-10-ui-notes-refresh.md`
- Modify: none
- Optional source artifact: `docs/notes.md`

- [ ] **Step 1: Review requirements source**

Read:

```bash
docs/notes.md
docs/design/ui-tailwind-spec.md
app/src/App.tsx
dashboard/src/App.tsx
src/server.ts
```

Expected: every bullet in `docs/notes.md` is represented by a later task.

- [ ] **Step 2: Commit the plan and notes**

Run:

```bash
git add docs/notes.md docs/superpowers/plans/2026-06-10-ui-notes-refresh.md
git commit -m "docs: plan UI notes refresh"
```

Expected: a docs commit exists before UI edits begin.

---

## Task 2: Public Shell Navigation + Layout Contract

**Files:**
- Modify: `app/src/data.ts`
- Modify: `app/src/components.tsx`
- Modify: `app/src/App.tsx`

- [ ] **Step 1: Simplify public nav labels**

In `app/src/data.ts`, keep the same keys but use label-only tabs:

```ts
export const views: Array<{ key: ViewKey; label: string; note: string }> = [
  { key: 'dashboard', label: 'Dashboard', note: '' },
  { key: 'overlay', label: 'Broadcast', note: '' },
  { key: 'transcripts', label: 'Transcripts', note: '' },
  { key: 'submit', label: 'Submit Prompt', note: '' },
  { key: 'about', label: 'About', note: '' },
];
```

- [ ] **Step 2: Make tabs note-optional**

In `app/src/components.tsx`, keep `TabButton` props unchanged but render the note conditionally:

```tsx
{note ? <p className="text-2xs text-[hsl(var(--ink-dim))]">{note}</p> : null}
```

Expected: the header shows only labels, not descriptions.

- [ ] **Step 3: Make public shell fill viewport**

In `app/src/App.tsx`, change the public shell from a normal block page to a flex column:

```tsx
<div className="min-h-screen bg-[hsl(var(--void))] text-[hsl(var(--ink))] font-body flex flex-col overflow-x-hidden">
  ...
  <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-6">
    <section className="min-w-0 flex-1" ...>
      ...
    </section>
  </main>
  ...
</div>
```

Expected: Submit Prompt and About can consume remaining viewport height and the footer sits at the bottom on short pages.

- [ ] **Step 4: Verify build**

Run:

```bash
npm run build
```

Expected: TypeScript and both Vite builds pass.

- [ ] **Step 5: Commit public shell work**

Run:

```bash
git add app/src/data.ts app/src/components.tsx app/src/App.tsx
git commit -m "fix: simplify public shell navigation"
```

---

## Task 3: Public Dashboard + Transcript UX Fixes

**Files:**
- Modify: `app/src/App.tsx`

- [ ] **Step 1: Fix live LED alignment and remove dashboard gradient**

Replace the live dashboard hero panel gradient with a flat raised panel and align LED/section header in one baseline row:

```tsx
<ConsolePanel className="overflow-hidden border-[hsl(var(--pulse))] bg-[hsl(var(--panel))]">
  <div className="grid gap-0 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
    <div className="min-w-0 p-5">
      <div className="flex items-start gap-2">
        <span className="mt-[0.45rem] inline-flex shrink-0"><StatusLed state={connected ? 'live' : 'sync'} /></span>
        <HudSection label={`Live court · ${prettyLabel(activePhase)}`} note={connected ? 'SSE live' : liveError ?? 'Polling'} />
      </div>
```

Expected: the square LED visually aligns with the LIVE COURT heading.

- [ ] **Step 2: Stop dashboard metric overflow**

Replace the 4-up `sm:grid-cols-4` metrics with cards that stack values under labels and only become four columns at `xl`:

```tsx
<div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
  <MetricCard label="Turns" value={String(activeTurnCount)} tone="pulse" />
  <MetricCard label="Length" value={runtime} tone="caution" />
  <MetricCard label="Evidence" value={`${evidenceCount} cards`} tone="signal" />
  <MetricCard label="Objections" value={String(objectionCount)} tone={objectionCount > 0 ? 'alert' : 'ink-dim'} />
</div>
```

Add a local helper in `app/src/App.tsx` near `StatusPill`:

```tsx
function MetricCard({ label, value, tone = 'ink' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 border bg-[hsl(var(--void-800))] p-3" style={{ borderColor: `hsl(var(--${tone}) / 0.5)` }}>
      <p className="text-2xs uppercase tracking-[0.12em] text-[hsl(var(--ink-mute))]">{label}</p>
      <p className="mt-1 break-words text-lg font-bold leading-tight" style={{ color: `hsl(var(--${tone}))` }}>{value}</p>
    </div>
  );
}
```

- [ ] **Step 3: Bottom-lock the dashboard live feed**

Add a ref and effect inside `DashboardView`:

```tsx
const liveFeedRef = useRef<HTMLDivElement | null>(null);
useEffect(() => {
  const node = liveFeedRef.current;
  if (!node) return;
  node.scrollTop = node.scrollHeight;
}, [recentLiveTurns.length, liveSession?.id]);
```

Wrap feed rows in a capped scroll region:

```tsx
<div ref={liveFeedRef} className="max-h-64 space-y-2 overflow-y-auto pr-1" role="log" aria-live="polite">
```

Expected: newest live turns remain visible as turns arrive.

- [ ] **Step 4: Fix dashboard session click → transcript detail**

In `TranscriptsView`, listen for `popstate` and URL `case` changes:

```tsx
useEffect(() => {
  const syncCaseFromUrl = () => setSelectedTranscriptId(getCaseParam());
  window.addEventListener('popstate', syncCaseFromUrl);
  return () => window.removeEventListener('popstate', syncCaseFromUrl);
}, []);
```

Expected: clicking a dashboard session switches to Transcripts and fetches the selected case detail.

- [ ] **Step 5: Fix transcript overflow, empty state, and detail scroll reset**

Add a detail scroll ref in `TranscriptsView`:

```tsx
const detailScrollRef = useRef<HTMLDivElement | null>(null);
useEffect(() => {
  detailScrollRef.current?.scrollTo({ top: 0 });
}, [selectedTranscriptId, selectedSession?.id]);
```

Use a single-column-safe layout:

```tsx
<div className={cn('grid min-w-0 gap-4', selectedTranscriptId ? 'xl:grid-cols-[minmax(0,1fr)_320px]' : 'xl:grid-cols-[360px_minmax(0,1fr)]')}>
```

Make empty transcript view small until a case is selected:

```tsx
<ConsolePanel className={cn('min-w-0 p-4 flex flex-col', selectedTranscriptId ? 'min-h-[70vh] max-h-[72vh]' : 'min-h-48')}>
```

Attach the scroll ref:

```tsx
<div ref={detailScrollRef} className="mt-3 flex-1 overflow-y-auto pr-1" role="log" aria-live="polite">
```

Expected: no right overflow at single-column widths; selected transcript starts at top and has an internal scroll region.

- [ ] **Step 6: Make Submit/About panels fill remaining viewport and remove About gradient**

Use `min-h-full` wrappers:

```tsx
return <div className="grid min-h-full gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">...</div>;
```

For About hero, replace `bg-gradient-to-r ...` with:

```tsx
<ConsolePanel className="overflow-hidden border-[hsl(var(--signal)/0.55)] bg-[hsl(var(--panel))] p-5">
```

Expected: flat hero panel; Submit/About occupy viewport comfortably.

- [ ] **Step 7: Verify public app build**

Run:

```bash
npm run build
```

Expected: build passes.

- [ ] **Step 8: Commit public UX fixes**

Run:

```bash
git add app/src/App.tsx
git commit -m "fix: polish public dashboard and transcripts"
```

---

## Task 4: Operator Dashboard Shell IA + Shared Admin Style

**Files:**
- Modify: `dashboard/src/index.css`
- Modify: `dashboard/src/App.tsx`

- [ ] **Step 1: Add reusable admin classes**

In `dashboard/src/index.css`, add hard-edged utilities:

```css
.admin-panel { border: 1px solid hsl(var(--border)); background: hsl(var(--surface) / 0.86); }
.admin-panel-raised { border: 1px solid hsl(var(--border)); background: hsl(var(--surface-2) / 0.92); }
.admin-label { font-size: 10px; letter-spacing: 0.28em; text-transform: uppercase; color: hsl(var(--cyan)); }
.admin-muted { color: hsl(var(--muted)); }
.admin-button { border: 1px solid hsl(var(--border)); background: hsl(var(--surface-2)); color: hsl(var(--text)); }
.admin-button:hover { border-color: hsl(var(--cyan) / 0.7); }
button:focus-visible, a:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 1px solid hsl(var(--cyan)); outline-offset: 2px; }
* { box-sizing: border-box; }
body { overflow-x: hidden; }
```

Expected: the dashboard can use hard borders consistently without new dependencies.

- [ ] **Step 2: Rethink dashboard tabs into useful operator areas**

Keep existing `DashboardTabId` values to avoid churn, but relabel `TABS`:

```ts
const TABS: DashboardTab[] = [
  { id: 'monitor', label: 'Live Court', icon: 'LIVE' },
  { id: 'caseQueue', label: 'Queue', icon: 'QUEUE', preload: loadCaseQueue },
  { id: 'controls', label: 'Control', icon: 'CTRL', preload: () => Promise.all([loadManualControls(), loadAdminTriggers()]) },
  { id: 'broadcast', label: 'Broadcast', icon: 'OBS' },
  { id: 'llm', label: 'LLM Audit', icon: 'LLM', preload: loadLLMAuditLog },
  { id: 'analytics', label: 'Analytics', icon: 'DATA', preload: loadAnalytics },
  { id: 'ops', label: 'Ops', icon: 'OPS', preload: loadOpsMetrics },
  { id: 'moderation', label: 'Moderation', icon: 'MOD', preload: loadModerationQueue },
  { id: 'recap', label: 'Recap', icon: 'RECAP' },
];
```

Expected: fewer cutesy icons; more operator-readable labels.

- [ ] **Step 3: Add dashboard top context and cross-navigation**

In `dashboard/src/App.tsx`, replace rounded/glass header with a hard-bordered top bar containing:

```tsx
<a href="/" className="admin-button px-3 py-2 text-xs uppercase tracking-[0.18em]">Public</a>
<a href="/?view=overlay" className="admin-button px-3 py-2 text-xs uppercase tracking-[0.18em]">Broadcast</a>
<form method="post" action="/api/admin/logout"><button className="admin-button px-3 py-2 text-xs uppercase tracking-[0.18em]">Logout</button></form>
```

Also show connection, session ID, current phase, turns, event count, active tab.

Expected: operators can move back and forth between public/admin areas quickly.

- [ ] **Step 4: Make nav responsive without early breakpoint churn**

Use a horizontal scroll tab bar instead of wrapping at small widths:

```tsx
<nav className="border-b border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
  <div className="mx-auto max-w-[1600px] overflow-x-auto px-4">
    <div className="flex min-w-max gap-1 py-2">
```

Expected: tabs remain readable and do not force awkward early wrapping.

- [ ] **Step 5: Verify dashboard build**

Run:

```bash
npm run build
```

Expected: dashboard and public app build.

- [ ] **Step 6: Commit dashboard shell work**

Run:

```bash
git add dashboard/src/index.css dashboard/src/App.tsx
git commit -m "feat: redesign operator dashboard shell"
```

---

## Task 5: Operator Panels + Auth Login Restyle

**Files:**
- Modify: `dashboard/src/components/SessionMonitor.tsx`
- Modify: `dashboard/src/components/ManualControls.tsx`
- Modify: `dashboard/src/components/AdminTriggers.tsx`
- Modify: `dashboard/src/components/CaseQueue.tsx`
- Modify: `src/server.ts`

- [ ] **Step 1: Restyle Session Monitor**

Replace `bg-gray-800 rounded-lg shadow-lg` cards with `admin-panel p-5`, use `xl:grid-cols-[1.1fr_0.9fr]`, and make event feed scrollable:

```tsx
<div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
  <section className="admin-panel p-5">...</section>
  <section className="admin-panel p-5">...</section>
</div>
```

Expected: useful data remains visible without soft rounded legacy styling.

- [ ] **Step 2: Restyle Manual Controls**

Use `admin-panel` blocks, high-contrast action buttons, and explicit live-session context:

```tsx
<section className="admin-panel p-5">
  <p className="admin-label">Session control</p>
  <h2 className="mt-2 text-xl font-semibold">Create or advance court state</h2>
```

Expected: controls look like the new operator dashboard and still call the same APIs.

- [ ] **Step 3: Restyle Admin Triggers**

Remove rounded/glass classes; use hard cards and clear current trigger preview:

```tsx
<section className="admin-panel p-5">
  <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">...</div>
</section>
```

Expected: stinger controls remain protected and readable.

- [ ] **Step 4: Restyle Case Queue**

Use `admin-panel`/`admin-panel-raised`, no large rounded pills, and make automation state prominent:

```tsx
<section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">...</section>
```

Expected: queue, automation, fallback circuit, submitted cases, and history are easier to scan.

- [ ] **Step 5: Restyle `/admin/login`**

In `src/server.ts`, remove rounded/glass/gradient button CSS from the login HTML and use the same hard admin style:

```css
.shell { width: min(100%, 520px); border: 1px solid hsl(var(--border)); padding: 28px; background: hsl(var(--surface)); box-shadow: 8px 8px 0 rgba(0,0,0,.45); }
input, button, a { border-radius: 0; }
.links { display: grid; gap: 8px; margin-top: 16px; }
.links a { border: 1px solid hsl(var(--border)); padding: 10px 12px; color: hsl(var(--cyan)); text-decoration: none; }
```

Expected: auth page matches the admin dashboard and includes links to `/`, `/?view=overlay`, and `/operator`.

- [ ] **Step 6: Verify build**

Run:

```bash
npm run build
```

Expected: TypeScript and both Vite builds pass.

- [ ] **Step 7: Commit operator/auth panel work**

Run:

```bash
git add dashboard/src/components/SessionMonitor.tsx dashboard/src/components/ManualControls.tsx dashboard/src/components/AdminTriggers.tsx dashboard/src/components/CaseQueue.tsx src/server.ts
git commit -m "feat: restyle admin controls and login"
```

---

## Task 6: Tests + Browser Verification

**Files:**
- Modify: `src/app-ui.test.ts`
- Optionally modify: `src/server.test.ts`

- [ ] **Step 1: Update stale public UI assertions**

Change `src/app-ui.test.ts` so it asserts current real requirements:

```ts
assert.match(app, /function useLiveOverlaySession/);
assert.match(app, /function DashboardView/);
assert.match(app, /function TranscriptsView/);
assert.match(app, /role="log"/);
assert.match(app, /aria-live="polite"/);
assert.match(styles, /prefers-reduced-motion:\s*reduce/);
assert.match(data, /Broadcast/);
assert.doesNotMatch(data, /16:9 broadcast frame/);
```

Expected: tests stop expecting removed mock UI tokens while still covering accessibility and navigation.

- [ ] **Step 2: Run automated checks**

Run:

```bash
npm test
npm run build
```

Expected: both pass.

- [ ] **Step 3: Browser-check public app**

Run local server or use deployed staging after final deploy. Check these URLs at 320, 768, 1280, and ultrawide widths:

```text
http://localhost:3001/
http://localhost:3001/?view=transcripts
http://localhost:3001/?view=submit
http://localhost:3001/?view=about
http://localhost:3001/?view=overlay
```

Expected:
- No horizontal scrollbar.
- Header shows label-only tabs.
- Dashboard metrics do not overflow.
- Live feed scroll stays at newest turn.
- Dashboard session click opens transcript detail.
- Transcript detail is capped and internally scrollable.
- Empty transcript detail is compact in one-column layout.
- Submit/About fill the viewport.
- About hero has no gradient.

- [ ] **Step 4: Browser-check admin/auth**

Check:

```text
http://localhost:3001/admin/login
http://localhost:3001/operator
```

Expected:
- Login matches hard-border admin styling.
- Operator dashboard exposes public/overlay/admin navigation.
- Tabs remain usable on narrow widths without right overflow.
- Monitor, queue, control, broadcast, LLM, analytics, ops, moderation, recap panels render.

- [ ] **Step 5: Commit test updates**

Run:

```bash
git add src/app-ui.test.ts src/server.test.ts
git commit -m "test: update UI notes coverage"
```

Only include `src/server.test.ts` if it changes.

---

## Task 7: Final Sync + Redeploy

**Files:**
- None expected beyond completed tasks.

- [ ] **Step 1: Final git check**

Run:

```bash
git status --branch --short
git diff --stat
git log --oneline -10
```

Expected: only intentionally untracked local assets remain; no unstaged tracked edits.

- [ ] **Step 2: Push commits**

Run:

```bash
git fetch origin
git push origin main
```

Expected: `main` synced with `origin/main`.

- [ ] **Step 3: Rebuild/redeploy Docker services**

Run:

```bash
docker compose --env-file .env up -d --build
```

Expected: `juryrigged-api` is rebuilt and restarted; `juryrigged-db` remains healthy.

- [ ] **Step 4: Verify deployment**

Run:

```bash
docker compose --env-file .env ps
curl -fsS http://10.0.0.56:3040/api/health
curl -fsS https://jury-rigged.subcult.tv/api/health
curl -fsSI "https://jury-rigged.subcult.tv/app/?view=transcripts"
docker compose --env-file .env logs --since=2m api
```

Expected: local/public health pass, public app returns HTTP 200, and logs show normal migration/startup without fatal errors.

---

## Self-Review

- Spec coverage: every bullet in `docs/notes.md` maps to Tasks 2-6.
- Placeholder scan: no task relies on TBD behavior; all code steps name exact files and commands.
- Type consistency: `ViewKey` remains unchanged; only visible overlay label changes to `Broadcast`. Existing API contracts remain unchanged.
