import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  cases,
  detailTabs,
  evidence,
  health,
  howItWorks,
  jury,
  liveMeta,
  timeline,
  transcript,
  views,
  voteOptions,
  type ViewKey,
} from './data';
import {
  CaseCard,
  EvidenceList,
  JuryGrid,
  LivePill,
  PhaseRail,
  SectionLabel,
  StatChip,
  Surface,
  TabButton,
  TranscriptLog,
  VoteCard,
  cn,
} from './components';

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

type SidebarCard = {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  details: string[];
  footer?: string;
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

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback'?: () => void; 'error-callback'?: () => void }) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

const VIEW_PARAM = 'view';
const OVERLAY_DISCOVERY_MS = 5_000;
const OVERLAY_ROTATION_MS = 7_000;
const OVERLAY_TRANSCRIPT_LIMIT = 120;
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

function isViewKey(value: string | null): value is ViewKey {
  return (
    value === 'viewer' ||
    value === 'overlay' ||
    value === 'directory' ||
    value === 'details' ||
    value === 'prompt' ||
    value === 'transcripts' ||
    value === 'voting' ||
    value === 'about'
  );
}

function getCaseParam() {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('case') ?? '';
}

function getInitialView(): ViewKey {
  if (typeof window === 'undefined') return 'viewer';
  const view = new URLSearchParams(window.location.search).get(VIEW_PARAM);
  return isViewKey(view) ? view : 'viewer';
}

function syncViewToUrl(view: ViewKey) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (view === 'viewer') {
    url.searchParams.delete(VIEW_PARAM);
  } else {
    url.searchParams.set(VIEW_PARAM, view);
  }
  window.history.pushState({}, '', url);
}

function isRecord(value: unknown): value is ApiRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function toNumericRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, typeof entry === 'number' && Number.isFinite(entry) ? entry : Number(entry)])
      .filter(([, entry]) => Number.isFinite(entry)),
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeSession(raw: unknown): LiveSession | null {
  if (!isRecord(raw)) return null;
  const metadata = isRecord(raw.metadata) ? raw.metadata : {};
  const turns = Array.isArray(raw.turns)
    ? raw.turns.flatMap((item): LiveTurn[] => {
        if (!isRecord(item)) return [];
        const id = readString(item.id);
        const dialogue = readString(item.dialogue);
        const phase = readString(item.phase);
        const role = readString(item.role);
        const speaker = readString(item.speaker);
        const createdAt = readString(item.createdAt);
        const turnNumber = readNumber(item.turnNumber);
        if (!id || !dialogue || !phase || !role || !speaker || !createdAt || turnNumber === undefined) return [];
        return [{ id, dialogue, phase, role, speaker, createdAt, turnNumber }];
      })
    : [];

  const id = readString(raw.id);
  const topic = readString(raw.topic);
  const status = readString(raw.status);
  const phase = readString(raw.phase);
  const createdAt = readString(raw.createdAt);
  const turnCount = readNumber(raw.turnCount);
  if (!id || !topic || !status || !phase || !createdAt || turnCount === undefined) return null;

  const roleAssignments = isRecord(metadata.roleAssignments) ? metadata.roleAssignments : {};
  const witnesses = toStringList(roleAssignments.witnesses);

  return {
    id,
    topic,
    status,
    phase,
    turnCount,
    turns,
    participants: Array.isArray(raw.participants)
      ? raw.participants.filter((participant): participant is string => typeof participant === 'string')
      : [],
    metadata: {
      casePrompt: readString(metadata.casePrompt) ?? topic,
      caseType: readString(metadata.caseType) ?? 'unknown',
      caseSource: readString(metadata.caseSource),
      queueItemId: readString(metadata.queueItemId),
      verdictVotes: toNumericRecord(metadata.verdictVotes),
      sentenceVotes: toNumericRecord(metadata.sentenceVotes),
      pressVotes: toNumericRecord(metadata.pressVotes),
      presentVotes: toNumericRecord(metadata.presentVotes),
      roleAssignments: {
        judge: readString(roleAssignments.judge),
        prosecutor: readString(roleAssignments.prosecutor),
        defense: readString(roleAssignments.defense),
        witnesses,
        bailiff: readString(roleAssignments.bailiff),
      },
      currentGenre: readString(metadata.currentGenre),
      genreHistory: toStringList(metadata.genreHistory),
      evidenceCards: Array.isArray(metadata.evidenceCards)
        ? metadata.evidenceCards.flatMap((entry): Array<{ id: string; text?: string; revealedAt?: string }> => {
            if (!isRecord(entry)) return [];
            const evidenceId = readString(entry.id);
            return evidenceId
              ? [{ id: evidenceId, text: readString(entry.text), revealedAt: readString(entry.revealedAt) }]
              : [];
          })
        : [],
      objectionCount: readNumber(metadata.objectionCount),
      recapTurnIds: toStringList(metadata.recapTurnIds),
      finalRuling: isRecord(metadata.finalRuling)
        ? {
            verdict: readString(metadata.finalRuling.verdict) ?? '',
            sentence: readString(metadata.finalRuling.sentence) ?? '',
            decidedAt: readString(metadata.finalRuling.decidedAt) ?? '',
          }
        : undefined,
      lastRenderDirective: isRecord(metadata.lastRenderDirective) ? metadata.lastRenderDirective : undefined,
    },
    createdAt,
    startedAt: readString(raw.startedAt),
    completedAt: readString(raw.completedAt),
  };
}

function normalizeTranscriptSearchResult(raw: unknown): TranscriptSearchResult | null {
  if (!isRecord(raw)) return null;
  const id = readString(raw.id);
  const topic = readString(raw.topic);
  const status = readString(raw.status);
  const phase = readString(raw.phase);
  const createdAt = readString(raw.createdAt);
  const turnCount = readNumber(raw.turnCount);
  if (!id || !topic || !status || !phase || !createdAt || turnCount === undefined) return null;
  return {
    id,
    topic,
    status,
    phase,
    createdAt,
    turnCount,
    caseType: readString(raw.caseType),
    casePrompt: readString(raw.casePrompt),
    startedAt: readString(raw.startedAt),
    completedAt: readString(raw.completedAt),
  };
}

function normalizeTranscriptSearchResponse(raw: unknown): TranscriptSearchResponse | null {
  if (!isRecord(raw)) return null;
  const results = Array.isArray(raw.results)
    ? raw.results.flatMap((entry): TranscriptSearchResult[] => {
        const result = normalizeTranscriptSearchResult(entry);
        return result ? [result] : [];
      })
    : [];
  return {
    query: readString(raw.query) ?? '',
    results,
    count: readNumber(raw.count) ?? results.length,
  };
}

