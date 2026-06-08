# Case Automation Queue Implementation Plan

> **For agentic workers:** Execute this plan task-by-task. Recommended path:
> dispatch a fresh subagent per task, review each result with `review-quality`,
> then continue. For complex multi-agent splits, use
> `parallel-feature-development`, `team-composition-patterns`, and
> `team-communication-protocols`. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Keep JuryRigged running continuously with generated cases, while allowing Twitch chatters and operators to submit queued case prompts that take priority over generated defaults.

**Architecture:** Add a small persistent case queue to the server, expose public queue/read endpoints plus admin queue controls, and run a single scheduler that starts the next queued case or a generated prompt whenever no session is running. Twitch `!prompt` submits to the queue, public UI explains the flow and shows the queue, and operator UI manages submissions.

**Tech Stack:** Express, TypeScript, Postgres optional store pattern, React/Vite public app, React/Vite dashboard, tmi.js Twitch bot, Node test runner.

---

## Behavior Contract

- Generated cases should run automatically when no session is running and the user queue is empty.
- User-triggered cases should be submitted with `!prompt <case idea>` in Twitch chat or from the operator dashboard.
- If no case is running, the next approved/queued user case should start immediately.
- If a case is running, submitted cases should enter a visible FIFO queue.
- After each case completes/fails, the scheduler should start the next queued user case; if no queued cases exist, it should start a generated case.
- Public viewers should see: how automation works, how to submit a case, current running case, and queued case count/list.
- Operators should see queue details and be able to approve/start/remove submitted cases.
- Keep the first version simple: no complex moderation workflow, no priority tiers, no persisted queue history beyond completed/skipped status.

## Files and Responsibilities

- Create `src/court/case-queue.ts` — in-memory queue types, validation, generated-case scheduler decisions, no Express dependency.
- Modify `src/server.ts` — instantiate queue, expose queue APIs, add scheduler loop, use existing `createSessionHandler` logic safely.
- Modify `src/twitch/commands.ts` — parse `!prompt <case idea>` into a new command action.
- Modify `src/twitch/bot.ts` — forward `!prompt` to the queue endpoint and mention it in help/timed messages.
- Modify `src/types.ts` — add shared queue item/status types if frontend needs them.
- Modify `app/src/App.tsx` — show automation explainer, current source, and visible queue on public page.
- Modify `dashboard/src/App.tsx` or create `dashboard/src/components/CaseQueue.tsx` — operator queue view/controls.
- Modify `docs/05-viewer-and-chatter-guide.md` and `docs/03-operator-guide.md` — document commands and automation rules.
- Test with `npm run build`, `npm test`, `docker compose up -d --build`, public `/api/health`, and startup logs.

---

### Task 1: Queue model and unit tests

**Files:**
- Create: `src/court/case-queue.ts`
- Create: `src/court/case-queue.test.ts`

- [ ] **Step 1: Write failing tests for queue behavior**

Cover:
- enqueue chat prompt trims input and rejects empty/too-long input
- queued items are FIFO
- item can be marked `running`, then `completed`
- generated fallback decision is returned when queue is empty

Run:

```bash
npm test -- src/court/case-queue.test.ts
```

Expected first result: FAIL because module does not exist.

- [ ] **Step 2: Implement `case-queue.ts`**

Use a minimal in-memory queue:

```ts
export type CaseQueueSource = 'twitch' | 'operator' | 'generated';
export type CaseQueueStatus = 'queued' | 'running' | 'completed' | 'skipped';

export interface CaseQueueItem {
  id: string;
  prompt: string;
  source: CaseQueueSource;
  submittedBy?: string;
  status: CaseQueueStatus;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
}
```

Expose methods:
- `enqueue(input)`
- `list()`
- `nextQueued()`
- `markRunning(id, sessionId)`
- `markCompletedForSession(sessionId)`
- `skip(id)`
- `snapshot()`

- [ ] **Step 3: Run queue tests**

```bash
npm test -- src/court/case-queue.test.ts
```

Expected: PASS.

---

### Task 2: Server queue API and scheduler

**Files:**
- Modify: `src/server.ts`
- Modify/Create tests if existing API tests cover server routes; otherwise create `src/court/case-queue-scheduler.test.ts` for pure scheduler decisions.

- [ ] **Step 1: Add queue endpoints**

Add public read/submit endpoints:

- `GET /api/court/case-queue` — returns `{ queue, runningSessionId, automationEnabled }`
- `POST /api/court/case-queue` — accepts `{ prompt, source?, submittedBy? }`, validates prompt, enqueues item

Add admin endpoints protected with existing admin middleware:

- `POST /api/admin/case-queue/:id/start` — start selected queued case if no case is running
- `POST /api/admin/case-queue/:id/skip` — mark queued item skipped

- [ ] **Step 2: Add scheduler loop**

Implement a single interval/timer after route registration:

- check `store.listSessions()` for any `running` session
- if one is running, do nothing
- if none running, call `caseQueue.nextQueued()`
- if queued item exists, create/start session using its prompt and mark it running
- if no queued item exists and `AUTO_GENERATE_CASES !== 'false'`, create/start session with generated prompt by reusing existing no-topic behavior

Use a lock boolean like `caseSchedulerInFlight` so the interval cannot start two sessions concurrently.

- [ ] **Step 3: Prevent duplicate generated starts**

