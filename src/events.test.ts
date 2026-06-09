import test from 'node:test';
import assert from 'node:assert/strict';
import { assertEventPayload } from './events.js';
import type { CourtEvent } from './types.js';

function makeEvent(
    type: CourtEvent['type'],
    payload: Record<string, unknown>,
): CourtEvent {
    return {
        id: 'test-id',
        sessionId: 'sess-1',
        type,
        at: new Date().toISOString(),
        payload,
    };
}

// ---------------------------------------------------------------------------
// Valid payload tests
// ---------------------------------------------------------------------------

test('assertEventPayload: session_created valid', () => {
    assert.doesNotThrow(() =>
        assertEventPayload(makeEvent('session_created', { sessionId: 'abc' })),
    );
});

test('assertEventPayload: session_started valid', () => {
    assert.doesNotThrow(() =>
        assertEventPayload(
            makeEvent('session_started', {
                sessionId: 'abc',
                startedAt: new Date().toISOString(),
            }),
        ),
    );
});

test('assertEventPayload: phase_changed valid', () => {
    assert.doesNotThrow(() =>
        assertEventPayload(
            makeEvent('phase_changed', {
                phase: 'openings',
                phaseStartedAt: new Date().toISOString(),
                phaseDurationMs: 30_000,
            }),
        ),
    );
});

test('assertEventPayload: turn valid', () => {
    assert.doesNotThrow(() =>
        assertEventPayload(
            makeEvent('turn', {
                turn: {
                    id: 't1',
                    sessionId: 'sess-1',
                    turnNumber: 0,
                    speaker: 'phoenix',
                    role: 'judge',
                    phase: 'openings',
                    dialogue: 'All rise.',
                    createdAt: new Date().toISOString(),
                },
            }),
        ),
    );
});

test('assertEventPayload: vote_updated valid', () => {
    assert.doesNotThrow(() =>
        assertEventPayload(
            makeEvent('vote_updated', {
                voteType: 'verdict',
                choice: 'guilty',
                verdictVotes: { guilty: 1 },
                sentenceVotes: {},
            }),
        ),
    );
});

test('assertEventPayload: vote_closed valid', () => {
    assert.doesNotThrow(() =>
        assertEventPayload(
            makeEvent('vote_closed', {
                pollType: 'verdict',
                closedAt: new Date().toISOString(),
                votes: { guilty: 3, not_guilty: 2 },
                nextPhase: 'sentence_vote',
            }),
        ),
    );
});

test('assertEventPayload: witness_response_capped valid', () => {
    assert.doesNotThrow(() =>
        assertEventPayload(
            makeEvent('witness_response_capped', {
                turnId: 'turn-1',
                speaker: 'phoenix',
                phase: 'witness_exam',
                originalLength: 180,
                truncatedLength: 120,
                reason: 'tokens',
            }),
        ),
    );
});

test('assertEventPayload: judge_recap_emitted valid', () => {
    assert.doesNotThrow(() =>
        assertEventPayload(
            makeEvent('judge_recap_emitted', {
                turnId: 'turn-2',
                phase: 'witness_exam',
                cycleNumber: 2,
            }),
        ),
    );
});

test('assertEventPayload: token_budget_applied valid', () => {
    assert.doesNotThrow(() =>
        assertEventPayload(
            makeEvent('token_budget_applied', {
                turnId: 'turn-3',
                speaker: 'phoenix',
                role: 'judge',
                phase: 'openings',
                requestedMaxTokens: 260,
                appliedMaxTokens: 180,
                roleMaxTokens: 180,
                source: 'env_role_cap',
            }),
        ),
    );
});

test('assertEventPayload: session_token_estimate valid', () => {
    assert.doesNotThrow(() =>
        assertEventPayload(
            makeEvent('session_token_estimate', {
                turnId: 'turn-4',
                role: 'judge',
                phase: 'openings',
                estimatedPromptTokens: 120,
                estimatedCompletionTokens: 75,
                cumulativeEstimatedTokens: 195,
                costPer1kTokensUsd: 0.002,
                estimatedCostUsd: 0.00039,
            }),
        ),
    );
});

test('assertEventPayload: analytics_event poll_started valid', () => {
    assert.doesNotThrow(() =>
        assertEventPayload(
            makeEvent('analytics_event', {
                name: 'poll_started',
                pollType: 'verdict',
                phase: 'verdict_vote',
            }),
        ),
    );
});

test('assertEventPayload: analytics_event vote_completed valid', () => {
    assert.doesNotThrow(() =>
        assertEventPayload(
            makeEvent('analytics_event', {
                name: 'vote_completed',
                pollType: 'verdict',
                choice: 'guilty',
            }),
        ),
    );
});