function normalizeCaseQueueSnapshot(raw: unknown): CaseQueueSnapshot | null {
  if (!isRecord(raw)) return null;
  const queue = Array.isArray(raw.queue)
    ? raw.queue.flatMap((item): CaseQueueItem[] => {
        if (!isRecord(item)) return [];
        const id = readString(item.id);
        const prompt = readString(item.prompt);
        const source = readString(item.source);
        const status = readString(item.status);
        const createdAt = readString(item.createdAt);
        if (!id || !prompt || !createdAt) return [];
        if (source !== 'twitch' && source !== 'operator' && source !== 'generated' && source !== 'public_page') return [];
        if (status !== 'queued' && status !== 'running' && status !== 'completed' && status !== 'skipped') return [];
        return [{
          id,
          prompt,
          source,
          status,
          createdAt,
          submittedBy: readString(item.submittedBy),
          sessionId: readString(item.sessionId),
          estimatedStartMinutes: readNumber(item.estimatedStartMinutes),
          streamUrl: readString(item.streamUrl),
          transcriptsUrl: readString(item.transcriptsUrl),
        }];
      })
    : [];

  return {
    queue,
    queuedCount: readNumber(raw.queuedCount) ?? queue.filter(item => item.status === 'queued').length,
    runningSessionId: readString(raw.runningSessionId) ?? null,
    automationEnabled: raw.automationEnabled !== false,
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

function sumRecord(values: Record<string, number>) {
  return Object.values(values).reduce((total, value) => total + value, 0);
}

function prettyLabel(value?: string) {
  if (!value) return 'Unassigned';
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function hashString(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createSeededRandom(seedValue: string) {
  let seed = hashString(seedValue) || 1;

  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

const JUROR_FIRST_NAMES = ['Avery', 'Mina', 'Cole', 'Daria', 'Rowan', 'Jules', 'Nico', 'Iris', 'Tess', 'Bennett'];
const JUROR_LAST_NAMES = ['Stone', 'Vale', 'Mercer', 'Quinn', 'Hale', 'Brooks', 'Sloane', 'Parker', 'Reed', 'North'];
const JUROR_ROLES = ['Foreperson', 'Evidence lead', 'Signal reader', 'Procedure guard', 'Pattern spotter', 'Consensus check'];
const JUROR_TRAITS = ['calm', 'sharp-eyed', 'pragmatic', 'skeptical', 'methodical', 'empathetic', 'direct', 'patient'];

function buildJurors(sessionId: string) {
  const random = createSeededRandom(sessionId);

  return Array.from({ length: 6 }, (_, index) => {
    const first = JUROR_FIRST_NAMES[Math.floor(random() * JUROR_FIRST_NAMES.length)];
    const last = JUROR_LAST_NAMES[Math.floor(random() * JUROR_LAST_NAMES.length)];
    const role = JUROR_ROLES[index % JUROR_ROLES.length];
    const trait = JUROR_TRAITS[Math.floor(random() * JUROR_TRAITS.length)];

    return {
      id: `${sessionId}-${index}`,
      label: `Juror ${String(index + 1).padStart(2, '0')}`,
      name: `${first} ${last}`,
      role,
      trait,
    };
  });
}

function formatOverlayTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function latestEvidenceLabel(session: LiveSession) {
  const latest = session.metadata.evidenceCards.at(-1);
  if (!latest) return 'No evidence revealed yet';
  return latest.text ?? latest.id;
}

function latestDirectiveLabel(session: LiveSession) {
  const directive = session.metadata.lastRenderDirective;
  if (!directive) return 'No active directive';
  return readString(directive.effect) ?? readString(directive.camera) ?? 'Directive active';
}

function directiveStingerLabel(effect: string) {
  const normalized = effect.replaceAll('_', ' ').toUpperCase();
  if (effect.includes('objection')) return 'OBJECTION';
  if (effect.includes('hold')) return 'HOLD IT';
  if (effect.includes('take')) return 'TAKE THAT';
  if (effect.includes('evidence') || effect.includes('present')) return 'EVIDENCE PRESENTED';
  return normalized;
}

function stingerFromEvent(event: LiveOverlayEvent | null): OverlayStinger | null {
  if (!event || !isRecord(event.payload)) return null;
  const payload = event.payload;

  if (event.type === 'admin_trigger') {
    const title = readString(payload.title)?.trim();
    const message = readString(payload.message)?.trim();
    const kind = readString(payload.kind);
    if (!title || !message) return null;
    return {
      title,
      message,
      tone: kind === 'objection_stinger' ? 'purple' : kind === 'evidence_stinger' ? 'gold' : 'cyan',
    };
  }

  if (event.type === 'render_directive' && isRecord(payload.directive)) {
    const effect = readString(payload.directive.effect);
    if (!effect) return null;
    return {
      title: directiveStingerLabel(effect),
      message: `Render directive received during ${prettyLabel(readString(payload.phase) ?? 'live')} phase.`,
      tone: effect.includes('objection') || effect.includes('hold') ? 'purple' : 'gold',
    };
  }

  if (event.type === 'phase_changed') {
    const phase = readString(payload.phase);
    if (!phase) return null;
    return {
      title: `${prettyLabel(phase)} phase`,
      message: 'The courtroom has moved to a new phase.',
      tone: 'cyan',
    };
  }

  if (event.type === 'case_file_generated') {
    return {
      title: 'Case file locked',
      message: 'Evidence, roles, and witness statements are ready for broadcast.',
      tone: 'gold',
    };
  }

  if (event.type === 'evidence_revealed') {
    return {
      title: 'Evidence revealed',
      message: readString(payload.evidenceText) ?? 'A new exhibit entered the record.',
      tone: 'gold',
    };
  }

  if (event.type === 'objection_count_changed') {
    return {
      title: 'Objection logged',
      message: `${String(readNumber(payload.count) ?? 0)} objections on the court record.`,
      tone: 'purple',
    };
  }

  return null;
}

function stingerToneClass(tone: OverlayStinger['tone']) {
  if (tone === 'gold') return 'text-[hsl(var(--gold))] border-[hsl(var(--gold)/0.45)] shadow-[0_24px_90px_hsl(var(--gold)/0.16)]';
  if (tone === 'purple') return 'text-[hsl(var(--purple))] border-[hsl(var(--purple)/0.45)] shadow-[0_24px_90px_hsl(var(--purple)/0.18)]';
  return 'text-[hsl(var(--cyan))] border-[hsl(var(--cyan)/0.45)] shadow-[0_24px_90px_hsl(var(--cyan)/0.16)]';
}

function formatDuration(startedAt?: string, now = Date.now()) {
  if (!startedAt) return '00:00:00';
  const elapsed = Math.max(0, now - Date.parse(startedAt));
  const hours = Math.floor(elapsed / 3_600_000);
  const minutes = Math.floor((elapsed % 3_600_000) / 60_000);
  const seconds = Math.floor((elapsed % 60_000) / 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function useNowTick(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPrefersReducedMotion(media.matches);
    update();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }

    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  return prefersReducedMotion;
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
      if (!response.ok) {
        throw new Error(`Unexpected status ${response.status}`);
      }

      const payload = (await response.json()) as { sessions?: unknown };
      const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
      const running = sessions.find((candidate) => isRecord(candidate) && candidate.status === 'running');
      const nextSessionId = isRecord(running) ? (readString(running.id) ?? readString(running.sessionId) ?? null) : null;

      setSessionId((current: string | null) => (current === nextSessionId ? current : nextSessionId));

      if (!nextSessionId) {
        setSession(null);
        setConnected(false);
        setError(null);
        setLastEvent(null);
        setLoading(false);
      }
    } catch (listError) {
      console.error('Failed to discover live session:', listError);
      setError('Waiting for a running session.');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSessionList();
    const timer = window.setInterval(() => {
      void refreshSessionList();
    }, OVERLAY_DISCOVERY_MS);

    return () => window.clearInterval(timer);
  }, [refreshSessionList]);

  useEffect(() => {
    if (!sessionId) return undefined;

    let cancelled = false;
    setLoading(true);
    setSession(null);
    setLastEvent(null);

    const syncSession = async () => {
      try {
        const response = await fetch(`/api/court/sessions/${sessionId}`);
        if (!response.ok) {
          throw new Error(`Unexpected status ${response.status}`);
        }

        const payload = (await response.json()) as { session?: unknown };
        const nextSession = normalizeSession(payload.session);
        if (cancelled) return;

        if (!nextSession || nextSession.status !== 'running') {
          setSession(null);
          setConnected(false);
          setError(null);
          setLoading(false);
          return;
        }

        setSession(nextSession);
        setLoading(false);
        setError(null);
        setLastUpdatedAt(new Date().toISOString());
      } catch (sessionError) {
        if (cancelled) return;
        console.error('Failed to load live session:', sessionError);
        setError('Live session sync failed.');
        setLoading(false);
      }
    };

    void syncSession();
    const source = new EventSource(`/api/court/sessions/${sessionId}/stream`);

    source.onopen = () => {
      if (cancelled) return;
      setConnected(true);
      setError(null);
    };

    source.onmessage = (event) => {
      if (cancelled) return;

      try {
        const message = JSON.parse(event.data) as { type?: string; payload?: unknown };
        if (typeof message.type === 'string' && message.type !== 'snapshot') {
          setLastEvent({ type: message.type, payload: message.payload, receivedAt: new Date().toISOString() });
        }
        if (message.type === 'snapshot' && isRecord(message.payload)) {
          const nextSession = normalizeSession(message.payload.session);
          if (nextSession?.status === 'running') {
            setSession(nextSession);
            setLoading(false);
            setLastUpdatedAt(new Date().toISOString());
          }
          return;
        }

        void syncSession();
      } catch (streamError) {
        console.error('Failed to parse overlay stream message:', streamError);
      }
    };

    source.onerror = () => {
      if (cancelled) return;
      setConnected(false);
      setError('Reconnecting to live session...');
    };

    return () => {
      cancelled = true;
      source.close();
    };
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
      setSnapshot(next);
      setError(null);
    } catch (queueError) {
      console.error('Failed to load case queue:', queueError);
      setError('Case queue unavailable.');
    }
  }, [endpoint]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { snapshot, error };
}

function buildSidebarCards(session: LiveSession, now: number): SidebarCard[] {
  const verdictVotes = sumRecord(session.metadata.verdictVotes);
  const sentenceVotes = sumRecord(session.metadata.sentenceVotes);
  const pressVotes = sumRecord(session.metadata.pressVotes);
  const presentVotes = sumRecord(session.metadata.presentVotes);
  const evidenceCount = session.metadata.evidenceCards.length;
  const witnessSummary = session.metadata.roleAssignments.witnesses.length
    ? session.metadata.roleAssignments.witnesses.map(prettyLabel).join(' · ')
    : 'No witness roles assigned';
  const directive = session.metadata.lastRenderDirective;

  return [
    {
      id: 'session',
      eyebrow: 'Live posture',
      title: session.topic,
      summary: `${session.phase} · ${session.status.toUpperCase()} · ${formatDuration(session.startedAt ?? session.createdAt, now)}`,
      details: [
        `${session.turnCount} turns on record`,
        `${session.turns.length} transcript lines loaded`,
        `${session.metadata.caseType} case · ${session.metadata.casePrompt}`,
      ],
      footer: session.metadata.currentGenre ? `Genre: ${session.metadata.currentGenre}` : 'Live capture only — no archived demo state.',
    },
    {
      id: 'cast',
      eyebrow: 'Cast board',
      title: 'Active roles',
      summary: 'Current courtroom assignments attached to the live session.',
      details: [
        `Judge · ${prettyLabel(session.metadata.roleAssignments.judge)}`,
        `Prosecution · ${prettyLabel(session.metadata.roleAssignments.prosecutor)}`,
        `Defense · ${prettyLabel(session.metadata.roleAssignments.defense)}`,
        `Bailiff · ${prettyLabel(session.metadata.roleAssignments.bailiff)}`,
        `Witnesses · ${witnessSummary}`,
      ],
      footer: `${session.participants?.length ?? 0} participants connected`,
    },
    {
      id: 'votes',
      eyebrow: 'Vote pulse',
      title: 'Live tallies',
      summary: 'Aggregated signal from the active ballot channels.',
      details: [
        `Verdict votes · ${verdictVotes}`,
        `Sentence votes · ${sentenceVotes}`,
        `Press actions · ${pressVotes}`,
        `Present actions · ${presentVotes}`,
      ],
      footer: evidenceCount > 0 ? `${evidenceCount} evidence cards available` : 'No evidence cards published yet.',
    },
    {
      id: 'notes',
      eyebrow: 'Session notes',
      title: 'Operational context',
      summary: 'Small live cues for the broadcast operator without cluttering the frame.',
      details: [
        session.metadata.objectionCount !== undefined
          ? `Objections tracked · ${session.metadata.objectionCount}`
          : 'Objection counter not yet emitted',
        session.metadata.recapTurnIds.length
          ? `${session.metadata.recapTurnIds.length} recap turns pinned`
          : 'No recap turns pinned',
        directive && isRecord(directive.directive)
          ? `Directive · ${readString(directive.directive.effect) ?? 'update'}`
          : 'No render directive active',
      ],
      footer: session.metadata.finalRuling
        ? `Final ruling · ${session.metadata.finalRuling.verdict}`
        : `Last sync ${new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    },
  ];
}

function App() {
  const [activeView, setActiveView] = useState<ViewKey>(getInitialView);
  const [selectedCaseId, setSelectedCaseId] = useState(cases[0].id);

  const selectedCase = useMemo(
    () => cases.find((item) => item.id === selectedCaseId) ?? cases[0],
    [selectedCaseId],
  );

  const setView = useCallback((view: ViewKey) => {
    setActiveView(view);
    syncViewToUrl(view);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setActiveView(getInitialView());
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  if (activeView === 'overlay') {
    return <OverlayView />;
  }

  return (
    <div className="min-h-screen bg-[hsl(var(--bg))] text-[hsl(var(--text))]">
      <div className="mx-auto flex min-h-screen max-w-[1680px] flex-col gap-5 px-4 py-4 lg:px-6">
        <header className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.82)] px-4 py-4 shadow-[0_24px_80px_rgba(0,0,0,0.3)] backdrop-blur-xl lg:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <p className="font-monoish text-[10px] uppercase tracking-[0.38em] text-[hsl(var(--cyan))]">JuryRigged</p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[hsl(var(--text))] md:text-3xl">Dark courtroom broadcast UI</h1>
                </div>
                <LivePill />
                <span className="rounded-full border border-[hsl(var(--border))] bg-black/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-[hsl(var(--muted))]">{liveMeta.mode}</span>
                <a
                  href="/operator"
                  className="rounded-full border border-[hsl(var(--cyan)/0.45)] bg-[hsl(var(--cyan)/0.12)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[hsl(var(--cyan))] transition hover:border-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.18)]"
                >
                  Admin console
                </a>
              </div>
              <p className="max-w-3xl text-sm leading-6 text-[hsl(var(--muted))]">
                A compact, cinematic legal control surface. Most screens use internal mock data; the overlay view attaches to a running live session when one exists.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[520px]">
              <StatChip label="Courtroom" value={liveMeta.courtroom} tone="cyan" />
              <StatChip label="Signal" value={liveMeta.signal} tone="green" />
              <StatChip label="Uptime" value={liveMeta.uptime} tone="gold" />
              <StatChip label="Selected" value={selectedCase.docket} tone="purple" />
            </div>
          </div>

          <nav className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-4" aria-label="View navigation" role="tablist">
            {views.filter(view => view.key !== 'overlay').map((view) => (
              <TabButton
                key={view.key}
                active={activeView === view.key}
                label={view.label}
                note={view.note}
                onClick={() => setView(view.key)}
              />
            ))}
          </nav>
        </header>

        <main className="flex-1">
          {activeView === 'viewer' ? <ViewerView selectedCase={selectedCase} onSelectCase={setSelectedCaseId} /> : null}
          {activeView === 'directory' ? <DirectoryView selectedCaseId={selectedCaseId} onSelectCase={setSelectedCaseId} /> : null}
          {activeView === 'details' ? <DetailsView selectedCase={selectedCase} onSelectCase={setSelectedCaseId} /> : null}
          {activeView === 'prompt' ? <PromptQueueView /> : null}
          {activeView === 'transcripts' ? <TranscriptSearchView /> : null}
          {activeView === 'voting' ? <VotingView selectedCase={selectedCase} /> : null}
          {activeView === 'about' ? <AboutView /> : null}
        </main>
      </div>
    </div>
  );
}

function ViewerView({ selectedCase, onSelectCase }: { selectedCase: (typeof cases)[number]; onSelectCase: (id: string) => void }) {
  const { snapshot: caseQueue, error: caseQueueError } = useCaseQueue();

  return (
    <section className="grid gap-5 xl:grid-cols-[280px_minmax(0,1.5fr)_380px]">
      <div className="space-y-5">
        <CaseAutomationCard snapshot={caseQueue} error={caseQueueError} />
        <PhaseRail phases={timeline} />
        <Surface className="p-5">
          <SectionLabel eyebrow="Selected case" title={selectedCase.title} note={selectedCase.phase} />
          <p className="mt-4 text-sm leading-6 text-[hsl(var(--muted))]">{selectedCase.summary}</p>
          <div className="mt-5 grid gap-2">
            {cases.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectCase(item.id)}
                className={cn(
                  'rounded-2xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--cyan))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]',
                  item.id === selectedCase.id
                    ? 'border-[hsl(var(--cyan)/0.55)] bg-[hsl(var(--surface-2))]'
                    : 'border-[hsl(var(--border))] bg-black/10 hover:border-[hsl(var(--border)/1)]',
                )}
              >
                <p className="font-monoish text-[10px] uppercase tracking-[0.28em] text-[hsl(var(--cyan))]">{item.docket}</p>
                <p className="mt-1 text-sm font-semibold text-[hsl(var(--text))]">{item.title}</p>
              </button>
            ))}
          </div>
        </Surface>
      </div>

      <TranscriptLog items={transcript} />

      <div className="space-y-5">
        <JuryGrid jurors={jury} />
        <EvidenceList items={evidence} compact />
      </div>
    </section>
  );
}

function CaseAutomationCard({ snapshot, error }: { snapshot: CaseQueueSnapshot | null; error: string | null }) {
  const queuedItems = snapshot?.queue.filter(item => item.status === 'queued').slice(0, 5) ?? [];
  const running = snapshot?.queue.find(item => item.status === 'running');

  return (
    <Surface className="p-5">
      <SectionLabel
        eyebrow="Case automation"
        title="How cases start"
        note={snapshot?.automationEnabled === false ? 'manual mode' : 'auto queue'}
      />
      <p className="mt-4 text-sm leading-6 text-[hsl(var(--muted))]">
        JuryRigged keeps court running with generated cases. Chat can submit a case with{' '}
        <span className="font-monoish text-[hsl(var(--cyan))]">!prompt &lt;case idea&gt;</span>. Submitted cases enter this queue and run before the next generated case.
      </p>
      <div className="mt-4 grid gap-2 text-xs uppercase tracking-[0.22em] text-[hsl(var(--muted))]">
        <span className="rounded-2xl border border-[hsl(var(--border))] bg-black/10 px-3 py-2">
          Running · {running ? running.prompt : snapshot?.runningSessionId ? 'live court session' : 'generated fallback ready'}
        </span>
        <span className="rounded-2xl border border-[hsl(var(--border))] bg-black/10 px-3 py-2">
          Queued submissions · {snapshot?.queuedCount ?? 0}
        </span>
      </div>
      <div className="mt-4 space-y-2">
        {queuedItems.length > 0 ? queuedItems.map((item, index) => (
          <div key={item.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2)/0.75)] px-3 py-3">
            <p className="font-monoish text-[10px] uppercase tracking-[0.28em] text-[hsl(var(--gold))]">#{index + 1} · {item.source}{item.submittedBy ? ` · ${item.submittedBy}` : ''}</p>
            <p className="mt-1 line-clamp-3 text-sm leading-5 text-[hsl(var(--text))]">{item.prompt}</p>
          </div>
        )) : (
          <p className="rounded-2xl border border-[hsl(var(--border))] bg-black/10 px-3 py-3 text-sm leading-5 text-[hsl(var(--muted))]">
            No submitted cases queued. The next empty slot defaults to an auto-generated case.
          </p>
        )}
      </div>
      {error ? <p className="mt-3 text-xs uppercase tracking-[0.22em] text-[hsl(var(--gold))]">{error}</p> : null}
    </Surface>
  );
}

function OverlayStandby({ loading, error }: { loading: boolean; error: string | null }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[hsl(var(--bg))] text-[hsl(var(--text))]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,hsl(var(--cyan)/0.14),transparent_32%),radial-gradient(circle_at_85%_10%,hsl(var(--purple)/0.12),transparent_28%),linear-gradient(180deg,hsl(var(--bg))_0%,hsl(211_41%_5%)_100%)]" />
      <div className="relative flex min-h-screen items-center justify-center p-8">
        <div className="max-w-2xl rounded-[2.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.82)] px-8 py-10 text-center shadow-[0_30px_90px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:px-10">
          <LivePill text={loading ? 'CONNECTING' : 'STANDBY'} />
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-[hsl(var(--text))] sm:text-4xl">Waiting for a running courtroom session</h1>
          <p className="mt-4 text-sm leading-6 text-[hsl(var(--muted))]">
            This overlay only shows live session data. When the court goes on air, it will attach automatically and fill this frame with the active feed.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs uppercase tracking-[0.24em] text-[hsl(var(--muted))]">
            <span className="rounded-full border border-[hsl(var(--border))] bg-black/10 px-3 py-1">No demo session</span>
            <span className="rounded-full border border-[hsl(var(--border))] bg-black/10 px-3 py-1">No archived fallback</span>
          </div>
          {error ? <p className="mt-5 text-xs uppercase tracking-[0.22em] text-[hsl(var(--gold))]">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

function OverlayView() {
  const now = useNowTick(1000);
  const reducedMotion = usePrefersReducedMotion();
  const { session, loading, connected, error, lastUpdatedAt, lastEvent } = useLiveOverlaySession();
  const [activePanel, setActivePanel] = useState(0);
  const [stinger, setStinger] = useState<OverlayStinger | null>(null);

  const sidebarCards = useMemo(() => (session ? buildSidebarCards(session, now) : []), [session, now]);
  const transcriptTurns = useMemo(
    () => (session ? session.turns.slice(-OVERLAY_TRANSCRIPT_LIMIT).reverse() : []),
    [session],
  );
  const jurors = useMemo(() => (session ? buildJurors(session.id) : []), [session]);
  const runtime = session ? formatDuration(session.startedAt ?? session.createdAt, now) : '00:00:00';
  const liveStamp = lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'syncing';

  useEffect(() => {
    if (sidebarCards.length === 0) {
      setActivePanel(0);
      return;
    }

    setActivePanel((current: number) => current % sidebarCards.length);
  }, [sidebarCards.length]);

  useEffect(() => {
    if (reducedMotion || sidebarCards.length <= 1 || !session) return undefined;

    const timer = window.setInterval(() => {
      setActivePanel((current: number) => (current + 1) % sidebarCards.length);
    }, OVERLAY_ROTATION_MS);

    return () => window.clearInterval(timer);
  }, [reducedMotion, sidebarCards.length, session]);

  useEffect(() => {
    if (!session) {
      setStinger(null);
      return undefined;
    }

    const nextStinger = stingerFromEvent(lastEvent);
    if (!nextStinger) return undefined;

    setStinger(nextStinger);
    const timer = window.setTimeout(() => setStinger(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [lastEvent, session]);

  if (!session) {
    return <OverlayStandby loading={loading} error={error} />;
  }

  const activeCard = sidebarCards[activePanel] ?? sidebarCards[0];

  return (
    <div className="relative min-h-screen overflow-hidden bg-[hsl(var(--bg))] text-[hsl(var(--text))]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,hsl(var(--cyan)/0.16),transparent_28%),radial-gradient(circle_at_82%_14%,hsl(var(--purple)/0.16),transparent_26%),radial-gradient(circle_at_72%_78%,hsl(var(--gold)/0.08),transparent_30%),linear-gradient(180deg,hsl(var(--bg))_0%,hsl(211_41%_5%)_100%)]" />
      {stinger ? (
        <div
          className={cn(
            'pointer-events-none absolute right-8 top-28 z-20 max-w-md rounded-[2rem] border bg-[hsl(var(--surface)/0.94)] px-6 py-5 backdrop-blur-xl motion-safe:animate-pulse',
            stingerToneClass(stinger.tone),
          )}
        >
          <p className="font-monoish text-xs uppercase tracking-[0.28em]">Court stinger</p>
          <h2 className="mt-2 text-2xl font-semibold text-[hsl(var(--text))]">{stinger.title}</h2>
          <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted))]">{stinger.message}</p>
        </div>
      ) : null}
      <div className="relative flex min-h-screen flex-col gap-4 p-6 xl:p-8">
        <header className="flex items-start justify-between gap-4 rounded-[2.25rem] border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.82)] px-6 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-monoish text-xs uppercase tracking-[0.32em] text-[hsl(var(--cyan))]">JuryRigged · Live overlay</p>
              <LivePill text={connected ? 'LIVE' : 'SYNCING'} />
              <span className="rounded-full border border-[hsl(var(--border))] bg-black/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-[hsl(var(--muted))]">{session.phase}</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-[hsl(var(--text))] sm:text-4xl">{session.topic}</h1>
            <p className="max-w-4xl text-sm leading-6 text-[hsl(var(--muted))]">{session.metadata.casePrompt}</p>
          </div>

          <div className="shrink-0 text-right">
            <p className="font-monoish text-xs uppercase tracking-[0.26em] text-[hsl(var(--muted))]">Runtime</p>
            <p className="mt-2 text-2xl font-semibold text-[hsl(var(--text))]">{runtime}</p>
            <p className="mt-1 text-xs text-[hsl(var(--muted))]">Synced {liveStamp}{error ? ` · ${error}` : ''}</p>
          </div>
        </header>

        <main className="grid flex-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.75fr)]">
          <section className="flex min-h-0 flex-col gap-4">
            <Surface className="min-h-0 flex-1 p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-monoish text-xs uppercase tracking-[0.28em] text-[hsl(var(--cyan))]">Current beat</p>
                  <h2 className="mt-2 text-2xl font-semibold text-[hsl(var(--text))]">Transcript feed</h2>
                </div>
                <div className="rounded-full border border-[hsl(var(--border))] bg-black/10 px-3 py-1 text-xs uppercase tracking-[0.22em] text-[hsl(var(--muted))]">{session.turnCount} turns · showing {transcriptTurns.length}</div>
              </div>

              <div className="mt-5 min-h-0 flex-1 overflow-hidden rounded-[1.75rem] border border-[hsl(var(--border))] bg-black/15">
                <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--border))] px-4 py-3">
                  <p className="font-monoish text-xs uppercase tracking-[0.26em] text-[hsl(var(--muted))]">Newest first</p>
                  <p className="text-xs uppercase tracking-[0.22em] text-[hsl(var(--muted))]">{session.phase} · live transcript</p>
                </div>
                <div className="max-h-[min(58vh,760px)] overflow-y-auto px-4 py-4" role="log" aria-live="polite" aria-relevant="additions text">
                  <div className="space-y-3">
                    {transcriptTurns.length > 0 ? transcriptTurns.map((turn) => (
                      <article key={turn.id} className="rounded-[1.35rem] border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.7)] px-4 py-3 shadow-[0_10px_24px_rgba(0,0,0,0.16)]">
                        <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.18em] text-[hsl(var(--muted))]">
                          <span className="font-monoish text-[hsl(var(--cyan))]">#{turn.turnNumber}</span>
                          <span className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5">{prettyLabel(turn.role)}</span>
                          <span className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5">{turn.phase}</span>
                          <span>{formatOverlayTimestamp(turn.createdAt)}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <p className="text-sm font-semibold tracking-tight text-[hsl(var(--text))]">{prettyLabel(turn.speaker)}</p>
                          <p className="text-xs uppercase tracking-[0.18em] text-[hsl(var(--muted))]">{turn.role}</p>
                        </div>
                        <p className="mt-3 text-sm leading-6 font-normal text-[hsl(var(--text)/0.92)]">{turn.dialogue}</p>
                      </article>
                    )) : (
                      <div className="rounded-[1.35rem] border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.7)] px-4 py-4 text-sm text-[hsl(var(--muted))]">The stream is live, but no spoken turn has arrived yet.</div>
                    )}
                  </div>
                </div>
              </div>
            </Surface>

            <Surface className="p-5">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-[1.5rem] border border-[hsl(var(--border))] bg-black/10 p-4">
                  <p className="font-monoish text-xs uppercase tracking-[0.24em] text-[hsl(var(--cyan))]">Current phase</p>
                  <p className="mt-2 text-lg font-semibold text-[hsl(var(--text))]">{session.phase}</p>
                  <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted))]">Runtime {runtime} · {session.status}</p>
                </div>
                <div className="rounded-[1.5rem] border border-[hsl(var(--border))] bg-black/10 p-4">
                  <p className="font-monoish text-xs uppercase tracking-[0.24em] text-[hsl(var(--gold))]">Evidence</p>
                  <p className="mt-2 text-lg font-semibold text-[hsl(var(--text))]">{session.metadata.evidenceCards.length} cards</p>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-[hsl(var(--muted))]">{latestEvidenceLabel(session)}</p>
                </div>
                <div className="rounded-[1.5rem] border border-[hsl(var(--border))] bg-black/10 p-4">
                  <p className="font-monoish text-xs uppercase tracking-[0.24em] text-[hsl(var(--purple))]">Objections</p>
                  <p className="mt-2 text-lg font-semibold text-[hsl(var(--text))]">{String(session.metadata.objectionCount ?? 0)}</p>
                  <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted))]">{prettyLabel(latestDirectiveLabel(session))}</p>
                </div>
              </div>
            </Surface>
          </section>

          <aside className="flex min-h-0 flex-col gap-4">
            <Surface className="flex min-h-[520px] flex-1 flex-col p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-monoish text-xs uppercase tracking-[0.24em] text-[hsl(var(--gold))]">Sidebar rotation</p>
                  <h2 className="mt-2 text-xl font-semibold text-[hsl(var(--text))]">Live information blocks</h2>
                </div>
                <div className="flex gap-1" aria-hidden="true">
                  {sidebarCards.map((card, index) => (
                    <span
                      key={card.id}
                      className={cn('size-2 rounded-full transition-colors', index === activePanel ? 'bg-[hsl(var(--cyan))]' : 'bg-[hsl(var(--border))]')}
                    />
                  ))}
                </div>
              </div>

              <div className="mt-5 min-h-[420px] rounded-[1.75rem] border border-[hsl(var(--border))] bg-black/15 p-5 motion-safe:transition-opacity motion-safe:duration-500 motion-reduce:transition-none">
                <p className="font-monoish text-xs uppercase tracking-[0.24em] text-[hsl(var(--cyan))]">{activeCard?.eyebrow}</p>
                <h3 className="mt-2 text-2xl font-semibold text-[hsl(var(--text))]">{activeCard?.title}</h3>
                <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted))]">{activeCard?.summary}</p>
                <div className="mt-5 space-y-2">
                  {activeCard?.details.map((detail) => (
                    <div key={detail} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.7)] px-3 py-2 text-sm text-[hsl(var(--text))]">
                      {detail}
                    </div>
                  ))}
                </div>
                {activeCard?.footer ? (
                  <p className="mt-5 text-xs uppercase tracking-[0.22em] text-[hsl(var(--gold))]">{activeCard.footer}</p>
                ) : null}
              </div>

              <p className="mt-3 text-xs leading-5 text-[hsl(var(--muted))]">
                Auto-rotates every {OVERLAY_ROTATION_MS / 1000} seconds; reduced-motion users stay on the first block.
              </p>
            </Surface>

            <Surface className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-monoish text-xs uppercase tracking-[0.24em] text-[hsl(var(--gold))]">Jury panel</p>
                  <h2 className="mt-2 text-xl font-semibold text-[hsl(var(--text))]">Six deterministic jurors</h2>
                </div>
                <p className="text-xs uppercase tracking-[0.2em] text-[hsl(var(--muted))]">Seeded by session id</p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {jurors.map((juror) => (
                  <article key={juror.id} className="rounded-[1.35rem] border border-[hsl(var(--border))] bg-black/10 p-4">
                    <p className="font-monoish text-xs uppercase tracking-[0.18em] text-[hsl(var(--gold))]">{juror.label}</p>
                    <p className="mt-2 text-sm font-semibold text-[hsl(var(--text))]">{juror.name}</p>
                    <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[hsl(var(--gold))]">{juror.role}</p>
                    <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted))]">{juror.trait}</p>
                  </article>
                ))}
              </div>
            </Surface>
          </aside>
        </main>
      </div>
    </div>
  );
}

function DirectoryView({ selectedCaseId, onSelectCase }: { selectedCaseId: string; onSelectCase: (id: string) => void }) {
  const groupedCases = [
    { title: 'Live Now', items: cases.filter((item) => item.status.toLowerCase().includes('live')) },
    { title: 'Upcoming Sessions', items: cases.filter((item) => item.status.toLowerCase().includes('pre')) },
    { title: 'Archived Cases', items: cases.filter((item) => item.status.toLowerCase().includes('archive')) },
  ];

  return (
    <section className="space-y-5">
      <SectionLabel eyebrow="Case directory" title="Active docket map" note="Compact cards for scanning status, phase, and risk without a router." />
      <div className="grid gap-5 xl:grid-cols-3">
        {groupedCases.map((group) => (
          <Surface key={group.title} className="p-4">
            <p className="font-monoish text-[10px] uppercase tracking-[0.32em] text-[hsl(var(--cyan))]">{group.title}</p>
            <div className="mt-4 space-y-4">
              {group.items.map((item) => (
                <CaseCard key={item.id} item={item} active={item.id === selectedCaseId} onClick={() => onSelectCase(item.id)} />
              ))}
            </div>
          </Surface>
        ))}
      </div>
    </section>
  );
}

function PromptQueueView() {
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

    if (window.turnstile) {
      renderWidget();
    } else {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = renderWidget;
      document.head.append(script);
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const submitPrompt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSubmission(null);

    try {
      let nonce = '';
      if (!usesTurnstile) {
        const nonceResponse = await fetch('/api/public/case-queue/nonce');
        if (!nonceResponse.ok) throw new Error('Public prompt verification is not configured.');
        const noncePayload = await nonceResponse.json() as { nonce?: unknown };
        if (typeof noncePayload.nonce !== 'string') throw new Error('Verification nonce unavailable');
        nonce = noncePayload.nonce;
      } else if (!turnstileToken) {
        throw new Error('Complete the verification challenge before submitting.');
      }

      const response = await fetch('/api/public/case-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          source: 'public_page',
          nonce,
          turnstileToken,
        }),
      });
      const payload = await response.json() as ApiRecord;
      if (!response.ok) {
        const message = readString(payload.message) ?? readString(payload.error) ?? `Prompt rejected (${response.status})`;
        throw new Error(message);
      }
      const nextSubmission = normalizePublicQueueSubmission(payload);
      if (!nextSubmission) throw new Error('Queue returned an unexpected response');
      setSubmission(nextSubmission);
      setPrompt('');
      setTurnstileToken('');
      window.turnstile?.reset(turnstileWidgetIdRef.current);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Prompt submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Surface className="p-5">
        <SectionLabel eyebrow="Public prompt queue" title="Submit the next absurd case" note="Prompts enter the queue only; direct session creation stays admin-only." />
        <form className="mt-5 space-y-4" onSubmit={submitPrompt}>
          <label className="block text-sm font-semibold text-[hsl(var(--text))]" htmlFor="public-prompt">Case prompt</label>
          <textarea
            id="public-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            minLength={10}
            maxLength={500}
            rows={7}
            placeholder="The defendant replaced every courtroom exhibit label with riddles..."
            className="w-full resize-none rounded-[1.5rem] border border-[hsl(var(--border))] bg-black/20 px-4 py-3 text-sm leading-6 text-[hsl(var(--text))] outline-none transition placeholder:text-[hsl(var(--muted))] focus:border-[hsl(var(--cyan))] focus:ring-2 focus:ring-[hsl(var(--cyan)/0.25)]"
          />
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-[0.2em] text-[hsl(var(--muted))]">
            <span>{prompt.trim().length}/500 characters</span>
            <span>{usesTurnstile ? 'Protected by Turnstile + rate limits' : 'Protected by dev nonce + rate limits'}</span>
          </div>
          {usesTurnstile ? <div ref={turnstileContainerRef} className="min-h-[65px]" /> : null}
          <button
            type="submit"
            disabled={submitting || prompt.trim().length < 10 || (usesTurnstile && !turnstileToken)}
            className="w-full rounded-2xl bg-[hsl(var(--cyan))] px-4 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {submitting ? 'Submitting…' : 'Submit to queue'}
          </button>
        </form>

        {submission ? (
          <div className="mt-5 rounded-[1.5rem] border border-[hsl(var(--cyan)/0.45)] bg-[hsl(var(--cyan)/0.08)] p-4">
            <p className="font-monoish text-xs uppercase tracking-[0.24em] text-[hsl(var(--cyan))]">Queued at position #{submission.position}</p>
            <p className="mt-2 text-sm leading-6 text-[hsl(var(--text))]">{submission.item.prompt}</p>
            <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted))]">
              Approximate start: {submission.estimatedStartMinutes ?? 0} minutes. Timing depends on the current case and operator pauses.
            </p>
          </div>
        ) : null}
        {error ? <p className="mt-4 rounded-2xl border border-[hsl(var(--gold)/0.5)] bg-[hsl(var(--gold)/0.08)] px-3 py-2 text-sm text-[hsl(var(--gold))]">{error}</p> : null}
      </Surface>

      <div className="space-y-5">
        <Surface className="p-5">
          <SectionLabel eyebrow="Queue status" title={`${snapshot?.queuedCount ?? 0} prompts waiting`} note={queueError ?? 'ETA is approximate.'} />
          <div className="mt-5 grid gap-3">
            <a href={streamUrl} className="rounded-2xl border border-[hsl(var(--cyan)/0.45)] bg-[hsl(var(--cyan)/0.08)] px-4 py-3 text-sm font-semibold text-[hsl(var(--cyan))] transition hover:border-[hsl(var(--cyan))]">Watch live stream overlay</a>
            <a href={transcriptsUrl} className="rounded-2xl border border-[hsl(var(--gold)/0.45)] bg-[hsl(var(--gold)/0.08)] px-4 py-3 text-sm font-semibold text-[hsl(var(--gold))] transition hover:border-[hsl(var(--gold))]">Search public transcripts</a>
          </div>
        </Surface>
        <Surface className="p-5">
          <SectionLabel eyebrow="Next in line" title="Queue preview" note="Newest public and chat submissions wait behind active court." />
          <div className="mt-5 space-y-3">
            {queuedItems.length ? queuedItems.map((item, index) => (
              <article key={item.id} className="rounded-2xl border border-[hsl(var(--border))] bg-black/10 p-4">
                <p className="font-monoish text-[10px] uppercase tracking-[0.28em] text-[hsl(var(--cyan))]">#{index + 1} · {item.source.replace('_', ' ')}</p>
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-[hsl(var(--text))]">{item.prompt}</p>
                <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[hsl(var(--gold))]">Approx. {item.estimatedStartMinutes ?? index * 12} min</p>
              </article>
            )) : (
              <p className="rounded-2xl border border-[hsl(var(--border))] bg-black/10 px-4 py-3 text-sm leading-6 text-[hsl(var(--muted))]">No public prompts queued right now. Auto-generated cases fill empty slots.</p>
            )}
          </div>
        </Surface>
      </div>
    </section>
  );
}

function TranscriptSearchView() {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [results, setResults] = useState<TranscriptSearchResult[]>([]);
  const [selectedTranscriptId, setSelectedTranscriptId] = useState(getCaseParam);
  const [selectedSession, setSelectedSession] = useState<LiveSession | null>(null);
  const [searchLoading, setSearchLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const search = async () => {
      setSearchLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/public/transcripts?q=${encodeURIComponent(submittedQuery)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Transcript search failed (${response.status})`);
        const payload = normalizeTranscriptSearchResponse(await response.json());
        if (!payload) throw new Error('Transcript search returned an unexpected response');
        setResults(payload.results);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Transcript search failed');
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    };
    search();
    return () => controller.abort();
  }, [submittedQuery]);

  useEffect(() => {
    if (!selectedTranscriptId) {
      setSelectedSession(null);
      return undefined;
    }

    const controller = new AbortController();
    const loadDetail = async () => {
      setDetailLoading(true);
      setSelectedSession(null);
      setError(null);
      try {
        const response = await fetch(`/api/public/transcripts/${encodeURIComponent(selectedTranscriptId)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Transcript detail failed (${response.status})`);
        const payload = await response.json() as ApiRecord;
        const session = normalizeSession(payload.session);
        if (!session) throw new Error('Transcript detail returned an unexpected response');
        setSelectedSession(session);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Transcript detail failed');
      } finally {
        if (!controller.signal.aborted) setDetailLoading(false);
      }
    };
    loadDetail();
    return () => controller.abort();
  }, [selectedTranscriptId]);

  const selectTranscript = (id: string) => {
    setSelectedTranscriptId(id);
    const url = new URL(window.location.href);
    url.searchParams.set(VIEW_PARAM, 'transcripts');
    url.searchParams.set('case', id);
    window.history.pushState({}, '', url);
  };

  const clearTranscript = () => {
    setSelectedTranscriptId('');
    const url = new URL(window.location.href);
    url.searchParams.set(VIEW_PARAM, 'transcripts');
    url.searchParams.delete('case');
    window.history.pushState({}, '', url);
  };

  const detailTurns = selectedSession ? [...selectedSession.turns].reverse() : [];

  return (
    <section className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
      <Surface className="p-5">
        <SectionLabel eyebrow="Public records" title="Transcript search" note="Search by case id, name, or prompt text." />
        <form
          className="mt-5 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmittedQuery(query.trim());
          }}
        >
          <label className="block text-sm font-semibold text-[hsl(var(--text))]" htmlFor="transcript-query">Case search</label>
          <input
            id="transcript-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="case id, title, or prompt"
            className="w-full rounded-2xl border border-[hsl(var(--border))] bg-black/20 px-4 py-3 text-sm text-[hsl(var(--text))] outline-none transition placeholder:text-[hsl(var(--muted))] focus:border-[hsl(var(--cyan))] focus:ring-2 focus:ring-[hsl(var(--cyan)/0.25)]"
          />
          <button type="submit" className="w-full rounded-2xl bg-[hsl(var(--cyan))] px-4 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-black transition hover:brightness-110">
            Search transcripts
          </button>
        </form>
        {error ? <p className="mt-4 rounded-2xl border border-[hsl(var(--gold)/0.5)] bg-[hsl(var(--gold)/0.08)] px-3 py-2 text-sm text-[hsl(var(--gold))]">{error}</p> : null}
        <div className="mt-5 space-y-3">
          <p className="font-monoish text-xs uppercase tracking-[0.24em] text-[hsl(var(--muted))]">
            {searchLoading ? 'Loading records' : `${results.length} records found`}
          </p>
          {results.map((result) => (
            <button
              key={result.id}
              type="button"
              onClick={() => selectTranscript(result.id)}
              className={cn(
                'w-full rounded-2xl border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--cyan))]',
                selectedTranscriptId === result.id ? 'border-[hsl(var(--cyan)/0.6)] bg-[hsl(var(--surface-2))]' : 'border-[hsl(var(--border))] bg-black/10 hover:border-[hsl(var(--cyan)/0.45)]',
              )}
            >
              <p className="font-monoish text-[10px] uppercase tracking-[0.28em] text-[hsl(var(--cyan))]">{result.status} · {result.phase}</p>
              <p className="mt-2 text-sm font-semibold text-[hsl(var(--text))]">{result.topic}</p>
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-[hsl(var(--muted))]">{result.casePrompt ?? result.id}</p>
              <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[hsl(var(--gold))]">{result.turnCount} turns</p>
            </button>
          ))}
        </div>
      </Surface>

      <Surface className="p-5">
        {detailLoading ? (
          <div className="flex min-h-[460px] items-center justify-center rounded-[2rem] border border-dashed border-[hsl(var(--border))] bg-black/10 p-8 text-center">
            <div>
              <LivePill text="LOADING" />
              <h2 className="mt-4 text-2xl font-semibold text-[hsl(var(--text))]">Loading transcript</h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-[hsl(var(--muted))]">Fetching the selected public case record.</p>
            </div>
          </div>
        ) : selectedSession ? (
          <div>
            <div className="flex flex-col gap-3 border-b border-[hsl(var(--border))] pb-5 lg:flex-row lg:items-start lg:justify-between">
              <SectionLabel eyebrow="Transcript detail" title={selectedSession.topic} note={`${selectedSession.status} · ${selectedSession.phase} · ${selectedSession.turnCount} turns`} />
              <button type="button" onClick={clearTranscript} className="rounded-full border border-[hsl(var(--border))] px-3 py-1 text-xs uppercase tracking-[0.2em] text-[hsl(var(--muted))] transition hover:border-[hsl(var(--cyan))] hover:text-[hsl(var(--text))]">
                Clear case
              </button>
            </div>
            <p className="mt-5 text-sm leading-6 text-[hsl(var(--muted))]">{selectedSession.metadata.casePrompt}</p>
            <div className="mt-5 max-h-[720px] overflow-y-auto pr-2" role="log" aria-live="polite">
              <div className="space-y-3">
                {detailTurns.map((turn) => (
                  <article key={turn.id} className="rounded-2xl border border-[hsl(var(--border))] bg-black/10 p-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.18em] text-[hsl(var(--muted))]">
                      <span className="font-monoish text-[hsl(var(--cyan))]">#{turn.turnNumber}</span>
                      <span>{prettyLabel(turn.role)}</span>
                      <span>{turn.phase}</span>
                      <span>{formatOverlayTimestamp(turn.createdAt)}</span>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-[hsl(var(--text))]">{prettyLabel(turn.speaker)}</p>
                    <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted))]">{turn.dialogue}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-[460px] items-center justify-center rounded-[2rem] border border-dashed border-[hsl(var(--border))] bg-black/10 p-8 text-center">
            <div>
              <LivePill text="SELECT" />
              <h2 className="mt-4 text-2xl font-semibold text-[hsl(var(--text))]">Choose a transcript</h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-[hsl(var(--muted))]">Search public case records, then open a case to review the full session transcript.</p>
            </div>
          </div>
        )}
      </Surface>
    </section>
  );
}

