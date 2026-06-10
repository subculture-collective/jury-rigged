import React, { useState } from 'react';

const SESSION_RELOAD_DELAY_MS = 1500;

const PHASE_OPTIONS = [
    { phase: 'witness_exam', label: 'Start Witness Exam', emoji: '👤' },
    { phase: 'closings', label: 'Start Closings', emoji: '⚖️' },
    { phase: 'verdict_vote', label: 'Start Verdict Vote', emoji: '🗳️' },
    { phase: 'final_ruling', label: 'Final Ruling', emoji: '📜' },
] as const;

interface ManualControlsProps {
    sessionId: string | null;
}

export function ManualControls({ sessionId }: ManualControlsProps) {
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const handleAdvancePhase = async (targetPhase: string) => {
        if (!sessionId) {
            setMessage({ type: 'error', text: 'No active session' });
            return;
        }

        setLoading(true);
        setMessage(null);

        try {
            const response = await fetch(`/api/court/sessions/${sessionId}/phase`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Request': '1',
                },
                body: JSON.stringify({ phase: targetPhase }),
            });

            if (!response.ok) {
                throw new Error(`Action failed: ${response.statusText}`);
            }

            setMessage({ type: 'success', text: `Phase advanced to ${targetPhase}` });
        } catch (err) {
            setMessage({ type: 'error', text: (err as Error).message });
        } finally {
            setLoading(false);
        }
    };

    const handleNewSession = async () => {
        setLoading(true);
        setMessage(null);

        try {
            const response = await fetch('/api/court/sessions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Request': '1',
                },
                body: JSON.stringify({ topic: 'Operator-created session' }),
            });

            if (!response.ok) {
                throw new Error(`Failed to create session: ${response.statusText}`);
            }

            const data = await response.json();
            const createdSessionId = data.session?.id ?? data.sessionId;
            setMessage({ type: 'success', text: `New session created: ${createdSessionId}` });

            setTimeout(() => window.location.reload(), SESSION_RELOAD_DELAY_MS);
        } catch (err) {
            setMessage({ type: 'error', text: (err as Error).message });
        } finally {
            setLoading(false);
        }
    };

    return (
        <section className='grid gap-5 xl:grid-cols-[0.95fr_1.05fr]'>
            <div className='space-y-5'>
                <div className='admin-panel-strong p-6'>
                    <p className='admin-kicker text-[hsl(var(--gold))]'>Session control</p>
                    <h2 className='admin-title mt-2'>Create or re-seed the live court</h2>
                    <p className='admin-copy mt-3'>
                        New sessions can be created from here, and phase overrides remain protected by the admin header.
                        Treat these controls as high-impact actions.
                    </p>

                    {message ? (
                        <div
                            className={`mt-4 border px-4 py-3 text-sm ${
                                message.type === 'success'
                                    ? 'border-[hsl(var(--green)/0.5)] bg-[hsl(var(--green)/0.12)] text-[hsl(var(--text))]'
                                    : 'border-[hsl(var(--red)/0.5)] bg-[hsl(var(--red)/0.12)] text-[hsl(var(--text))]'
                            }`}
                        >
                            {message.text}
                        </div>
                    ) : null}

                    <button
                        onClick={handleNewSession}
                        disabled={loading}
                        className='admin-button admin-button-danger mt-5 w-full justify-center px-4 py-3'
                    >
                        {loading ? 'Processing…' : 'Create new session'}
                    </button>
                    <p className='mt-3 text-xs uppercase tracking-[0.22em] text-[hsl(var(--muted))]'>
                        This reloads the dashboard so the new session binds immediately.
                    </p>
                </div>

                <div className='admin-panel p-5'>
                    <p className='admin-kicker text-[hsl(var(--cyan))]'>Guardrails</p>
                    <div className='mt-3 grid gap-3 sm:grid-cols-2'>
                        <Metric label='Admin header' value='Required' />
                        <Metric label='Session mutation' value='Protected' />
                        <Metric label='Reload delay' value='1.5s' />
                        <Metric label='Phase actions' value='Immediate' />
                    </div>
                </div>
            </div>

            <div className='admin-panel p-5'>
                <div className='flex items-start justify-between gap-3'>
                    <div>
                        <p className='admin-kicker text-[hsl(var(--cyan))]'>Phase control</p>
                        <h3 className='admin-title mt-2 text-xl'>Operator overrides</h3>
                    </div>
                    <span className='admin-chip'>{sessionId ? `Session ${sessionId.slice(0, 8)}` : 'No session'}</span>
                </div>

                <p className='admin-copy mt-3'>
                    Phase changes should only be used when the live run needs manual intervention or a controlled jump to a
                    later court state.
                </p>

                {sessionId ? (
                    <div className='mt-5 grid gap-3 md:grid-cols-2'>
                        {PHASE_OPTIONS.map(({ phase, label, emoji }) => (
                            <button
                                key={phase}
                                onClick={() => void handleAdvancePhase(phase)}
                                disabled={loading}
                                className='admin-button justify-start px-4 py-4 text-left normal-case tracking-normal'
                            >
                                <span className='text-xl'>{emoji}</span>
                                <span className='flex flex-col items-start gap-1'>
                                    <span className='text-[0.72rem] tracking-[0.22em]'>{label}</span>
                                    <span className='text-[0.68rem] font-normal tracking-normal text-[hsl(var(--muted))]'>
                                        Force the current session to {phase}
                                    </span>
                                </span>
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className='mt-5 border border-[hsl(var(--border))] bg-black/10 p-4 text-sm text-[hsl(var(--muted))]'>
                        No active session connected. Create one or wait for the scheduler to attach.
                    </div>
                )}
            </div>
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
