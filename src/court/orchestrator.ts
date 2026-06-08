import { AGENTS } from '../agents.js';
import { llmGenerateDetailed, sanitizeDialogue } from '../llm/client.js';
import type { LLMAuditLogStore } from '../llm/audit-log-store.js';
import { logger } from '../logger.js';
import { moderateContent } from '../moderation/content-filter.js';
import { createTTSAdapterFromEnv, type TTSAdapter } from '../tts/adapter.js';
import {
    createBroadcastAdapterFromEnv,
    safeBroadcastHook,
    type BroadcastAdapter,
} from '../broadcast/adapter.js';
import {
    createTwitchAdapter,
    wireTwitchToSession,
    type TwitchAdapter,
} from '../twitch/adapter.js';
import {
    applyWitnessCap,
    estimateTokens,
    resolveWitnessCapConfig,
} from './witness-caps.js';
import type { WitnessCapConfig } from './witness-caps.js';
import {
    applyRoleTokenBudget,
    resolveRoleTokenBudgetConfig,
    type RoleTokenBudgetConfig,
} from './token-budget.js';
import type {
    AgentId,
    CaseType,
    CourtPhase,
    CourtRole,
    CourtSession,
    CourtTurn,
    RenderDirective,
    CameraPreset,
    CaseFile,
    WitnessStatement,
} from '../types.js';
import type { CourtSessionStore } from '../store/session-store.js';
import { buildCourtSystemPrompt } from './personas.js';
import {
    createSafelySpeak,
    createTokenSampleRecorder,
    resolveRecapCadence,
    runCasePromptPhase,
    runClosingsPhase,
    runFinalRulingPhase,
    runOpeningsPhase,
    runSentenceVotePhase,
    runVerdictVotePhase,
    runWitnessExamPhase,
    type GenerateBudgetedTurn,
    type TokenSample,
    type SessionRuntimeContext,
} from './phases/session-flow.js';

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function recentHistory(turns: CourtTurn[], limit = 8): string {
    const selected = turns.slice(-limit);
    return selected
        .map(
            turn =>
                `${AGENTS[turn.speaker]?.displayName ?? turn.speaker} (${turn.role}): ${turn.dialogue}`,
        )
        .join('\n');
}

const MODERATION_REDIRECT_DIALOGUE =
    'The court will strike that from the record. Please keep testimony appropriate and on topic.';

const broadcastBySession = new Map<string, BroadcastAdapter>();

export class FallbackCircuitOpenError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FallbackCircuitOpenError';
    }
}

// ---------------------------------------------------------------------------
// Phase 7: Render directive inference (#70)
// ---------------------------------------------------------------------------

const ROLE_CAMERA_MAP: Record<CourtRole, CameraPreset> = {
    judge: 'judge',
    prosecutor: 'prosecution',
    defense: 'defense',
    witness_1: 'witness',
    witness_2: 'witness',
    witness_3: 'witness',
    bailiff: 'wide',
};

function inferRenderDirective(
    role: CourtRole,
    phase: CourtPhase,
    dialogue: string,
): RenderDirective {
    const directive: RenderDirective = {
        camera: ROLE_CAMERA_MAP[role] ?? 'wide',
        poses: { [role]: 'talk' } as RenderDirective['poses'],
    };

    // Detect exclamatory dialogue for effects (match with or without trailing !)
    const upper = dialogue.toUpperCase();
    if (/\bOBJECTION[!.]?/.test(upper)) {
        directive.effect = 'objection';
        directive.poses = { [role]: 'point' } as RenderDirective['poses'];
    } else if (/\bHOLD IT[!.]?/.test(upper)) {
        directive.effect = 'hold_it';
        directive.poses = { [role]: 'slam' } as RenderDirective['poses'];
    } else if (/\bTAKE THAT[!.]?/.test(upper)) {
        directive.effect = 'take_that';
        directive.poses = { [role]: 'point' } as RenderDirective['poses'];
    }

    // Phase-specific camera overrides
    if (phase === 'verdict_vote' || phase === 'final_ruling') {
        directive.camera = 'verdict';
    } else if (phase === 'evidence_reveal') {
        directive.camera = 'evidence';
    }

    return directive;
}

function emitRenderDirective(
    store: CourtSessionStore,
    session: CourtSession,
    directive: RenderDirective,
    turnId?: string,
): void {
    session.metadata.lastRenderDirective = directive;
    store
        .patchMetadata(session.id, { lastRenderDirective: directive })
        // eslint-disable-next-line no-console
        .catch(err =>
            console.error(
                '[orchestrator] patchMetadata render_directive failed',
                err,
            ),
        );
    store.emitEvent(session.id, 'render_directive', {
        directive,
        turnId,
        phase: session.phase,
        emittedAt: new Date().toISOString(),
    });
}

