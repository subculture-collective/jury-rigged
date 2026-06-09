# Overlay Chat and Social Feed Implementation Plan

> **For agentic workers:** Execute this plan task-by-task. Recommended path:
> dispatch a fresh subagent per task, review each result with `review-quality`,
> then continue. For complex multi-agent splits, use
> `parallel-feature-development`, `team-composition-patterns`, and
> `team-communication-protocols`. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Refresh the live overlay transcript/chat presentation and add Twitch social status cards for latest follower, subscriber, gifter, and most-gifted viewer.

**Architecture:** Keep the primary target as the React overlay at `/app/?view=overlay`. Split the work into a presentational overlay pass and a small backend Twitch social state pipeline exposed as read-only public JSON and SSE events. Do not touch protected session creation or the trusted bot queue token route.

**Tech Stack:** TypeScript, Express, React/Vite, Twitch IRC tags, Twitch EventSub webhook payloads, Node test runner, existing Tailwind-style utility CSS.

---

## Scope and Behavior Contract

- Target surface: `app/src/App.tsx` overlay view (`/app/?view=overlay`).
- Legacy `public/app.js`/Pixi overlay is out of scope unless a later visual QA pass confirms it is still active.
- “Chat” means the live overlay transcript/chat feed rendered from `session.turns`.
- Alternate justification means transcript entries visually alternate left/right alignment by rendered index while preserving newest-first ordering.
- Remove chat boxes means no full bordered card around each transcript line; keep subtle separators/spacing for readability.
- Role color cues must be deterministic and readable: judge/prosecutor/defense/witness/bailiff/jury/default each gets a stable color treatment.
- Increase all overlay text except the case title. The case title remains its current relative size to avoid covering the stream frame.
- Twitch social feed must degrade gracefully when Twitch data is unavailable: show “waiting for signal” instead of breaking overlay.
- Latest follower/subscriber/gifter are last observed events. “Most gifted” is the top cumulative gifter from this process/runtime unless persisted later.

---

## File Map

- Modify: `app/src/App.tsx` — overlay transcript row layout, role colors, text scale, social feed fetch/SSE consumption, social cards.
- Modify: `app/src/data.ts` — if navigation/help copy needs a new note for social overlays.
- Create: `src/twitch/social-feed.ts` — in-memory Twitch social feed model, normalization, aggregation helpers.
- Modify: `src/twitch/bot.ts` — record IRC chat/subscriber signals that are already visible in tags; optionally expose callback hooks to server.
- Modify: `src/twitch/eventsub.ts` — parse follow/subscribe/gift EventSub notification payloads in addition to current redemption payloads.
- Modify: `src/server.ts` — instantiate social feed, expose `GET /api/public/twitch/social`, emit social updates into active session streams where useful.
- Modify: `src/types.ts` — shared `TwitchSocialSnapshot`, `TwitchSocialEvent`, and optional `CourtEventType` entry if SSE emits social updates.
- Test: `src/twitch/social-feed.test.ts` — aggregation and redaction tests.
- Test: `src/twitch/eventsub.test.ts` or existing EventSub tests — parse follow/sub/gift payloads.
- Test: `src/server.test.ts` or `src/twitch-social.test.ts` — public social endpoint and SSE/update behavior.

---

## Milestone 1: Overlay transcript visual refresh

### Task 1: Add role styling helpers

**Files:**
- Modify: `app/src/App.tsx`

- [x] **Step 1: Add role tone helper functions near existing overlay helpers**

Add deterministic role styles that can be reused by transcript rows and social cards:

```ts
type RoleTone = 'judge' | 'prosecutor' | 'defense' | 'witness' | 'bailiff' | 'jury' | 'default';

function roleTone(role?: string): RoleTone {
  const normalized = role?.toLowerCase() ?? '';
  if (normalized.includes('judge')) return 'judge';
  if (normalized.includes('prosecutor') || normalized.includes('prosecution')) return 'prosecutor';
  if (normalized.includes('defense')) return 'defense';
  if (normalized.includes('witness')) return 'witness';
  if (normalized.includes('bailiff')) return 'bailiff';
  if (normalized.includes('juror') || normalized.includes('jury')) return 'jury';
  return 'default';
}

function roleToneClass(tone: RoleTone) {
  switch (tone) {
    case 'judge':
      return 'text-[hsl(var(--gold))]';
    case 'prosecutor':
      return 'text-[hsl(var(--cyan))]';
    case 'defense':
      return 'text-[hsl(var(--purple))]';
    case 'witness':
      return 'text-emerald-300';
    case 'bailiff':
      return 'text-sky-300';
    case 'jury':
      return 'text-amber-200';
    default:
      return 'text-[hsl(var(--text))]';
  }
}

function roleAccentClass(tone: RoleTone) {
  switch (tone) {
    case 'judge':
      return 'from-[hsl(var(--gold)/0.36)]';
    case 'prosecutor':
      return 'from-[hsl(var(--cyan)/0.34)]';
    case 'defense':
      return 'from-[hsl(var(--purple)/0.34)]';
    case 'witness':
      return 'from-emerald-400/30';
    case 'bailiff':
      return 'from-sky-400/30';
    case 'jury':
      return 'from-amber-300/28';
    default:
      return 'from-white/12';
  }
}
```

- [x] **Step 2: Run app lint**

Run:

```bash
npm run lint:app
```

Expected: PASS.

### Task 2: Replace boxed transcript cards with alternating justified rows

**Files:**
- Modify: `app/src/App.tsx`

- [x] **Step 1: Update overlay transcript rendering**

In the overlay transcript feed map, replace bordered article cards with alternating alignment rows:

```tsx
{overlayTurns.map((turn, index) => {
  const tone = roleTone(turn.role);
  const alignRight = index % 2 === 1;

  return (
    <article
      key={turn.id}
      className={cn(
        'group flex w-full',
        alignRight ? 'justify-end text-right' : 'justify-start text-left',
      )}
    >
      <div
        className={cn(
          'max-w-[86%] border-t border-white/10 bg-gradient-to-r px-1 py-3',
          roleAccentClass(tone),
          alignRight ? 'bg-gradient-to-l' : 'bg-gradient-to-r',
        )}
      >
        <div className={cn('flex flex-wrap items-center gap-2 text-sm uppercase tracking-[0.16em] text-[hsl(var(--muted))]', alignRight ? 'justify-end' : 'justify-start')}>
          <span className="font-monoish">#{turn.turnNumber}</span>
          <span className={cn('font-semibold', roleToneClass(tone))}>{prettyLabel(turn.speaker)}</span>
          <span>{prettyLabel(turn.role)}</span>
          <span>{formatOverlayTimestamp(turn.createdAt)}</span>
        </div>
        <p className="mt-2 text-lg leading-7 text-[hsl(var(--text))]">{turn.dialogue}</p>
      </div>
    </article>
  );
})}
```

Keep `OVERLAY_TRANSCRIPT_LIMIT` unchanged.

- [x] **Step 2: Make non-title overlay text larger**

Increase label/body text in `OverlayView`, `OverlayStandby`, phase/evidence/objection cards, jury cards, and stinger popup by one Tailwind step where practical:

```tsx
// Examples:
// text-[10px] -> text-xs
// text-xs -> text-sm
// text-sm -> text-base
// text-base -> text-lg
```

Do not increase the main case title heading. If space gets tight, reduce sidebar content count before shrinking text.

- [x] **Step 3: Verify visual compile**

Run:

```bash
npm run lint:app
npm run build:app
```

Expected: PASS.

---

## Milestone 2: Twitch social feed state

### Task 3: Add social feed types and in-memory aggregator

**Files:**
- Modify: `src/types.ts`
- Create: `src/twitch/social-feed.ts`
- Test: `src/twitch/social-feed.test.ts`

- [x] **Step 1: Add shared types**

In `src/types.ts`, add:

```ts
export type TwitchSocialEventType = 'follow' | 'subscribe' | 'gift_sub';

export interface TwitchSocialUser {
  id?: string;
  login?: string;
  displayName: string;
}

export interface TwitchSocialEvent {
  type: TwitchSocialEventType;
  user: TwitchSocialUser;
  gifter?: TwitchSocialUser;
  giftCount?: number;
  tier?: string;
  occurredAt: string;
}

export interface TwitchSocialSnapshot {
  latestFollower?: TwitchSocialUser & { followedAt: string };
  latestSubscriber?: TwitchSocialUser & { subscribedAt: string; tier?: string };
  latestGifter?: TwitchSocialUser & { giftedAt: string; giftCount: number };
  mostGifted?: TwitchSocialUser & { giftCount: number; updatedAt: string };
  updatedAt?: string;
}
```

- [x] **Step 2: Implement aggregator**

Create `src/twitch/social-feed.ts`:

```ts
import type { TwitchSocialEvent, TwitchSocialSnapshot, TwitchSocialUser } from '../types.js';

function cloneUser<T extends TwitchSocialUser>(user: T): T {
  return { ...user };
}

function giftKey(user: TwitchSocialUser): string {
  return user.id || user.login || user.displayName.toLowerCase();
}

export class TwitchSocialFeed {
  private snapshot: TwitchSocialSnapshot = {};
  private readonly giftedTotals = new Map<string, TwitchSocialUser & { giftCount: number; updatedAt: string }>();

  record(event: TwitchSocialEvent): TwitchSocialSnapshot {
    if (event.type === 'follow') {
      this.snapshot.latestFollower = { ...cloneUser(event.user), followedAt: event.occurredAt };
    }

    if (event.type === 'subscribe') {
      this.snapshot.latestSubscriber = { ...cloneUser(event.user), subscribedAt: event.occurredAt, tier: event.tier };
    }

    if (event.type === 'gift_sub' && event.gifter) {
      const giftCount = Math.max(1, event.giftCount ?? 1);
      this.snapshot.latestGifter = { ...cloneUser(event.gifter), giftedAt: event.occurredAt, giftCount };
      const key = giftKey(event.gifter);
      const previous = this.giftedTotals.get(key);
      const total = (previous?.giftCount ?? 0) + giftCount;
      const updated = { ...cloneUser(event.gifter), giftCount: total, updatedAt: event.occurredAt };
      this.giftedTotals.set(key, updated);
      this.snapshot.mostGifted = [...this.giftedTotals.values()].sort((a, b) => b.giftCount - a.giftCount)[0];
    }

    this.snapshot.updatedAt = event.occurredAt;
    return this.getSnapshot();
  }

  getSnapshot(): TwitchSocialSnapshot {
    return structuredClone(this.snapshot);
  }
}
```

- [x] **Step 3: Test aggregation**

Create `src/twitch/social-feed.test.ts` with assertions:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { TwitchSocialFeed } from './social-feed.js';