Make the scheduler wait a configurable delay after a session completes before starting the next generated case:

```env
AUTO_GENERATE_CASES=true
AUTO_CASE_IDLE_DELAY_MS=10000
CASE_QUEUE_POLL_MS=5000
```

Queued user cases should bypass most idle delay and start on the next poll.

- [ ] **Step 4: Build and run tests**

```bash
npm test
npm run build
```

Expected: all pass.

---

### Task 3: Twitch `!prompt` command

**Files:**
- Modify: `src/twitch/commands.ts`
- Modify: `src/twitch/bot.ts`
- Modify tests if Twitch command tests exist; otherwise add `src/twitch/commands.test.ts`.

- [ ] **Step 1: Extend command parser**

Parse:

```text
!prompt The defendant stole the moon using office glitter
```

Into:

```ts
{ action: 'prompt', params: { prompt: 'The defendant stole the moon using office glitter' } }
```

Reject empty prompt and prompts over the same server max length.

- [ ] **Step 2: Forward prompt submissions**

In `TwitchBot.forwardCommand`, route `prompt` to:

```http
POST /api/court/case-queue
{ "prompt": "...", "source": "twitch", "submittedBy": "username" }
```

Reply in chat on success:

```text
@user case submitted. It will run after the current case and any earlier submissions.
```

Reply on validation failure:

```text
@user prompt was too short/long. Try: !prompt a fictional PG-13 case idea
```

- [ ] **Step 3: Update help text**

Include:

```text
!prompt <case idea>
```

Keep help under Twitch message length limit.

- [ ] **Step 4: Test parser and build**

```bash
npm test -- src/twitch/commands.test.ts
npm run build
```

Expected: PASS.

---

### Task 4: Public visual explanation and queue

**Files:**
- Modify: `app/src/App.tsx`
- Modify: `app/src/styles.css` only if existing component styles are insufficient.

- [ ] **Step 1: Fetch queue snapshot**

Add a lightweight polling call to `GET /api/court/case-queue` every 10 seconds and when session changes.

- [ ] **Step 2: Add explainer card**

Public page should include concise copy:

```text
How cases start: JuryRigged keeps the courtroom running with generated cases. Chat can submit a case with !prompt <case idea>. Submitted cases jump into the visible queue and run before the next generated case.
```

- [ ] **Step 3: Add visible queue panel**

Show:
- current case/running session if available
- queued submitted cases, with submitter/source
- empty state: “No submitted cases queued. The court will auto-generate the next one.”

- [ ] **Step 4: Build app**

```bash
npm run build:app
```

Expected: PASS.

---

### Task 5: Operator queue controls

**Files:**
- Create: `dashboard/src/components/CaseQueue.tsx`
- Modify: `dashboard/src/App.tsx`

- [ ] **Step 1: Add operator component**

Component should:
- fetch `GET /api/court/case-queue`
- show queued/running/completed/skipped status
- include a textarea/button to submit an operator case
- include Skip and Start Now buttons for queued items

- [ ] **Step 2: Wire into dashboard navigation**

Add a dashboard card/tab labelled “Case Queue”.

- [ ] **Step 3: Build dashboard**

```bash
npm run build:dashboard
```

Expected: PASS.

---

### Task 6: Documentation and deployment

**Files:**
- Modify: `.env.example`
- Modify: `docs/05-viewer-and-chatter-guide.md`
- Modify: `docs/03-operator-guide.md`

- [ ] **Step 1: Document env flags**

Add:

```env
AUTO_GENERATE_CASES=true
AUTO_CASE_IDLE_DELAY_MS=10000
CASE_QUEUE_POLL_MS=5000
```

- [ ] **Step 2: Document viewer commands**

Explain `!prompt <case idea>` and that queued cases run before generated cases.

- [ ] **Step 3: Document operator behavior**

Explain queue controls, skipping, and generated fallback.

- [ ] **Step 4: Final verification**

Run:

```bash
npm test
npm run build
docker compose up -d --build
curl -sS -f https://jury-rigged.subcult.tv/api/health
docker compose logs --since=2m api
```

Expected:
- health returns `{"ok":true,"service":"juryrigged"}`
- Twitch bot connects
- queue endpoint returns valid JSON
- no duplicate session starts in logs

---

## Complexity Assessment

- Logic depth: High — scheduler/queue state machine must avoid duplicate session starts.
- Contract sensitivity: High — adds public API, Twitch command behavior, and user-visible queue rules.
- Context span: Medium — touches server, Twitch, public UI, dashboard, docs.
- Discovery need: Medium — current auto-run exists but not continuous scheduling.
- Failure cost: Medium/High — bad scheduling could spam cases or break live show flow.
- Concern coupling: High — queue behavior, Twitch chat, UI explanation, and operator controls must agree.

## Recommended Execution Route

Use a full implementation with checkpoints:

1. Build queue/scheduler backend and tests first.
2. Add Twitch `!prompt` after backend queue is stable.
3. Add public/operator visuals after API contract is stable.
4. Deploy only after build/tests pass and scheduler behavior is manually verified.

## Self-Review

- Spec coverage: continuous generated cases, triggered cases, queue, generated fallback, Twitch + operator triggers, public + operator visual explanation are all covered.
- Placeholder scan: no implementation task relies on an undefined “later” feature; EventSub remains explicitly out of scope.
- Type consistency: queue status/source names are defined once and reused across tasks.