type BudgetResolution = {
    requestedMaxTokens: number;
    appliedMaxTokens: number;
    roleMaxTokens: number;
    source: 'env_role_cap' | 'requested';
};

function resolveBudgetResolution(input: {
    role: CourtRole;
    maxTokens?: number;
    roleBudgetConfig?: RoleTokenBudgetConfig;
    auditLogStore?: LLMAuditLogStore;
}): BudgetResolution {
    if (input.roleBudgetConfig) {
        return applyRoleTokenBudget(
            input.role,
            input.maxTokens,
            input.roleBudgetConfig,
        );
    }

    const fallbackMaxTokens = input.maxTokens ?? 260;
    return {
        requestedMaxTokens: fallbackMaxTokens,
        appliedMaxTokens: fallbackMaxTokens,
        roleMaxTokens: fallbackMaxTokens,
        source: 'requested',
    };
}

function appendTurnToSession(session: CourtSession, turn: CourtTurn): void {
    session.turns.push(turn);
    session.turnCount += 1;
}

async function handleFlaggedModeration(input: {
    store: CourtSessionStore;
    session: CourtSession;
    speaker: AgentId;
    moderationReasons: string[];
    activeBroadcast?: BroadcastAdapter;
}): Promise<void> {
    logger.warn(
        `[moderation] content flagged session=${input.session.id} speaker=${input.speaker} reasons=${input.moderationReasons.join(',')}`,
    );

    const currentCount = input.session.metadata.objectionCount || 0;
    const newCount = currentCount + 1;
    input.session.metadata.objectionCount = newCount;

    input.store.emitEvent(input.session.id, 'objection_count_changed', {
        count: newCount,
        phase: input.session.phase,
        changedAt: new Date().toISOString(),
    });

    if (input.activeBroadcast) {
        const activeBroadcast = input.activeBroadcast;
        await safeBroadcastHook(
            'moderation_alert',
            () =>
                activeBroadcast.triggerModerationAlert({
                    reason: input.moderationReasons[0] ?? 'unknown',
                    phase: input.session.phase,
                    sessionId: input.session.id,
                }),
            (type, payload) =>
                input.store.emitEvent(input.session.id, type, {
                    phase: input.session.phase,
                    ...payload,
                }),
        );
    }
}

async function addJudgeModerationRedirect(input: {
    store: CourtSessionStore;
    session: CourtSession;
}): Promise<void> {
    const judgeId = input.session.metadata.roleAssignments.judge;
    const judgeTurn = await input.store.addTurn({
        sessionId: input.session.id,
        speaker: judgeId,
        role: 'judge',
        phase: input.session.phase,
        dialogue: MODERATION_REDIRECT_DIALOGUE,
    });

    appendTurnToSession(input.session, judgeTurn);
}