test('TwitchSocialFeed tracks latest follower subscriber gifter and most gifted', () => {
  const feed = new TwitchSocialFeed();

  feed.record({
    type: 'follow',
    user: { id: 'u1', login: 'newfan', displayName: 'NewFan' },
    occurredAt: '2026-06-08T10:00:00.000Z',
  });
  feed.record({
    type: 'subscribe',
    user: { id: 'u2', login: 'subfan', displayName: 'SubFan' },
    tier: '1000',
    occurredAt: '2026-06-08T10:01:00.000Z',
  });
  feed.record({
    type: 'gift_sub',
    user: { id: 'u3', login: 'recipient', displayName: 'Recipient' },
    gifter: { id: 'u4', login: 'gifter', displayName: 'Gifter' },
    giftCount: 3,
    occurredAt: '2026-06-08T10:02:00.000Z',
  });

  const snapshot = feed.getSnapshot();
  assert.equal(snapshot.latestFollower?.displayName, 'NewFan');
  assert.equal(snapshot.latestSubscriber?.displayName, 'SubFan');
  assert.equal(snapshot.latestGifter?.displayName, 'Gifter');
  assert.equal(snapshot.mostGifted?.giftCount, 3);
});
```

- [x] **Step 4: Verify**

Run:

```bash
npm test -- src/twitch/social-feed.test.ts
npm run lint
```

Expected: PASS.

---

## Milestone 3: Twitch EventSub and bot integration

### Task 4: Parse Twitch social EventSub payloads

**Files:**
- Modify: `src/twitch/eventsub.ts`
- Test: `src/twitch/eventsub.test.ts` or existing `src/twitch/bot.test.ts` if no EventSub test exists

- [x] **Step 1: Add parser for social notification types**

Add a helper that accepts EventSub notification bodies for these subscription types:

```ts
channel.follow
channel.subscribe
channel.subscription.gift
```

Return `TwitchSocialEvent | undefined`:

```ts
export function parseSocialEventSubNotification(body: unknown): TwitchSocialEvent | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const message = body as { subscription?: { type?: unknown }; event?: Record<string, unknown> };
  const type = typeof message.subscription?.type === 'string' ? message.subscription.type : '';
  const event = message.event;
  if (!event) return undefined;
  const occurredAt = new Date().toISOString();

  if (type === 'channel.follow') {
    const displayName = typeof event.user_name === 'string' ? event.user_name : undefined;
    if (!displayName) return undefined;
    return { type: 'follow', user: { id: String(event.user_id ?? ''), login: String(event.user_login ?? ''), displayName }, occurredAt };
  }

  if (type === 'channel.subscribe') {
    const displayName = typeof event.user_name === 'string' ? event.user_name : undefined;
    if (!displayName) return undefined;
    return { type: 'subscribe', user: { id: String(event.user_id ?? ''), login: String(event.user_login ?? ''), displayName }, tier: typeof event.tier === 'string' ? event.tier : undefined, occurredAt };
  }

  if (type === 'channel.subscription.gift') {
    const displayName = typeof event.user_name === 'string' ? event.user_name : undefined;
    if (!displayName) return undefined;
    return { type: 'gift_sub', user: { displayName: 'Gift recipient' }, gifter: { id: String(event.user_id ?? ''), login: String(event.user_login ?? ''), displayName }, giftCount: Number(event.total ?? event.cumulative_total ?? 1), tier: typeof event.tier === 'string' ? event.tier : undefined, occurredAt };
  }

  return undefined;
}
```

- [x] **Step 2: Test each payload type**

Add tests that assert parser returns `follow`, `subscribe`, and `gift_sub` for representative EventSub payloads and `undefined` for unrelated redemption payloads.

- [x] **Step 3: Verify**

Run:

```bash
npm test -- src/twitch/eventsub.test.ts
npm run lint
```

Expected: PASS. If the project has no dedicated EventSub test file, create it and run that path.

### Task 5: Wire social feed into server and bot startup

**Files:**
- Modify: `src/server.ts`
- Modify: `src/twitch/bot.ts` only if using IRC subscriber badge fallback
- Test: `src/twitch-social.test.ts`

- [x] **Step 1: Instantiate social feed**

In `createServerApp`, create one `TwitchSocialFeed` instance and expose it through the API route setup.

- [x] **Step 2: Add public endpoint**

In `registerApiRoutes`, add:

```ts
app.get('/api/public/twitch/social', audienceInteractionLimiter, (_req, res) => {
  res.json({ social: deps.socialFeed.getSnapshot() });
});
```

- [x] **Step 3: Record EventSub social notifications**

Inside the existing EventSub webhook route, call `parseSocialEventSubNotification(req.body)` before/after redemption handling. If it returns an event, record it:

```ts
const socialEvent = parseSocialEventSubNotification(req.body);
if (socialEvent) {
  const social = deps.socialFeed.record(socialEvent);
  const active = await getRunningOrPendingSession();
  if (active) {
    deps.store.emitEvent(active.id, 'twitch_social_updated', { social, event: socialEvent });
  }
  return res.json({ ok: true, social: true });
}
```

Add `'twitch_social_updated'` to `CourtEventType` and payload validation in `src/events.ts` if validation covers all event types.

- [ ] **Step 4: Optional IRC fallback for subscribers**

If EventSub subscriber events are not yet configured, record a `subscribe` event when `TwitchBot` sees IRC tags with a subscriber badge on a unique user. Keep this as best-effort and do not count gift totals from IRC chat messages.

- [x] **Step 5: Test endpoint and event recording**

Create `src/twitch-social.test.ts`:

```ts
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createServerApp } from './server.js';