test('assertEventPayload: analytics_event poll_closed valid', () => {
    assert.doesNotThrow(() =>
        assertEventPayload(
            makeEvent('analytics_event', {
                name: 'poll_closed',
                pollType: 'verdict',
                phase: 'sentence_vote',
            }),
        ),
    );
});

test('assertEventPayload: moderation_action valid', () => {
    assert.doesNotThrow(() =>
        assertEventPayload(
            makeEvent('moderation_action', {
                turnId: 't1',
                speaker: 'gumshoe',
                reasons: ['hate_speech'],
                phase: 'openings',
            }),
        ),
    );
});

test('assertEventPayload: vote_spam_blocked valid', () => {
    assert.doesNotThrow(() =>
        assertEventPayload(
            makeEvent('vote_spam_blocked', {
                ip: '127.0.0.1',
                voteType: 'verdict',
            }),
        ),
    );
});

test('assertEventPayload: session_completed valid', () => {
    assert.doesNotThrow(() =>
        assertEventPayload(
            makeEvent('session_completed', {
                sessionId: 'abc',
                completedAt: new Date().toISOString(),
            }),
        ),
    );
});

test('assertEventPayload: session_failed valid', () => {
    assert.doesNotThrow(() =>
        assertEventPayload(
            makeEvent('session_failed', {
                sessionId: 'abc',
                reason: 'LLM timeout',
                completedAt: new Date().toISOString(),
            }),
        ),
    );
});

// ---------------------------------------------------------------------------
// Invalid payload tests
// ---------------------------------------------------------------------------

test('assertEventPayload: session_created missing sessionId', () => {
    assert.throws(
        () => assertEventPayload(makeEvent('session_created', {})),
        TypeError,
    );
});

test('assertEventPayload: session_started missing startedAt', () => {
    assert.throws(
        () =>
            assertEventPayload(
                makeEvent('session_started', { sessionId: 'abc' }),
            ),
        TypeError,
    );
});

test('assertEventPayload: phase_changed missing phase', () => {
    assert.throws(
        () =>
            assertEventPayload(
                makeEvent('phase_changed', {
                    phaseStartedAt: new Date().toISOString(),
                }),
            ),
        TypeError,
    );
});

test('assertEventPayload: turn missing turn object', () => {
    assert.throws(
        () => assertEventPayload(makeEvent('turn', { turn: 'not-an-object' })),
        TypeError,
    );
});

test('assertEventPayload: turn rejects array as turn value', () => {
    assert.throws(
        () => assertEventPayload(makeEvent('turn', { turn: [] })),
        TypeError,
    );
});

test('assertEventPayload: vote_updated missing verdictVotes', () => {
    assert.throws(
        () =>
            assertEventPayload(
                makeEvent('vote_updated', {
                    voteType: 'verdict',
                    choice: 'guilty',
                    sentenceVotes: {},
                }),
            ),
        TypeError,
    );
});

test('assertEventPayload: vote_closed missing votes', () => {
    assert.throws(
        () =>
            assertEventPayload(
                makeEvent('vote_closed', {
                    pollType: 'verdict',
                    closedAt: new Date().toISOString(),
                    nextPhase: 'sentence_vote',
                }),
            ),
        TypeError,
    );
});

test('assertEventPayload: witness_response_capped missing turnId', () => {
    assert.throws(
        () =>
            assertEventPayload(
                makeEvent('witness_response_capped', {
                    speaker: 'phoenix',
                    phase: 'witness_exam',
                    originalLength: 180,
                    truncatedLength: 120,
                    reason: 'tokens',
                }),
            ),
        TypeError,
    );
});

test('assertEventPayload: judge_recap_emitted missing cycleNumber', () => {
    assert.throws(
        () =>
            assertEventPayload(
                makeEvent('judge_recap_emitted', {
                    turnId: 'turn-2',
                    phase: 'witness_exam',
                }),
            ),
        TypeError,
    );
});

test('assertEventPayload: token_budget_applied missing roleMaxTokens', () => {
    assert.throws(
        () =>
            assertEventPayload(
                makeEvent('token_budget_applied', {
                    turnId: 'turn-3',
                    speaker: 'phoenix',
                    role: 'judge',
                    phase: 'openings',
                    requestedMaxTokens: 260,
                    appliedMaxTokens: 180,
                    source: 'env_role_cap',
                }),
            ),
        TypeError,
    );
});

test('assertEventPayload: session_token_estimate missing estimatedCostUsd', () => {
    assert.throws(
        () =>
            assertEventPayload(
                makeEvent('session_token_estimate', {
                    turnId: 'turn-4',
                    role: 'judge',
                    phase: 'openings',
                    estimatedPromptTokens: 120,
                    estimatedCompletionTokens: 75,
                    cumulativeEstimatedTokens: 195,
                    costPer1kTokensUsd: 0.002,
                }),
            ),
        TypeError,
    );
});

