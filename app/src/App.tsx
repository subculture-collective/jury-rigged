import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  howItWorks,
  liveMeta,
  views,
  type ViewKey,
} from './data';
import {
  TabButton,
  ConsolePanel,
  HudSection,
  HudRow,
  TranscriptRow,
  cn,
  StatusLed,
} from './components';
import { useSceneRunner } from './scene/runner';
import { useCourtStage } from './scene/useCourtStage';
import { CourtStage } from './scene/Stage';
import { DialogueBox } from './scene/DialogueBox';
import { FXOverlay } from './scene/FXOverlay';
import { OPENING_SCENE } from './scene/scripts/opening';
import type { SceneEvent } from './scene/types';

type ApiRecord = Record<string, unknown>;

type LiveTurn = {
  id: string;
  turnNumber: number;
  speaker: string;
  role: string;
  phase: string;
  dialogue: string;
  createdAt: string;
};

type LiveSession = {
  id: string;
  topic: string;
  status: string;
  phase: string;
  turnCount: number;
  turns: LiveTurn[];
  participants: string[];
  metadata: {
    casePrompt: string;
    caseType: string;
    caseSource?: string;
    queueItemId?: string;
    verdictVotes: Record<string, number>;
    sentenceVotes: Record<string, number>;
    pressVotes: Record<string, number>;
    presentVotes: Record<string, number>;
    roleAssignments: {
      judge?: string;
      prosecutor?: string;
      defense?: string;
      witnesses: string[];
      bailiff?: string;
    };
    currentGenre?: string;
    genreHistory: string[];
    evidenceCards: Array<{ id: string; text?: string; revealedAt?: string }>;
    objectionCount?: number;
    recapTurnIds: string[];
    finalRuling?: {
      verdict: string;
      sentence: string;
      decidedAt: string;
    };
    lastRenderDirective?: ApiRecord;
  };
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};

type TranscriptSearchResult = {
  id: string;
  topic: string;
  status: string;
  phase: string;
  caseType?: string;
  casePrompt?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  turnCount: number;
};

type TranscriptSearchResponse = {
  query: string;
  results: TranscriptSearchResult[];
  count: number;
};

type CaseQueueItem = {
  id: string;
  prompt: string;
  source: 'twitch' | 'operator' | 'generated' | 'public_page';
  submittedBy?: string;
  status: 'queued' | 'running' | 'completed' | 'skipped';
  sessionId?: string;
  estimatedStartMinutes?: number;
  streamUrl?: string;
  transcriptsUrl?: string;
  createdAt: string;
};

type CaseQueueSnapshot = {
  queue: CaseQueueItem[];
  queuedCount: number;
  runningSessionId: string | null;
  automationEnabled: boolean;
  generatedFallback: boolean;
};

type PublicQueueSubmission = {
  item: CaseQueueItem;
  position: number;
  estimatedStartMinutes?: number;
};

type LiveOverlayEvent = {
  type: string;
  payload?: unknown;
  receivedAt: string;
};

type OverlayStinger = {
  title: string;
  message: string;
  tone: 'cyan' | 'gold' | 'purple';
};

type RoleTone = 'judge' | 'prosecutor' | 'defense' | 'witness' | 'bailiff' | 'jury' | 'default';

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

type Juror = {
  id: string;
  label: string;
  name: string;
  role: string;
  trait: string;
};

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback'?: () => void; 'error-callback'?: () => void }) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

// ── Constants ──
const VIEW_PARAM = 'view';
const OVERLAY_DISCOVERY_MS = 5_000;
const OVERLAY_TRANSCRIPT_LIMIT = 120;
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

// ── View key helpers ──
function isViewKey(value: string | null): value is ViewKey {
  return value === 'dashboard' || value === 'overlay' || value === 'transcripts' || value === 'submit' || value === 'about';
}

function getInitialView(): ViewKey {
  if (typeof window === 'undefined') return 'dashboard';
  const view = new URLSearchParams(window.location.search).get(VIEW_PARAM);
  return isViewKey(view) ? view : 'dashboard';
}

function syncViewToUrl(view: ViewKey) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (view === 'dashboard') {
    url.searchParams.delete(VIEW_PARAM);
  } else {
    url.searchParams.set(VIEW_PARAM, view);
  }
  window.history.pushState({}, '', url);
}

function getCaseParam() {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('case') ?? '';
}