async function generateTurn(input: {
    store: CourtSessionStore;
    session: CourtSession;
    speaker: AgentId;
    role: CourtRole;
    userInstruction: string;
    maxTokens?: number;
    capConfig?: WitnessCapConfig;
    dialoguePrefix?: string;
    broadcast?: BroadcastAdapter;
    roleBudgetConfig?: RoleTokenBudgetConfig;
    onTokenSample?: (sample: {
        turnId: string;
        role: CourtRole;
        phase: CourtPhase;
        promptTokens: number;
        completionTokens: number;
    }) => void;
    auditLogStore?: LLMAuditLogStore;
    onLlmFallback?: RunCourtSessionOptions['onLlmFallback'];
    onLlmSuccess?: RunCourtSessionOptions['onLlmSuccess'];
}): Promise<CourtTurn> {
    const { store, session, speaker, role, userInstruction } = input;

    const systemPrompt = await buildCourtSystemPrompt({
        agentId: speaker,
        role,
        topic: session.topic,
        caseType: session.metadata.caseType,
        phase: session.phase,
        history: recentHistory(session.turns),
        genre: session.metadata.currentGenre, // Phase 3: Pass genre for prompt variations
    });

    const budgetResolution = resolveBudgetResolution({
        role: input.role,
        maxTokens: input.maxTokens,
        roleBudgetConfig: input.roleBudgetConfig,
    });

    const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: userInstruction },
    ];
    const llmResult = await llmGenerateDetailed({
        messages,
        temperature: session.phase === 'witness_exam' ? 0.8 : 0.7,
        maxTokens: budgetResolution.appliedMaxTokens,
    });
    if (llmResult.status === 'fallback' || llmResult.status === 'mock') {
        await input.onLlmFallback?.({
            sessionId: session.id,
            status: llmResult.status,
            provider: llmResult.provider,
            model: llmResult.model,
        });
    } else {
        input.onLlmSuccess?.({ sessionId: session.id });
    }
    const raw = llmResult.text;

    let dialogue = sanitizeDialogue(raw);
    const capResult =
        input.capConfig ? applyWitnessCap(dialogue, input.capConfig) : null;
    if (capResult?.capped) {
        dialogue = capResult.text;
    }

    if (input.dialoguePrefix) {
        dialogue = `${input.dialoguePrefix} ${dialogue}`.trim();
    }

    const moderation = moderateContent(dialogue);
    const activeBroadcast =
        input.broadcast ?? broadcastBySession.get(session.id);

    if (moderation.flagged) {
        await handleFlaggedModeration({
            store,
            session,
            speaker,
            moderationReasons: moderation.reasons,
            activeBroadcast,
        });
    }

    const turn = await input.store.addTurn({
        sessionId: session.id,
        speaker,
        role,
        phase: session.phase,
        dialogue: moderation.sanitized,
        moderationResult:
            moderation.flagged ?
                { flagged: true, reasons: moderation.reasons }
            :   undefined,
    });

    appendTurnToSession(session, turn);

    void input.auditLogStore?.append({
        sessionId: session.id,
        turnId: turn.id,
        phase: session.phase,
        speaker,
        role,
        source: 'main_turn',
        provider: llmResult.provider,
        model: llmResult.model,
        status: llmResult.status,
        messages,
        rawResponse: raw,
        sanitizedResponse: moderation.sanitized,
        latencyMs: llmResult.latencyMs,
        errorCode: llmResult.errors.length ? 'MODEL_RETRY_OR_FALLBACK' : undefined,
        errorMessage: llmResult.errors.join('\n') || undefined,
    });

    // Phase 7: Infer and emit render directive for this turn
    const renderDirective = inferRenderDirective(
        role,
        session.phase,
        moderation.sanitized,
    );
    emitRenderDirective(store, session, renderDirective, turn.id);

    // Phase 7: Emit witness statement if applicable
    emitWitnessStatement(store, session, turn);

    store.emitEvent(session.id, 'token_budget_applied', {
        turnId: turn.id,
        speaker,
        role,
        phase: session.phase,
        requestedMaxTokens: budgetResolution.requestedMaxTokens,
        appliedMaxTokens: budgetResolution.appliedMaxTokens,
        roleMaxTokens: budgetResolution.roleMaxTokens,
        source: budgetResolution.source,
    });

    input.onTokenSample?.({
        turnId: turn.id,
        role,
        phase: session.phase,
        promptTokens:
            estimateTokens(systemPrompt) + estimateTokens(userInstruction),
        completionTokens: estimateTokens(moderation.sanitized),
    });

    if (moderation.flagged && role !== 'judge') {
        await addJudgeModerationRedirect({
            store,
            session,
        });
    }

    if (capResult?.capped && !moderation.flagged) {
        store.emitEvent(session.id, 'witness_response_capped', {
            turnId: turn.id,
            speaker,
            phase: session.phase,
            originalLength: capResult.originalTokens,
            truncatedLength: capResult.truncatedTokens,
            reason: capResult.reason ?? 'tokens',
        });
    }

    return turn;
}

function verdictOptions(caseType: CaseType): string[] {
    return caseType === 'civil' ?
            ['liable', 'not_liable']
        :   ['guilty', 'not_guilty'];
}

export interface RunCourtSessionOptions {
    ttsAdapter?: TTSAdapter;
    sleepFn?: (ms: number) => Promise<void>;
    auditLogStore?: LLMAuditLogStore;
    onLlmFallback?: (event: {
        sessionId: string;
        status: string;
        provider: string;
        model: string;
    }) => Promise<void> | void;
    onLlmSuccess?: (event: { sessionId: string }) => Promise<void> | void;
}

type GenerateTurnInput = Parameters<typeof generateTurn>[0];

