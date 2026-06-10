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
    const sessions = Array.isArray(payload.sessions) ? payload.sessions : ([] as unknown[]);

    if (sessions.length === 0) {
        return null;
    }

    const running = sessions.find(candidate => asRecord(candidate).status === 'running');
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

type DashboardTab = {
    id: DashboardTabId;
    label: string;
    badge: string;
    purpose: string;
    preload?: () => Promise<unknown>;
};

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

const TABS: DashboardTab[] = [
    {
        id: 'monitor',
        label: 'Live Court',
        badge: 'LIVE',
        purpose: 'Session health, live events, and the active courtroom snapshot.',
    },
    {
        id: 'caseQueue',
        label: 'Case Queue',
        badge: 'QUEUE',
        purpose: 'Operator-submitted prompts, automation state, and fallback pressure.',
        preload: loadCaseQueue,
    },
    {
        id: 'controls',
        label: 'Control Room',
        badge: 'CTRL',
        purpose: 'Phase overrides, manual session creation, and protected overlay triggers.',
        preload: () => Promise.all([loadManualControls(), loadAdminTriggers()]),
    },
    {
        id: 'broadcast',
        label: 'Broadcast',
        badge: 'OBS',
        purpose: 'Public app and overlay routes, copy links, and stream access guidance.',
    },
    {
        id: 'llm',
        label: 'LLM Audit',
        badge: 'LLM',
        purpose: 'Prompt/response traces, latency, and persisted body status.',
        preload: loadLLMAuditLog,
    },
    {
        id: 'analytics',
        label: 'Analytics',
        badge: 'DATA',
        purpose: 'Event mix, phase counts, and recent timeline density.',
        preload: loadAnalytics,
    },
    {
        id: 'ops',
        label: 'Ops Metrics',
        badge: 'OPS',
        purpose: 'Health check, SSE totals, and raw Prometheus metrics.',
        preload: loadOpsMetrics,
    },
    {
        id: 'moderation',
        label: 'Moderation',
        badge: 'MOD',
        purpose: 'Flagged content, voting guard actions, and manual review state.',
        preload: loadModerationQueue,
    },
    {
        id: 'recap',
        label: 'Recap',
        badge: 'RECAP',
        purpose: 'Replay highlights, recap markers, and session memory.',
    },
];

function TabFallback({ message }: { message: string }) {
    return (
        <div className='flex items-center justify-center py-12'>
            <div className='admin-panel px-4 py-3 text-sm text-[hsl(var(--muted))]'>{message}</div>
        </div>
    );
}

function MetricCard({
    label,
    value,
    tone = 'text',
}: {
    label: string;
    value: string;
    tone?: 'text' | 'cyan' | 'purple' | 'gold' | 'green' | 'red';
}) {
    return (
        <div className='admin-stat-card min-w-0'>
            <p className='admin-stat-label'>{label}</p>
            <p
                className='admin-stat-value break-words'
                style={{
                    color: tone === 'text' ? 'hsl(var(--text))' : `hsl(var(--${tone}))`,
                }}
            >
                {value}
            </p>
        </div>
    );
}

function QuickLink({ href, label, hint }: { href: string; label: string; hint: string }) {
    return (
        <a
            href={href}
            className='admin-button w-full justify-between px-4 py-3 text-left normal-case tracking-normal'
        >
            <span className='flex flex-col items-start gap-1'>
                <span className='text-[0.72rem] tracking-[0.22em]'>{label}</span>
                <span className='whitespace-normal text-[0.68rem] font-normal tracking-normal text-[hsl(var(--muted))]'>
                    {hint}
                </span>
            </span>
            <span aria-hidden='true' className='text-[hsl(var(--muted))]'>
                ↗
            </span>
        </a>
    );
}

