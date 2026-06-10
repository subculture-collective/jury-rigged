import React, { useMemo, useState } from 'react';

type AdminTriggerKind = 'message' | 'phase_stinger' | 'evidence_stinger' | 'objection_stinger';

const TRIGGER_OPTIONS: Array<{
    kind: AdminTriggerKind;
    label: string;
    hint: string;
    emoji: string;
}> = [
    {
        kind: 'message',
        label: 'Operator Message',
        hint: 'Show a neutral control-room note on the overlay.',
        emoji: '📣',
    },
    {
        kind: 'phase_stinger',
        label: 'Phase Stinger',
        hint: 'Punch in a phase-transition card.',
        emoji: '🎬',
    },
    {
        kind: 'evidence_stinger',
        label: 'Evidence Stinger',
        hint: 'Highlight evidence or a newly surfaced exhibit.',
        emoji: '🧾',
    },
    {
        kind: 'objection_stinger',
        label: 'Objection Stinger',
        hint: 'Trigger an objection-style burst.',
        emoji: '⚡',
    },
];

interface AdminTriggersProps {
    sessionId: string | null;
}

export function AdminTriggers({ sessionId }: AdminTriggersProps) {
    const [kind, setKind] = useState<AdminTriggerKind>('message');
    const [title, setTitle] = useState('Court notice');
    const [message, setMessage] = useState('Stand by for an operator update.');
    const [loading, setLoading] = useState(false);
    const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const activeOption = useMemo(() => TRIGGER_OPTIONS.find(option => option.kind === kind), [kind]);

    const submitTrigger = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!sessionId) {
            setNotice({ type: 'error', text: 'No active session selected.' });
            return;
        }

        setLoading(true);
        setNotice(null);

        try {
            const response = await fetch('/api/admin/triggers', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Request': '1',
                },
                body: JSON.stringify({
                    sessionId,
                    kind,
                    title,
                    message,
                }),
            });

            if (!response.ok) {
                const payload = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
                throw new Error(payload?.error ?? payload?.code ?? `Trigger failed with ${response.status}`);
            }

            setNotice({
                type: 'success',
                text: `${activeOption?.label ?? 'Trigger'} sent to overlay stream.`,
            });
        } catch (err) {
            setNotice({ type: 'error', text: (err as Error).message });
        } finally {
            setLoading(false);
        }
    };

    return (
        <section className='admin-panel-strong p-6'>
            <div className='flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between'>
                <div className='max-w-2xl'>
                    <p className='admin-kicker text-[hsl(var(--gold))]'>Admin triggers</p>
                    <h2 className='admin-title mt-2'>Message + stinger console</h2>
                    <p className='admin-copy mt-3'>
                        Send protected, one-shot overlay events for operator notes, phase cards, evidence moments, and
                        objections. These do not mutate the case; they only emit an SSE trigger for the live overlay.
                    </p>
                </div>

                <div className='admin-panel px-4 py-3 text-sm text-[hsl(var(--muted))]'>
                    <span className='font-semibold text-[hsl(var(--text))]'>Session:</span>{' '}
                    <span className='font-mono text-[hsl(var(--cyan))]'>{sessionId ? sessionId.slice(0, 8) : 'none'}</span>
                </div>
            </div>

            {notice ? (
                <div
                    className={`mt-5 border px-4 py-3 text-sm ${
                        notice.type === 'success'
                            ? 'border-[hsl(var(--green)/0.5)] bg-[hsl(var(--green)/0.12)] text-[hsl(var(--text))]'
                            : 'border-[hsl(var(--red)/0.5)] bg-[hsl(var(--red)/0.12)] text-[hsl(var(--text))]'
                    }`}
                >
                    {notice.text}
                </div>
            ) : null}

            <form onSubmit={submitTrigger} className='mt-6 grid gap-5 xl:grid-cols-[0.85fr_1.15fr]'>
                <div className='space-y-3'>
                    {TRIGGER_OPTIONS.map(option => (
                        <button
                            key={option.kind}
                            type='button'
                            onClick={() => setKind(option.kind)}
                            data-active={kind === option.kind}
                            className='admin-button w-full justify-start rounded-none p-4 text-left normal-case tracking-normal'
                        >
                            <span className='text-xl'>{option.emoji}</span>
                            <span className='flex flex-col items-start gap-1'>
                                <span className='text-[0.72rem] tracking-[0.22em]'>{option.label}</span>
                                <span className='text-[0.68rem] font-normal tracking-normal text-[hsl(var(--muted))]'>
                                    {option.hint}
                                </span>
                            </span>
                        </button>
                    ))}
                </div>

                <div className='admin-panel p-5'>
                    <div className='grid gap-4'>
                        <div>
                            <label className='admin-kicker text-[hsl(var(--cyan))]' htmlFor='admin-trigger-title'>
                                Trigger title
                            </label>
                            <input
                                id='admin-trigger-title'
                                value={title}
                                onChange={event => setTitle(event.target.value)}
                                maxLength={80}
                                required
                                className='admin-input mt-2'
                            />
                        </div>

                        <div>
                            <label className='admin-kicker text-[hsl(var(--cyan))]' htmlFor='admin-trigger-message'>
                                Overlay message
                            </label>
                            <textarea
                                id='admin-trigger-message'
                                value={message}
                                onChange={event => setMessage(event.target.value)}
                                maxLength={280}
                                required
                                rows={6}
                                className='admin-textarea mt-2 resize-none'
                            />
                        </div>

                        <div className='grid gap-3 sm:grid-cols-2'>
                            <Metric label='Characters' value={`${title.length}/80 · ${message.length}/280`} />
                            <Metric label='Trigger type' value={activeOption?.label ?? 'Message'} />
                        </div>

                        <button
                            type='submit'
                            disabled={loading || !sessionId}
                            className='admin-button admin-button-danger mt-1 w-full justify-center px-5 py-3'
                        >
                            {loading ? 'Sending trigger…' : 'Send overlay trigger'}
                        </button>
                    </div>
                </div>
            </form>
        </section>
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