function createGenerateBudgetedTurn(input: {
    roleTokenBudgetConfig: RoleTokenBudgetConfig;
    onTokenSample: (sample: TokenSample) => void;
    auditLogStore?: LLMAuditLogStore;
    onLlmFallback?: RunCourtSessionOptions['onLlmFallback'];
    onLlmSuccess?: RunCourtSessionOptions['onLlmSuccess'];
}): GenerateBudgetedTurn {
    return turnInput =>
        generateTurn({
            ...turnInput,
            roleBudgetConfig: input.roleTokenBudgetConfig,
            onTokenSample: input.onTokenSample,
            auditLogStore: input.auditLogStore,
            onLlmFallback: input.onLlmFallback,
            onLlmSuccess: input.onLlmSuccess,
        });
}

// ---------------------------------------------------------------------------
// Phase 7: Structured case file (#67)
// ---------------------------------------------------------------------------

function buildCaseFile(session: CourtSession): CaseFile {
    const meta = session.metadata;
    const assignments = meta.roleAssignments;

    const witnesses: CaseFile['witnesses'] = [];
    for (const wRole of [
        'witness_1',
        'witness_2',
        'witness_3',
    ] as CourtRole[]) {
        const agentId = (assignments as unknown as Record<string, AgentId>)[
            wRole
        ];
        if (agentId) {
            const agent = AGENTS[agentId];
            witnesses.push({
                role: wRole,
                agentId,
                displayName: agent?.displayName ?? agentId,
                bio: agent?.description ?? 'Court witness',
            });
        }
    }

    const evidenceItems: CaseFile['evidence'] = (meta.evidenceCards ?? []).map(
        (card, i) => ({
            id: card.id,
            label: `Evidence ${i + 1}`,
            description: card.text,
            revealPhase: 'evidence_reveal' as CourtPhase,
        }),
    );

    return {
        title: session.topic,
        genre: meta.currentGenre ?? 'absurd_civil',
        caseType: meta.caseType,
        synopsis: session.topic,
        charges:
            meta.caseType === 'criminal' ?
                ['As stated in case prompt']
            :   ['Damages as alleged'],
        witnesses,
        evidence: evidenceItems,
        sentenceOptions: meta.sentenceOptions,
    };
}

function emitCaseFile(store: CourtSessionStore, session: CourtSession): void {
    const caseFile = buildCaseFile(session);
    store
        .patchMetadata(session.id, { caseFile })
        // eslint-disable-next-line no-console
        .catch(err =>
            console.error('[orchestrator] patchMetadata case_file failed', err),
        );
    store.emitEvent(session.id, 'case_file_generated', {
        caseFile,
        sessionId: session.id,
        generatedAt: new Date().toISOString(),
    });
}

// ---------------------------------------------------------------------------
// Phase 7: Witness statement emission (#75)
// ---------------------------------------------------------------------------

function emitWitnessStatement(
    store: CourtSessionStore,
    session: CourtSession,
    turn: CourtTurn,
): void {
    if (!turn.role.startsWith('witness_')) return;

    const statement: WitnessStatement = {
        witnessRole: turn.role,
        agentId: turn.speaker,
        statementText: turn.dialogue,
        issuedAt: new Date().toISOString(),
    };

    const existing = session.metadata.witnessStatements ?? [];
    const witnessStatements = [...existing, statement];
    session.metadata.witnessStatements = witnessStatements;
    store
        .patchMetadata(session.id, { witnessStatements })
        // eslint-disable-next-line no-console
        .catch(err =>
            console.error(
                '[orchestrator] patchMetadata witness_statement failed',
                err,
            ),
        );

    store.emitEvent(session.id, 'witness_statement', {
        statement,
        phase: session.phase,
        emittedAt: new Date().toISOString(),
    });
}

// ---------------------------------------------------------------------------
// Phase 7: Audience action integration (#77)
// ---------------------------------------------------------------------------

/**
 * Get the winning press statement number from audience votes
 * Returns highest-voted statement number or null if no votes
 */
function getWinningPressStatement(
    pressVotes: Record<number, number>,
): number | null {
    const entries = Object.entries(pressVotes);
    if (entries.length === 0) return null;

    const winner = entries.reduce((best, current) => {
        const [stmtNum, voteCount] = current;
        const [bestNum, bestCount] = best;
        return voteCount > bestCount ? current : best;
    });

    return parseInt(winner[0], 10);
}

/**
 * Get the winning evidence ID from audience votes
 * Returns highest-voted evidence ID or null if no votes
 */
function getWinningPresentEvidence(
    presentVotes: Record<string, number>,
): string | null {
    const entries = Object.entries(presentVotes);
    if (entries.length === 0) return null;

    const winner = entries.reduce((best, current) => {
        const [evidenceId, voteCount] = current;
        const [bestId, bestCount] = best;
        return voteCount > bestCount ? current : best;
    });

    return winner[0];
}