function navigateToTranscript(id: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('view', 'transcripts');
  url.searchParams.set('case', id);
  window.history.pushState({}, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

// ── Type guards ──
function isRecord(value: unknown): value is ApiRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

// ── Data normalization ──
function normalizeTranscriptSearchResponse(raw: unknown): TranscriptSearchResponse | null {
  if (!isRecord(raw)) return null;
  const query = readString(raw.query) ?? '';
  const count = readNumber(raw.count) ?? 0;
  const resultsRaw = Array.isArray(raw.results) ? raw.results : [];
  const results: TranscriptSearchResult[] = [];
  for (const item of resultsRaw) {
    if (!isRecord(item)) continue;
    const id = readString(item.id);
    if (!id) continue;
    results.push({
      id,
      topic: readString(item.topic) ?? id,
      status: readString(item.status) ?? 'unknown',
      phase: readString(item.phase) ?? '',
      caseType: readString(item.caseType),
      casePrompt: readString(item.casePrompt),
      createdAt: readString(item.createdAt) ?? '',
      startedAt: readString(item.startedAt),
      completedAt: readString(item.completedAt),
      turnCount: readNumber(item.turnCount) ?? 0,
    });
  }
  return { query, results, count };
}

function normalizeSession(raw: unknown): LiveSession | null {
  if (!isRecord(raw)) return null;
  const metadata: ApiRecord = isRecord(raw.metadata) ? raw.metadata : {};
  const evidenceCards = Array.isArray(metadata.evidenceCards)
    ? metadata.evidenceCards.filter((c): c is { id: string; text?: string; revealedAt?: string } => isRecord(c) && typeof c.id === 'string')
    : [];

  return {
    id: readString(raw.id) ?? '',
    topic: readString(raw.topic) ?? '',
    status: readString(raw.status) ?? 'unknown',
    phase: readString(raw.phase) ?? '',
    turnCount: readNumber(raw.turnCount) ?? 0,
    turns: Array.isArray(raw.turns)
      ? raw.turns.filter(isRecord).map((t) => ({
          id: readString(t.id) ?? '',
          turnNumber: readNumber(t.turnNumber) ?? 0,
          speaker: readString(t.speaker) ?? '',
          role: readString(t.role) ?? '',
          phase: readString(t.phase) ?? '',
          dialogue: readString(t.dialogue) ?? '',
          createdAt: readString(t.createdAt) ?? '',
        }))
      : [],
    participants: Array.isArray(raw.participants) ? raw.participants.filter((p): p is string => typeof p === 'string') : [],
    metadata: {
      casePrompt: readString(metadata.casePrompt) ?? '',
      caseType: readString(metadata.caseType) ?? '',
      caseSource: readString(metadata.caseSource),
      queueItemId: readString(metadata.queueItemId),
      verdictVotes: isRecord(metadata.verdictVotes) ? Object.fromEntries(Object.entries(metadata.verdictVotes).map(([k, v]) => [k, typeof v === 'number' ? v : 0])) : {},
      sentenceVotes: isRecord(metadata.sentenceVotes) ? Object.fromEntries(Object.entries(metadata.sentenceVotes).map(([k, v]) => [k, typeof v === 'number' ? v : 0])) : {},
      pressVotes: isRecord(metadata.pressVotes) ? Object.fromEntries(Object.entries(metadata.pressVotes).map(([k, v]) => [k, typeof v === 'number' ? v : 0])) : {},
      presentVotes: isRecord(metadata.presentVotes) ? Object.fromEntries(Object.entries(metadata.presentVotes).map(([k, v]) => [k, typeof v === 'number' ? v : 0])) : {},
      roleAssignments: {
        judge: readString(((metadata as ApiRecord).roleAssignments as ApiRecord | undefined)?.judge),
        prosecutor: readString(((metadata as ApiRecord).roleAssignments as ApiRecord | undefined)?.prosecutor),
        defense: readString(((metadata as ApiRecord).roleAssignments as ApiRecord | undefined)?.defense),
        witnesses: Array.isArray(((metadata as ApiRecord).roleAssignments as ApiRecord | undefined)?.witnesses) ? (((metadata as ApiRecord).roleAssignments as ApiRecord).witnesses as unknown[]).filter((w: unknown): w is string => typeof w === 'string') : [],
        bailiff: readString(((metadata as ApiRecord).roleAssignments as ApiRecord | undefined)?.bailiff),
      },
      currentGenre: readString(metadata.currentGenre),
      genreHistory: Array.isArray(metadata.genreHistory) ? metadata.genreHistory.filter((g): g is string => typeof g === 'string') : [],
      evidenceCards,
      objectionCount: readNumber(metadata.objectionCount),
      recapTurnIds: Array.isArray(metadata.recapTurnIds) ? metadata.recapTurnIds.filter((r): r is string => typeof r === 'string') : [],
      finalRuling: isRecord(metadata.finalRuling) ? {
        verdict: readString(metadata.finalRuling.verdict) ?? '',
        sentence: readString(metadata.finalRuling.sentence) ?? '',
        decidedAt: readString(metadata.finalRuling.decidedAt) ?? '',
      } : undefined,
      lastRenderDirective: isRecord(metadata.lastRenderDirective) ? metadata.lastRenderDirective : undefined,
    },
    createdAt: readString(raw.createdAt) ?? '',
    startedAt: readString(raw.startedAt),
    completedAt: readString(raw.completedAt),
  };
}

function normalizeCaseQueueSnapshot(raw: unknown): CaseQueueSnapshot | null {
  if (!isRecord(raw)) return null;
  const queueRaw = Array.isArray(raw.queue) ? raw.queue : [];
  const queue: CaseQueueItem[] = [];
  for (const item of queueRaw) {
    if (!isRecord(item)) continue;
    const id = readString(item.id);
    if (!id) continue;
    const source = readString(item.source) ?? '';
    if (source !== 'twitch' && source !== 'operator' && source !== 'generated' && source !== 'public_page') continue;
    queue.push({
      id,
      prompt: readString(item.prompt) ?? '',
      source,
      submittedBy: readString(item.submittedBy),
      status: (item.status === 'queued' || item.status === 'running' || item.status === 'completed' || item.status === 'skipped') ? item.status : 'queued',
      sessionId: readString(item.sessionId),
      estimatedStartMinutes: readNumber(item.estimatedStartMinutes),
      streamUrl: readString(item.streamUrl),
      transcriptsUrl: readString(item.transcriptsUrl),
      createdAt: readString(item.createdAt) ?? '',
    });
  }
  return {
    queue,
    queuedCount: readNumber(raw.queuedCount) ?? queue.length,
    runningSessionId: readString(raw.runningSessionId) ?? null,
    automationEnabled: raw.automationEnabled === true,
    generatedFallback: raw.generatedFallback === true,
  };
}

function normalizePublicQueueSubmission(raw: unknown): PublicQueueSubmission | null {
  if (!isRecord(raw) || !isRecord(raw.item)) return null;
  const snapshot = normalizeCaseQueueSnapshot({ queue: [raw.item], queuedCount: 1, runningSessionId: null });
  const item = snapshot?.queue[0];
  const position = readNumber(raw.position);
  if (!item || position === undefined) return null;
  return {
    item,
    position,
    estimatedStartMinutes: readNumber(raw.estimatedStartMinutes),
  };
}

function normalizeSocialPerson(raw: unknown): TwitchSocialPerson | undefined {
  if (!isRecord(raw)) return undefined;
  const displayName = readString(raw.displayName)?.trim();
  if (!displayName) return undefined;
  return {
    displayName,
    login: readString(raw.login),
    giftCount: readNumber(raw.giftCount),
    tier: readString(raw.tier),
    followedAt: readString(raw.followedAt),
    subscribedAt: readString(raw.subscribedAt),
    giftedAt: readString(raw.giftedAt),
    updatedAt: readString(raw.updatedAt),
  };
}

function normalizeTwitchSocialSnapshot(raw: unknown): TwitchSocialSnapshot {
  if (!isRecord(raw)) return {};
  return {
    latestFollower: normalizeSocialPerson(raw.latestFollower),
    latestSubscriber: normalizeSocialPerson(raw.latestSubscriber),
    latestGifter: normalizeSocialPerson(raw.latestGifter),
    mostGifted: normalizeSocialPerson(raw.mostGifted),
    updatedAt: readString(raw.updatedAt),
  };
}

// ── Helpers ──
function prettyLabel(value?: string) {
  const label = value?.trim();
  if (!label) return '—';
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatOverlayTimestamp(iso?: string) {
  if (!iso) return '--:--:--';
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch {
    return iso.slice(0, 8);
  }
}

function formatDuration(startedAt?: string, now = Date.now()) {
  if (!startedAt) return '00:00:00';
  const elapsed = Math.max(0, now - Date.parse(startedAt));
  const hours = Math.floor(elapsed / 3_600_000);
  const minutes = Math.floor((elapsed % 3_600_000) / 60_000);
  const seconds = Math.floor((elapsed % 60_000) / 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// ── Hashing for deterministic jurors ──
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807 + 0) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

const FIRST_NAMES = ['Avery', 'Blythe', 'Cora', 'Dorian', 'Ellis', 'Faye', 'Grier', 'Hollis', 'Ira', 'Jules', 'Kerry', 'Lane', 'Morgan', 'Noor', 'Orin', 'Perry', 'Quinn', 'Reese', 'Sage', 'Tatum'];
const LAST_NAMES = ['Kovac', 'Delaney', 'Nakamura', 'Okonkwo', 'Solberg', 'Tran', 'Vasquez', 'Whitfield', 'Xie', 'Adebayo', 'Belkin', 'Cho', 'Dahl', 'Espino', 'Feng', 'Gupta', 'Hawke', 'Ikeda', 'Jiang', 'Knox'];
const ROLES = ['Foreperson', 'Data analyst', 'Behavioral scientist', 'Logistics coordinator', 'Risk assessor', 'Ethics advisor'];
const TRAITS = ['Meticulous note-taker', 'Skeptical of timelines', 'Pattern-focused', 'Trusts documentary evidence', 'Prefers oral testimony', 'Weighs motive heavily'];

function buildJurors(sessionId: string): Juror[] {
  const seed = hashString(sessionId);
  const rng = seededRandom(seed);
  const namePick = <T extends unknown>(list: T[], offset = 0): T => list[Math.floor(rng() * list.length + offset) % list.length];
  const jurors: Juror[] = [];
  const usedFirst = new Set<string>();
  const usedLast = new Set<string>();
  for (let i = 0; i < 6; i++) {
    let first = namePick(FIRST_NAMES, i * 3);
    let last = namePick(LAST_NAMES, i * 7);
    let attempts = 0;
    while ((usedFirst.has(first) || usedLast.has(last)) && attempts < 20) {
      first = namePick(FIRST_NAMES, i * 3 + attempts);
      last = namePick(LAST_NAMES, i * 7 + attempts);
      attempts++;
    }
    usedFirst.add(first);
    usedLast.add(last);
    const role = ROLES[i % ROLES.length];
    const trait = TRAITS[(i * 2 + Math.floor(rng() * 3)) % TRAITS.length];
    jurors.push({
      id: `juror-${sessionId}-${i}`,
      label: `J0${i + 1}`,
      name: `${first} ${last}`,
      role,
      trait,
    });
  }
  return jurors;
}

// ── Role styling ──
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

function roleColor(tone: RoleTone) {
  switch (tone) {
    case 'judge':     return 'hsl(var(--caution))';
    case 'prosecutor':return 'hsl(var(--pulse))';
    case 'defense':   return 'hsl(var(--signal))';
    case 'witness':   return 'hsl(var(--confirm))';
    case 'bailiff':   return 'hsl(var(--ink-dim))';
    case 'jury':      return 'hsl(var(--pulse))';
    default:          return 'hsl(var(--ink))';
  }
}

// ── Stingers ──
function directiveStingerLabel(effect: string) {
  if (effect.includes('objection')) return 'OBJECTION';
  if (effect.includes('hold')) return 'HOLD IT';
  if (effect.includes('take')) return 'TAKE THAT';
  if (effect.includes('evidence') || effect.includes('present')) return 'EVIDENCE PRESENTED';
  return effect.replaceAll('_', ' ').toUpperCase();
}

function stingerFromEvent(event: LiveOverlayEvent | null): OverlayStinger | null {
  if (!event || !isRecord(event.payload)) return null;
  const payload = event.payload;
  if (event.type === 'admin_trigger') {
    const title = readString(payload.title)?.trim();
    const message = readString(payload.message)?.trim();
    const kind = readString(payload.kind);
    if (!title || !message) return null;
    return { title, message, tone: kind === 'objection_stinger' ? 'purple' : kind === 'evidence_stinger' ? 'gold' : 'cyan' };
  }
  if (event.type === 'render_directive' && isRecord(payload.directive)) {
    const effect = readString(payload.directive.effect);
    if (!effect) return null;
    return { title: directiveStingerLabel(effect), message: `Directive during ${prettyLabel(readString(payload.phase) ?? 'live')} phase.`, tone: effect.includes('objection') || effect.includes('hold') ? 'purple' : 'gold' };
  }
  if (event.type === 'phase_changed') {
    const phase = readString(payload.phase);
    if (!phase) return null;
    return { title: `${prettyLabel(phase)} phase`, message: 'Courtroom moved to a new phase.', tone: 'cyan' };
  }
  if (event.type === 'case_file_generated') return { title: 'Case file locked', message: 'Evidence, roles, and witness statements ready.', tone: 'gold' };
  if (event.type === 'evidence_revealed') return { title: 'Evidence revealed', message: readString(payload.evidenceText) ?? 'New exhibit entered.', tone: 'gold' };
  if (event.type === 'objection_count_changed') return { title: 'Objection logged', message: `${String(readNumber(payload.count) ?? 0)} objections on record.`, tone: 'purple' };
  return null;
}

function stingerBorderColor(tone: OverlayStinger['tone']) {
  if (tone === 'gold') return 'border-[hsl(var(--caution))]';
  if (tone === 'purple') return 'border-[hsl(var(--signal))]';
  return 'border-[hsl(var(--pulse))]';
}

// ── Hooks ──
function useNowTick(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function useLiveOverlaySession() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<LiveSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<LiveOverlayEvent | null>(null);

  const refreshSessionList = useCallback(async () => {
    try {
      const response = await fetch('/api/court/sessions');
      if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
      const payload = (await response.json()) as { sessions?: unknown };
      const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
      const running = sessions.find((candidate) => isRecord(candidate) && candidate.status === 'running');
      const nextSessionId = isRecord(running) ? (readString(running.id) ?? readString(running.sessionId) ?? null) : null;
      setSessionId((current) => (current === nextSessionId ? current : nextSessionId));
      if (!nextSessionId) { setSession(null); setConnected(false); setError(null); setLastEvent(null); setLoading(false); }
    } catch (listError) {
      console.error('Failed to discover live session:', listError);
      setError('Waiting for a running session.');
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refreshSessionList(); const timer = window.setInterval(() => void refreshSessionList(), OVERLAY_DISCOVERY_MS); return () => window.clearInterval(timer); }, [refreshSessionList]);

  useEffect(() => {
    if (!sessionId) return undefined;
    let cancelled = false;
    setLoading(true); setSession(null); setLastEvent(null);

    const syncSession = async () => {
      try {
        const response = await fetch(`/api/court/sessions/${sessionId}`);
        if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
        const payload = (await response.json()) as { session?: unknown };
        const nextSession = normalizeSession(payload.session);
        if (cancelled) return;
        if (!nextSession || nextSession.status !== 'running') { setSession(null); setConnected(false); setError(null); setLoading(false); return; }
        setSession(nextSession); setLoading(false); setError(null); setLastUpdatedAt(new Date().toISOString());
      } catch (sessionError) {
        if (cancelled) return;
        console.error('Failed to load live session:', sessionError);
        setError('Live session sync failed.'); setLoading(false);
      }
    };

    void syncSession();
    const source = new EventSource(`/api/court/sessions/${sessionId}/stream`);
    source.onopen = () => { if (!cancelled) { setConnected(true); setError(null); } };
    source.onmessage = (event) => {
      if (cancelled) return;
      try {
        const message = JSON.parse(event.data) as { type?: string; payload?: unknown };
        if (typeof message.type === 'string' && message.type !== 'snapshot') {
          setLastEvent({ type: message.type, payload: message.payload, receivedAt: new Date().toISOString() });
        }
        if (message.type === 'snapshot' && isRecord(message.payload)) {
          const nextSession = normalizeSession(message.payload.session);
          if (nextSession?.status === 'running') { setSession(nextSession); setLoading(false); setLastUpdatedAt(new Date().toISOString()); }
          return;
        }
        void syncSession();
      } catch (streamError) { console.error('Failed to parse overlay stream message:', streamError); }
    };
    source.onerror = () => { if (!cancelled) { setConnected(false); setError('Reconnecting...'); } };
    return () => { cancelled = true; source.close(); };
  }, [sessionId]);

  return { session, loading, connected, error, lastUpdatedAt, lastEvent };
}

function useCaseQueue(endpoint = '/api/public/case-queue') {
  const [snapshot, setSnapshot] = useState<CaseQueueSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
      const next = normalizeCaseQueueSnapshot(await response.json());
      setSnapshot(next); setError(null);
    } catch (queueError) { console.error('Failed to load case queue:', queueError); setError('Case queue unavailable.'); }
  }, [endpoint]);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 10_000); return () => window.clearInterval(timer); }, [refresh]);
  return { snapshot, error };
}

