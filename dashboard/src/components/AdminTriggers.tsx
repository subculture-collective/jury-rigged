import React, { useMemo, useState } from 'react';

type AdminTriggerKind =
    | 'message'
    | 'phase_stinger'
    | 'evidence_stinger'
    | 'objection_stinger';

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
    const [notice, setNotice] = useState<{
        type: 'success' | 'error';
        text: string;
    } | null>(null);

    const activeOption = useMemo(
        () => TRIGGER_OPTIONS.find(option => option.kind === kind),
        [kind],
    );

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
                const payload = (await response.json().catch(() => null)) as {
                    error?: string;
                    code?: string;
                } | null;
                throw new Error(
                    payload?.error ??
                        payload?.code ??
                        `Trigger failed with ${response.status}`,
                );
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
        <section className='rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.82)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl'>
            <div className='flex flex-col gap-3 md:flex-row md:items-start md:justify-between'>
                <div>
                    <p className='font-monoish text-[10px] uppercase tracking-[0.34em] text-[hsl(var(--gold))]'>Admin triggers</p>
                    <h2 className='mt-2 text-2xl font-semibold text-[hsl(var(--text))]'>Message + stinger console</h2>
                    <p className='mt-3 max-w-2xl text-sm leading-6 text-[hsl(var(--muted))]'>
                        Send protected, one-shot overlay events for operator notes,
                        phase cards, evidence moments, and objections. These do not
                        mutate the case; they only emit an SSE trigger for the live
                        overlay.
                    </p>
                </div>
                <div className='rounded-2xl border border-[hsl(var(--border))] bg-black/10 px-4 py-3 text-sm text-[hsl(var(--muted))]'>
                    <span className='font-semibold text-[hsl(var(--text))]'>Session:</span>{' '}
                    <span className='font-mono text-[hsl(var(--cyan))]'>
                        {sessionId ? sessionId.slice(0, 8) : 'none'}
                    </span>
                </div>
            </div>

            {notice ? (
                <div
                    className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${
                        notice.type === 'success' ?
                            'border-[hsl(var(--green)/0.5)] bg-[hsl(var(--green)/0.12)] text-[hsl(var(--green))]'
                        :   'border-[hsl(var(--red)/0.5)] bg-[hsl(var(--red)/0.12)] text-[hsl(var(--red))]'
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
                            className={`w-full rounded-2xl border p-4 text-left transition ${
                                kind === option.kind ?
                                    'border-[hsl(var(--cyan)/0.65)] bg-[hsl(var(--cyan)/0.12)]'
                                :   'border-[hsl(var(--border))] bg-black/10 hover:border-[hsl(var(--cyan)/0.36)]'
                            }`}
                        >
                            <div className='flex items-center gap-3'>
                                <span className='text-xl'>{option.emoji}</span>
                                <span className='font-semibold text-[hsl(var(--text))]'>{option.label}</span>
                            </div>
                            <p className='mt-2 text-sm leading-6 text-[hsl(var(--muted))]'>{option.hint}</p>
                        </button>
                    ))}
                </div>

                <div className='rounded-[1.5rem] border border-[hsl(var(--border))] bg-black/10 p-5'>
                    <label className='block text-xs font-semibold uppercase tracking-[0.22em] text-[hsl(var(--cyan))]' htmlFor='admin-trigger-title'>
                        Trigger title
                    </label>
                    <input
                        id='admin-trigger-title'
                        value={title}
                        onChange={event => setTitle(event.target.value)}
                        maxLength={80}
                        required
                        className='mt-2 w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-4 py-3 text-[hsl(var(--text))] outline-none transition focus:border-[hsl(var(--cyan)/0.7)]'
                    />

                    <label className='mt-5 block text-xs font-semibold uppercase tracking-[0.22em] text-[hsl(var(--cyan))]' htmlFor='admin-trigger-message'>
                        Overlay message
                    </label>
                    <textarea
                        id='admin-trigger-message'
                        value={message}
                        onChange={event => setMessage(event.target.value)}
                        maxLength={280}
                        required
                        rows={5}
                        className='mt-2 w-full resize-none rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-4 py-3 text-[hsl(var(--text))] outline-none transition focus:border-[hsl(var(--cyan)/0.7)]'
                    />

                    <div className='mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[hsl(var(--muted))]'>
                        <span>{title.length}/80 title · {message.length}/280 message</span>
                        <span>{activeOption?.emoji} {activeOption?.label}</span>
                    </div>

                    <button
                        type='submit'
                        disabled={loading || !sessionId}
                        className='mt-5 w-full rounded-full bg-[hsl(var(--gold))] px-5 py-3 font-bold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-gray-600 disabled:text-gray-300'
                    >
                        {loading ? 'Sending trigger...' : 'Send overlay trigger'}
                    </button>
                </div>
            </form>
        </section>
    );
}