/**
 * Check if there's a winning audience action and log it
 * Used as a reference point for future audience-driven orchestration
 */
function checkAudienceActions(session: CourtSession): void {
    if (session.phase !== 'witness_exam') return;

    const winningPress = getWinningPressStatement(session.metadata.pressVotes);
    const winningPresent = getWinningPresentEvidence(
        session.metadata.presentVotes,
    );

    if (winningPress) {
        // eslint-disable-next-line no-console
        console.log(
            `[audience] Press vote winning: statement ${winningPress} in session ${session.id}`,
        );
    }

    if (winningPresent) {
        // eslint-disable-next-line no-console
        console.log(
            `[audience] Present vote winning: evidence ${winningPresent} in session ${session.id}`,
        );
    }
}

/**
 * Clear audience votes for a new phase loop
 * Called when transitioning between witness cycles
 */
function clearAudienceVotes(session: CourtSession): void {
    session.metadata.pressVotes = {};
    session.metadata.presentVotes = {};
}

export async function runCourtSession(
    sessionId: string,
    store: CourtSessionStore,
    options: RunCourtSessionOptions = {},
): Promise<void> {
    const session = await store.startSession(sessionId);
    const tts = options.ttsAdapter ?? createTTSAdapterFromEnv();
    const broadcast = await createBroadcastAdapterFromEnv(); // Phase 3: Initialize broadcast adapter
    broadcastBySession.set(session.id, broadcast);

    // Phase 7: Generate and emit structured case file
    emitCaseFile(store, session);

    // Phase 7: Wire Twitch integration
    const twitchAdapter = createTwitchAdapter();
    void wireTwitchToSession(twitchAdapter, store, session.id);
    const pause = options.sleepFn ?? sleep;
    const witnessCapConfig = resolveWitnessCapConfig();
    const roleTokenBudgetConfig = resolveRoleTokenBudgetConfig();
    const recapCadence = resolveRecapCadence();
    const ttsMetrics = {
        success: 0,
        failure: 0,
    };
    const onTokenSample = createTokenSampleRecorder({
        store,
        sessionId: session.id,
        roleTokenBudgetConfig,
    });
    const generateBudgetedTurn = createGenerateBudgetedTurn({
        roleTokenBudgetConfig,
        onTokenSample,
        auditLogStore: options.auditLogStore,
        onLlmFallback: options.onLlmFallback,
        onLlmSuccess: options.onLlmSuccess,
    });
    const safelySpeak = createSafelySpeak({
        tts,
        sessionId: session.id,
        ttsMetrics,
    });

    const context: SessionRuntimeContext = {
        store,
        session,
        tts,
        broadcast,
        pause,
        safelySpeak,
        generateBudgetedTurn,
        witnessCapConfig,
        recapCadence,
        auditLogStore: options.auditLogStore,
    };

    try {
        await runCasePromptPhase(context);
        await runOpeningsPhase(context);
        await runWitnessExamPhase(context);

        // Phase 3: Evidence reveal phase (currently skipped, placeholder for future implementation)
        // TODO: Implement evidence_reveal phase logic
        // Example of how evidence could be revealed:
        // session.phase = 'evidence_reveal';
        // await store.setPhase(session.id, 'evidence_reveal', 15_000);
        // const evidenceText = await generateEvidenceCard(session, judge);
        // const evidenceId = `evidence_${Date.now()}`;
        // session.metadata.evidenceCards = session.metadata.evidenceCards || [];
        // session.metadata.evidenceCards.push({
        //     id: evidenceId,
        //     text: evidenceText,
        //     revealedAt: new Date().toISOString(),
        // });
        // store.emitEvent(session.id, 'evidence_revealed', {
        //     evidenceId,
        //     evidenceText,
        //     phase: 'evidence_reveal',
        //     revealedAt: new Date().toISOString(),
        // });
        // await pause(800);

        await runClosingsPhase(context);

        const verdictChoices = verdictOptions(session.metadata.caseType);
        await runVerdictVotePhase(context, verdictChoices);
        await runSentenceVotePhase(context);
        await runFinalRulingPhase(context, verdictChoices);
    } catch (error) {
        const message =
            error instanceof Error ?
                error.message
            :   'Unknown orchestration error';
        await store.failSession(session.id, message);
    } finally {
        broadcastBySession.delete(session.id);
        twitchAdapter.disconnect();
        // eslint-disable-next-line no-console
        console.info(
            `[tts] session=${session.id} provider=${tts.provider} success=${ttsMetrics.success} failure=${ttsMetrics.failure}`,
        );
    }
}
