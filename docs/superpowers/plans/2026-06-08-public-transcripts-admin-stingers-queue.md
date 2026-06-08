# Public Transcripts Admin Stingers Queue Implementation Plan

> **For agentic workers:** Execute this plan task-by-task. Recommended path:
> dispatch a fresh subagent per task, review each result with `review-quality`,
> then continue. For complex multi-agent splits, use
> `parallel-feature-development`, `team-composition-patterns`, and
> `team-communication-protocols`. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Add searchable public transcripts, session-completion transcript links, admin messages/triggers, overlay stingers, a public prompt queue page, and browser-safe abuse protection without exposing direct session creation.

**Architecture:** Keep `POST /api/court/sessions` admin-only. Public users submit prompts to a hardened public queue flow; Twitch bot and admin tools continue to use trusted server/admin paths. Public transcript/search and prompt pages live in the React app, admin controls live in the dashboard, and transient stinger events are emitted from the server over existing session SSE so the overlay can animate them.

**Tech Stack:** Express, TypeScript, Postgres/in-memory session store pattern, React/Vite public app, React/Vite dashboard, Node test runner, tmi.js Twitch bot, optional Cloudflare Turnstile.

---

## Behavior Contract

- Public direct session creation remains protected by admin auth.
- Public queue submission never starts a case immediately by itself; it enqueues only.
- Public queue submission requires rate limiting plus either Turnstile verification when configured or a server-issued short-lived submission nonce in development/mock mode.
- Public transcript search is read-only and searchable by session id, case title/topic, and case prompt text.
- Transcript detail pages are accessible by stable session id and can be linked by the Twitch bot after a session completes.
- The Twitch bot announces a transcript link once per completed session when `PUBLIC_BASE_URL` is configured.
- Admin message/trigger controls are protected by existing admin auth and same-origin POST checks.
- Stinger popups are display-only overlay events for phase changes, evidence, objections, and admin triggers.
- Queue ETA is approximate and clearly labeled; it must not promise exact start times.

## Files and Responsibilities

- Modify `src/types.ts` — shared types for transcript summaries, public queue submissions, stinger events, and admin trigger payloads.
- Modify `src/store/session-store.ts` — transcript search/list helpers for in-memory and Postgres-backed stores.
- Add migration `db/migrations/002_transcript_search_indexes.sql` — Postgres indexes for topic/case prompt lookup.
- Modify `src/server.ts` — public transcript endpoints, hardened queue endpoints, admin trigger endpoints, SSE stinger emission, Turnstile/nonce verification.
- Modify `src/court/case-queue.ts` — queue size cap, duplicate prompt guard, ETA helper.
- Modify `src/twitch/bot.ts` — session-completion transcript link announcement.
- Modify `app/src/App.tsx` — public transcript search/detail views, public prompt queue page, overlay stinger component.
- Modify `app/src/data.ts` — add navigation/view metadata for transcript and prompt pages if needed.
- Modify `dashboard/src/App.tsx` — route/admin nav for message/trigger controls.
- Add `dashboard/src/components/AdminTriggers.tsx` — admin composer and trigger panel.
- Add tests: `src/transcripts.test.ts`, `src/public-queue-security.test.ts`, `src/admin-triggers.test.ts`, `src/twitch/transcript-link.test.ts`, `src/court/case-queue.test.ts` updates.
- Modify docs: `docs/03-operator-guide.md`, `docs/05-viewer-and-chatter-guide.md`, `README.md`.

---

## Milestone 1: Public transcript search and transcript detail pages

### Task 1: Shared transcript search types

**Files:**
- Modify: `src/types.ts`

- [x] **Step 1: Add transcript DTO types**

Add these exports near the existing court/session public types:

```ts
export interface TranscriptSearchResult {
    id: string;
    topic: string;
    status: CourtSessionStatus;
    phase: CourtPhase;
    caseType?: string;
    casePrompt?: string;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    turnCount: number;
}

export interface TranscriptSearchResponse {
    query: string;
    results: TranscriptSearchResult[];
    count: number;
}
```

- [x] **Step 2: Run typecheck and expect no new behavior**

Run:

```bash
npm run lint
```

Expected: PASS.

### Task 2: Store transcript search helpers

**Files:**
- Modify: `src/store/session-store.ts`
- Test: `src/transcripts.test.ts`

- [x] **Step 1: Write failing tests for public transcript search**

