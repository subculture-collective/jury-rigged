import { useCallback, useEffect, useMemo, useState } from 'react';
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
    evidenceCards: Array<{ id: string }>;
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

type SidebarCard = {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  details: string[];
  footer?: string;
};

const VIEW_PARAM = 'view';
const OVERLAY_DISCOVERY_MS = 5_000;
const OVERLAY_ROTATION_MS = 7_000;

function isViewKey(value: string | null): value is ViewKey {
  return (
    value === 'viewer' ||
    value === 'overlay' ||
    value === 'directory' ||
    value === 'details' ||
    value === 'voting' ||
    value === 'about'
  );
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
        ? metadata.evidenceCards.flatMap((entry): Array<{ id: string }> => {
            if (!isRecord(entry)) return [];
            const evidenceId = readString(entry.id);
            return evidenceId ? [{ id: evidenceId }] : [];
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

function sumRecord(values: Record<string, number>) {
  return Object.values(values).reduce((total, value) => total + value, 0);
}

function prettyLabel(value?: string) {
  if (!value) return 'Unassigned';
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
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

  return { session, loading, connected, error, lastUpdatedAt };
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
          {activeView === 'voting' ? <VotingView selectedCase={selectedCase} /> : null}
          {activeView === 'about' ? <AboutView /> : null}
        </main>
      </div>
    </div>
  );
}

function ViewerView({ selectedCase, onSelectCase }: { selectedCase: (typeof cases)[number]; onSelectCase: (id: string) => void }) {
  return (
    <section className="grid gap-5 xl:grid-cols-[280px_minmax(0,1.5fr)_380px]">
      <div className="space-y-5">
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
  const { session, loading, connected, error, lastUpdatedAt } = useLiveOverlaySession();
  const [activePanel, setActivePanel] = useState(0);

  const sidebarCards = useMemo(() => (session ? buildSidebarCards(session, now) : []), [session, now]);
  const latestTurn = session?.turns.at(-1) ?? null;
  const recentTurns = session?.turns.slice(-3).reverse() ?? [];
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

  if (!session) {
    return <OverlayStandby loading={loading} error={error} />;
  }

  const phaseVoteCount = sumRecord(session.metadata.verdictVotes) + sumRecord(session.metadata.sentenceVotes);
  const activeCard = sidebarCards[activePanel] ?? sidebarCards[0];

  return (
    <div className="relative min-h-screen overflow-hidden bg-[hsl(var(--bg))] text-[hsl(var(--text))]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,hsl(var(--cyan)/0.16),transparent_28%),radial-gradient(circle_at_82%_14%,hsl(var(--purple)/0.16),transparent_26%),radial-gradient(circle_at_72%_78%,hsl(var(--gold)/0.08),transparent_30%),linear-gradient(180deg,hsl(var(--bg))_0%,hsl(211_41%_5%)_100%)]" />
      <div className="relative flex min-h-screen flex-col gap-4 p-6 xl:p-8">
        <header className="flex items-start justify-between gap-4 rounded-[2.25rem] border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.82)] px-6 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-monoish text-[10px] uppercase tracking-[0.38em] text-[hsl(var(--cyan))]">JuryRigged · Live overlay</p>
              <LivePill text={connected ? 'LIVE' : 'SYNCING'} />
              <span className="rounded-full border border-[hsl(var(--border))] bg-black/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-[hsl(var(--muted))]">{session.phase}</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-[hsl(var(--text))] sm:text-4xl">{session.topic}</h1>
            <p className="max-w-4xl text-sm leading-6 text-[hsl(var(--muted))]">{session.metadata.casePrompt}</p>
          </div>

          <div className="shrink-0 text-right">
            <p className="font-monoish text-[10px] uppercase tracking-[0.32em] text-[hsl(var(--muted))]">Runtime</p>
            <p className="mt-2 text-2xl font-semibold text-[hsl(var(--text))]">{runtime}</p>
            <p className="mt-1 text-xs text-[hsl(var(--muted))]">Synced {liveStamp}{error ? ` · ${error}` : ''}</p>
          </div>
        </header>

        <main className="grid flex-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.75fr)]">
          <section className="flex min-h-0 flex-col gap-4">
            <Surface className="min-h-0 flex-1 p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-monoish text-[10px] uppercase tracking-[0.32em] text-[hsl(var(--cyan))]">Current beat</p>
                  <h2 className="mt-2 text-2xl font-semibold text-[hsl(var(--text))]">Latest turn on record</h2>
                </div>
                <div className="rounded-full border border-[hsl(var(--border))] bg-black/10 px-3 py-1 text-[10px] uppercase tracking-[0.28em] text-[hsl(var(--muted))]">{session.turnCount} turns</div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
                <article className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-black/15 p-5">
                  <p className="text-[10px] uppercase tracking-[0.32em] text-[hsl(var(--muted))]">Now speaking</p>
                  {latestTurn ? (
                    <>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-monoish text-[hsl(var(--cyan))]">#{latestTurn.turnNumber}</span>
                        <span className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-[hsl(var(--muted))]">{prettyLabel(latestTurn.role)}</span>
                        <span className="font-semibold text-[hsl(var(--text))]">{prettyLabel(latestTurn.speaker)}</span>
                      </div>
                      <p className="mt-4 text-2xl leading-[1.25] font-semibold text-[hsl(var(--text))] sm:text-[2rem]">{latestTurn.dialogue}</p>
                      <p className="mt-4 font-monoish text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--gold))]">{session.phase} · {latestTurn.createdAt}</p>
                    </>
                  ) : (
                    <p className="mt-4 text-sm leading-6 text-[hsl(var(--muted))]">The stream is live, but no spoken turn has arrived yet.</p>
                  )}
                </article>

                <aside className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-black/15 p-5">
                  <p className="text-[10px] uppercase tracking-[0.32em] text-[hsl(var(--muted))]">Session pulse</p>
                  <div className="mt-4 space-y-3 text-sm text-[hsl(var(--text))]">
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.7)] p-3">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-[hsl(var(--muted))]">Case type</p>
                      <p className="mt-1 font-semibold">{session.metadata.caseType}</p>
                    </div>
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.7)] p-3">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-[hsl(var(--muted))]">Participants</p>
                      <p className="mt-1 font-semibold">{session.participants.length} connected</p>
                    </div>
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.7)] p-3">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-[hsl(var(--muted))]">Vote actions</p>
                      <p className="mt-1 font-semibold">{phaseVoteCount} recorded</p>
                    </div>
                  </div>
                </aside>
              </div>
            </Surface>

            <div className="grid gap-4 md:grid-cols-3">
              <StatChip label="Current phase" value={session.phase} tone="cyan" />
              <StatChip label="Evidence" value={`${session.metadata.evidenceCards.length} cards`} tone="gold" />
              <StatChip label="Objections" value={String(session.metadata.objectionCount ?? 0)} tone="purple" />
            </div>

            <Surface className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-monoish text-[10px] uppercase tracking-[0.32em] text-[hsl(var(--cyan))]">Recent turns</p>
                  <h2 className="mt-2 text-lg font-semibold text-[hsl(var(--text))]">Last three entries</h2>
                </div>
                <p className="text-xs uppercase tracking-[0.24em] text-[hsl(var(--muted))]">Transcript only, no filler</p>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {recentTurns.length > 0 ? (
                  recentTurns.map((turn) => (
                    <article key={turn.id} className="rounded-[1.5rem] border border-[hsl(var(--border))] bg-black/10 p-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-monoish text-[hsl(var(--cyan))]">#{turn.turnNumber}</span>
                        <span className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-[hsl(var(--muted))]">{prettyLabel(turn.role)}</span>
                      </div>
                      <p className="mt-3 text-sm font-semibold text-[hsl(var(--text))]">{prettyLabel(turn.speaker)}</p>
                      <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted))]">{turn.dialogue}</p>
                    </article>
                  ))
                ) : (
                  <div className="rounded-[1.5rem] border border-[hsl(var(--border))] bg-black/10 p-4 text-sm text-[hsl(var(--muted))]">No turns captured yet.</div>
                )}
              </div>
            </Surface>
          </section>

          <aside className="flex min-h-0 flex-col gap-4">
            <Surface className="flex min-h-[520px] flex-1 flex-col p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-monoish text-[10px] uppercase tracking-[0.32em] text-[hsl(var(--gold))]">Sidebar rotation</p>
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
                <p className="font-monoish text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--cyan))]">{activeCard?.eyebrow}</p>
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
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <StatChip label="Judge" value={prettyLabel(session.metadata.roleAssignments.judge)} tone="gold" />
                <StatChip label="Bailiff" value={prettyLabel(session.metadata.roleAssignments.bailiff)} tone="green" />
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
