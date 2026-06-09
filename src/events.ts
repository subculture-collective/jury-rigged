/**
 * Typed payload interfaces for every CourtEvent type.
 *
 * Each interface represents the *required* fields for that event's payload.
 * Use `assertEventPayload` to validate a raw `CourtEvent` at runtime.
 */

import type {
    AdminTriggerKind,
    CourtEvent,
    CourtPhase,
    RenderDirective,
    CaseFile,
    WitnessStatement,
} from './types.js';

// ---------------------------------------------------------------------------
// Payload interfaces
// ---------------------------------------------------------------------------

export interface SessionCreatedPayload {
    sessionId: string;
}

export interface SessionStartedPayload {
    sessionId: string;
    startedAt: string; // ISO 8601
}

export interface PhaseChangedPayload {
    phase: CourtPhase;
    phaseStartedAt: string; // ISO 8601
    phaseDurationMs?: number;
}

export interface TurnPayload {
    turn: {
        id: string;
        sessionId: string;
        turnNumber: number;
        speaker: string;
        role: string;
        phase: CourtPhase;
        dialogue: string;
        createdAt: string;
    };
    render?: {
        sfx?: string[];
        fx?: Array<{
            type: 'flash' | 'shake' | 'freeze' | 'hit_stop';
            params?: Record<string, any>;
        }>;
        stinger?: string;
    };
}

export interface VoteUpdatedPayload {
    voteType: 'verdict' | 'sentence';
    choice: string;
    verdictVotes: Record<string, number>;
    sentenceVotes: Record<string, number>;
}

export interface VoteClosedPayload {
    pollType: 'verdict' | 'sentence';
    closedAt: string; // ISO 8601
    votes: Record<string, number>;
    nextPhase: CourtPhase;
}

export interface PressVoteUpdatedPayload {
    statementNumber: number;
    pressVotes: Record<number, number>;
    phase: CourtPhase;
}

export interface PresentVoteUpdatedPayload {
    evidenceId: string;
    presentVotes: Record<string, number>;
    phase: CourtPhase;
}

export interface WitnessResponseCappedPayload {
    turnId: string;
    speaker: string;
    phase: CourtPhase;
    originalLength: number;
    truncatedLength: number;
    reason: 'tokens' | 'seconds';
}

export interface JudgeRecapEmittedPayload {
    turnId: string;
    phase: CourtPhase;
    cycleNumber: number;
}

export interface TokenBudgetAppliedPayload {
    turnId: string;
    speaker: string;
    role: string;
    phase: CourtPhase;
    requestedMaxTokens: number;
    appliedMaxTokens: number;
    roleMaxTokens: number;
    source: 'env_role_cap' | 'requested';
}

export interface SessionTokenEstimatePayload {
    turnId: string;
    role: string;
    phase: CourtPhase;
    estimatedPromptTokens: number;
    estimatedCompletionTokens: number;
    cumulativeEstimatedTokens: number;
    costPer1kTokensUsd: number;
    estimatedCostUsd: number;
}

export type AnalyticsEventName =
    | 'poll_started'
    | 'vote_completed'
    | 'poll_closed';

export interface AnalyticsEventPayload {
    name: AnalyticsEventName;
    pollType: 'verdict' | 'sentence';
    phase?: CourtPhase;
    choice?: string;
}

export interface ModerationActionPayload {
    turnId: string;
    speaker: string;
    reasons: string[];
    phase: CourtPhase;
}

export interface VoteSpamBlockedPayload {
    ip: string;
    voteType: 'verdict' | 'sentence';
    reason?: string;
    retryAfterMs?: number;
}

export interface SessionCompletedPayload {
    sessionId: string;
    completedAt: string; // ISO 8601
}

export interface SessionFailedPayload {
    sessionId: string;
    reason: string;
    completedAt: string; // ISO 8601
}

// Phase 3 payload interfaces

export interface BroadcastHookTriggeredPayload {
    hookType: 'phase_stinger' | 'scene_switch' | 'moderation_alert';
    phase?: string;
    sceneName?: string;
    triggeredAt: string; // ISO 8601
}

export interface BroadcastHookFailedPayload {
    hookType: 'phase_stinger' | 'scene_switch' | 'moderation_alert';
    error: string;
    phase?: string;
    failedAt: string; // ISO 8601
}

export interface EvidenceRevealedPayload {
    evidenceId: string;
    evidenceText: string;
    phase: string;
    revealedAt: string; // ISO 8601
}

export interface ObjectionCountChangedPayload {
    count: number;
    phase: string;
    changedAt: string; // ISO 8601
}

// Phase 7 payload interfaces

export interface RenderDirectivePayload {
    directive: RenderDirective;
    turnId?: string;
    phase: string;
    emittedAt: string; // ISO 8601
}