Create `src/transcripts.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryCourtSessionStore } from './store/session-store.js';

test('searchTranscripts finds sessions by topic and prompt text', async () => {
    const store = new InMemoryCourtSessionStore();
    const session = await store.createSession({
        topic: 'The Case of the Glitter Bandit',
        caseType: 'criminal',
        casePrompt: 'A glitter theft disrupted the entire courtroom lobby.',
    });

    await store.appendTurn(session.id, {
        speaker: 'judge',
        role: 'judge',
        phase: 'openings',
        dialogue: 'Court is now in session.',
    });

    const byTopic = await store.searchTranscripts('glitter');
    assert.equal(byTopic.length, 1);
    assert.equal(byTopic[0].id, session.id);
    assert.equal(byTopic[0].turnCount, 1);

    const byPrompt = await store.searchTranscripts('lobby');
    assert.equal(byPrompt.length, 1);
    assert.equal(byPrompt[0].id, session.id);
});
```

Run:

```bash
npm test -- src/transcripts.test.ts
```

Expected: FAIL because `searchTranscripts` does not exist.

- [x] **Step 2: Add store interface method and in-memory implementation**

In `src/store/session-store.ts`, add this method to the store interface:

```ts
searchTranscripts(query: string, limit?: number): Promise<TranscriptSearchResult[]>;
```

Add this implementation to `InMemoryCourtSessionStore`:

```ts
async searchTranscripts(query: string, limit = 25): Promise<TranscriptSearchResult[]> {
    const normalized = query.trim().toLowerCase();
    const sessions = await this.listSessions();
    return sessions
        .filter(session => {
            if (!normalized) return true;
            const haystack = [session.id, session.topic, session.metadata.casePrompt]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            return haystack.includes(normalized);
        })
        .slice(0, Math.max(1, Math.min(limit, 50)))
        .map(session => ({
            id: session.id,
            topic: session.topic,
            status: session.status,
            phase: session.phase,
            caseType: session.metadata.caseType,
            casePrompt: session.metadata.casePrompt,
            createdAt: session.createdAt,
            startedAt: session.startedAt,
            completedAt: session.completedAt,
            turnCount: session.turnCount,
        }));
}
```

- [x] **Step 3: Add Postgres implementation**

In `PostgresCourtSessionStore`, add:

```ts
async searchTranscripts(query: string, limit = 25): Promise<TranscriptSearchResult[]> {
    const normalized = query.trim();
    const cappedLimit = Math.max(1, Math.min(limit, 50));
    const rows = normalized ?
        await this.sql<Array<{
            id: string;
            topic: string;
            status: CourtSessionStatus;
            phase: CourtPhase;
            metadata: CourtSessionMetadata;
            created_at: Date;
            started_at: Date | null;
            completed_at: Date | null;
            turn_count: number;
        }>>`
            SELECT s.*, COUNT(t.id)::int AS turn_count
            FROM court_sessions s
            LEFT JOIN court_turns t ON t.session_id = s.id
            WHERE lower(s.id) LIKE ${`%${normalized.toLowerCase()}%`}
               OR lower(s.topic) LIKE ${`%${normalized.toLowerCase()}%`}
               OR lower(s.metadata ->> 'casePrompt') LIKE ${`%${normalized.toLowerCase()}%`}
            GROUP BY s.id
            ORDER BY s.completed_at DESC NULLS LAST, s.created_at DESC
            LIMIT ${cappedLimit}
        `
    :   await this.sql<Array<{
            id: string;
            topic: string;
            status: CourtSessionStatus;
            phase: CourtPhase;
            metadata: CourtSessionMetadata;
            created_at: Date;
            started_at: Date | null;
            completed_at: Date | null;
            turn_count: number;
        }>>`
            SELECT s.*, COUNT(t.id)::int AS turn_count
            FROM court_sessions s
            LEFT JOIN court_turns t ON t.session_id = s.id
            GROUP BY s.id
            ORDER BY s.completed_at DESC NULLS LAST, s.created_at DESC
            LIMIT ${cappedLimit}
        `;

    return rows.map(row => ({
        id: row.id,
        topic: row.topic,
        status: row.status,
        phase: row.phase,
        caseType: row.metadata.caseType,
        casePrompt: row.metadata.casePrompt,
        createdAt: row.created_at.toISOString(),
        startedAt: row.started_at?.toISOString(),
        completedAt: row.completed_at?.toISOString(),
        turnCount: row.turn_count,
    }));
}
```

- [x] **Step 4: Run test**

Run:

```bash
npm test -- src/transcripts.test.ts
```

Expected: PASS.

### Task 3: Public transcript API and indexes