function App() {
    const [activeTab, setActiveTab] = useState<DashboardTabId>('monitor');
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [sessionSnapshot, setSessionSnapshot] = useState<SessionSnapshot | null>(null);
    const [events, setEvents] = useState<CourtEvent[]>([]);
    const [sessionLookupLoading, setSessionLookupLoading] = useState(true);
    const [sessionSnapshotLoading, setSessionSnapshotLoading] = useState(false);
    const [accessNotice, setAccessNotice] = useState<string | null>(null);

    const handleSSEEvent = useCallback((event: CourtEvent) => {
        setEvents(prev => [...prev, event]);
        setSessionSnapshot(current => applyEventToSnapshot(current, event));
    }, []);

    const handleSSESnapshot = useCallback((payload: Record<string, unknown>) => {
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
    }, []);

    const { connected, error } = useSSE(sessionId, handleSSEEvent, handleSSESnapshot);

    const activeTabInfo = useMemo(
        () => TABS.find(tab => tab.id === activeTab) ?? TABS[0],
        [activeTab],
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

                const nextSessionId = resolvePreferredSessionId(sessionsResponse);
                setSessionId(current => (current === nextSessionId ? current : nextSessionId));
            } catch (err) {
                console.error('Failed to fetch session:', err);
            }
        };

        void syncSessionId().finally(() => {
            if (!cancelled) {
                setSessionLookupLoading(false);
            }
        });

        const intervalId = window.setInterval(() => {
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
            .catch(err => console.error('Failed to fetch session snapshot:', err))
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
        sessionLookupLoading || (Boolean(sessionId) && sessionSnapshotLoading && sessionSnapshot === null);

    const broadcastLinks = useMemo(() => {
        const build = (path: string) => {
            if (typeof window === 'undefined') {
                return path;
            }

            return new URL(path, window.location.origin).toString();
        };

        return {
            publicDashboard: build('/app/?view=dashboard'),
            overlay: build('/app/?view=overlay'),
            submit: build('/app/?view=submit'),
            transcripts: build('/app/?view=transcripts'),
            operator: build('/operator'),
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
                            <div className='admin-panel-strong p-6'>
                                <p className='admin-kicker'>Broadcast access</p>
                                <h2 className='admin-title mt-2'>Public routes and overlay source</h2>
                                <p className='admin-copy mt-3 max-w-2xl'>
                                    Use these links to jump straight back to the public app or copy the overlay source without
                                    leaving the operator shell.
                                </p>

                                {accessNotice ? (
                                    <p className='admin-panel mt-4 px-4 py-3 text-sm text-[hsl(var(--gold))]'>
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
                                            title: 'Public Dashboard',
                                            href: broadcastLinks.publicDashboard,
                                            note: 'Audience-facing courtroom UI with the broadcast deep link hidden from nav.',
                                        },
                                        {
                                            title: 'Prompt Submit',
                                            href: broadcastLinks.submit,
                                            note: 'Public entry point for viewers submitting new case prompts.',
                                        },
                                        {
                                            title: 'Transcript View',
                                            href: broadcastLinks.transcripts,
                                            note: 'Open the transcript browser for case review and detail lookup.',
                                        },
                                    ].map(card => (
                                        <div key={card.title} className='admin-panel-flat p-4'>
                                            <p className='admin-kicker text-[hsl(var(--cyan))]'>{card.title}</p>
                                            <p className='mt-2 break-all text-sm text-[hsl(var(--text))]'>{card.href}</p>
                                            <p className='admin-copy mt-2'>{card.note}</p>
                                            <div className='mt-4 flex flex-wrap gap-2'>
                                                <button
                                                    type='button'
                                                    onClick={() => openAccessLink(card.href)}
                                                    className='admin-button px-3 py-2 text-[0.68rem]'
                                                >
                                                    Open
                                                </button>
                                                <button
                                                    type='button'
                                                    onClick={() => void copyAccessLink(card.title, card.href)}
                                                    className='admin-button admin-button-ghost px-3 py-2 text-[0.68rem]'
                                                >
                                                    Copy
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className='grid gap-3 sm:grid-cols-3'>
                                <MetricCard label='Dashboard route' value='/app/?view=dashboard' tone='cyan' />
                                <MetricCard label='Overlay route' value='/app/?view=overlay' tone='green' />
                                <MetricCard label='Operator route' value='/operator' tone='purple' />
                            </div>
                        </div>

                        <div className='space-y-5'>
                            <div className='admin-panel p-5'>
                                <p className='admin-kicker text-[hsl(var(--gold))]'>Operator note</p>
                                <h3 className='admin-title mt-2 text-xl'>Public overlay policy</h3>
                                <p className='admin-copy mt-3'>
                                    OBS and stream tooling should hit the overlay directly. The dashboard is for control, not for
                                    proxying the live frame.
                                </p>
                                <div className='mt-4 space-y-2 text-sm text-[hsl(var(--muted))]'>
                                    <p>• Overlay stays reachable at a public URL.</p>
                                    <p>• Admin auth only protects the dashboard shell.</p>
                                    <p>• Public app remains audience-facing.</p>
                                </div>
                            </div>

                            <div className='admin-panel-flat p-5'>
                                <p className='admin-kicker text-[hsl(var(--cyan))]'>Quick launch</p>
                                <div className='mt-4 grid gap-3'>
                                    <a href={broadcastLinks.overlay} target='_blank' rel='noreferrer' className='admin-button justify-start px-4 py-3 normal-case tracking-normal'>
                                        Open overlay in a new tab
                                    </a>
                                    <a href={broadcastLinks.publicDashboard} target='_blank' rel='noreferrer' className='admin-button justify-start px-4 py-3 normal-case tracking-normal'>
                                        Open public dashboard
                                    </a>
                                    <a href={broadcastLinks.submit} target='_blank' rel='noreferrer' className='admin-button justify-start px-4 py-3 normal-case tracking-normal'>
                                        Open prompt submit
                                    </a>
                                </div>
                            </div>
                        </div>
                    </section>
                );
            case 'moderation':
                return (
                    <Suspense fallback={<TabFallback message='Loading moderation queue...' />}>
                        <ModerationQueue events={events} />
                    </Suspense>
                );
            case 'recap':
                return (
                    <section className='grid gap-5 xl:grid-cols-[0.95fr_1.05fr]'>
                        <div className='admin-panel-strong p-6'>
                            <p className='admin-kicker text-[hsl(var(--purple))]'>Replay recap</p>
                            <h2 className='admin-title mt-2'>Archived highlights for the control room</h2>
                            <p className='admin-copy mt-3'>
                                Live recap markers appear here when the session emits them. If there is no replay data yet, the
                                dashboard falls back to the mock recap slate used for review.
                            </p>
                            <div className='mt-5 grid gap-3 sm:grid-cols-2'>
                                <MetricCard
                                    label='Recap source'
                                    value={sessionSnapshot?.recapCount ? 'Live replay markers' : 'Mock recap content'}
                                    tone='cyan'
                                />
                                <MetricCard label='Turn count' value={String(sessionSnapshot?.recapCount ?? 0)} tone='gold' />
                            </div>
                        </div>

                        <div className='admin-panel-flat p-5'>
                            <p className='admin-kicker text-[hsl(var(--gold))]'>Recap slate</p>
                            <div className='mt-4 space-y-3'>
                                {recapCards.map(card => (
                                    <div key={`${card.stamp}-${card.title}`} className='admin-panel-flat p-4'>
                                        <div className='flex flex-wrap items-center gap-3'>
                                            <span className='admin-chip'>{card.stamp}</span>
                                            <p className='text-sm font-semibold text-[hsl(var(--text))]'>{card.title}</p>
                                        </div>
                                        <p className='admin-copy mt-2'>{card.detail}</p>
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
                    <Suspense fallback={<TabFallback message='Loading manual controls...' />}>
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
                    <Suspense fallback={<TabFallback message='Loading analytics...' />}>
                        <Analytics events={events} />
                    </Suspense>
                );
            default:
                return null;
        }
    };

    return (
        <div className='min-h-screen bg-[hsl(var(--bg))] text-[hsl(var(--text))]'>
            <div className='mx-auto max-w-[1600px] px-4 py-4 lg:px-6'>
                <header className='admin-panel-strong shadow-[0_24px_80px_rgba(0,0,0,0.22)]'>
                    <div className='grid gap-5 px-5 py-5 xl:grid-cols-[1.2fr_0.8fr]'>
                        <div className='min-w-0 space-y-4'>
                            <div className='flex flex-wrap items-center gap-2'>
                                <p className='admin-kicker'>JuryRigged · Operator Dashboard</p>
                                <span className='admin-chip'>Protected</span>
                                <span className='admin-chip'>{connected ? 'SSE live' : 'SSE reconnecting'}</span>
                                {sessionId ? (
                                    <span className='admin-chip'>Session {sessionId.slice(0, 8)}</span>
                                ) : (
                                    <span className='admin-chip'>No session yet</span>
                                )}
                            </div>

                            <div className='space-y-2'>
                                <h1 className='admin-title'>Useful, dense control room for the live court.</h1>
                                <p className='admin-copy max-w-3xl'>
                                    Keep the operator side readable at a glance: current session, queue pressure, broadcast routes,
                                    moderation, audit history, and the public links needed to jump back and forth.
                                </p>
                            </div>

                            <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
                                <MetricCard label='Active tab' value={activeTabInfo.label} tone='cyan' />
                                <MetricCard label='Tab purpose' value={activeTabInfo.purpose} />
                                <MetricCard
                                    label='Connection'
                                    value={connected ? 'Live SSE' : 'Polling / reconnecting'}
                                    tone={connected ? 'green' : 'gold'}
                                />
                                <MetricCard
                                    label='Session'
                                    value={sessionId ? sessionId.slice(0, 12) : sessionLookupLoading ? 'Discovering…' : 'No active session'}
                                    tone='purple'
                                />
                            </div>
                        </div>

                        <div className='space-y-3'>
                            <div className='admin-panel p-4'>
                                <div className='flex items-center justify-between gap-3'>
                                    <div>
                                        <p className='admin-kicker text-[hsl(var(--gold))]'>Cross navigation</p>
                                        <p className='mt-2 text-sm font-semibold text-[hsl(var(--text))]'>Jump between public and admin views</p>
                                    </div>
                                    <div className={`h-3 w-3 shrink-0 border border-[hsl(var(--border))] ${connected ? 'bg-[hsl(var(--green))]' : 'bg-[hsl(var(--red))]'}`} />
                                </div>

                                <div className='mt-4 grid gap-2'>
                                    <QuickLink href={broadcastLinks.publicDashboard} label='Public dashboard' hint='/app/?view=dashboard' />
                                    <QuickLink href={broadcastLinks.overlay} label='Broadcast overlay' hint='/app/?view=overlay' />
                                    <QuickLink href={broadcastLinks.submit} label='Submit prompt' hint='/app/?view=submit' />
                                    <QuickLink href={broadcastLinks.operator} label='Operator shell' hint='/operator' />
                                </div>

                                <div className='mt-4 flex flex-wrap gap-2'>
                                    <a href={broadcastLinks.transcripts} className='admin-button flex-1 min-w-[10rem] justify-center'>
                                        Transcripts
                                    </a>
                                    <a href={broadcastLinks.overlay} className='admin-button admin-button-ghost flex-1 min-w-[10rem] justify-center'>
                                        Overlay
                                    </a>
                                    <form action='/api/admin/logout' method='post' className='flex-1 min-w-[10rem]'>
                                        <button type='submit' className='admin-button admin-button-danger w-full'>
                                            Logout
                                        </button>
                                    </form>
                                </div>
                            </div>

                            <div className='grid gap-3 sm:grid-cols-3'>
                                <MetricCard label='Turns' value={String(sessionSnapshot?.transcript.length ?? 0)} tone='cyan' />
                                <MetricCard label='Events' value={String(events.length)} tone='gold' />
                                <MetricCard label='Mode' value={activeTabInfo.badge} tone='purple' />
                            </div>
                        </div>
                    </div>

                    <nav className='border-t border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.54)]' aria-label='Operator dashboard sections' role='tablist'>
                        <div className='admin-scroll px-3 py-3'>
                            <div className='flex min-w-max gap-2'>
                                {TABS.map(tab => (
                                    <button
                                        key={tab.id}
                                        id={`operator-tab-${tab.id}`}
                                        role='tab'
                                        aria-selected={activeTab === tab.id}
                                        aria-controls={`operator-panel-${tab.id}`}
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
                                        data-active={activeTab === tab.id}
                                        className='admin-button min-w-[11rem] flex-col items-start px-4 py-3 text-left'
                                    >
                                        <span className='text-[0.64rem] tracking-[0.28em] text-[hsl(var(--muted))]'>{tab.badge}</span>
                                        <span className='text-[0.78rem] tracking-[0.12em]'>{tab.label}</span>
                                        <span className='mt-1 whitespace-normal text-left text-[0.68rem] font-normal tracking-normal text-[hsl(var(--muted))]'>
                                            {tab.purpose}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </nav>
                </header>

                {error ? (
                    <div className='mt-4 admin-panel border-[hsl(var(--red)/0.6)] bg-[hsl(var(--red)/0.12)] px-4 py-3 text-sm text-[hsl(var(--text))]'>
                        <p className='font-semibold text-[hsl(var(--red))]'>Connection error</p>
                        <p className='mt-1 text-[hsl(var(--muted))]'>{error}</p>
                    </div>
                ) : null}

                {accessNotice ? (
                    <div className='mt-4 admin-panel border-[hsl(var(--gold)/0.6)] bg-[hsl(var(--gold)/0.1)] px-4 py-3 text-sm text-[hsl(var(--text))]'>
                        <p className='font-semibold text-[hsl(var(--gold))]'>Broadcast link helper</p>
                        <p className='mt-1 text-[hsl(var(--muted))]'>{accessNotice}</p>
                    </div>
                ) : null}

                <main
                    id={`operator-panel-${activeTab}`}
                    role='tabpanel'
                    aria-labelledby={`operator-tab-${activeTab}`}
                    className='py-5'
                >
                    {renderActiveTab()}
                </main>
            </div>
        </div>
    );
}

export default App;
