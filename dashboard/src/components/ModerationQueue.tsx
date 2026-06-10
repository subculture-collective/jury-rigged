import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CourtEvent } from '../types';

interface ModerationQueueProps {
    events: CourtEvent[];
}

interface FlaggedItem {
    id: string;
    type: 'statement' | 'vote';
    content: string;
    speaker?: string;
    timestamp: string;
    reason: string;
    status: 'pending' | 'approved' | 'rejected';
}

export function ModerationQueue({ events }: ModerationQueueProps) {
    const [queue, setQueue] = useState<FlaggedItem[]>([]);
    const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
    const processedEventCountRef = useRef(0);

    const handleApprove = (id: string) => {
        setQueue(prev => prev.map(item => (item.id === id ? { ...item, status: 'approved' as const } : item)));
    };

    const handleReject = (id: string) => {
        setQueue(prev => prev.map(item => (item.id === id ? { ...item, status: 'rejected' as const } : item)));
    };

    useEffect(() => {
        if (events.length < processedEventCountRef.current) {
            processedEventCountRef.current = 0;
            setQueue([]);
            return;
        }

        if (events.length === processedEventCountRef.current) {
            return;
        }

        const newEvents = events.slice(processedEventCountRef.current);
        processedEventCountRef.current = events.length;

        setQueue(prev => {
            const known = new Set(prev.map(item => item.id));
            const additions: FlaggedItem[] = [];

            for (const event of newEvents) {
                if (known.has(event.id)) {
                    continue;
                }

                const payload = event.payload as Record<string, unknown>;

                if (event.type === 'moderation_action') {
                    const reasons = Array.isArray(payload.reasons) ? payload.reasons : [];
                    additions.push({
                        id: event.id,
                        type: 'statement',
                        content: 'Content was flagged and redacted by courtroom moderation.',
                        speaker: typeof payload.speaker === 'string' ? payload.speaker : undefined,
                        timestamp: event.at,
                        reason: reasons.length > 0 ? reasons.map(String).join(', ') : 'policy_violation',
                        status: 'pending',
                    });
                    known.add(event.id);
                }

                if (event.type === 'vote_spam_blocked') {
                    const reason = typeof payload.reason === 'string' ? payload.reason : 'vote_spam';
                    additions.push({
                        id: event.id,
                        type: 'vote',
                        content: 'Vote submission blocked by anti-spam guard.',
                        timestamp: event.at,
                        reason,
                        status: 'pending',
                    });
                    known.add(event.id);
                }
            }

            return additions.length > 0 ? [...prev, ...additions] : prev;
        });
    }, [events]);

    const queueStats = useMemo(() => {
        let pending = 0;
        let approved = 0;
        let rejected = 0;

        for (const item of queue) {
            if (item.status === 'pending') pending += 1;
            if (item.status === 'approved') approved += 1;
            if (item.status === 'rejected') rejected += 1;
        }

        return { total: queue.length, pending, approved, rejected };
    }, [queue]);

    const filteredQueue = useMemo(
        () => queue.filter(item => filter === 'all' || item.status === filter),
        [filter, queue],
    );

    return (
        <section className='space-y-5'>
            <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
                <Metric label='Total' value={String(queueStats.total)} tone='cyan' />
                <Metric label='Pending' value={String(queueStats.pending)} tone='gold' />
                <Metric label='Approved' value={String(queueStats.approved)} tone='green' />
                <Metric label='Rejected' value={String(queueStats.rejected)} tone='red' />
            </div>

            <div className='admin-panel p-5'>
                <div className='flex flex-wrap gap-2'>
                    {(['all', 'pending', 'approved', 'rejected'] as const).map(status => (
                        <button
                            key={status}
                            onClick={() => setFilter(status)}
                            data-active={filter === status}
                            className='admin-button px-4 py-2 text-[0.68rem]'
                        >
                            {status.charAt(0).toUpperCase() + status.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            <div className='admin-panel-strong p-5'>
                <div className='flex items-center justify-between gap-3'>
                    <div>
                        <p className='admin-kicker text-[hsl(var(--purple))]'>Moderation queue</p>
                        <h2 className='admin-title mt-2 text-xl'>Flagged items and anti-spam blocks</h2>
                    </div>
                    <span className='admin-chip'>{filteredQueue.length} visible</span>
                </div>

                <div className='mt-5 space-y-3'>
                    {filteredQueue.length === 0 ? (
                        <div className='border border-[hsl(var(--border))] bg-black/10 p-5 text-sm text-[hsl(var(--muted))]'>
                            {filter === 'pending' ? 'No pending items' : `No ${filter} items`}
                        </div>
                    ) : (
                        filteredQueue.map(item => (
                            <div key={item.id} className='border border-[hsl(var(--border))] bg-black/10 p-4'>
                                <div className='flex flex-wrap items-start justify-between gap-3'>
                                    <div className='min-w-0 flex-1'>
                                        <div className='flex flex-wrap items-center gap-2'>
                                            <span className='admin-chip'>{item.type}</span>
                                            {item.speaker ? <span className='text-sm text-[hsl(var(--muted))]'>by {item.speaker}</span> : null}
                                            <span className='text-xs text-[hsl(var(--muted))]'>{new Date(item.timestamp).toLocaleString()}</span>
                                        </div>
                                        <p className='mt-3 break-words text-sm leading-6 text-[hsl(var(--text))]'>{item.content}</p>
                                        <p className='mt-2 text-sm text-[hsl(var(--gold))]'>⚠ {item.reason}</p>
                                    </div>

                                    <div className='flex gap-2'>
                                        {item.status === 'pending' ? (
                                            <>
                                                <button
                                                    onClick={() => handleApprove(item.id)}
                                                    className='admin-button px-3 py-2 text-[0.64rem]'
                                                >
                                                    Approve
                                                </button>
                                                <button
                                                    onClick={() => handleReject(item.id)}
                                                    className='admin-button admin-button-danger px-3 py-2 text-[0.64rem]'
                                                >
                                                    Reject
                                                </button>
                                            </>
                                        ) : (
                                            <span className='admin-chip'>{item.status}</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </section>
    );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'cyan' | 'gold' | 'green' | 'red' }) {
    return (
        <div className='border border-[hsl(var(--border))] bg-black/10 p-4'>
            <p className='text-xs uppercase tracking-[0.22em] text-[hsl(var(--muted))]'>{label}</p>
            <p className='mt-2 text-2xl font-semibold' style={{ color: `hsl(var(--${tone}))` }}>
                {value}
            </p>
        </div>
    );
}