**Files:**
- Modify: `src/server.ts`
- Add: `db/migrations/002_transcript_search_indexes.sql`
- Test: `src/transcripts.test.ts`

- [x] **Step 1: Add Postgres search indexes migration**

Create `db/migrations/002_transcript_search_indexes.sql`:

```sql
CREATE INDEX IF NOT EXISTS idx_court_sessions_topic_lower
    ON court_sessions (lower(topic));

CREATE INDEX IF NOT EXISTS idx_court_sessions_case_prompt_lower
    ON court_sessions (lower((metadata ->> 'casePrompt')));

CREATE INDEX IF NOT EXISTS idx_court_sessions_completed_at
    ON court_sessions (completed_at DESC NULLS LAST);
```

- [x] **Step 2: Add public search route**

In `src/server.ts`, add this public route near other public court read routes:

```ts
app.get('/api/public/transcripts', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 25;
    const results = await store.searchTranscripts(query, Number.isFinite(limit) ? limit : 25);
    res.json({ query, results, count: results.length });
});
```

- [x] **Step 3: Add public detail route alias**

Add:

```ts
app.get('/api/public/transcripts/:id', async (req, res) => {
    const session = await store.getSession(req.params.id);
    if (!session) {
        res.status(404).json({ error: 'transcript not found', code: 'TRANSCRIPT_NOT_FOUND' });
        return;
    }
    res.json({ session });
});
```

- [x] **Step 4: Extend API tests**

In `src/transcripts.test.ts`, add an app-level test that creates a session and fetches `/api/public/transcripts?q=glitter` and `/api/public/transcripts/:id`. Use the existing `createServerApp({ autoRunCourtSession: false, startTwitchBot: false })` pattern from `src/server.test.ts`.

- [x] **Step 5: Verify**

Run:

```bash
npm test -- src/transcripts.test.ts
npm run lint
```

Expected: PASS.

### Task 4: Public transcript React views

**Files:**
- Modify: `app/src/App.tsx`
- Modify: `app/src/data.ts` if view labels are centralized there

- [x] **Step 1: Add view keys**

Extend the public app view union to include:

```ts
'transcripts' | 'prompt'
```

Make `isViewKey` accept both values.

- [x] **Step 2: Add transcript search component**

Add a `TranscriptSearchView` component that calls `/api/public/transcripts?q=${encodeURIComponent(query)}` and renders result cards linking to `?view=transcripts&case=${session.id}`.

- [x] **Step 3: Add transcript detail state**

When `case` URL param is present, fetch `/api/public/transcripts/:id` and render the session topic plus a newest-first or chronological transcript list with speaker/role labels.

- [x] **Step 4: Verify app build**

Run:

```bash
npm run lint:app
npm run build:app
```

Expected: PASS.

---

## Milestone 2: Bot transcript links after session completion

### Task 5: Completion listener contract

**Files:**
- Modify: `src/twitch/bot.ts`
- Test: `src/twitch/transcript-link.test.ts`

- [x] **Step 1: Write failing bot transcript link test**

Create `src/twitch/transcript-link.test.ts` with a pure helper test:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTranscriptUrl } from './bot.js';

test('buildTranscriptUrl returns public transcript URL', () => {
    assert.equal(
        buildTranscriptUrl('https://jury.example', 'session-123'),
        'https://jury.example/app/?view=transcripts&case=session-123',
    );
});
```

Run:

```bash
npm test -- src/twitch/transcript-link.test.ts
```

Expected: FAIL because `buildTranscriptUrl` is not exported.

- [x] **Step 2: Add helper**

In `src/twitch/bot.ts`, export:

```ts
export function buildTranscriptUrl(publicBaseUrl: string, sessionId: string): string {
    const base = publicBaseUrl.replace(/\/+$/, '');
    return `${base}/app/?view=transcripts&case=${encodeURIComponent(sessionId)}`;
}
```

- [x] **Step 3: Announce once per session**

Subscribe to `session_completed` events where the bot already receives or can be given the session event stream. When event payload includes `sessionId`, send:

```text
Transcript ready: https://.../app/?view=transcripts&case=<sessionId>
```

Guard with a `Set<string>` named `announcedTranscriptSessionIds` so each session is announced once.

- [x] **Step 4: Verify**

Run:

```bash
npm test -- src/twitch/transcript-link.test.ts
npm run lint
```

Expected: PASS.

---

## Milestone 3: Admin message and trigger interface

### Task 6: Admin trigger API

**Files:**
- Modify: `src/types.ts`
- Modify: `src/server.ts`
- Test: `src/admin-triggers.test.ts`

- [x] **Step 1: Add shared admin trigger payload**

In `src/types.ts` add:

```ts
export type AdminTriggerKind = 'message' | 'phase_stinger' | 'evidence_stinger' | 'objection_stinger';