function useTwitchSocial(lastEvent?: LiveOverlayEvent | null) {
  const [social, setSocial] = useState<TwitchSocialSnapshot>({});
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/public/twitch/social');
      if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
      const payload = await response.json() as { social?: unknown };
      setSocial(normalizeTwitchSocialSnapshot(payload.social)); setError(null);
    } catch { setError('Signals offline.'); }
  }, []);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 15_000); return () => window.clearInterval(timer); }, [refresh]);
  useEffect(() => {
    if (lastEvent?.type !== 'twitch_social_updated' || !isRecord(lastEvent.payload)) return;
    setSocial(normalizeTwitchSocialSnapshot(lastEvent.payload.social)); setError(null);
  }, [lastEvent]);
  return { social, error };
}

// ── Social helpers ──
function socialTimeLabel(person?: TwitchSocialPerson) {
  const value = person?.followedAt ?? person?.subscribedAt ?? person?.giftedAt ?? person?.updatedAt;
  if (!value) return '--';
  return formatOverlayTimestamp(value);
}

// ══════════════════════════════════════════════
// SOCIAL SIGNAL CARD
// ══════════════════════════════════════════════
function SocialSignalCard({ label, person, fallback, tone }: {
  label: string; person?: TwitchSocialPerson; fallback: string; tone: 'pulse' | 'caution' | 'signal';
}) {
  const borderColor = tone === 'signal' ? 'hsl(var(--signal))' : tone === 'caution' ? 'hsl(var(--caution))' : 'hsl(var(--pulse))';
  return (
    <div className="border-l-2 pl-3 py-1" style={{ borderColor }}>
      <p className="text-2xs uppercase tracking-[0.12em] text-[hsl(var(--ink-mute))]">{label}</p>
      <p className="truncate text-sm font-semibold text-[hsl(var(--ink))]">{person?.displayName ?? fallback}</p>
      <p className="text-2xs" style={{ color: borderColor }}>
        {person?.giftCount ? `${person.giftCount}g ` : ''}{person?.tier ? `T${person.tier} ` : ''}{socialTimeLabel(person)}
      </p>
    </div>
  );
}