function DetailsView({ selectedCase, onSelectCase }: { selectedCase: (typeof cases)[number]; onSelectCase: (id: string) => void }) {
  return (
    <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
      <Surface className="p-5">
        <SectionLabel eyebrow="Case details" title={selectedCase.title} note={`${selectedCase.docket} · ${selectedCase.status}`} />
        <p className="mt-4 text-sm leading-6 text-[hsl(var(--muted))]">{selectedCase.summary}</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <StatChip label="Judge" value={selectedCase.judge} tone="gold" />
          <StatChip label="Room" value={selectedCase.room} tone="cyan" />
          <StatChip label="Jurors" value={selectedCase.jurorLean} tone="green" />
          <StatChip label="Exhibits" value={`${selectedCase.evidenceCount} items`} tone="purple" />
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-5" aria-label="Case file tabs">
          {detailTabs.map((tab) => (
            <div key={tab.label} className="rounded-2xl border border-[hsl(var(--border))] bg-black/10 p-3">
              <p className="text-sm font-semibold text-[hsl(var(--text))]">{tab.label}</p>
              <p className="mt-2 text-xs leading-5 text-[hsl(var(--muted))]">{tab.detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 grid gap-2">
          {cases.map((item) => (
            <button key={item.id} type="button" onClick={() => onSelectCase(item.id)} className="rounded-2xl border border-[hsl(var(--border))] bg-black/10 px-3 py-2 text-left text-sm text-[hsl(var(--text))] transition hover:bg-[hsl(var(--surface-2))]">
              Switch to {item.docket} · {item.title}
            </button>
          ))}
        </div>
      </Surface>
      <EvidenceList items={evidence} />
    </section>
  );
}

function VotingView({ selectedCase }: { selectedCase: (typeof cases)[number] }) {
  return (
    <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
      <Surface className="p-5">
        <SectionLabel eyebrow="Jury voting" title="Ballot state" note="Disabled choices explain why they are unavailable; no mystery toggles." />
        <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-black/10 p-4">
          <p className="text-sm text-[hsl(var(--muted))]">Current case</p>
          <p className="mt-1 text-lg font-semibold text-[hsl(var(--text))]">{selectedCase.title}</p>
          <p className="mt-1 font-monoish text-[10px] uppercase tracking-[0.28em] text-[hsl(var(--cyan))]">{selectedCase.docket} · {selectedCase.phase}</p>
        </div>
        <div className="mt-4 grid gap-3">
          {voteOptions.map((option) => (
            <VoteCard key={option.label} option={option} />
          ))}
        </div>
      </Surface>
      <Surface className="p-5">
        <SectionLabel eyebrow="Eligibility" title="Why some votes are blocked" note="Clear reasons reduce confusion, especially when the UI is used from the broadcast booth." />
        <div className="mt-5 space-y-3">
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-4">
            <p className="text-sm font-semibold text-[hsl(var(--text))]">Open phase</p>
            <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted))]">A verdict can be recorded now. Sentence controls stay hidden, and special verdict branches stay disabled until a judge opens the matching procedural window.</p>
          </div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-4">
            <p className="text-sm font-semibold text-[hsl(var(--text))]">Accessibility note</p>
            <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted))]">Button labels say exactly what happens. The disabled message is text, not color-only decoration.</p>
          </div>
        </div>
      </Surface>
    </section>
  );
}