test('public Twitch social endpoint returns snapshot', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = '';
  const created = await createServerApp({ autoRunCourtSession: false, autoGenerateCases: false, startTwitchBot: false });
  const server = created.app.listen(0);

  try {
    await once(server, 'listening');
    const address = server.address() as AddressInfo | null;
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/public/twitch/social`);
    assert.equal(response.status, 200);
    const json = await response.json() as { social?: unknown };
    assert.ok(json.social);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    created.dispose();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
```

- [x] **Step 6: Verify**

Run:

```bash
npm test -- src/twitch-social.test.ts
npm run lint
```

Expected: PASS.

---

## Milestone 4: Social cards in the overlay

### Task 6: Fetch and render social feed cards

**Files:**
- Modify: `app/src/App.tsx`

- [x] **Step 1: Add client types and normalizer**

Add local app-side equivalents:

```ts
type TwitchSocialPerson = {
  displayName: string;
  login?: string;
  giftCount?: number;
  tier?: string;
  followedAt?: string;
  subscribedAt?: string;
  giftedAt?: string;
  updatedAt?: string;
};

type TwitchSocialSnapshot = {
  latestFollower?: TwitchSocialPerson;
  latestSubscriber?: TwitchSocialPerson;
  latestGifter?: TwitchSocialPerson;
  mostGifted?: TwitchSocialPerson;
  updatedAt?: string;
};
```

Normalize unknown JSON with the existing `isRecord`, `readString`, and `readNumber` helpers.

- [x] **Step 2: Add `useTwitchSocial()` hook**

Poll `/api/public/twitch/social` every 15 seconds and expose `{ social, error }`. Also update social state from overlay SSE events of type `twitch_social_updated` if available.

- [x] **Step 3: Add social card component**

Render four compact cards:

```tsx
<SocialSignalCard label="Latest follower" person={social.latestFollower} fallback="Waiting for follow signal" tone="cyan" />
<SocialSignalCard label="Latest subscriber" person={social.latestSubscriber} fallback="Waiting for subscriber" tone="purple" />
<SocialSignalCard label="Latest gifter" person={social.latestGifter} fallback="Waiting for gift" tone="gold" />
<SocialSignalCard label="Most gifted" person={social.mostGifted} fallback="No gift leader yet" tone="gold" />
```

Place these cards in the right-side overlay sidebar below the jury panel or replace the least useful sidebar card if vertical space is tight.

- [x] **Step 4: Verify**

Run:

```bash
npm run lint:app
npm run build:app
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

- [ ] Visual smoke routes:

```bash
curl -fsS "$PUBLIC_BASE_URL/app/?view=overlay"
curl -fsS "$PUBLIC_BASE_URL/api/public/twitch/social"
```

Expected: public app and social JSON return successfully.

- [ ] Manual overlay QA:
  - Transcript rows alternate left/right.
  - Rows no longer look like boxed cards.
  - Speaker names and roles are color-coded by role.
  - Body/label text is larger while case title remains stable.
  - Social cards display fallback copy when no Twitch events are present.
  - Social cards update after simulated EventSub payloads.

## Self-Review

- Spec coverage: Covers all five requested items: alternating chat justification, no chat boxes, colorized name/role cues, larger non-title text, and Twitch social integrations.
- Scope control: Keeps work focused on the React overlay and public read-only social endpoint; legacy overlay is explicitly out of scope unless later confirmed active.
- Security posture: New social endpoint is read-only and rate-limited; no admin/session creation behavior changes.
- Data durability: Most-gifted is runtime-only in this plan; add persistence later if stream-to-stream continuity is required.
- Placeholder scan: No unresolved placeholder language remains.
