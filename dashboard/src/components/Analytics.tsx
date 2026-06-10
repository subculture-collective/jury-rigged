import React, { useMemo } from 'react';
import type { CourtEvent } from '../types';

interface AnalyticsProps {
    events: CourtEvent[];
}

export function Analytics({ events }: AnalyticsProps) {
    const stats = useMemo(() => {
        const byType: Record<string, number> = {};
        const byPhase: Record<string, number> = {};
        let votes = 0;
        let statements = 0;
        let recaps = 0;
        let tokenBudgetApplied = 0;
        let latestEstimatedTokens = 0;
        let latestEstimatedCostUsd = 0;

        for (const event of events) {
            byType[event.type] = (byType[event.type] || 0) + 1;

            if (event.type === 'phase_changed') {
                const phase = typeof event.payload.phase === 'string' ? event.payload.phase : '';
                if (phase) {
                    byPhase[phase] = (byPhase[phase] || 0) + 1;
                }
            }

            if (event.type === 'vote_updated') votes += 1;
            if (event.type === 'turn') statements += 1;
            if (event.type === 'judge_recap_emitted') recaps += 1;
            if (event.type === 'token_budget_applied') tokenBudgetApplied += 1;

            if (event.type === 'session_token_estimate') {
                if (typeof event.payload.cumulativeEstimatedTokens === 'number') {
                    latestEstimatedTokens = event.payload.cumulativeEstimatedTokens;
                }

                if (typeof event.payload.estimatedCostUsd === 'number') {
                    latestEstimatedCostUsd = event.payload.estimatedCostUsd;
                }
            }
        }

        const sortedByType = Object.entries(byType).sort(([, leftCount], [, rightCount]) => rightCount - leftCount);
        const sortedByPhase = Object.entries(byPhase).sort(([, leftCount], [, rightCount]) => rightCount - leftCount);

        return {
            total: events.length,
            byType: sortedByType,
            byPhase: sortedByPhase,
            votes,
            statements,
            recaps,
            tokenBudgetApplied,
            latestEstimatedTokens,
            latestEstimatedCostUsd,
            recentEvents: events.slice(-50).reverse(),
        };
    }, [events]);

    return (
        <section className='space-y-5'>
            <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-6'>
                <Metric label='Total events' value={String(stats.total)} tone='cyan' />
                <Metric label='Statements' value={String(stats.statements)} tone='blue' />
                <Metric label='Votes' value={String(stats.votes)} tone='green' />
                <Metric label='Recaps' value={String(stats.recaps)} tone='purple' />
                <Metric label='Token caps' value={String(stats.tokenBudgetApplied)} tone='gold' />
                <Metric label='Est. cost' value={`$${stats.latestEstimatedCostUsd.toFixed(4)}`} tone='green' subvalue={`~${stats.latestEstimatedTokens} tokens`} />
            </div>

            <div className='grid gap-5 xl:grid-cols-[0.9fr_1.1fr]'>
                <div className='space-y-5'>
                    <div className='admin-panel-strong p-5'>
                        <p className='admin-kicker'>Event mix</p>
                        <div className='mt-4 space-y-3'>
                            {stats.byType.map(([type, count]) => (
                                <Row key={type} label={type} count={count} total={stats.total} />
                            ))}
                        </div>
                    </div>

                    <div className='admin-panel p-5'>
                        <p className='admin-kicker text-[hsl(var(--cyan))]'>Phase mix</p>
                        {stats.byPhase.length === 0 ? (
                            <div className='mt-4 border border-[hsl(var(--border))] bg-black/10 p-4 text-sm text-[hsl(var(--muted))]'>
                                No phase data available
                            </div>
                        ) : (
                            <div className='mt-4 space-y-3'>
                                {stats.byPhase.map(([phase, count]) => (
                                    <div key={phase} className='border border-[hsl(var(--border))] bg-black/10 p-4'>
                                        <div className='flex items-center justify-between gap-3'>
                                            <p className='text-sm font-semibold text-[hsl(var(--text))]'>{phase}</p>
                                            <p className='text-xs text-[hsl(var(--muted))]'>
                                                {((count / Math.max(stats.total, 1)) * 100).toFixed(1)}%
                                            </p>
                                        </div>
                                        <div className='mt-3 h-2 border border-[hsl(var(--border))] bg-black/20'>
                                            <div
                                                className='h-full bg-[hsl(var(--purple))]'
                                                style={{ width: `${(count / Math.max(stats.total, 1)) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className='admin-panel-strong p-5'>
                    <div className='flex items-center justify-between gap-3'>
                        <p className='admin-kicker text-[hsl(var(--gold))]'>Event timeline</p>
                        <span className='admin-chip'>{stats.recentEvents.length} shown</span>
                    </div>
                    <div className='admin-scroll mt-4 max-h-[44rem] space-y-2 pr-1'>
                        {stats.total === 0 ? (
                            <div className='border border-[hsl(var(--border))] bg-black/10 p-5 text-sm text-[hsl(var(--muted))]'>
                                No events recorded
                            </div>
                        ) : (
                            stats.recentEvents.map(event => (
                                <div key={event.id} className='border border-[hsl(var(--border))] bg-black/10 p-3'>
                                    <div className='flex flex-wrap items-center gap-2'>
                                        <span className='admin-chip'>{new Date(event.at).toLocaleTimeString()}</span>
                                        <span className='text-sm font-semibold text-[hsl(var(--text))]'>{event.type}</span>
                                        {event.type === 'phase_changed' && event.payload.phase ? (
                                            <span className='text-xs text-[hsl(var(--muted))]'>({event.payload.phase as string})</span>
                                        ) : null}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
}

function Metric({
    label,
    value,
    tone,
    subvalue,
}: {
    label: string;
    value: string;
    tone: 'cyan' | 'blue' | 'green' | 'purple' | 'gold';
    subvalue?: string;
}) {
    return (
        <div className='border border-[hsl(var(--border))] bg-black/10 p-4'>
            <p className='text-[0.68rem] uppercase tracking-[0.22em] text-[hsl(var(--muted))]'>{label}</p>
            <p className='mt-2 text-2xl font-semibold' style={{ color: `hsl(var(--${tone}))` }}>
                {value}
            </p>
            {subvalue ? <p className='mt-1 text-xs text-[hsl(var(--muted))]'>{subvalue}</p> : null}
        </div>
    );
}

function Row({ label, count, total }: { label: string; count: number; total: number }) {
    return (
        <div>
            <div className='mb-1 flex items-center justify-between gap-3'>
                <span className='text-sm font-medium text-[hsl(var(--text))]'>{label}</span>
                <span className='text-xs text-[hsl(var(--muted))]'>{count}</span>
            </div>
            <div className='h-2 border border-[hsl(var(--border))] bg-black/20'>
                <div className='h-full bg-[hsl(var(--cyan))]' style={{ width: `${(count / Math.max(total, 1)) * 100}%` }} />
            </div>
        </div>
    );
}