export interface AdminTriggerRequest {
    sessionId: string;
    kind: AdminTriggerKind;
    title: string;
    message: string;
}
```

- [x] **Step 2: Add protected route**

In `src/server.ts`, add:

```ts
app.post('/api/admin/triggers', requireAdminPost, async (req, res) => {
    const { sessionId, kind, title, message } = req.body ?? {};
    if (typeof sessionId !== 'string' || typeof kind !== 'string' || typeof title !== 'string' || typeof message !== 'string') {
        res.status(400).json({ error: 'invalid trigger payload', code: 'INVALID_TRIGGER_PAYLOAD' });
        return;
    }
    const session = await store.getSession(sessionId);
    if (!session) {
        res.status(404).json({ error: 'session not found', code: 'SESSION_NOT_FOUND' });
        return;
    }
    store.emitEvent(sessionId, 'admin_trigger', {
        sessionId,
        kind,
        title: title.trim().slice(0, 80),
        message: message.trim().slice(0, 280),
        emittedAt: new Date().toISOString(),
    });
    res.status(202).json({ ok: true });
});
```

- [x] **Step 3: Test auth protection**

Create `src/admin-triggers.test.ts` using the existing admin auth tests as a model. Assert unauthenticated POST returns 401/403, authenticated POST returns 202, and unknown session returns 404.

- [x] **Step 4: Verify**

Run:

```bash
npm test -- src/admin-triggers.test.ts
npm run lint
```

Expected: PASS.

### Task 7: Dashboard AdminTriggers component

**Files:**
- Add: `dashboard/src/components/AdminTriggers.tsx`
- Modify: `dashboard/src/App.tsx`

- [x] **Step 1: Add component**

Create `dashboard/src/components/AdminTriggers.tsx` with a form for `sessionId`, `kind`, `title`, and `message`. POST JSON to `/api/admin/triggers` and display success/error text.

- [x] **Step 2: Wire into dashboard**

Import `AdminTriggers` in `dashboard/src/App.tsx` and render it near `ManualControls` or in an admin tools section.

- [x] **Step 3: Verify dashboard build**

Run:

```bash
npm run build:dashboard
```

Expected: PASS.

---

## Milestone 4: Animated overlay stinger popups

### Task 8: Overlay stinger event handling

**Files:**
- Modify: `app/src/App.tsx`
- Modify: `src/server.ts`

- [x] **Step 1: Ensure SSE forwards stinger events**

Confirm `admin_trigger`, `render_directive`, `phase_changed`, and `case_file_generated` events are delivered over `/api/court/sessions/:id/stream`. If the stream filters event types, include these names.

- [x] **Step 2: Add overlay stinger state**

In `OverlayView`, add state:

```ts
const [stinger, setStinger] = useState<{ title: string; message: string; tone: 'cyan' | 'gold' | 'purple' } | null>(null);
```

When live events indicate phase/evidence/objection/admin trigger, set stinger for 4 seconds.

- [x] **Step 3: Render stinger popup**

Add an absolutely positioned card in the overlay root:

```tsx
{stinger ? (
  <div className="pointer-events-none absolute right-8 top-28 z-20 rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.94)] px-6 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] motion-safe:animate-pulse">
    <p className="font-monoish text-xs uppercase tracking-[0.28em] text-[hsl(var(--gold))]">Court stinger</p>
    <h2 className="mt-2 text-2xl font-semibold text-[hsl(var(--text))]">{stinger.title}</h2>
    <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted))]">{stinger.message}</p>
  </div>
) : null}
```

- [x] **Step 4: Verify overlay build**

Run:

```bash
npm run lint:app
npm run build:app
```

Expected: PASS.

---

## Milestone 5: Public prompt queue page and ETA

### Task 9: Queue ETA helper

**Files:**
- Modify: `src/court/case-queue.ts`
- Test: `src/court/case-queue.test.ts`

- [x] **Step 1: Add ETA snapshot fields**

Extend queue snapshot to include:

```ts
estimatedStartMinutes?: number;
streamUrl?: string;
transcriptsUrl?: string;
```

Use a simple estimate: queued position × `CASE_QUEUE_ESTIMATED_CASE_MINUTES` defaulting to 12.

- [x] **Step 2: Test ETA**

In `src/court/case-queue.test.ts`, enqueue two prompts and assert the second item has an estimated start greater than or equal to the first.

- [x] **Step 3: Verify**

Run:

```bash
npm test -- src/court/case-queue.test.ts
```

Expected: PASS.

### Task 10: Public prompt page UI

**Files:**
- Modify: `app/src/App.tsx`

- [x] **Step 1: Add prompt view**

Add a `PromptQueueView` component with:

- prompt textarea
- submit button
- queue position result
- estimated start copy labeled approximate
- stream link from `PUBLIC_STREAM_URL` or server snapshot
- transcript search link `?view=transcripts`

- [x] **Step 2: POST to hardened public endpoint**

Submit to `/api/public/case-queue` with:

```json
{ "prompt": "...", "source": "public_page", "turnstileToken": "...", "nonce": "..." }
```

- [x] **Step 3: Verify**

Run:

```bash
npm run lint:app
npm run build:app
```

Expected: PASS.

---

## Milestone 6: Hardened public submission abuse protection

### Task 11: Public submission verifier

**Files:**
- Modify: `src/server.ts`
- Test: `src/public-queue-security.test.ts`

- [x] **Step 1: Add security contract tests**

Create `src/public-queue-security.test.ts` with these assertions:

- `POST /api/public/case-queue` rejects missing Turnstile token/nonce with 403 when public submission protection is enabled.
- short prompts are rejected with 400.
- duplicate prompt from same IP is rejected with 429 or 409.
- valid mock nonce submission enqueues and returns queue position.

- [x] **Step 2: Add nonce route for dev/mock mode**

Add public route:

```ts
app.get('/api/public/case-queue/nonce', audienceInteractionLimiter, (_req, res) => {
    const nonce = crypto.randomUUID();
    publicQueueNonces.set(nonce, Date.now() + 10 * 60 * 1000);
    res.json({ nonce, expiresInSeconds: 600 });
});
```

Use an in-memory `Map<string, number>` and delete nonce after use.

- [x] **Step 3: Add Turnstile verification helper**

Implement:

```ts
async function verifyTurnstile(token: string, ip?: string): Promise<boolean> {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) return false;
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body,
    });
    const json = await response.json() as { success?: boolean };
    return json.success === true;
}
```

- [x] **Step 4: Add public queue route**

Extend `CaseQueueSource` in `src/court/case-queue.ts` and the shared frontend queue type to include `'public_page'`. Add `POST /api/public/case-queue` that runs `audienceInteractionLimiter`, validates prompt, verifies Turnstile or nonce, moderates content, checks duplicate prompt cache, then calls:

```ts
const item = caseQueue.enqueue({ prompt, source: 'public_page', submittedBy: 'public-page' });
```

Respond with:

```ts
res.status(202).json({
    item,
    position: caseQueue.queued().findIndex(candidate => candidate.id === item.id) + 1,
    estimatedStartMinutes: estimateQueueStartMinutes(caseQueue, item.id),
});
```

- [x] **Step 5: Keep trusted token route**

Do not remove existing `POST /api/court/case-queue` token behavior; keep it for Twitch/bot/server-to-server usage.

- [x] **Step 6: Verify security tests**

Run:

```bash
npm test -- src/public-queue-security.test.ts
npm run lint
```

Expected: PASS.

---

## Final Verification

- [x] Run full checks:

```bash
npm run lint
npm run lint:app
npm test
npm run build
```

Expected: all pass.

- [ ] Deploy:

```bash
docker compose --env-file .env up -d --build
```

- [ ] Smoke check deployed public routes:

```bash
curl -fsS "$PUBLIC_BASE_URL/api/health"
curl -fsS "$PUBLIC_BASE_URL/api/public/transcripts"
curl -fsS "$PUBLIC_BASE_URL/app/?view=prompt"
curl -fsS "$PUBLIC_BASE_URL/app/?view=transcripts"
```

Expected: all return successfully.

## Self-Review

- Spec coverage: Covers all six follow-up items: transcript index/search, bot transcript link drop, admin message/trigger UI, stinger popups, public prompt page, and hardened abuse protection.
- Security posture: Direct session creation remains admin-only; public prompts are queue-only with rate limiting, moderation, duplicate detection, and Turnstile/nonce verification.
- Placeholder scan: No task uses unresolved placeholder text or undefined acceptance criteria.
- Type consistency: Uses `TranscriptSearchResult`, `TranscriptSearchResponse`, `AdminTriggerRequest`, `AdminTriggerKind`, existing `CourtSessionStatus`, `CourtPhase`, and current queue/session APIs.