// ══════════════════════════════════════════════
// OVERLAY STANDBY
// ══════════════════════════════════════════════
function OverlayStandby({ loading, error }: { loading: boolean; error: string | null }) {
  return (
    <div className="grid min-h-screen place-items-center overflow-hidden bg-[hsl(var(--void))] text-[hsl(var(--ink))] font-body">
      <div className="relative aspect-video w-screen max-w-[calc(100vh*16/9)] overflow-hidden border border-[hsl(var(--border-faint))] hud-bracket">
        <div className="overlay-safe flex h-full items-center justify-center">
          <div className="max-w-lg text-center space-y-6">
            <div className="flex items-center justify-center gap-3 text-hud uppercase tracking-[0.15em] text-[hsl(var(--ink-dim))]">
              <StatusLed state="sync" />
              <span>JURYRIGGED v0.1</span>
              <StatusLed state="sync" />
            </div>
            <div className="border border-[hsl(var(--border-faint))] px-6 py-8">
              <p className="text-xs uppercase tracking-[0.2em] text-[hsl(var(--pulse))] hud-prompt">
                {loading ? 'ESTABLISHING UPLINK' : 'AWAITING SIGNAL'}
              </p>
              <p className="mt-4 text-lg font-semibold text-[hsl(var(--ink))]">
                {loading ? 'Scanning for active courtroom session...' : 'No running session detected'}
              </p>
              <p className="mt-3 text-sm text-[hsl(var(--ink-dim))]">
                This overlay attaches automatically when the court goes live.
              </p>
              {error ? <p className="mt-4 text-xs uppercase tracking-[0.12em] text-[hsl(var(--caution))]">▸ STATUS: {error}</p> : null}
            </div>
            <div className="flex items-center justify-center gap-6 text-2xs uppercase tracking-[0.15em] text-[hsl(var(--ink-mute))]">
              <span>SYS: NOMINAL</span>
              <span>FRAME: 16:9</span>
              <span>RATE: 60HZ</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// OVERLAY VIEW
// ══════════════════════════════════════════════
function OverlayView() {
  const now = useNowTick(1000);
  const { session, loading, connected, error, lastUpdatedAt, lastEvent } = useLiveOverlaySession();
  const { social, error: socialError } = useTwitchSocial(lastEvent);
  const [stinger, setStinger] = useState<OverlayStinger | null>(null);
  const { snapshot: queueSnapshot } = useCaseQueue();
  const sceneRunner = useSceneRunner();
  const courtStage = useCourtStage();
  const [sceneMode, setSceneMode] = useState(false);

  // Feed scene events to the stage state
  useEffect(() => {
    if (sceneRunner.current) {
      courtStage.applyEvent(sceneRunner.current);
    }
  }, [sceneRunner.current, courtStage]);

  // Auto-activate scene mode when a render_directive with stinger arrives
  useEffect(() => {
    if (!lastEvent || lastEvent.type !== 'render_directive' || !isRecord(lastEvent.payload)) return;
    const directive = lastEvent.payload as ApiRecord;
    if (directive.stinger || directive.scene) {
      setSceneMode(true);
      if (directive.scene === 'opening') {
        sceneRunner.loadScene(OPENING_SCENE);
      }
    }
  }, [lastEvent, sceneRunner]);

  const transcriptTurns = useMemo(
    () => (session ? session.turns.slice(-OVERLAY_TRANSCRIPT_LIMIT) : []),
    [session],
  );
  const jurors = useMemo(() => (session ? buildJurors(session.id) : []), [session]);
  const runtime = session ? formatDuration(session.startedAt ?? session.createdAt, now) : '00:00:00';
  const liveStamp = lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--';
  const connectedLed = connected ? 'live' : 'sync';
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [transcriptTurns]);

  useEffect(() => {
    if (!session) { setStinger(null); return undefined; }
    const nextStinger = stingerFromEvent(lastEvent);
    if (!nextStinger) return undefined;
    setStinger(nextStinger);
    const timer = window.setTimeout(() => setStinger(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [lastEvent, session]);

  if (!session) return <OverlayStandby loading={loading} error={error} />;

  const queuedCount = queueSnapshot?.queuedCount ?? 0;
  const activePromptSource = session.metadata.caseSource ? prettyLabel(session.metadata.caseSource) : 'GEN';
  const evidenceCount = session.metadata.evidenceCards.length;
  const objectionCount = session.metadata.objectionCount ?? 0;

  return (
    <div className="grid min-h-screen place-items-center overflow-hidden bg-[hsl(var(--void))] text-[hsl(var(--ink))] font-body">
      <div className="relative aspect-video w-screen max-w-[calc(100vh*16/9)] overflow-hidden border border-[hsl(var(--border-faint))] hud-bracket">
        {stinger ? (
          <div className={cn('pointer-events-none absolute inset-0 z-30 flex items-center justify-center motion-safe:animate-stinger-shake')}>
            <div className={cn('border-3 px-8 py-6 bg-[hsl(var(--void-900))]', stingerBorderColor(stinger.tone))}>
              <p className="text-xs uppercase tracking-[0.2em] text-[hsl(var(--signal))] hud-prompt">COURT STINGER</p>
              <p className="mt-3 text-3xl font-bold text-[hsl(var(--ink))]">{stinger.title}</p>
              <p className="mt-2 text-base text-[hsl(var(--ink-dim))]">{stinger.message}</p>
            </div>
          </div>
        ) : null}

        {/* SCENE STAGE — background layer when scene mode is active */}
        {sceneMode ? (
          <div className="absolute inset-0 z-0">
            <CourtStage state={courtStage.state} />
          </div>
        ) : null}

        {/* DIALOGUE BOX — overlaid when scene runner has a 'say' event */}
        {sceneMode && sceneRunner.current?.type === 'say' ? (
          <DialogueBox
            speaker={sceneRunner.current.speaker}
            text={sceneRunner.current.text}
            onAdvance={sceneRunner.advance}
          />
        ) : null}

        {/* FX OVERLAY — flash/shake/stamp from scene events */}
        {sceneMode ? <FXOverlay event={sceneRunner.current} /> : null}

        <div className="flex items-center gap-6 px-4 py-1.5 border-b border-[hsl(var(--border-faint))] bg-[hsl(var(--void-800))] text-2xs uppercase tracking-[0.1em] text-[hsl(var(--ink-dim))]">
          <span className="text-[hsl(var(--signal))] font-semibold">JURYRIGGED</span>
          <StatusLed state={connectedLed as 'live' | 'sync'} />
          <span>{connected ? 'LIVE' : 'SYNC'}</span>
          <span className="text-[hsl(var(--ink-mute))]">|</span>
          <span>PHASE:</span>
          <span className="text-[hsl(var(--pulse))]">{session.phase}</span>
          <span className="text-[hsl(var(--ink-mute))]">|</span>
          <span>UPT:</span>
          <span className="text-[hsl(var(--signal))]">{runtime}</span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => { setSceneMode(!sceneMode); if (!sceneMode) { sceneRunner.loadScene(OPENING_SCENE); } else { sceneRunner.stop(); courtStage.reset(); } }}
            className={cn('text-2xs uppercase tracking-[0.1em] border px-1.5 py-0.5', sceneMode ? 'border-[hsl(var(--signal))] text-[hsl(var(--signal))]' : 'border-[hsl(var(--border-faint))] text-[hsl(var(--ink-mute))]')}
          >
            SCENE
          </button>
          <span>{liveStamp}</span>
          {error ? <span className="text-[hsl(var(--alert))] ml-3">· {error}</span> : null}
        </div>

        <div className="px-4 py-2 border-b border-[hsl(var(--border-faint))]">
          <p className="text-2xs uppercase tracking-[0.15em] text-[hsl(var(--ink-mute))]">CASE FILE</p>
          <p className="text-lg font-bold text-[hsl(var(--ink))] truncate">{session.topic}</p>
          <p className="text-xs text-[hsl(var(--ink-dim))] truncate">{session.metadata.casePrompt}</p>
        </div>

        <div className="flex flex-1 min-h-0" style={{ height: 'calc(100% - 146px)' }}>
          <div className="flex-1 flex flex-col min-w-0 border-r border-[hsl(var(--border-faint))]">
            <div className="flex items-center gap-4 px-4 py-1.5 border-b border-[hsl(var(--border-faint))] text-2xs uppercase tracking-[0.1em] text-[hsl(var(--ink-dim))]">
              <span className="text-[hsl(var(--pulse))]">▸</span>
              <span>COMMS LOG</span>
              <span className="flex-1" />
              <span className="text-[hsl(var(--ink-mute))]">{session.turnCount}T / {transcriptTurns.length}V</span>
            </div>
            <div ref={transcriptRef} className="flex-1 overflow-y-auto px-4" role="log" aria-live="polite" aria-relevant="additions text">
              {transcriptTurns.length > 0 ? (
                <div className="py-2 space-y-0">
                  {transcriptTurns.map((turn, index) => {
                    const tone = roleTone(turn.role);
                    const color = roleColor(tone);
                    const alignRight = index % 2 === 1;
                    return (
                      <article key={turn.id} className={cn('flex w-full py-1', alignRight ? 'justify-end text-right' : 'justify-start text-left')}>
                        <div className={cn('max-w-[88%] border-l-2 pl-3', alignRight && 'border-l-0 border-r-2 pl-0 pr-3')} style={{ borderColor: color }}>
                          <p className="text-xs font-semibold" style={{ color }}>
                            [{tone === 'judge' ? 'JUDG' : tone === 'prosecutor' ? 'PROS' : tone === 'defense' ? 'DEFN' : tone === 'witness' ? 'WITN' : tone === 'bailiff' ? 'BAIL' : tone === 'jury' ? 'JURY' : 'ROLE'}]{' '}
                            <span className="text-[hsl(var(--ink))]">{prettyLabel(turn.speaker)}</span>
                          </p>
                          <p className="text-2xs uppercase tracking-[0.1em] text-[hsl(var(--ink-mute))] mt-0.5">#{turn.turnNumber} · {prettyLabel(turn.phase)}</p>
                          <p className="mt-1 text-sm leading-relaxed text-[hsl(var(--ink-dim))]">{turn.dialogue}</p>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-xs text-[hsl(var(--ink-mute))]">
                  <span className="hud-cursor">AWAITING TRANSMISSION</span>
                </div>
              )}
            </div>
          </div>

          <div className="w-[320px] flex flex-col min-h-0 bg-[hsl(var(--void-800))] overflow-y-auto">
            <div className="border-b border-[hsl(var(--border-faint))]">
              <div className="px-3 py-1.5 text-2xs uppercase tracking-[0.12em] text-[hsl(var(--signal))] flex items-center gap-2">
                <StatusLed state="ok" /><span>JURY MANIFEST</span><span className="flex-1" /><span className="text-[hsl(var(--ink-mute))]">{jurors.length} SEATED</span>
              </div>
              <div className="px-3 pb-3 space-y-0.5">
                {jurors.map((juror) => (
                  <div key={juror.id} className="flex items-center gap-2 py-0.5 border-b border-[hsl(var(--border-faint)/0.3)] last:border-0">
                    <span className="text-2xs text-[hsl(var(--ink-mute))] w-8">{juror.label}</span>
                    <span className="text-xs text-[hsl(var(--ink))] flex-1 truncate">{juror.name}</span>
                    <span className="text-2xs text-[hsl(var(--ink-dim))] uppercase">{juror.role.slice(0, 5)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-b border-[hsl(var(--border-faint))]">
              <div className="px-3 py-1.5 text-2xs uppercase tracking-[0.12em] text-[hsl(var(--pulse))] flex items-center gap-2">
                <StatusLed state="sync" /><span>SIGNALS</span><span className="flex-1" /><span className="text-[hsl(var(--ink-mute))]">{socialError ?? 'LIVE'}</span>
              </div>
              <div className="px-3 pb-3 space-y-2">
                <SocialSignalCard label="FOLLOW" person={social.latestFollower} fallback="---" tone="pulse" />
                <SocialSignalCard label="SUB" person={social.latestSubscriber} fallback="---" tone="signal" />
                <SocialSignalCard label="GIFT" person={social.latestGifter} fallback="---" tone="caution" />
                <SocialSignalCard label="TOP GIFT" person={social.mostGifted} fallback="---" tone="caution" />
              </div>
            </div>

            <div className="border-b border-[hsl(var(--border-faint))]">
              <div className="px-3 py-1.5 text-2xs uppercase tracking-[0.12em] text-[hsl(var(--caution))] flex items-center gap-2">
                <StatusLed state="warn" /><span>QUEUE</span><span className="flex-1" /><span className="text-[hsl(var(--ink))] font-semibold">{queuedCount}</span>
              </div>
              <div className="px-3 pb-3">
                <HudRow label="Source" value={activePromptSource} />
                <HudRow label="Status" value={queuedCount === 0 ? 'IDLE' : `${queuedCount} WAITING`} accent={queuedCount > 0 ? 'caution' : undefined} />
              </div>
            </div>

            <div className="px-3 py-2 space-y-0.5">
              <HudRow label="Evidence" value={`${evidenceCount} CARDS`} />
              <HudRow label="Objections" value={String(objectionCount)} accent={objectionCount > 0 ? 'alert' : undefined} />
              <HudRow label="Case Type" value={prettyLabel(session.metadata.caseType)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// APP SHELL
// ══════════════════════════════════════════════
function App() {
  const [activeView, setActiveView] = useState<ViewKey>(getInitialView);
  const setView = useCallback((view: ViewKey) => { setActiveView(view); syncViewToUrl(view); }, []);
  const navigableViews = useMemo(() => views.filter(v => v.key !== 'overlay'), []);

  const handleViewKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, currentView: ViewKey) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const currentIndex = navigableViews.findIndex(v => v.key === currentView);
    const lastIndex = navigableViews.length - 1;
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? lastIndex : event.key === 'ArrowRight' ? (currentIndex + 1) % navigableViews.length : (currentIndex - 1 + navigableViews.length) % navigableViews.length;
    const nextView = navigableViews[nextIndex];
    if (!nextView) return;
    setView(nextView.key);
    window.setTimeout(() => document.getElementById(`view-tab-${nextView.key}`)?.focus(), 0);
  }, [navigableViews, setView]);

  useEffect(() => {
    const handlePopState = () => setActiveView(getInitialView());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  if (activeView === 'overlay') return <OverlayView />;

  return (
    <div className="min-h-screen bg-[hsl(var(--void))] text-[hsl(var(--ink))] font-body">
      <header className="sticky top-0 z-20 border-b border-[hsl(var(--border-faint))] bg-[hsl(var(--void-800))] px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <span className="text-sm font-bold text-[hsl(var(--signal))]">JURYRIGGED</span>
          <span className="text-2xs text-[hsl(var(--ink-mute))]">v0.1</span>
          <StatusLed state="sync" />
          <span className="text-2xs text-[hsl(var(--ink-dim))]">{liveMeta.mode}</span>
          <nav className="ml-auto flex gap-1" aria-label="View navigation" role="tablist">
            {navigableViews.map((view) => (
              <TabButton
                key={view.key}
                active={activeView === view.key}
                label={view.label}
                note={view.note}
                id={`view-tab-${view.key}`}
                controls={`view-panel-${view.key}`}
                onKeyDown={(event) => handleViewKeyDown(event, view.key)}
                onClick={() => setView(view.key)}
              />
            ))}
          </nav>
          <a href="/operator" className="text-2xs text-[hsl(var(--pulse))] border border-[hsl(var(--pulse))] px-2 py-0.5 hover:bg-[hsl(var(--panel-raised))] ml-2">
            ADMIN
          </a>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <section id="view-panel-dashboard" role="tabpanel" aria-labelledby="view-tab-dashboard" hidden={activeView !== 'dashboard'}>
          <DashboardView />
        </section>
        <section id="view-panel-transcripts" role="tabpanel" aria-labelledby="view-tab-transcripts" hidden={activeView !== 'transcripts'}>
          <TranscriptsView />
        </section>
        <section id="view-panel-submit" role="tabpanel" aria-labelledby="view-tab-submit" hidden={activeView !== 'submit'}>
          <SubmitView />
        </section>
        <section id="view-panel-about" role="tabpanel" aria-labelledby="view-tab-about" hidden={activeView !== 'about'}>
          <AboutView />
        </section>
      </main>
    </div>
  );
}

// ══════════════════════════════════════════════
// DASHBOARD VIEW — live data from API
// ══════════════════════════════════════════════
function DashboardView() {
  const { snapshot: caseQueue } = useCaseQueue();
  const { social } = useTwitchSocial();
  const [sessions, setSessions] = useState<TranscriptSearchResult[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const now = useNowTick(30_000);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setSessionsLoading(true);
      try {
        const response = await fetch('/api/court/sessions', { signal: controller.signal });
        if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
        const payload = await response.json() as { sessions?: unknown };
        const list = Array.isArray(payload.sessions) ? payload.sessions : [];
        const mapped: TranscriptSearchResult[] = [];
        for (const s of list) {
          if (!isRecord(s)) continue;
          const id = readString(s.id) ?? readString(s.sessionId);
          if (!id) continue;
          mapped.push({
            id,
            topic: readString(s.topic) ?? id,
            status: readString(s.status) ?? 'unknown',
            phase: readString(s.phase) ?? '',
            caseType: readString(s.caseType),
            casePrompt: readString((s.metadata as ApiRecord | undefined)?.casePrompt ?? s.casePrompt),
            createdAt: readString(s.createdAt) ?? '',
            startedAt: readString(s.startedAt),
            completedAt: readString(s.completedAt),
            turnCount: readNumber(s.turnCount) ?? 0,
          });
        }
        setSessions(mapped);
      } catch { /* silent, keep previous data */ }
      finally { if (!controller.signal.aborted) setSessionsLoading(false); }
    })();
    return () => controller.abort();
  }, [now]);

  const running = sessions.find(s => s.status === 'running');
  const recent = sessions.filter(s => s.status !== 'running').slice(0, 10);

  return (
    <div className="space-y-6">
      {/* LIVE SESSION — prominent callout */}
      {running ? (
        <ConsolePanel className="p-5 border-[hsl(var(--pulse))]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <HudSection label={`LIVE COURT · ${prettyLabel(running.phase)}`} note={running.status.toUpperCase()} />
              <p className="mt-2 text-xl font-bold text-[hsl(var(--ink))]">{running.topic}</p>
              <p className="mt-1 text-sm text-[hsl(var(--ink-dim))] line-clamp-2">{running.casePrompt}</p>
              <div className="mt-3 flex flex-wrap gap-4 text-2xs">
                <HudRow label="Turns" value={String(running.turnCount)} />
                <HudRow label="Started" value={running.startedAt ? formatDuration(running.startedAt, Date.now()) : '—'} accent="caution" />
                <HudRow label="Queue" value={caseQueue ? `${caseQueue.queuedCount} waiting` : '—'} />
              </div>
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              <a href="/app/?view=overlay" className="border border-[hsl(var(--pulse))] px-3 py-1.5 text-xs text-[hsl(var(--pulse))] text-center hover:bg-[hsl(var(--pulse)/0.1)]">WATCH OVERLAY</a>
            </div>
          </div>
        </ConsolePanel>
      ) : (
        <ConsolePanel className="p-5">
          <HudSection label="No active session" note={sessionsLoading ? 'Loading...' : 'Idle'} />
          <p className="mt-2 text-sm text-[hsl(var(--ink-dim))]">
            No courtroom session is currently running. Start one from the admin console or submit a prompt to the queue.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <a href="/app/?view=submit" className="border border-[hsl(var(--pulse))] px-3 py-1.5 text-xs text-[hsl(var(--pulse))] hover:bg-[hsl(var(--pulse)/0.1)]">SUBMIT PROMPT</a>
            <a href="/operator" className="border border-[hsl(var(--signal))] px-3 py-1.5 text-xs text-[hsl(var(--signal))] hover:bg-[hsl(var(--signal)/0.1)]">ADMIN CONSOLE</a>
          </div>
        </ConsolePanel>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent sessions */}
        <ConsolePanel className="lg:col-span-2 p-4">
          <HudSection label={`Recent sessions · ${sessions.length} total`} note={sessionsLoading ? 'Loading...' : ''} />
          <div className="mt-3 space-y-1">
            {recent.length > 0 ? recent.map((s) => {
              const dateLabel = s.completedAt ?? s.startedAt ?? s.createdAt;
              const source = s.caseType ? prettyLabel(s.caseType) : '—';
              return (
              <button
                key={s.id}
                type="button"
                onClick={() => { navigateToTranscript(s.id); }}
                className="block w-full border border-[hsl(var(--border-faint))] hover:border-[hsl(var(--pulse))] px-3 py-2 transition text-left"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[hsl(var(--ink))] truncate">{s.topic}</p>
                    <p className="text-2xs text-[hsl(var(--ink-dim))] line-clamp-1">{s.casePrompt ?? s.id}</p>
                  </div>
                  <span className="text-2xs uppercase tracking-[0.1em] text-[hsl(var(--ink-mute))] shrink-0">{s.status}</span>
                </div>
                <div className="mt-1 flex gap-3 text-2xs text-[hsl(var(--ink-mute))]">
                  <span>{s.turnCount} turns</span>
                  <span>{s.phase}</span>
                  <span>{source}</span>
                  {dateLabel ? <span>{new Date(dateLabel).toLocaleString()}</span> : null}
                </div>
              </button>
              );
            }) : (
              <p className="text-xs text-[hsl(var(--ink-mute))]">{sessionsLoading ? 'Loading sessions...' : 'No sessions recorded yet.'}</p>
            )}
          </div>
        </ConsolePanel>

        {/* Sidebar */}
        <div className="space-y-4">
          <ConsolePanel className="p-4">
            <HudSection label="System" />
            <div className="space-y-0.5 mt-2">
              <HudRow label="API" value="Online" accent="confirm" />
              <HudRow label="Queue" value={caseQueue ? `${caseQueue.queuedCount} waiting` : '—'} accent={caseQueue && caseQueue.queuedCount > 0 ? 'caution' : undefined} />
              <HudRow label="Auto-gen" value={caseQueue?.automationEnabled ? 'ON' : 'OFF'} accent={caseQueue?.automationEnabled ? 'pulse' : undefined} />
              <HudRow label="Fallback" value={caseQueue?.generatedFallback ? 'Active' : 'Inactive'} />
            </div>
          </ConsolePanel>

          <ConsolePanel className="p-4">
            <HudSection label="Signals" note="Twitch" />
            <div className="space-y-1 mt-2">
              {social.latestFollower ? <HudRow label="Follow" value={social.latestFollower.displayName} /> : <p className="text-2xs text-[hsl(var(--ink-mute))]">No signals yet</p>}
              {social.latestSubscriber ? <HudRow label="Sub" value={`${social.latestSubscriber.displayName}${social.latestSubscriber.tier ? ` T${social.latestSubscriber.tier}` : ''}`} /> : null}
              {social.mostGifted ? <HudRow label="Top Gift" value={`${social.mostGifted.displayName} (${social.mostGifted.giftCount})`} accent="caution" /> : null}
            </div>
          </ConsolePanel>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// TRANSCRIPTS VIEW
// ══════════════════════════════════════════════
function TranscriptsView() {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [results, setResults] = useState<TranscriptSearchResult[]>([]);
  const [selectedTranscriptId, setSelectedTranscriptId] = useState(getCaseParam);
  const [selectedSession, setSelectedSession] = useState<LiveSession | null>(null);
  const [searchLoading, setSearchLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'turns_desc' | 'turns_asc' | 'topic_asc'>('date_desc');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const search = async () => {
      setSearchLoading(true); setError(null);
      try {
        const response = await fetch(`/api/public/transcripts?q=${encodeURIComponent(submittedQuery)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Search failed (${response.status})`);
        const payload = normalizeTranscriptSearchResponse(await response.json());
        if (!payload) throw new Error('Unexpected response');
        setResults(payload.results);
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Search failed'); }
      finally { if (!controller.signal.aborted) setSearchLoading(false); }
    };
    search();
    return () => controller.abort();
  }, [submittedQuery]);

  useEffect(() => {
    if (!selectedTranscriptId) { setSelectedSession(null); return undefined; }
    const controller = new AbortController();
    setDetailLoading(true); setSelectedSession(null); setError(null);
    (async () => {
      try {
        const response = await fetch(`/api/public/transcripts/${encodeURIComponent(selectedTranscriptId)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Detail failed (${response.status})`);
        const payload = await response.json() as ApiRecord;
        const session = normalizeSession(payload.session);
        if (!session) throw new Error('Unexpected response');
        setSelectedSession(session);
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Detail failed'); }
      finally { if (!controller.signal.aborted) setDetailLoading(false); }
    })();
    return () => controller.abort();
  }, [selectedTranscriptId]);

  const selectTranscript = (id: string) => {
    setSelectedTranscriptId(id);
    const url = new URL(window.location.href);
    url.searchParams.set(VIEW_PARAM, 'transcripts');
    url.searchParams.set('case', id);
    window.history.pushState({}, '', url);
  };

  const clearTranscript = () => { setSelectedTranscriptId(''); setSelectedSession(null); };

  const detailTurns = useMemo(() => selectedSession?.turns ?? [], [selectedSession]);

  // Sort + filter results client-side
  const sortedResults = useMemo(() => {
    let filtered = [...results];
    if (statusFilter !== 'all') {
      filtered = filtered.filter(r => r.status === statusFilter);
    }
    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      filtered = filtered.filter(r => new Date(r.completedAt ?? r.createdAt).getTime() >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo + 'T23:59:59').getTime();
      filtered = filtered.filter(r => new Date(r.completedAt ?? r.createdAt).getTime() <= to);
    }
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'date_desc': return (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt);
        case 'date_asc':  return (a.createdAt).localeCompare(b.createdAt);
        case 'turns_desc':return b.turnCount - a.turnCount;
        case 'turns_asc': return a.turnCount - b.turnCount;
        case 'topic_asc': return a.topic.localeCompare(b.topic);
        default:          return 0;
      }
    });
    return filtered;
  }, [results, sortBy, statusFilter]);

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
      <ConsolePanel className="p-4 flex flex-col min-h-0">
        <HudSection label="Search records" />
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); setSubmittedQuery(query.trim()); }}>
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by topic or prompt..."
            className="w-full border border-[hsl(var(--border-faint))] bg-[hsl(var(--void-800))] px-3 py-1.5 text-xs text-[hsl(var(--ink))] outline-none placeholder:text-[hsl(var(--ink-mute))] focus:border-[hsl(var(--pulse))]"
          />
          <div className="flex gap-2">
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="flex-1 border border-[hsl(var(--border-faint))] bg-[hsl(var(--void-800))] px-2 py-1.5 text-2xs text-[hsl(var(--ink))] uppercase">
              <option value="date_desc">Newest</option>
              <option value="date_asc">Oldest</option>
              <option value="turns_desc">Most turns</option>
              <option value="turns_asc">Fewest turns</option>
              <option value="topic_asc">Topic A-Z</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="flex-1 border border-[hsl(var(--border-faint))] bg-[hsl(var(--void-800))] px-2 py-1.5 text-2xs text-[hsl(var(--ink))] uppercase">
              <option value="all">All</option>
              <option value="completed">Completed</option>
              <option value="running">Running</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div className="flex gap-2">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="flex-1 border border-[hsl(var(--border-faint))] bg-[hsl(var(--void-800))] px-2 py-1.5 text-2xs text-[hsl(var(--ink))] uppercase"
              aria-label="Date from"
            />
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="flex-1 border border-[hsl(var(--border-faint))] bg-[hsl(var(--void-800))] px-2 py-1.5 text-2xs text-[hsl(var(--ink))] uppercase"
              aria-label="Date to"
            />
          </div>
          <button type="submit" className="w-full border border-[hsl(var(--pulse))] bg-[hsl(var(--pulse)/0.1)] px-3 py-1.5 text-xs text-[hsl(var(--pulse))] hover:bg-[hsl(var(--pulse)/0.2)]">
            SEARCH
          </button>
        </form>
        <div className="mt-3 flex-1 overflow-y-auto space-y-1">
          {searchLoading ? (
            <p className="text-2xs text-[hsl(var(--ink-mute))]">Scanning...</p>
          ) : sortedResults.length > 0 ? sortedResults.map((result) => (
            <button
              key={result.id} type="button" onClick={() => selectTranscript(result.id)}
              className={cn('w-full border p-2 text-left transition hover:border-[hsl(var(--pulse))]', selectedTranscriptId === result.id ? 'border-[hsl(var(--pulse))] bg-[hsl(var(--panel-raised))]' : 'border-[hsl(var(--border-faint))]')}
            >
              <p className="text-2xs uppercase tracking-[0.1em] text-[hsl(var(--ink-mute))]">{result.status} · {result.phase}{result.caseType ? ` · ${result.caseType}` : ''}</p>
              <p className="text-xs font-semibold text-[hsl(var(--ink))] truncate">{result.topic}</p>
              <p className="text-2xs text-[hsl(var(--ink-dim))] line-clamp-1">{result.casePrompt ?? result.id}</p>
              <p className="text-2xs text-[hsl(var(--caution))]">{result.turnCount} turns{result.completedAt ? ` · completed ${new Date(result.completedAt).toLocaleDateString()}` : result.startedAt ? ` · started ${new Date(result.startedAt).toLocaleDateString()}` : ''}</p>
            </button>
          )) : (
            <p className="text-2xs text-[hsl(var(--ink-mute))]">{submittedQuery ? 'No results.' : `Enter a query. ${sortedResults.length !== results.length ? 'Filter active.' : ''}`}</p>
          )}
        </div>
        {error ? <p className="mt-2 text-2xs text-[hsl(var(--alert))]">{error}</p> : null}
      </ConsolePanel>

      <ConsolePanel className="p-4 flex flex-col min-h-0">
        {detailLoading ? (
          <div className="flex items-center justify-center h-full text-xs text-[hsl(var(--ink-mute))]">
            <span className="hud-cursor">LOADING TRANSCRIPT</span>
          </div>
        ) : selectedSession ? (
          <div className="flex flex-col min-h-0">
            <div className="flex items-start justify-between gap-3 border-b border-[hsl(var(--border-faint))] pb-3">
              <div className="min-w-0">
                <p className="text-2xs uppercase tracking-[0.1em] text-[hsl(var(--ink-mute))]">TRANSCRIPT</p>
                <p className="text-sm font-bold text-[hsl(var(--ink))] truncate">{selectedSession.topic}</p>
                <p className="text-2xs text-[hsl(var(--ink-dim))]">{selectedSession.status} · {prettyLabel(selectedSession.phase)} · {selectedSession.turnCount} turns</p>
              </div>
              <button type="button" onClick={clearTranscript} className="border border-[hsl(var(--border-faint))] px-2 py-0.5 text-2xs text-[hsl(var(--ink-mute))] hover:border-[hsl(var(--pulse))]">CLEAR</button>
            </div>
            <div className="mt-3 flex-1 overflow-y-auto" role="log" aria-live="polite">
              <div className="space-y-1">
                {detailTurns.map((turn, index) => {
                  const tone = roleTone(turn.role);
                  const color = roleColor(tone);
                  return (
                    <TranscriptRow
                      key={turn.id}
                      speaker={prettyLabel(turn.speaker)}
                      role={turn.role}
                      dialogue={turn.dialogue}
                      turnNumber={turn.turnNumber}
                      phase={prettyLabel(turn.phase)}
                      alignRight={index % 2 === 1}
                      roleColor={color}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-xs text-[hsl(var(--ink-mute))]">
            Select a transcript to view the full session record.
          </div>
        )}
      </ConsolePanel>
    </div>
  );
}

// ══════════════════════════════════════════════
// SUBMIT VIEW (public prompt queue)
// ══════════════════════════════════════════════
function SubmitView() {
  const { snapshot, error: queueError } = useCaseQueue();
  const [prompt, setPrompt] = useState('');
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | undefined>(undefined);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submission, setSubmission] = useState<PublicQueueSubmission | null>(null);
  const [error, setError] = useState<string | null>(null);

  const queuedItems = snapshot?.queue.filter(item => item.status === 'queued').slice(0, 6) ?? [];
  const streamUrl = queuedItems.find(item => item.streamUrl)?.streamUrl ?? '/app/?view=overlay';
  const transcriptsUrl = queuedItems.find(item => item.transcriptsUrl)?.transcriptsUrl ?? '/app/?view=transcripts';
  const usesTurnstile = Boolean(TURNSTILE_SITE_KEY);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !turnstileContainerRef.current) return undefined;
    let cancelled = false;
    const renderWidget = () => {
      if (cancelled || !window.turnstile || !turnstileContainerRef.current || turnstileWidgetIdRef.current) return;
      turnstileWidgetIdRef.current = window.turnstile.render(turnstileContainerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: setTurnstileToken,
        'expired-callback': () => setTurnstileToken(''),
        'error-callback': () => setTurnstileToken(''),
      });
    };
    if (window.turnstile) { renderWidget(); } else {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true; script.defer = true; script.onload = renderWidget;
      document.head.append(script);
    }
    return () => { cancelled = true; };
  }, []);

  const submitPrompt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true); setError(null); setSubmission(null);
    try {
      let nonce = '';
      if (!usesTurnstile) {
        const nonceResponse = await fetch('/api/public/case-queue/nonce');
        if (!nonceResponse.ok) throw new Error('Verification not configured.');
        const noncePayload = await nonceResponse.json() as { nonce?: unknown };
        if (typeof noncePayload.nonce !== 'string') throw new Error('Nonce unavailable');
        nonce = noncePayload.nonce;
      } else if (!turnstileToken) throw new Error('Complete the verification challenge.');
      const response = await fetch('/api/public/case-queue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, source: 'public_page', nonce, turnstileToken }),
      });
      const payload = await response.json() as ApiRecord;
      if (!response.ok) {
        const message = readString(payload.message) ?? `Rejected (${response.status})`;
        throw new Error(message);
      }
      const next = normalizePublicQueueSubmission(payload);
      if (!next) throw new Error('Unexpected response');
      setSubmission(next); setPrompt(''); setTurnstileToken('');
      window.turnstile?.reset(turnstileWidgetIdRef.current);
    } catch (e) { setError(e instanceof Error ? e.message : 'Submission failed'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <ConsolePanel className="p-4">
        <HudSection label="Submit prompt" note="Queue only — session creation is admin-only." />
        <form className="mt-3 space-y-3" onSubmit={submitPrompt}>
          <textarea
            id="public-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)}
            minLength={10} maxLength={500} rows={7}
            placeholder="The defendant replaced evidence labels with riddles..."
            className="w-full resize-none border border-[hsl(var(--border-faint))] bg-[hsl(var(--void-800))] px-3 py-2 text-xs text-[hsl(var(--ink))] outline-none placeholder:text-[hsl(var(--ink-mute))] focus:border-[hsl(var(--pulse))]"
          />
          <div className="flex items-center justify-between text-2xs uppercase tracking-[0.1em] text-[hsl(var(--ink-mute))]">
            <span>{prompt.trim().length}/500</span>
            <span>{usesTurnstile ? 'Turnstile · rate limited' : 'Nonce · rate limited'}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {[
              'The accused replaced all jury chairs with whoopee cushions.',
              'The defendant claims their cat wrote the confession letter.',
              'A key witness insists they saw the suspect riding a unicycle.',
              'The prosecutor alleges the evidence was swapped for candy.',
              'The court stenographer was actually two raccoons in a trench coat.',
            ].map((example) => (
              <button
                key={example} type="button"
                onClick={() => setPrompt(example)}
                className="border border-[hsl(var(--border-faint))] px-2 py-1 text-2xs text-[hsl(var(--ink-dim))] hover:border-[hsl(var(--pulse))] hover:text-[hsl(var(--ink))]"
              >
                {example}
              </button>
            ))}
          </div>
          {usesTurnstile ? <div ref={turnstileContainerRef} className="min-h-[65px]" /> : null}
          <button
            type="submit" disabled={submitting || prompt.trim().length < 10 || (usesTurnstile && !turnstileToken)}
            className="w-full border border-[hsl(var(--pulse))] bg-[hsl(var(--pulse)/0.12)] px-3 py-2 text-sm font-semibold uppercase tracking-[0.12em] text-[hsl(var(--pulse))] hover:bg-[hsl(var(--pulse)/0.24)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'SUBMITTING...' : 'SUBMIT TO QUEUE'}
          </button>
        </form>
        {submission ? (
          <div className="mt-3 border border-[hsl(var(--pulse))] bg-[hsl(var(--pulse)/0.08)] p-3">
            <p className="text-2xs uppercase tracking-[0.12em] text-[hsl(var(--pulse))]">Queued #{submission.position}</p>
            <p className="mt-2 text-xs text-[hsl(var(--ink))]">{submission.item.prompt}</p>
            <p className="mt-1 text-2xs text-[hsl(var(--ink-dim))]">Approx. {submission.estimatedStartMinutes ?? 0} min</p>
          </div>
        ) : null}
        {error ? <p className="mt-3 text-2xs text-[hsl(var(--alert))]">{error}</p> : null}
      </ConsolePanel>

      <div className="space-y-4">
        <ConsolePanel className="p-4">
          <HudSection label="Queue status" note={queueError ?? `${snapshot?.queuedCount ?? 0} waiting`} />
          <div className="mt-2 space-y-2">
            <a href={streamUrl} className="block border border-[hsl(var(--pulse))] px-3 py-1.5 text-xs text-[hsl(var(--pulse))] text-center hover:bg-[hsl(var(--pulse)/0.1)]">WATCH OVERLAY</a>
            <a href={transcriptsUrl} className="block border border-[hsl(var(--caution))] px-3 py-1.5 text-xs text-[hsl(var(--caution))] text-center hover:bg-[hsl(var(--caution)/0.1)]">SEARCH TRANSCRIPTS</a>
          </div>
        </ConsolePanel>

        <ConsolePanel className="p-4">
          <HudSection label="Next in line" />
          <div className="mt-2 space-y-1">
            {queuedItems.length > 0 ? queuedItems.map((item, i) => (
              <div key={item.id} className="border-b border-[hsl(var(--border-faint)/0.5)] last:border-0 py-1">
                <p className="text-2xs uppercase tracking-[0.1em] text-[hsl(var(--pulse))]">#{i + 1} · {item.source.replace('_', ' ')}</p>
                <p className="text-xs text-[hsl(var(--ink))] line-clamp-2">{item.prompt}</p>
                <p className="text-2xs text-[hsl(var(--caution))]">≈{item.estimatedStartMinutes ?? i * 12}min</p>
              </div>
            )) : <p className="text-2xs text-[hsl(var(--ink-mute))]">No prompts queued.</p>}
          </div>
        </ConsolePanel>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// ABOUT VIEW
// ══════════════════════════════════════════════
function AboutView() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ConsolePanel className="p-4">
        <HudSection label="How it works" />
        <div className="mt-3 space-y-3">
          {howItWorks.map((item) => (
            <div key={item.title} className="border-l-2 border-[hsl(var(--pulse))] pl-3">
              <p className="text-xs font-semibold text-[hsl(var(--ink))]">{item.title}</p>
              <p className="mt-1 text-2xs text-[hsl(var(--ink-dim))]">{item.text}</p>
            </div>
          ))}
        </div>
      </ConsolePanel>
      <ConsolePanel className="p-4">
        <HudSection label="Accessibility" />
        <div className="mt-3 space-y-2 text-2xs text-[hsl(var(--ink-dim))]">
          <p className="hud-prompt">Transcript log uses role=log and aria-live for assistive tech.</p>
          <p className="hud-prompt">All state indicators include text labels — never color alone.</p>
          <p className="hud-prompt">Focus states are keyboard-friendly with high-contrast rings.</p>
          <p className="hud-prompt">Motion respects prefers-reduced-motion everywhere.</p>
        </div>
      </ConsolePanel>
    </div>
  );
}

export default App;
