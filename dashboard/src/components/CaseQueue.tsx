import React, { useCallback, useEffect, useState } from 'react';

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
            const res = await fetch(
                `/api/admin/simulation-control/${paused ? 'pause' : 'resume'}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' },
                    body: JSON.stringify({ reason: 'Operator paused automation' }),
                },
            );
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error ?? `Automation update failed (${res.status})`);
            }
            setNotice(paused ? 'Automation paused. Running case may finish; no new cases will start.' : 'Automation resumed. Queue/generated cases may start on the next scheduler tick.');
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Automation update failed');
        }
    };

    const queued = snapshot?.queue.filter(item => item.status === 'queued') ?? [];
    const recent = snapshot?.queue.filter(item => item.status !== 'queued').slice(-8).reverse() ?? [];

    return (
        <section className='grid gap-5 xl:grid-cols-[0.9fr_1.1fr]'>
            <div className='space-y-5'>
                <div className='rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.82)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl'>
                    <p className='font-monoish text-[10px] uppercase tracking-[0.34em] text-[hsl(var(--cyan))]'>Case automation</p>
                    <h2 className='mt-2 text-2xl font-semibold text-[hsl(var(--text))]'>Queue + generated fallback</h2>
                    <p className='mt-3 text-sm leading-6 text-[hsl(var(--muted))]'>
                        Chatters submit cases with <span className='font-monoish text-[hsl(var(--cyan))]'>!prompt &lt;case idea&gt;</span>. Queued cases run before generated cases. If the queue is empty, the court automatically generates the next case.
                    </p>
                    <div className='mt-5 grid gap-3 sm:grid-cols-3'>
                        <Stat label='Automation' value={snapshot?.automationPaused ? 'Paused' : snapshot?.automationEnabled === false ? 'Manual' : 'On'} />
                        <Stat label='Queued' value={String(snapshot?.queuedCount ?? 0)} />
                        <Stat label='Running' value={snapshot?.runningSessionId ? 'Live' : 'None'} />
                    </div>
                    <div className='mt-4 flex flex-wrap gap-2'>
                        <button type='button' onClick={() => void setAutomationPaused(true)} disabled={snapshot?.automationPaused === true} className='rounded-full border border-[hsl(var(--gold)/0.45)] bg-[hsl(var(--gold)/0.12)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-[hsl(var(--gold))] transition hover:border-[hsl(var(--gold))] disabled:cursor-not-allowed disabled:opacity-40'>Pause automation</button>
                        <button type='button' onClick={() => void setAutomationPaused(false)} disabled={snapshot?.automationPaused === false && snapshot?.errorState === false} className='rounded-full border border-[hsl(var(--green)/0.45)] bg-[hsl(var(--green)/0.12)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-[hsl(var(--green))] transition hover:border-[hsl(var(--green))] disabled:cursor-not-allowed disabled:opacity-40'>Resume automation</button>
                    </div>
                    <p className='mt-3 text-xs uppercase tracking-[0.22em] text-[hsl(var(--muted))]'>Fallback circuit · {snapshot?.consecutiveFallbacks ?? 0}/{snapshot?.fallbackThreshold ?? 5}</p>
                    {snapshot?.errorState ? <p className='mt-4 rounded-2xl border border-[hsl(var(--red)/0.5)] bg-[hsl(var(--red)/0.12)] px-4 py-3 text-sm text-[hsl(var(--text))]'>{snapshot.errorReason ?? 'Simulation stopped in error state.'}</p> : null}
                    {notice ? <p className='mt-4 rounded-2xl border border-[hsl(var(--green)/0.5)] bg-[hsl(var(--green)/0.12)] px-4 py-3 text-sm text-[hsl(var(--text))]'>{notice}</p> : null}
                    {error ? <p className='mt-4 rounded-2xl border border-[hsl(var(--red)/0.5)] bg-[hsl(var(--red)/0.12)] px-4 py-3 text-sm text-[hsl(var(--text))]'>{error}</p> : null}
                </div>

                <div className='rounded-[2rem] border border-[hsl(var(--border))] bg-black/10 p-5'>
                    <p className='font-monoish text-[10px] uppercase tracking-[0.34em] text-[hsl(var(--gold))]'>Operator submit</p>
                    <textarea
                        value={prompt}
                        onChange={event => setPrompt(event.target.value)}
                        placeholder='A fictional PG-13 case idea...'
                        className='mt-4 min-h-32 w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-4 py-3 text-sm text-[hsl(var(--text))] outline-none transition focus:border-[hsl(var(--cyan)/0.6)]'
                    />
                    <button type='button' onClick={() => void submitPrompt()} disabled={prompt.trim().length < 10} className='mt-3 rounded-full border border-[hsl(var(--cyan)/0.45)] bg-[hsl(var(--cyan)/0.14)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-[hsl(var(--cyan))] transition hover:border-[hsl(var(--cyan))] disabled:cursor-not-allowed disabled:opacity-40'>Queue case</button>
                </div>
            </div>

            <div className='rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.82)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl'>
                <p className='font-monoish text-[10px] uppercase tracking-[0.34em] text-[hsl(var(--purple))]'>Visible queue</p>
                <h3 className='mt-2 text-xl font-semibold text-[hsl(var(--text))]'>Submitted cases</h3>
                <div className='mt-5 space-y-3'>
                    {queued.length > 0 ? queued.map((item, index) => (
                        <QueueRow key={item.id} item={item} index={index} busy={busyId === item.id} onStart={() => void action(item.id, 'start')} onSkip={() => void action(item.id, 'skip')} />
                    )) : (
                        <p className='rounded-2xl border border-[hsl(var(--border))] bg-black/10 px-4 py-4 text-sm text-[hsl(var(--muted))]'>No submitted cases queued. The next idle slot defaults to a generated case.</p>
                    )}
                </div>
                {recent.length > 0 ? (
                    <div className='mt-6 border-t border-[hsl(var(--border))] pt-5'>
                        <p className='font-monoish text-[10px] uppercase tracking-[0.34em] text-[hsl(var(--muted))]'>Recent queue history</p>
                        <div className='mt-3 space-y-2'>
                            {recent.map(item => <p key={item.id} className='text-xs leading-5 text-[hsl(var(--muted))]'>{item.status.toUpperCase()} · {item.prompt}</p>)}
                        </div>
                    </div>
                ) : null}
            </div>
        </section>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className='rounded-2xl border border-[hsl(var(--border))] bg-black/10 p-4'>
            <p className='text-xs uppercase tracking-[0.22em] text-[hsl(var(--muted))]'>{label}</p>
            <p className='mt-2 text-lg font-semibold text-[hsl(var(--text))]'>{value}</p>
        </div>
    );
}

function QueueRow({ item, index, busy, onStart, onSkip }: { item: CaseQueueItem; index: number; busy: boolean; onStart: () => void; onSkip: () => void }) {
    return (
        <div className='rounded-2xl border border-[hsl(var(--border))] bg-black/10 p-4'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <p className='font-monoish text-[10px] uppercase tracking-[0.28em] text-[hsl(var(--gold))]'>#{index + 1} · {item.source}{item.submittedBy ? ` · ${item.submittedBy}` : ''}</p>
                    <p className='mt-2 text-sm leading-6 text-[hsl(var(--text))]'>{item.prompt}</p>
                </div>
                <div className='flex gap-2'>
                    <button type='button' disabled={busy} onClick={onStart} className='rounded-full border border-[hsl(var(--green)/0.45)] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--green))] disabled:opacity-40'>Start now</button>
                    <button type='button' disabled={busy} onClick={onSkip} className='rounded-full border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--muted))] disabled:opacity-40'>Skip</button>
                </div>
            </div>
        </div>
    );
}
