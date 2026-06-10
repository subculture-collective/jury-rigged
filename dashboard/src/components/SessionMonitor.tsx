import React, { useMemo } from 'react';
import type { CourtEvent, SessionSnapshot } from '../types';
import { EvidenceCard } from './EvidenceCard';
import { ObjectionCounter } from './ObjectionCounter';

interface SessionMonitorProps {
    events: CourtEvent[];
    snapshot: SessionSnapshot | null;
    loading: boolean;
}

export function SessionMonitor({ events, snapshot, loading }: SessionMonitorProps) {
    const shouldComputeEventDerivatives = !loading && snapshot !== null;

    const evidenceCards = useMemo(() => {
        if (!shouldComputeEventDerivatives) {
            return [];
        }

        return events
            .filter(event => event.type === 'evidence_revealed')
            .map(event => {
                const payload = event.payload as Record<string, unknown>;
                return {
                    evidenceId: typeof payload.evidenceId === 'string' ? payload.evidenceId : '',
                    evidenceText: typeof payload.evidenceText === 'string' ? payload.evidenceText : '',
                    revealedAt: typeof payload.revealedAt === 'string' ? payload.revealedAt : event.at,
                };
            });
    }, [events, shouldComputeEventDerivatives]);

    const objectionCount = useMemo(() => {
        if (!shouldComputeEventDerivatives) {
            return 0;
        }

        const objectionEvents = events.filter(event => event.type === 'objection_count_changed');
        if (objectionEvents.length === 0) return 0;
        const latest = objectionEvents[objectionEvents.length - 1];
        const payload = latest.payload as Record<string, unknown>;
        return typeof payload.count === 'number' ? payload.count : 0;
    }, [events, shouldComputeEventDerivatives]);

    const latestEvents = useMemo(
        () => (shouldComputeEventDerivatives ? events.slice(-12).reverse() : []),
        [events, shouldComputeEventDerivatives],
    );

    const totalVotes = useMemo(
        () =>
            snapshot ?
                Object.values(snapshot.votes).reduce((sum, voteCount) => sum + voteCount.total, 0)
            :   0,
        [snapshot],
    );

    if (loading) {
        return (
            <div className='flex items-center justify-center py-12'>
                <div className='admin-panel px-4 py-3 text-sm text-[hsl(var(--muted))]'>Loading session data…</div>
            </div>
        );
    }

    if (!snapshot) {
        return (
            <div className='admin-panel-strong max-w-2xl p-6'>
                <p className='admin-kicker text-[hsl(var(--gold))]'>Live court</p>
                <h2 className='admin-title mt-2'>No active session</h2>
                <p className='admin-copy mt-3'>Start a new session or wait for the next court run to connect the operator view.</p>
            </div>
        );
    }

    const witnessMax = snapshot.config.maxWitnessStatements;

    return (
        <div className='grid gap-5 xl:grid-cols-2'>
            <section className='admin-panel-strong p-5'>
                <p className='admin-kicker'>Session info</p>
                <div className='mt-3 grid gap-3 sm:grid-cols-2'>
                    <Stat label='Session ID' value={`${snapshot.sessionId.slice(0, 12)}…`} />
                    <Stat label='Phase' value={snapshot.phase} />
                    <Stat label='Transcript entries' value={String(snapshot.transcript.length)} />
                    <Stat label='Total votes' value={String(totalVotes)} />
                    <Stat label='Recap count' value={String(snapshot.recapCount)} />
                    <Stat label='Objections' value={String(objectionCount)} />
                </div>

                <div className='mt-5 rounded-none border border-[hsl(var(--border))] bg-black/10 p-4'>
                    <div className='flex items-center justify-between gap-3'>
                        <p className='text-xs uppercase tracking-[0.22em] text-[hsl(var(--muted))]'>Session density</p>
                        <p className='text-sm font-semibold text-[hsl(var(--text))]'>{snapshot.transcript.length} turns on record</p>
                    </div>
                    <p className='admin-copy mt-2'>This panel keeps the live courtroom state compact so operators can see phase, tally, and transcript pressure without opening other tabs.</p>
                </div>
            </section>

            <section className='admin-panel p-5'>
                <p className='admin-kicker text-[hsl(var(--cyan))]'>Witness caps</p>
                <div className='mt-4 space-y-4'>
                    <WitnessBar label='Witness 1' value={snapshot.witnessCaps.witness1} max={witnessMax} tone='cyan' />
                    <WitnessBar label='Witness 2' value={snapshot.witnessCaps.witness2} max={witnessMax} tone='purple' />
                </div>
                <p className='mt-4 text-sm text-[hsl(var(--muted))]'>Recap interval: every {snapshot.config.recapInterval} statements</p>
                <div className='mt-4'>
                    <ObjectionCounter count={objectionCount} />
                </div>
            </section>

            {evidenceCards.length > 0 ? (
                <section className='admin-panel-strong p-5 xl:col-span-2'>
                    <p className='admin-kicker text-[hsl(var(--gold))]'>Evidence revealed</p>
                    <div className='mt-4 space-y-3'>
                        {evidenceCards.map(card => (
                            <EvidenceCard
                                key={card.evidenceId || `${card.revealedAt}-${card.evidenceText}`}
                                evidenceId={card.evidenceId}
                                evidenceText={card.evidenceText}
                                revealedAt={card.revealedAt}
                            />
                        ))}
                    </div>
                </section>
            ) : null}

            <section className='admin-panel p-5'>
                <p className='admin-kicker text-[hsl(var(--green))]'>Vote tallies</p>
                <div className='mt-4 space-y-4'>
                    {Object.entries(snapshot.votes).map(([phase, counts]) => (
                        <div key={phase} className='border border-[hsl(var(--border))] bg-black/10 p-4'>
                            <div className='flex items-center justify-between gap-3'>
                                <p className='text-sm font-semibold text-[hsl(var(--text))]'>{phase}</p>
                                <p className='text-xs uppercase tracking-[0.22em] text-[hsl(var(--muted))]'>Total {counts.total}</p>
                            </div>
                            <div className='mt-3 grid grid-cols-2 gap-3'>
                                <VoteCard label='Innocent' value={counts.innocent} tone='green' />
                                <VoteCard label='Guilty' value={counts.guilty} tone='red' />
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section className='admin-panel-strong p-5'>
                <div className='flex items-center justify-between gap-3'>
                    <p className='admin-kicker text-[hsl(var(--purple))]'>Live event feed</p>
                    <span className='admin-chip'>{latestEvents.length} shown</span>
                </div>
                <div className='admin-scroll mt-4 max-h-[28rem] space-y-2 pr-1' role='log' aria-live='polite'>
                    {latestEvents.length === 0 ? (
                        <div className='admin-panel px-4 py-4 text-sm text-[hsl(var(--muted))]'>No recent events</div>
                    ) : (
                        latestEvents.map(event => {
                            const payload = event.payload as Record<string, unknown>;
                            const turn = payload.turn as { speaker?: string } | undefined;
                            return (
                                <article key={event.id} className='border border-[hsl(var(--border))] bg-black/10 p-3'>
                                    <div className='flex flex-wrap items-center gap-2'>
                                        <span className='admin-chip'>{new Date(event.at).toLocaleTimeString()}</span>
                                        <span className='text-sm font-semibold text-[hsl(var(--text))]'>{event.type}</span>
                                        {turn?.speaker ? <span className='text-xs uppercase tracking-[0.18em] text-[hsl(var(--muted))]'>{turn.speaker}</span> : null}
                                    </div>
                                    <pre className='mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-[hsl(var(--muted))]'>
                                        {JSON.stringify(event.payload, null, 2)}
                                    </pre>
                                </article>
                            );
                        })
                    )}
                </div>
            </section>
        </div>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className='border border-[hsl(var(--border))] bg-black/10 p-3'>
            <p className='text-[0.68rem] uppercase tracking-[0.22em] text-[hsl(var(--muted))]'>{label}</p>
            <p className='mt-2 break-words text-sm font-semibold text-[hsl(var(--text))]'>{value}</p>
        </div>
    );
}

function WitnessBar({
    label,
    value,
    max,
    tone,
}: {
    label: string;
    value: number;
    max: number;
    tone: 'cyan' | 'purple';
}) {
    const percent = max > 0 ? Math.min((value / max) * 100, 100) : 0;

    return (
        <div>
            <div className='flex items-center justify-between gap-3'>
                <p className='text-sm font-semibold text-[hsl(var(--text))]'>{label}</p>
                <p className='text-xs text-[hsl(var(--muted))]'>
                    {value} / {max}
                </p>
            </div>
            <div className='mt-2 h-2 border border-[hsl(var(--border))] bg-black/20'>
                <div
                    className='h-full'
                    style={{ width: `${percent}%`, backgroundColor: `hsl(var(--${tone}))` }}
                />
            </div>
        </div>
    );
}

function VoteCard({ label, value, tone }: { label: string; value: number; tone: 'green' | 'red' }) {
    return (
        <div className='border border-[hsl(var(--border))] bg-black/10 p-3'>
            <p className='text-xs uppercase tracking-[0.22em] text-[hsl(var(--muted))]'>{label}</p>
            <p className='mt-2 text-2xl font-semibold' style={{ color: `hsl(var(--${tone}))` }}>
                {value}
            </p>
        </div>
    );
}