test('assertEventPayload: analytics_event missing pollType', () => {
    assert.throws(
        () =>
            assertEventPayload(
                makeEvent('analytics_event', { name: 'poll_started' }),
            ),
        TypeError,
    );
});

test('assertEventPayload: moderation_action missing reasons array', () => {
    assert.throws(
        () =>
            assertEventPayload(
                makeEvent('moderation_action', {
                    turnId: 't1',
                    speaker: 'gumshoe',
                    phase: 'openings',
                }),
            ),
        TypeError,
    );
});

test('assertEventPayload: vote_spam_blocked missing ip', () => {
    assert.throws(
        () =>
            assertEventPayload(
                makeEvent('vote_spam_blocked', { voteType: 'verdict' }),
            ),
        TypeError,
    );
});

test('assertEventPayload: session_completed missing completedAt', () => {
    assert.throws(
        () =>
            assertEventPayload(
                makeEvent('session_completed', { sessionId: 'abc' }),
            ),
        TypeError,
    );
});

test('assertEventPayload: session_failed missing reason', () => {
    assert.throws(
        () =>
            assertEventPayload(
                makeEvent('session_failed', {
                    sessionId: 'abc',
                    completedAt: new Date().toISOString(),
                }),
            ),
        TypeError,
    );
});

// ---------------------------------------------------------------------------
// Phase 7: render_directive
// ---------------------------------------------------------------------------

test('assertEventPayload: render_directive valid', () => {
    assert.doesNotThrow(() =>
        assertEventPayload(
            makeEvent('render_directive', {
                directive: { camera: 'judge', effect: 'objection' },
                phase: 'witness_exam',
                emittedAt: new Date().toISOString(),
            }),
        ),
    );
});

test('assertEventPayload: render_directive missing directive object', () => {
    assert.throws(
        () =>
            assertEventPayload(
                makeEvent('render_directive', {
                    phase: 'openings',
                    emittedAt: new Date().toISOString(),
                }),
            ),
        TypeError,
    );
});

// ---------------------------------------------------------------------------
// Phase 7: witness_statement
// ---------------------------------------------------------------------------

test('assertEventPayload: witness_statement valid', () => {
    assert.doesNotThrow(() =>
        assertEventPayload(
            makeEvent('witness_statement', {
                statement: {
                    witnessRole: 'witness_1',
                    agentId: 'phoenix',
                    statementText: 'I saw it happen.',
                    issuedAt: new Date().toISOString(),
                },
                phase: 'witness_exam',
                emittedAt: new Date().toISOString(),
            }),
        ),
    );
});

test('assertEventPayload: witness_statement missing statement', () => {
    assert.throws(
        () =>
            assertEventPayload(
                makeEvent('witness_statement', {
                    phase: 'witness_exam',
                    emittedAt: new Date().toISOString(),
                }),
            ),
        TypeError,
    );
});

// ---------------------------------------------------------------------------
// Phase 7: case_file_generated
// ---------------------------------------------------------------------------

test('assertEventPayload: case_file_generated valid', () => {
    assert.doesNotThrow(() =>
        assertEventPayload(
            makeEvent('case_file_generated', {
                caseFile: {
                    title: 'Test Case',
                    genre: 'absurd_civil',
                    caseType: 'civil',
                    synopsis: 'A test case',
                    charges: [],
                    witnesses: [],
                    evidence: [],
                    sentenceOptions: ['warning'],
                },
                sessionId: 'sess-1',
                generatedAt: new Date().toISOString(),
            }),
        ),
    );
});

test('assertEventPayload: case_file_generated missing caseFile', () => {
    assert.throws(
        () =>
            assertEventPayload(
                makeEvent('case_file_generated', {
                    sessionId: 'sess-1',
                    generatedAt: new Date().toISOString(),
                }),
            ),
        TypeError,
    );
});

// ---------------------------------------------------------------------------
// Twitch social events
// ---------------------------------------------------------------------------

test('assertEventPayload: twitch_social_updated accepts redacted social only', () => {
    assert.doesNotThrow(() =>
        assertEventPayload(
            makeEvent('twitch_social_updated', {
                social: {
                    latestFollower: {
                        displayName: 'NewFan',
                        followedAt: new Date().toISOString(),
                    },
                },
            }),
        ),
    );
});

test('assertEventPayload: twitch_social_updated missing social', () => {
    assert.throws(
        () => assertEventPayload(makeEvent('twitch_social_updated', {})),
        TypeError,
    );
});
