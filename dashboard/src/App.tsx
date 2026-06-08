import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { SessionMonitor } from './components/SessionMonitor';
import { useSSE } from './hooks/useSSE';
import { applyEventToSnapshot, mapSessionToSnapshot } from './session-snapshot';
import type { CourtEvent, SessionSnapshot } from './types';
import { asRecord, asString } from './utils/payload-guards';

const SESSION_DISCOVERY_INTERVAL_MS = 5_000;

const MOCK_RECAP_MOMENTS = [
    {
        stamp: '00:14',
        title: 'Feeds locked',
        detail: 'Broadcast goes live with clean audio and caption sync.',
    },
    {
        stamp: '01:06',
        title: 'Defense challenge',
        detail: 'A narrow objection keeps the timeline under scrutiny.',
    },
    {
        stamp: '01:28',
        title: 'Jury split',
        detail: 'The panel moves toward a stable center of gravity.',
    },
    {
        stamp: '01:53',
        title: 'Exhibit queue',
        detail: 'Evidence cards are reindexed for replay.',
    },
] as const;

function resolvePreferredSessionId(response: unknown): string | null {
    const payload = asRecord(response);
    const sessions =
        Array.isArray(payload.sessions) ? payload.sessions : ([] as unknown[]);

    if (sessions.length === 0) {
        return null;
    }

    const running = sessions.find(
        candidate => asRecord(candidate).status === 'running',
    );
    const selected = asRecord(running ?? sessions[0]);
    return asString(selected.id) ?? asString(selected.sessionId);
}

type DashboardTabId =
    | 'monitor'
    | 'broadcast'
    | 'moderation'
    | 'llm'
    | 'ops'
    | 'recap'
    | 'controls'
    | 'caseQueue'
    | 'analytics';

const loadModerationQueue = () => import('./components/ModerationQueue');
const loadManualControls = () => import('./components/ManualControls');
const loadAdminTriggers = () => import('./components/AdminTriggers');
const loadCaseQueue = () => import('./components/CaseQueue');
const loadAnalytics = () => import('./components/Analytics');
const loadLLMAuditLog = () => import('./components/LLMAuditLog');
const loadOpsMetrics = () => import('./components/OpsMetrics');

const ModerationQueue = lazy(async () => {
    const module = await loadModerationQueue();
    return { default: module.ModerationQueue };
});

const ManualControls = lazy(async () => {
    const module = await loadManualControls();
    return { default: module.ManualControls };
});

const AdminTriggers = lazy(async () => {
    const module = await loadAdminTriggers();
    return { default: module.AdminTriggers };
});

const CaseQueue = lazy(async () => {
    const module = await loadCaseQueue();
    return { default: module.CaseQueue };
});

const Analytics = lazy(async () => {
    const module = await loadAnalytics();
    return { default: module.Analytics };
});

const LLMAuditLog = lazy(async () => {
    const module = await loadLLMAuditLog();
    return { default: module.LLMAuditLog };
});

const OpsMetrics = lazy(async () => {
    const module = await loadOpsMetrics();
    return { default: module.OpsMetrics };
});

type DashboardTab = {
    id: DashboardTabId;
    label: string;
    icon: string;
    preload?: () => Promise<unknown>;
};

const TABS: DashboardTab[] = [
    { id: 'monitor', label: 'Session Monitor', icon: '📊' },
    { id: 'broadcast', label: 'Broadcast Access', icon: '📡' },
    {
        id: 'moderation',
        label: 'Moderation Queue',
        icon: '🛡️',
        preload: loadModerationQueue,
    },
    {
        id: 'llm',
        label: 'LLM Calls',
        icon: '🧠',
        preload: loadLLMAuditLog,
    },
    {
        id: 'ops',
        label: 'Ops Metrics',
        icon: '📟',
        preload: loadOpsMetrics,
    },
    { id: 'recap', label: 'Replay Recap', icon: '🎞️' },
    {
        id: 'controls',
        label: 'Manual Controls',
        icon: '🎛️',
        preload: () => Promise.all([loadManualControls(), loadAdminTriggers()]),
    },
    {
        id: 'caseQueue',
        label: 'Case Queue',
        icon: '⚖️',
        preload: loadCaseQueue,
    },
    {
        id: 'analytics',
        label: 'Analytics',
        icon: '📈',
        preload: loadAnalytics,
    },
];