function AboutView() {
  return (
    <section className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
      <Surface className="p-5">
        <SectionLabel eyebrow="About / How it works" title="What this interface is doing" note="The design is broadcast-grade, with internal tab switching plus a live overlay that can attach to a running session." />
        <div className="mt-5 space-y-3">
          {howItWorks.map((item) => (
            <div key={item.title} className="rounded-2xl border border-[hsl(var(--border))] bg-black/10 p-4">
              <p className="text-sm font-semibold text-[hsl(var(--text))]">{item.title}</p>
              <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted))]">{item.text}</p>
            </div>
          ))}
        </div>
      </Surface>
      <Surface className="p-5">
        <SectionLabel eyebrow="Accessibility" title="Built-in safeguards" note="Labels, focus rings, reduced-motion support, and aria-live transcript logging." />
        <div className="mt-5 space-y-3 text-sm leading-6 text-[hsl(var(--muted))]">
          <p>• Transcript log uses <span className="text-[hsl(var(--text))]">role="log"</span> and <span className="text-[hsl(var(--text))]">aria-live</span>.</p>
          <p>• Juror states include visible text labels; color never carries meaning alone.</p>
          <p>• Focus states are high contrast and keyboard friendly on all buttons.</p>
          <p>• Motion respects reduced-motion preferences via CSS and Tailwind-safe classes.</p>
        </div>
      </Surface>
    </section>
  );
}

export default App;
