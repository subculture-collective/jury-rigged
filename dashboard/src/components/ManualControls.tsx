import React, { useState } from 'react';

const SESSION_RELOAD_DELAY_MS = 1500;

const PHASE_OPTIONS = [
    {
        phase: 'witness_exam',
        label: 'Start Witness Exam',
        emoji: '👤',
    },
    {
        phase: 'closings',
        label: 'Start Closings',
        emoji: '⚖️',
    },
    {
        phase: 'verdict_vote',
        label: 'Start Verdict Vote',
        emoji: '🗳️',
    },
    {
        phase: 'final_ruling',
        label: 'Final Ruling',
        emoji: '📜',
    },
] as const;

interface ManualControlsProps {
    sessionId: string | null;
}

export function ManualControls({ sessionId }: ManualControlsProps) {
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{
        type: 'success' | 'error';
        text: string;
    } | null>(null);

    const handleAdvancePhase = async (targetPhase: string) => {
        if (!sessionId) {
            setMessage({ type: 'error', text: 'No active session' });
            return;
        }

        setLoading(true);
        setMessage(null);

        try {
            const response = await fetch(
                `/api/court/sessions/${sessionId}/phase`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Admin-Request': '1',
                    },
                    body: JSON.stringify({ phase: targetPhase }),
                },
            );

            if (!response.ok) {
                throw new Error(`Action failed: ${response.statusText}`);
            }

            setMessage({
                type: 'success',
                text: `Phase advanced to ${targetPhase}`,
            });
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
                throw new Error(
                    `Failed to create session: ${response.statusText}`,
                );
            }

            const data = await response.json();
            const createdSessionId = data.session?.id ?? data.sessionId;
            setMessage({
                type: 'success',
                text: `New session created: ${createdSessionId}`,
            });

            // Reload page to connect to new session
            setTimeout(() => window.location.reload(), SESSION_RELOAD_DELAY_MS);
        } catch (err) {
            setMessage({ type: 'error', text: (err as Error).message });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className='space-y-6'>
            {/* Status Message */}
            {message && (
                <div
                    className={`p-4 rounded-lg ${
                        message.type === 'success' ?
                            'bg-green-900/30 border border-green-700 text-green-300'
                        :   'bg-red-900/30 border border-red-700 text-red-300'
                    }`}
                >
                    {message.text}
                </div>
            )}

            {/* Session Control */}
            <div className='bg-gray-800 rounded-lg p-6 shadow-lg'>
                <h2 className='text-xl font-semibold mb-4 text-primary-400'>
                    Session Control
                </h2>
                <div className='space-y-3'>
                    <button
                        onClick={handleNewSession}
                        disabled={loading}
                        className='w-full px-4 py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors'
                    >
                        {loading ? 'Processing...' : '🆕 Create New Session'}
                    </button>
                </div>
            </div>

            {/* Phase Control */}
            {sessionId && (
                <div className='bg-gray-800 rounded-lg p-6 shadow-lg'>
                    <h2 className='text-xl font-semibold mb-4 text-primary-400'>
                        Phase Control
                    </h2>
                    <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
                        {PHASE_OPTIONS.map(({ phase, label, emoji }) => (
                            <button
                                key={phase}
                                onClick={() => handleAdvancePhase(phase)}
                                disabled={loading}
                                className='px-4 py-3 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors text-left'
                            >
                                <span className='mr-2'>{emoji}</span>
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className='bg-gray-800 rounded-lg p-6 shadow-lg'>
                <p className='text-sm text-gray-400'>
                    Operator controls currently support creating sessions and
                    phase overrides. Additional moderation and emergency APIs
                    can be added server-side later.
                </p>
            </div>
        </div>
    );
}