function TabFallback({ message }: { message: string }) {
    return (
        <div className='flex items-center justify-center py-12'>
            <div className='text-gray-400'>{message}</div>
        </div>
    );
}

function App() {
    const [activeTab, setActiveTab] = useState<DashboardTabId>('monitor');
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [sessionSnapshot, setSessionSnapshot] =
        useState<SessionSnapshot | null>(null);
    const [events, setEvents] = useState<CourtEvent[]>([]);
    const [sessionLookupLoading, setSessionLookupLoading] = useState(true);
    const [sessionSnapshotLoading, setSessionSnapshotLoading] = useState(false);
    const [accessNotice, setAccessNotice] = useState<string | null>(null);

    const handleSSEEvent = useCallback((event: CourtEvent) => {
        setEvents(prev => [...prev, event]);
        setSessionSnapshot(current => applyEventToSnapshot(current, event));
    }, []);

    const handleSSESnapshot = useCallback(
        (payload: Record<string, unknown>) => {
            const nextSnapshot = mapSessionToSnapshot({
                session: payload.session,
                turns: payload.turns,
                recapTurnIds: payload.recapTurnIds,
            });

            if (!nextSnapshot) {
                return;
            }

            setSessionSnapshot(nextSnapshot);
            setSessionSnapshotLoading(false);
        },
        [],
    );

    const { connected, error } = useSSE(
        sessionId,
        handleSSEEvent,
        handleSSESnapshot,
    );

    useEffect(() => {
        let cancelled = false;

        const syncSessionId = async () => {
            try {
                const res = await fetch('/api/court/sessions');
                if (!res.ok) {
                    throw new Error(`Unexpected status ${res.status}`);
                }

                const sessionsResponse = await res.json();
                if (cancelled) {
                    return;
                }

                const nextSessionId =
                    resolvePreferredSessionId(sessionsResponse);
                setSessionId(current =>
                    current === nextSessionId ? current : nextSessionId,
                );
            } catch (err) {
                console.error('Failed to fetch session:', err);
            }
        };

        void syncSessionId().finally(() => {
            if (!cancelled) {
                setSessionLookupLoading(false);
            }
        });

        const intervalId = setInterval(() => {
            void syncSessionId();
        }, SESSION_DISCOVERY_INTERVAL_MS);

        return () => {
            clearInterval(intervalId);
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!sessionId) {
            setEvents([]);
            setSessionSnapshot(null);
            setSessionSnapshotLoading(false);
            return;
        }

        let cancelled = false;
        setEvents([]);
        setSessionSnapshot(null);
        setSessionSnapshotLoading(true);

        fetch(`/api/court/sessions/${sessionId}`)
            .then(res => {
                if (!res.ok) {
                    throw new Error(`Unexpected status ${res.status}`);
                }

                return res.json();
            })
            .then(data => {
                if (cancelled) {
                    return;
                }

                const nextSnapshot = mapSessionToSnapshot({
                    session: data.session,
                });

                if (!nextSnapshot) {
                    return;
                }

                setSessionSnapshot(current => current ?? nextSnapshot);
            })
            .catch(err =>
                console.error('Failed to fetch session snapshot:', err),
            )
            .finally(() => {
                if (!cancelled) {
                    setSessionSnapshotLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [sessionId]);

    const isSessionMonitorLoading =
        sessionLookupLoading ||
        (Boolean(sessionId) &&
            sessionSnapshotLoading &&
            sessionSnapshot === null);

    const broadcastLinks = useMemo(() => {
        const build = (path: string) => {
            if (typeof window === 'undefined') {
                return path;
            }

            return new URL(path, window.location.origin).toString();
        };

        return {
            overlay: build('/?view=overlay'),
            publicPage: build('/'),
            dashboard: build('/operator'),
        };
    }, []);

    const recapCards = useMemo(() => {
        const liveRecaps = sessionSnapshot?.transcript
            .filter(entry => entry.isRecap)
            .slice(-4)
            .map(entry => ({
                stamp: new Date(entry.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                }),
                title: entry.speaker,
                detail: entry.content,
            }));

        return liveRecaps && liveRecaps.length > 0 ? liveRecaps : MOCK_RECAP_MOMENTS;
    }, [sessionSnapshot]);

    const copyAccessLink = useCallback(async (label: string, url: string) => {
        try {
            await navigator.clipboard.writeText(url);
            setAccessNotice(`${label} copied`);
        } catch {
            setAccessNotice(`Copy failed for ${label}`);
        }
    }, []);

    const openAccessLink = useCallback((url: string) => {
        window.open(url, '_blank', 'noopener,noreferrer');
        setAccessNotice(`Opened ${url}`);
    }, []);

    const renderActiveTab = () => {
        switch (activeTab) {
            case 'monitor':
                return (
                    <SessionMonitor
                        events={events}
                        snapshot={sessionSnapshot}
                        loading={isSessionMonitorLoading}
                    />
                );
            case 'broadcast':
                return (
                    <section className='grid gap-5 xl:grid-cols-[1.1fr_0.9fr]'>
                        <div className='space-y-5'>
                            <div className='rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.82)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl'>
                                <p className='font-monoish text-[10px] uppercase tracking-[0.34em] text-[hsl(var(--cyan))]'>Broadcast access</p>
                                <h2 className='mt-2 text-2xl font-semibold text-[hsl(var(--text))]'>Overlay + public page links</h2>
                                <p className='mt-3 max-w-2xl text-sm leading-6 text-[hsl(var(--muted))]'>
                                    The overlay stays public for OBS at <span className='text-[hsl(var(--text))]'>{broadcastLinks.overlay}</span>. The dashboard only links, opens, or copies it; no admin lock sits in front of the stream source.
                                </p>

                                {accessNotice ? (
                                    <p className='mt-4 rounded-2xl border border-[hsl(var(--border))] bg-black/10 px-4 py-3 text-sm text-[hsl(var(--gold))]'>
                                        {accessNotice}
                                    </p>
                                ) : null}

                                <div className='mt-5 grid gap-3 md:grid-cols-2'>
                                    {[
                                        {
                                            title: 'Broadcast Overlay',
                                            href: broadcastLinks.overlay,
                                            note: 'Use as the OBS browser source. Remains publicly reachable.',
                                        },
                                        {
                                            title: 'Public Page',
                                            href: broadcastLinks.publicPage,
                                            note: 'Audience-facing courtroom UI with the overlay deep link hidden from nav.',
                                        },
                                    ].map(card => (
                                        <div key={card.title} className='rounded-[1.5rem] border border-[hsl(var(--border))] bg-black/10 p-4'>
                                            <p className='font-monoish text-[10px] uppercase tracking-[0.28em] text-[hsl(var(--cyan))]'>{card.title}</p>
                                            <p className='mt-2 break-all text-sm text-[hsl(var(--text))]'>{card.href}</p>
                                            <p className='mt-2 text-sm leading-6 text-[hsl(var(--muted))]'>{card.note}</p>
                                            <div className='mt-4 flex flex-wrap gap-2'>
                                                <button type='button' onClick={() => openAccessLink(card.href)} className='rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--text))] transition hover:border-[hsl(var(--cyan)/0.45)]'>Open</button>
                                                <button type='button' onClick={() => void copyAccessLink(card.title, card.href)} className='rounded-full border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--muted))] transition hover:text-[hsl(var(--text))]'>Copy</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className='grid gap-3 sm:grid-cols-3'>
                                <div className='rounded-[1.5rem] border border-[hsl(var(--border))] bg-black/10 p-4'>
                                    <p className='text-xs uppercase tracking-[0.22em] text-[hsl(var(--muted))]'>Overlay route</p>
                                    <p className='mt-2 text-lg font-semibold text-[hsl(var(--text))]'>/?view=overlay</p>
                                </div>
                                <div className='rounded-[1.5rem] border border-[hsl(var(--border))] bg-black/10 p-4'>
                                    <p className='text-xs uppercase tracking-[0.22em] text-[hsl(var(--muted))]'>Dashboard route</p>
                                    <p className='mt-2 text-lg font-semibold text-[hsl(var(--text))]'>/operator</p>
                                </div>
                                <div className='rounded-[1.5rem] border border-[hsl(var(--border))] bg-black/10 p-4'>
                                    <p className='text-xs uppercase tracking-[0.22em] text-[hsl(var(--muted))]'>Public page</p>
                                    <p className='mt-2 text-lg font-semibold text-[hsl(var(--text))]'>/</p>
                                </div>
                            </div>
                        </div>

                        <div className='space-y-5'>
                            <div className='rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.82)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl'>
                                <p className='font-monoish text-[10px] uppercase tracking-[0.34em] text-[hsl(var(--gold))]'>Operator note</p>
                                <h3 className='mt-2 text-xl font-semibold text-[hsl(var(--text))]'>Public overlay policy</h3>
                                <p className='mt-3 text-sm leading-6 text-[hsl(var(--muted))]'>
                                    OBS and stream tooling should hit the overlay directly. The dashboard is for control, not for proxying the live frame.
                                </p>
                                <div className='mt-4 space-y-2 text-sm text-[hsl(var(--muted))]'>
                                    <p>• Overlay stays reachable at a public URL.</p>
                                    <p>• Admin auth only protects the dashboard shell.</p>
                                    <p>• Public app remains audience-facing.</p>
                                </div>
                            </div>

                            <div className='rounded-[2rem] border border-[hsl(var(--border))] bg-black/10 p-5'>
                                <p className='font-monoish text-[10px] uppercase tracking-[0.34em] text-[hsl(var(--cyan))]'>Quick launch</p>
                                <div className='mt-4 grid gap-3'>
                                    <a href={broadcastLinks.overlay} target='_blank' rel='noreferrer' className='rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-4 py-3 text-left text-sm font-semibold text-[hsl(var(--text))] transition hover:border-[hsl(var(--cyan)/0.45)]'>Open overlay in a new tab</a>
                                    <a href={broadcastLinks.publicPage} target='_blank' rel='noreferrer' className='rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-4 py-3 text-left text-sm font-semibold text-[hsl(var(--text))] transition hover:border-[hsl(var(--cyan)/0.45)]'>Open public page</a>
                                    <a href={broadcastLinks.dashboard} target='_blank' rel='noreferrer' className='rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-4 py-3 text-left text-sm font-semibold text-[hsl(var(--text))] transition hover:border-[hsl(var(--cyan)/0.45)]'>Dashboard route</a>
                                </div>
                            </div>
                        </div>
                    </section>
                );
            case 'moderation':
                return (
                    <Suspense
                        fallback={
                            <TabFallback message='Loading moderation queue...' />
                        }
                    >
                        <ModerationQueue events={events} />
                    </Suspense>
                );
            case 'recap':
                return (
                    <section className='grid gap-5 xl:grid-cols-[0.95fr_1.05fr]'>
                        <div className='rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.82)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl'>
                            <p className='font-monoish text-[10px] uppercase tracking-[0.34em] text-[hsl(var(--purple))]'>Replay recap</p>
                            <h2 className='mt-2 text-2xl font-semibold text-[hsl(var(--text))]'>Archived highlights for the control room</h2>
                            <p className='mt-3 text-sm leading-6 text-[hsl(var(--muted))]'>
                                Live recap markers appear here when the session emits them. If there is no replay data yet, the dashboard falls back to the mock recap slate used for review.
                            </p>
                            <div className='mt-5 grid gap-3 sm:grid-cols-2'>
                                <div className='rounded-2xl border border-[hsl(var(--border))] bg-black/10 p-4'>
                                    <p className='text-xs uppercase tracking-[0.22em] text-[hsl(var(--muted))]'>Recap source</p>
                                    <p className='mt-2 text-lg font-semibold text-[hsl(var(--text))]'>
                                        {sessionSnapshot?.recapCount ? 'Live replay markers' : 'Mock recap content'}
                                    </p>
                                </div>
                                <div className='rounded-2xl border border-[hsl(var(--border))] bg-black/10 p-4'>
                                    <p className='text-xs uppercase tracking-[0.22em] text-[hsl(var(--muted))]'>Turn count</p>
                                    <p className='mt-2 text-lg font-semibold text-[hsl(var(--text))]'>
                                        {sessionSnapshot?.recapCount ?? 0}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className='rounded-[2rem] border border-[hsl(var(--border))] bg-black/10 p-5'>
                            <p className='font-monoish text-[10px] uppercase tracking-[0.34em] text-[hsl(var(--gold))]'>Recap slate</p>
                            <div className='mt-4 space-y-3'>
                                {recapCards.map(card => (
                                    <div key={`${card.stamp}-${card.title}`} className='rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-4'>
                                        <div className='flex items-center gap-3'>
                                            <span className='rounded-full border border-[hsl(var(--border))] px-2 py-1 font-monoish text-[10px] uppercase tracking-[0.24em] text-[hsl(var(--cyan))]'>{card.stamp}</span>
                                            <p className='text-sm font-semibold text-[hsl(var(--text))]'>{card.title}</p>
                                        </div>
                                        <p className='mt-2 text-sm leading-6 text-[hsl(var(--muted))]'>{card.detail}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>
                );
            case 'llm':
                return (
                    <Suspense fallback={<TabFallback message='Loading LLM call audit...' />}>
                        <LLMAuditLog sessionId={sessionId} />
                    </Suspense>
                );
            case 'ops':
                return (
                    <Suspense fallback={<TabFallback message='Loading ops metrics...' />}>
                        <OpsMetrics />
                    </Suspense>
                );
            case 'controls':
                return (
                    <Suspense
                        fallback={
                            <TabFallback message='Loading manual controls...' />
                        }
                    >
                        <div className='space-y-5'>
                            <ManualControls sessionId={sessionId} />
                            <AdminTriggers sessionId={sessionId} />
                        </div>
                    </Suspense>
                );
            case 'caseQueue':
                return (
                    <Suspense fallback={<TabFallback message='Loading case queue...' />}>
                        <CaseQueue />
                    </Suspense>
                );
            case 'analytics':
                return (
                    <Suspense
                        fallback={
                            <TabFallback message='Loading analytics...' />
                        }
                    >
                        <Analytics events={events} />
                    </Suspense>
                );
            default:
                return null;
        }
    };

    return (
        <div className='min-h-screen bg-[hsl(var(--bg))] text-[hsl(var(--text))]'>
            {/* Header */}
            <header className='border-b border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.82)] shadow-[0_24px_80px_rgba(0,0,0,0.24)] backdrop-blur-xl'>
                <div className='container mx-auto px-4 py-4'>
                    <div className='flex items-center justify-between'>
                        <div>
                            <p className='font-monoish text-[10px] uppercase tracking-[0.34em] text-[hsl(var(--cyan))]'>JuryRigged</p>
                            <h1 className='mt-1 text-2xl font-bold text-[hsl(var(--text))]'>
                                Operator Dashboard
                            </h1>
                            <p className='text-sm text-[hsl(var(--muted))]'>
                                Broadcast control surface
                            </p>
                        </div>
                        <div className='flex items-center gap-4'>
                            {sessionId && (
                                <div className='text-sm text-[hsl(var(--muted))]'>
                                    <span className='font-medium'>
                                        Session:
                                    </span>{' '}
                                    <span className='font-mono text-[hsl(var(--cyan))]'>
                                        {sessionId.slice(0, 8)}
                                    </span>
                                </div>
                            )}
                            <div className='flex items-center gap-2'>
                                <div
                                    className={`w-2 h-2 rounded-full ${connected ? 'bg-[hsl(var(--green))]' : 'bg-[hsl(var(--red))]'}`}
                                />
                                <span className='text-sm text-[hsl(var(--muted))]'>
                                    {connected ? 'Connected' : 'Disconnected'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {/* Tab Navigation */}
            <nav className='border-b border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.72)]'>
                <div className='container mx-auto px-4'>
                    <div className='flex gap-1'>
                        {TABS.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                onMouseEnter={() => {
                                    if (tab.preload) {
                                        void tab.preload();
                                    }
                                }}
                                onFocus={() => {
                                    if (tab.preload) {
                                        void tab.preload();
                                    }
                                }}
                                className={`px-6 py-3 font-medium transition-colors ${
                                    activeTab === tab.id ?
                                        'bg-[hsl(var(--bg))] text-[hsl(var(--cyan))] border-b-2 border-[hsl(var(--cyan))]'
                                    :   'text-[hsl(var(--muted))] hover:text-[hsl(var(--text))] hover:bg-black/10'
                                }`}
                            >
                                <span className='mr-2'>{tab.icon}</span>
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>
            </nav>

            {/* Error Banner */}
            {error && (
                <div className='border-l-4 border-[hsl(var(--red))] bg-[hsl(var(--red)/0.14)] p-4 text-[hsl(var(--text))]'>
                    <div className='container mx-auto'>
                        <p className='font-medium'>Connection Error</p>
                        <p className='text-sm text-[hsl(var(--muted))]'>{error}</p>
                    </div>
                </div>
            )}

            {/* Main Content */}
            <main className='container mx-auto px-4 py-6'>
                {renderActiveTab()}
            </main>
        </div>
    );
}

export default App;
