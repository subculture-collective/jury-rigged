import React, { useCallback, useEffect, useMemo, useState } from 'react';

type CaseQueueItem = {
    id: string;
    prompt: string;
    source: 'twitch' | 'operator' | 'generated';
    submittedBy?: string;
    status: 'queued' | 'running' | 'completed' | 'skipped';
    sessionId?: string;
    createdAt: string;
};

type CaseQueueSnapshot = {
    queue: CaseQueueItem[];
    queuedCount: number;
    runningSessionId: string | null;
    automationEnabled: boolean;
    automationPaused: boolean;
    errorState: boolean;
    errorReason?: string;
    consecutiveFallbacks: number;
    fallbackThreshold: number;
    generatedFallback: boolean;
};

async function fetchQueue(): Promise<CaseQueueSnapshot> {
    const res = await fetch('/api/court/case-queue');
    if (!res.ok) throw new Error(`Queue API unavailable (${res.status})`);
    return (await res.json()) as CaseQueueSnapshot;
}

export function CaseQueue() {
    const [snapshot, setSnapshot] = useState<CaseQueueSnapshot | null>(null);
    const [prompt, setPrompt] = useState('');
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            setSnapshot(await fetchQueue());
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Queue API unavailable');
        }
    }, []);

    useEffect(() => {
        void refresh();
        const timer = window.setInterval(() => void refresh(), 5_000);
        return () => window.clearInterval(timer);
    }, [refresh]);

    const submitPrompt = async () => {
        setNotice(null);
        setError(null);
        const res = await fetch('/api/admin/case-queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' },
            body: JSON.stringify({ prompt, submittedBy: 'operator' }),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            setError(body.error ?? `Submit failed (${res.status})`);
            return;
        }
        setPrompt('');
        setNotice('Case queued. It will run before the next generated case.');
        await refresh();
    };

    const action = async (id: string, kind: 'start' | 'skip') => {
        setBusyId(id);
        setNotice(null);
        setError(null);
        try {
            const res = await fetch(`/api/admin/case-queue/${id}/${kind}`, {
                method: 'POST',
                headers: { 'X-Admin-Request': '1' },
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error ?? `${kind} failed (${res.status})`);
            }
            setNotice(kind === 'start' ? 'Queued case started.' : 'Queued case skipped.');
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : `${kind} failed`);
        } finally {
            setBusyId(null);
        }
    };

    const setAutomationPaused = async (paused: boolean) => {
        setNotice(null);
        setError(null);
        try {
            const res = await fetch(`/api/admin/simulation-control/${paused ? 'pause' : 'resume'}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' },
                body: JSON.stringify({ reason: 'Operator paused automation' }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error ?? `Automation update failed (${res.status})`);
            }
            setNotice(
                paused ?
                    'Automation paused. Running case may finish; no new cases will start.'
                :   'Automation resumed. Queue/generated cases may start on the next scheduler tick.',
            );
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Automation update failed');
        }
    };

    const queued = snapshot?.queue.filter(item => item.status === 'queued') ?? [];
    const recent = snapshot?.queue.filter(item => item.status !== 'queued').slice(-8).reverse() ?? [];

    const sourceCounts = useMemo(() => {
        const counts = { twitch: 0, operator: 0, generated: 0 };
        for (const item of snapshot?.queue ?? []) {
            counts[item.source] += 1;
        }
        return counts;
    }, [snapshot?.queue]);

    const oldestQueued = queued[0]?.createdAt ? new Date(queued[0].createdAt).toLocaleString() : 'None';

    return (
        <section className='grid gap-5 xl:grid-cols-[0.9fr_1.1fr]'>
            <div className='space-y-5'>
                <div className='admin-panel-strong p-6'>
                    <p className='admin-kicker'>Case automation</p>
                    <h2 className='admin-title mt-2'>Queue + generated fallback</h2>
                    <p className='admin-copy mt-3'>
                        Chatters submit cases with <span className='font-mono text-[hsl(var(--cyan))]'>!prompt &lt;case idea&gt;</span>.
                        Queued cases run before generated cases. If the queue is empty, the court automatically generates the next case.
                    </p>

                    <div className='mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
                        <Stat label='Automation' value={snapshot?.automationPaused ? 'Paused' : snapshot?.automationEnabled === false ? 'Manual' : 'On'} />
                        <Stat label='Queued' value={String(snapshot?.queuedCount ?? 0)} />
                        <Stat label='Running' value={snapshot?.runningSessionId ? 'Live' : 'None'} />
                        <Stat label='Fallbacks' value={`${snapshot?.consecutiveFallbacks ?? 0}/${snapshot?.fallbackThreshold ?? 5}`} />
                        <Stat label='Oldest queued' value={oldestQueued} />
                        <Stat label='Generated fallback' value={snapshot?.generatedFallback ? 'Yes' : 'No'} />
                    </div>

                    <div className='mt-4 grid gap-3 sm:grid-cols-3'>
                        <Metric label='Twitch' value={String(sourceCounts.twitch)} />
                        <Metric label='Operator' value={String(sourceCounts.operator)} />
                        <Metric label='Generated' value={String(sourceCounts.generated)} />
                    </div>

                    <div className='mt-4 flex flex-wrap gap-2'>
                        <button
                            type='button'
                            onClick={() => void setAutomationPaused(true)}
                            disabled={snapshot?.automationPaused === true}
                            className='admin-button admin-button-danger px-4 py-2 text-[0.68rem]'
                        >
                            Pause automation
                        </button>
                        <button
                            type='button'
                            onClick={() => void setAutomationPaused(false)}
                            disabled={snapshot?.automationPaused === false && snapshot?.errorState === false}
                            className='admin-button px-4 py-2 text-[0.68rem]'
                        >
                            Resume automation
                        </button>
                    </div>

                    <p className='mt-3 text-xs uppercase tracking-[0.22em] text-[hsl(var(--muted))]'>
                        Fallback circuit · {snapshot?.consecutiveFallbacks ?? 0}/{snapshot?.fallbackThreshold ?? 5}
                    </p>

                    {snapshot?.errorState ? (
                        <p className='mt-4 border border-[hsl(var(--red)/0.5)] bg-[hsl(var(--red)/0.12)] px-4 py-3 text-sm text-[hsl(var(--text))]'>
                            {snapshot.errorReason ?? 'Simulation stopped in error state.'}
                        </p>
                    ) : null}
                    {notice ? <p className='mt-4 border border-[hsl(var(--green)/0.5)] bg-[hsl(var(--green)/0.12)] px-4 py-3 text-sm text-[hsl(var(--text))]'>{notice}</p> : null}
                    {error ? <p className='mt-4 border border-[hsl(var(--red)/0.5)] bg-[hsl(var(--red)/0.12)] px-4 py-3 text-sm text-[hsl(var(--text))]'>{error}</p> : null}
                </div>

                <div className='admin-panel p-5'>
                    <p className='admin-kicker text-[hsl(var(--gold))]'>Operator submit</p>
                    <textarea
                        value={prompt}
                        onChange={event => setPrompt(event.target.value)}
                        placeholder='A fictional PG-13 case idea...'
                        className='admin-textarea mt-4 min-h-32 resize-none'
                    />
                    <button
                        type='button'
                        onClick={() => void submitPrompt()}
                        disabled={prompt.trim().length < 10}
                        className='admin-button mt-3 px-4 py-2 text-[0.68rem]'
                    >
                        Queue case
                    </button>
                </div>
            </div>

            <div className='admin-panel-strong p-6'>
                <div className='flex items-center justify-between gap-3'>
                    <div>
                        <p className='admin-kicker text-[hsl(var(--purple))]'>Visible queue</p>
                        <h3 className='admin-title mt-2 text-xl'>Submitted cases</h3>
                    </div>
                    <span className='admin-chip'>{queued.length} queued</span>
                </div>

                <div className='mt-5 space-y-3'>
                    {queued.length > 0 ? (
                        queued.map((item, index) => (
                            <QueueRow
                                key={item.id}
                                item={item}
                                index={index}
                                busy={busyId === item.id}
                                onStart={() => void action(item.id, 'start')}
                                onSkip={() => void action(item.id, 'skip')}
                            />
                        ))
                    ) : (
                        <p className='border border-[hsl(var(--border))] bg-black/10 px-4 py-4 text-sm text-[hsl(var(--muted))]'>
                            No submitted cases queued. The next idle slot defaults to a generated case.
                        </p>
                    )}
                </div>

                {recent.length > 0 ? (
                    <div className='mt-6 border-t border-[hsl(var(--border))] pt-5'>
                        <p className='admin-kicker text-[hsl(var(--muted))]'>Recent queue history</p>
                        <div className='mt-3 space-y-2'>
                            {recent.map(item => (
                                <p key={item.id} className='text-xs leading-5 text-[hsl(var(--muted))]'>
                                    {item.status.toUpperCase()} · {item.prompt}
                                </p>
                            ))}
                        </div>
                    </div>
                ) : null}
            </div>
        </section>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className='border border-[hsl(var(--border))] bg-black/10 p-4'>
            <p className='text-[0.68rem] uppercase tracking-[0.22em] text-[hsl(var(--muted))]'>{label}</p>
            <p className='mt-2 break-words text-sm font-semibold text-[hsl(var(--text))]'>{value}</p>
        </div>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className='border border-[hsl(var(--border))] bg-black/10 p-3'>
            <p className='text-[0.68rem] uppercase tracking-[0.22em] text-[hsl(var(--muted))]'>{label}</p>
            <p className='mt-2 text-sm font-semibold text-[hsl(var(--text))]'>{value}</p>
        </div>
    );
}

function QueueRow({
    item,
    index,
    busy,
    onStart,
    onSkip,
}: {
    item: CaseQueueItem;
    index: number;
    busy: boolean;
    onStart: () => void;
    onSkip: () => void;
}) {
    return (
        <div className='border border-[hsl(var(--border))] bg-black/10 p-4'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div className='min-w-0'>
                    <p className='text-[0.68rem] uppercase tracking-[0.22em] text-[hsl(var(--gold))]'>
                        #{index + 1} · {item.source}
                        {item.submittedBy ? ` · ${item.submittedBy}` : ''}
                    </p>
                    <p className='mt-2 break-words text-sm leading-6 text-[hsl(var(--text))]'>{item.prompt}</p>
                </div>
                <div className='flex gap-2'>
                    <button
                        type='button'
                        disabled={busy}
                        onClick={onStart}
                        className='admin-button px-3 py-2 text-[0.64rem]'
                    >
                        Start now
                    </button>
                    <button
                        type='button'
                        disabled={busy}
                        onClick={onSkip}
                        className='admin-button admin-button-ghost px-3 py-2 text-[0.64rem]'
                    >
                        Skip
                    </button>
                </div>
            </div>
            <div className='mt-3 flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--muted))]'>
                <span className='admin-chip'>{item.status}</span>
                {item.sessionId ? <span className='admin-chip'>Session {item.sessionId.slice(0, 8)}</span> : null}
                <span>{new Date(item.createdAt).toLocaleString()}</span>
            </div>
        </div>
    );
}