export interface WitnessStatementPayload {
    statement: WitnessStatement;
    phase: string;
    emittedAt: string; // ISO 8601
}

export interface CaseFileGeneratedPayload {
    caseFile: CaseFile;
    sessionId: string;
    generatedAt: string; // ISO 8601
}

export interface AdminTriggerPayload {
    sessionId: string;
    kind: AdminTriggerKind;
    title: string;
    message: string;
    emittedAt: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Shape guard
// ---------------------------------------------------------------------------

function hasStringKeys(
    payload: Record<string, unknown>,
    keys: string[],
): boolean {
    return keys.every(k => typeof payload[k] === 'string');
}

function hasObjectKey(payload: Record<string, unknown>, key: string): boolean {
    return (
        payload[key] !== null &&
        typeof payload[key] === 'object' &&
        !Array.isArray(payload[key])
    );
}

/**
 * Asserts that `event.payload` contains the required fields for the given
 * event type.  Throws a `TypeError` with a descriptive message on failure.
 */
export function assertEventPayload(event: CourtEvent): void {
    const { type, payload } = event;

    switch (type) {
        case 'session_created':
            if (typeof payload['sessionId'] !== 'string') {
                throw new TypeError(
                    `session_created payload missing required string field: sessionId`,
                );
            }
            break;

        case 'session_started':
            if (!hasStringKeys(payload, ['sessionId', 'startedAt'])) {
                throw new TypeError(
                    `session_started payload missing required string fields: sessionId, startedAt`,
                );
            }
            break;

        case 'phase_changed':
            if (!hasStringKeys(payload, ['phase', 'phaseStartedAt'])) {
                throw new TypeError(
                    `phase_changed payload missing required string fields: phase, phaseStartedAt`,
                );
            }
            break;

        case 'turn':
            if (!hasObjectKey(payload, 'turn')) {
                throw new TypeError(
                    `turn payload missing required object field: turn`,
                );
            }
            break;

        case 'vote_updated':
            if (
                !hasStringKeys(payload, ['voteType', 'choice']) ||
                !hasObjectKey(payload, 'verdictVotes') ||
                !hasObjectKey(payload, 'sentenceVotes')
            ) {
                throw new TypeError(
                    `vote_updated payload missing required fields: voteType, choice, verdictVotes, sentenceVotes`,
                );
            }
            break;

        case 'press_vote_updated':
            if (
                !hasStringKeys(payload, ['phase']) ||
                typeof payload['statementNumber'] !== 'number' ||
                !hasObjectKey(payload, 'pressVotes')
            ) {
                throw new TypeError(
                    `press_vote_updated payload missing required fields: statementNumber (number), pressVotes (object), phase`,
                );
            }
            break;

        case 'present_vote_updated':
            if (
                !hasStringKeys(payload, ['phase', 'evidenceId']) ||
                !hasObjectKey(payload, 'presentVotes')
            ) {
                throw new TypeError(
                    `present_vote_updated payload missing required fields: evidenceId, presentVotes (object), phase`,
                );
            }
            break;

        case 'vote_closed':
            if (
                !hasStringKeys(payload, [
                    'pollType',
                    'closedAt',
                    'nextPhase',
                ]) ||
                !hasObjectKey(payload, 'votes')
            ) {
                throw new TypeError(
                    `vote_closed payload missing required fields: pollType, closedAt, votes, nextPhase`,
                );
            }
            break;

        case 'witness_response_capped':
            if (
                !hasStringKeys(payload, [
                    'turnId',
                    'speaker',
                    'phase',
                    'reason',
                ]) ||
                typeof payload['originalLength'] !== 'number' ||
                typeof payload['truncatedLength'] !== 'number'
            ) {
                throw new TypeError(
                    `witness_response_capped payload missing required fields: turnId, speaker, phase, originalLength, truncatedLength, reason`,
                );
            }
            break;

        case 'judge_recap_emitted':
            if (
                !hasStringKeys(payload, ['turnId', 'phase']) ||
                typeof payload['cycleNumber'] !== 'number'
            ) {
                throw new TypeError(
                    `judge_recap_emitted payload missing required fields: turnId, phase, cycleNumber`,
                );
            }
            break;

        case 'token_budget_applied':
            if (
                !hasStringKeys(payload, [
                    'turnId',
                    'speaker',
                    'role',
                    'phase',
                    'source',
                ]) ||
                typeof payload['requestedMaxTokens'] !== 'number' ||
                typeof payload['appliedMaxTokens'] !== 'number' ||
                typeof payload['roleMaxTokens'] !== 'number'
            ) {
                throw new TypeError(
                    `token_budget_applied payload missing required fields: turnId, speaker, role, phase, requestedMaxTokens, appliedMaxTokens, roleMaxTokens, source`,
                );
            }
            break;

        case 'session_token_estimate':
            if (
                !hasStringKeys(payload, ['turnId', 'role', 'phase']) ||
                typeof payload['estimatedPromptTokens'] !== 'number' ||
                typeof payload['estimatedCompletionTokens'] !== 'number' ||
                typeof payload['cumulativeEstimatedTokens'] !== 'number' ||
                typeof payload['costPer1kTokensUsd'] !== 'number' ||
                typeof payload['estimatedCostUsd'] !== 'number'
            ) {
                throw new TypeError(
                    `session_token_estimate payload missing required fields: turnId, role, phase, estimatedPromptTokens, estimatedCompletionTokens, cumulativeEstimatedTokens, costPer1kTokensUsd, estimatedCostUsd`,
                );
            }
            break;

        case 'analytics_event':
            if (!hasStringKeys(payload, ['name', 'pollType'])) {
                throw new TypeError(
                    `analytics_event payload missing required string fields: name, pollType`,
                );
            }
            break;

        case 'moderation_action':
            if (
                !hasStringKeys(payload, ['turnId', 'speaker', 'phase']) ||
                !Array.isArray(payload['reasons'])
            ) {
                throw new TypeError(
                    `moderation_action payload missing required fields: turnId, speaker, reasons, phase`,
                );
            }
            break;

        case 'vote_spam_blocked':
            if (!hasStringKeys(payload, ['ip', 'voteType'])) {
                throw new TypeError(
                    `vote_spam_blocked payload missing required string fields: ip, voteType`,
                );
            }
            break;

        case 'session_completed':
            if (!hasStringKeys(payload, ['sessionId', 'completedAt'])) {
                throw new TypeError(
                    `session_completed payload missing required string fields: sessionId, completedAt`,
                );
            }
            break;

        case 'session_failed':
            if (
                !hasStringKeys(payload, ['sessionId', 'reason', 'completedAt'])
            ) {
                throw new TypeError(
                    `session_failed payload missing required string fields: sessionId, reason, completedAt`,
                );
            }
            break;

        case 'broadcast_hook_triggered':
            if (!hasStringKeys(payload, ['hookType', 'triggeredAt'])) {
                throw new TypeError(
                    `broadcast_hook_triggered payload missing required string fields: hookType, triggeredAt`,
                );
            }
            break;

        case 'broadcast_hook_failed':
            if (!hasStringKeys(payload, ['hookType', 'error', 'failedAt'])) {
                throw new TypeError(
                    `broadcast_hook_failed payload missing required string fields: hookType, error, failedAt`,
                );
            }
            break;

        case 'evidence_revealed':
            if (
                !hasStringKeys(payload, [
                    'evidenceId',
                    'evidenceText',
                    'phase',
                    'revealedAt',
                ])
            ) {
                throw new TypeError(
                    `evidence_revealed payload missing required string fields: evidenceId, evidenceText, phase, revealedAt`,
                );
            }
            break;

        case 'objection_count_changed':
            if (
                !hasStringKeys(payload, ['phase', 'changedAt']) ||
                typeof payload['count'] !== 'number'
            ) {
                throw new TypeError(
                    `objection_count_changed payload missing required fields: count (number), phase, changedAt`,
                );
            }
            break;

        case 'twitch_social_updated':
            if (!hasObjectKey(payload, 'social')) {
                throw new TypeError(
                    `twitch_social_updated payload missing required object field: social`,
                );
            }
            break;

        // Phase 7 event types
        case 'render_directive':
            if (
                !hasObjectKey(payload, 'directive') ||
                !hasStringKeys(payload, ['phase', 'emittedAt'])
            ) {
                throw new TypeError(
                    `render_directive payload missing required fields: directive (object), phase, emittedAt`,
                );
            }
            break;

        case 'witness_statement':
            if (
                !hasObjectKey(payload, 'statement') ||
                !hasStringKeys(payload, ['phase', 'emittedAt'])
            ) {
                throw new TypeError(
                    `witness_statement payload missing required fields: statement (object), phase, emittedAt`,
                );
            }
            break;

        case 'case_file_generated':
            if (
                !hasObjectKey(payload, 'caseFile') ||
                !hasStringKeys(payload, ['sessionId', 'generatedAt'])
            ) {
                throw new TypeError(
                    `case_file_generated payload missing required fields: caseFile (object), sessionId, generatedAt`,
                );
            }
            break;

        case 'admin_trigger':
            if (
                !hasStringKeys(payload, [
                    'sessionId',
                    'kind',
                    'title',
                    'message',
                    'emittedAt',
                ])
            ) {
                throw new TypeError(
                    `admin_trigger payload missing required string fields: sessionId, kind, title, message, emittedAt`,
                );
            }
            break;

        default: {
            const _exhaustive: never = type;
            throw new TypeError(`Unknown event type: ${String(_exhaustive)}`);
        }
    }
}
