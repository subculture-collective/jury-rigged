import {
    safeBroadcastHook,
    type BroadcastAdapter,
} from '../../broadcast/adapter.js';
import type { TTSAdapter } from '../../tts/adapter.js';
import type {
    AgentId,
    CourtPhase,
    CourtRole,
    CourtSession,
    CourtTurn,
} from '../../types.js';
import type { CourtSessionStore } from '../../store/session-store.js';
import type { LLMAuditLogStore } from '../../llm/audit-log-store.js';
import { estimateCostUsd, type RoleTokenBudgetConfig } from '../token-budget.js';
import { effectiveTokenLimit, type WitnessCapConfig } from '../witness-caps.js';
import { buildWitnessScripts } from './witness-script.js';
import { checkRandomEvent, type RandomEvent, type EventSpeaker } from './random-events.js';
import { handleObjectionRound } from './objections.js';
import { AGENTS } from '../../agents.js';

const PHASE_DURATION_MS = {
    casePrompt: 8_000,
    openings: 30_000,
    witnessExam: 40_000,
    closings: 30_000,
    finalRuling: 20_000,
} as const;

const PAUSE_MS = {
    casePromptAfterCue: 2_000,
    witnessBetweenCycles: 3_000,
    witnessBetweenTurns: 2_500,
    recapLeadIn: 1_500,
} as const;

const DISPLAY_CPM = 200;
const PREFETCH_RATIO = 0.8;

/** Returns how long to pause before starting the next LLM call, based on how long
 * the client will spend displaying the given dialogue at DISPLAY_CPM characters/min.
 * Fires at PREFETCH_RATIO of display time so the response arrives just as the display ends. */
function displayPauseMs(dialogue: string): number {
    return (dialogue.length / DISPLAY_CPM) * 60_000 * PREFETCH_RATIO;
}

const MAX_WITNESS_TURN_TOKENS = 260;
const MAX_WITNESS_ROLE_INDEX = 3;

export type SpeakAction = 'speakCue' | 'speakVerdict' | 'speakRecap';
export type SafelySpeak = (
    action: SpeakAction,
    invoke: () => Promise<void>,
) => Promise<void>;

export type TokenSample = {
    turnId: string;
    role: CourtRole;
    phase: CourtPhase;
    promptTokens: number;
    completionTokens: number;
};

export interface GenerateBudgetedTurnInput {
    store: CourtSessionStore;
    session: CourtSession;
    speaker: AgentId;
    role: CourtRole;
    userInstruction: string;
    maxTokens?: number;
    capConfig?: WitnessCapConfig;
    dialoguePrefix?: string;
    broadcast?: BroadcastAdapter;
}

export type GenerateBudgetedTurn = (
    input: GenerateBudgetedTurnInput,
) => Promise<CourtTurn>;

export interface SessionRuntimeContext {
    store: CourtSessionStore;
    session: CourtSession;
    tts: TTSAdapter;
    broadcast: BroadcastAdapter;
    pause: (ms: number) => Promise<void>;
    safelySpeak: SafelySpeak;
    generateBudgetedTurn: GenerateBudgetedTurn;
    witnessCapConfig: WitnessCapConfig;
    recapCadence: number;
    auditLogStore?: LLMAuditLogStore;
}

function mostVotedChoice(votes: Record<string, number>, fallback: string): string {
    const entries = Object.entries(votes);
    if (entries.length === 0) return fallback;

    const sorted = [...entries].sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] ?? fallback;
}

export function createSafelySpeak(input: {
    tts: TTSAdapter;
    sessionId: string;
    ttsMetrics: { success: number; failure: number };
}): SafelySpeak {
    return async (action, invoke) => {
        const started = Date.now();
        try {
            await invoke();
            input.ttsMetrics.success += 1;
            // eslint-disable-next-line no-console
            console.info(
                `[tts] status=success action=${action} provider=${input.tts.provider} session=${input.sessionId} latencyMs=${Date.now() - started}`,
            );
        } catch (error) {
            input.ttsMetrics.failure += 1;
            const message =
                error instanceof Error ? error.message : 'unknown tts error';
            // eslint-disable-next-line no-console
            console.warn(
                `[tts] status=failure action=${action} provider=${input.tts.provider} session=${input.sessionId} latencyMs=${Date.now() - started} reason=${message}`,
            );
        }
    };
}

export function createTokenSampleRecorder(input: {
    store: CourtSessionStore;
    sessionId: string;
    roleTokenBudgetConfig: RoleTokenBudgetConfig;
}): (sample: TokenSample) => void {
    const tokenEstimate = {
        promptTokens: 0,
        completionTokens: 0,
    };

    return sample => {
        tokenEstimate.promptTokens += sample.promptTokens;
        tokenEstimate.completionTokens += sample.completionTokens;
        const cumulativeEstimatedTokens =
            tokenEstimate.promptTokens + tokenEstimate.completionTokens;

        input.store.emitEvent(input.sessionId, 'session_token_estimate', {
            turnId: sample.turnId,
            role: sample.role,
            phase: sample.phase,
            estimatedPromptTokens: tokenEstimate.promptTokens,
            estimatedCompletionTokens: tokenEstimate.completionTokens,
            cumulativeEstimatedTokens,
            costPer1kTokensUsd: input.roleTokenBudgetConfig.costPer1kTokensUsd,
            estimatedCostUsd: estimateCostUsd(
                cumulativeEstimatedTokens,
                input.roleTokenBudgetConfig.costPer1kTokensUsd,
            ),
        });
    };
}

export function resolveRecapCadence(
    env: NodeJS.ProcessEnv = process.env,
): number {
    const recapCadenceRaw = Number.parseInt(env.JUDGE_RECAP_CADENCE ?? '2', 10);
    return Number.isFinite(recapCadenceRaw) && recapCadenceRaw > 0 ?
            recapCadenceRaw
        :   2;
}

async function emitPhaseStinger(
    context: SessionRuntimeContext,
    phase: CourtPhase,
): Promise<void> {
    await safeBroadcastHook(
        'phase_stinger',
        () =>
            context.broadcast.triggerPhaseStinger({
                phase,
                sessionId: context.session.id,
            }),
        (type, payload) =>
            context.store.emitEvent(context.session.id, type, {
                phase,
                ...payload,
            }),
    );
}

async function emitSceneSwitch(
    context: SessionRuntimeContext,
    phase: 'verdict_vote' | 'sentence_vote',
): Promise<void> {
    await safeBroadcastHook(
        'scene_switch',
        () =>
            context.broadcast.triggerSceneSwitch({
                sceneName: phase,
                phase,
                sessionId: context.session.id,
            }),
        (type, payload) =>
            context.store.emitEvent(context.session.id, type, {
                phase,
                ...payload,
            }),
    );
}

async function beginPhase(
    context: SessionRuntimeContext,
    phase: CourtPhase,
    phaseDurationMs?: number,
): Promise<void> {
    context.session.phase = phase;
    await context.store.setPhase(context.session.id, phase, phaseDurationMs);
}

export async function runCasePromptPhase(
    context: SessionRuntimeContext,
): Promise<void> {
    const { bailiff } = context.session.metadata.roleAssignments;

    await beginPhase(context, 'case_prompt', PHASE_DURATION_MS.casePrompt);
    await emitPhaseStinger(context, 'case_prompt');

    const allRiseCue = `All rise. The JuryRigged court is now in session. Case: ${context.session.topic}`;
    await context.safelySpeak('speakCue', () =>
        context.tts.speakCue({
            sessionId: context.session.id,
            phase: 'case_prompt',
            text: allRiseCue,
        }),
    );

    await context.store.addTurn({
        sessionId: context.session.id,
        speaker: bailiff,
        role: 'bailiff',
        phase: 'case_prompt',
        dialogue: allRiseCue,
    });
    await context.pause(PAUSE_MS.casePromptAfterCue);
}

export async function runOpeningsPhase(
    context: SessionRuntimeContext,
): Promise<void> {
    const { prosecutor, defense } = context.session.metadata.roleAssignments;

    await beginPhase(context, 'openings', PHASE_DURATION_MS.openings);
    await context.safelySpeak('speakCue', () =>
        context.tts.speakCue({
            sessionId: context.session.id,
            phase: 'openings',
            text: 'Opening statements begin now. Prosecution may proceed.',
        }),
    );

    const prosecutorOpening = await context.generateBudgetedTurn({
        store: context.store,
        session: context.session,
        speaker: prosecutor,
        role: 'prosecutor',
        userInstruction:
            'Deliver your opening statement and explain why the court should lean toward conviction/liability.',
    });
    await context.pause(displayPauseMs(prosecutorOpening.dialogue));

    await context.generateBudgetedTurn({
        store: context.store,
        session: context.session,
        speaker: defense,
        role: 'defense',
        userInstruction:
            'Deliver your opening statement and establish reasonable doubt / non-liability.',
    });
}

function shouldJudgeInterrupt(rng: () => number = Math.random, probability = 0.12): boolean {
    return rng() < probability;
}

async function runRandomEvent(
    context: SessionRuntimeContext,
    event: RandomEvent,
    witnessId: AgentId,
    witnessRole: CourtRole,
    prosecutorId: AgentId,
    defenseId: AgentId,
    isDirectExam: boolean,
): Promise<CourtTurn> {
    const speaker: EventSpeaker = event.speaker;
    let agentId: AgentId;
    let role: CourtRole;

    if (speaker === 'witness') {
        agentId = witnessId;
        role = witnessRole;
    } else if (speaker === 'bailiff') {
        agentId = context.session.metadata.roleAssignments.bailiff;
        role = 'bailiff';
    } else if (speaker === 'judge') {
        agentId = context.session.metadata.roleAssignments.judge;
        role = 'judge';
    } else {
        // opposing_counsel: during direct, the defense opposes; during cross, the prosecution opposes
        agentId = isDirectExam ? defenseId : prosecutorId;
        role = isDirectExam ? 'defense' : 'prosecutor';
    }

    return context.generateBudgetedTurn({
        store: context.store,
        session: context.session,
        speaker: agentId,
        role,
        userInstruction: event.userInstruction,
    });
}

export async function runWitnessExamPhase(
    context: SessionRuntimeContext,
): Promise<void> {
    const { judge, prosecutor, defense, witnesses, bailiff } =
        context.session.metadata.roleAssignments;

    await beginPhase(context, 'witness_exam', PHASE_DURATION_MS.witnessExam);
    await context.safelySpeak('speakCue', () =>
        context.tts.speakCue({
            sessionId: context.session.id,
            phase: 'witness_exam',
            text: 'Witness examination begins. The court will hear testimony.',
        }),
    );

    const scripts = buildWitnessScripts(witnesses.length);
    // eslint-disable-next-line no-console
    console.info(
        `[witness-exam] session=${context.session.id} scripts=${JSON.stringify(scripts)}`,
    );

    let witnessIndex = 0;

    for (const witness of witnesses) {
        const script = scripts[witnessIndex]!;
        const witnessRole =
            `witness_${Math.min(witnessIndex + 1, MAX_WITNESS_ROLE_INDEX)}` as CourtRole;
        const witnessConfig = AGENTS[witness];

        // 1. Bailiff introduces witness
        const bailiffTurn = await context.generateBudgetedTurn({
            store: context.store,
            session: context.session,
            speaker: bailiff,
            role: 'bailiff',
            userInstruction: `Call ${witnessConfig.displayName} (${witnessConfig.role}) to the stand. Announce their name and role formally and briefly.`,
        });
        await context.pause(displayPauseMs(bailiffTurn.dialogue));

        // 2. Direct examination
        for (let q = 0; q < script.directRounds; q++) {
            const prosecutorTurn = await context.generateBudgetedTurn({
                store: context.store,
                session: context.session,
                speaker: prosecutor,
                role: 'prosecutor',
                userInstruction: `Ask ${witnessConfig.displayName} a focused question about the core accusation. Direct examination question ${q + 1} of ${script.directRounds}.`,
            });
            await context.pause(displayPauseMs(prosecutorTurn.dialogue));

            const witnessTurn = await context.generateBudgetedTurn({
                store: context.store,
                session: context.session,
                speaker: witness,
                role: witnessRole,
                userInstruction:
                    'Answer the question in 1–3 sentences with one concrete detail. Be truthful — or convincingly not.',
                maxTokens: Math.min(
                    MAX_WITNESS_TURN_TOKENS,
                    effectiveTokenLimit(context.witnessCapConfig).limit ??
                        MAX_WITNESS_TURN_TOKENS,
                ),
                capConfig: context.witnessCapConfig,
            });
            await context.pause(displayPauseMs(witnessTurn.dialogue));

            // Random event check
            const event = checkRandomEvent();
            if (event) {
                const eventTurn = await runRandomEvent(
                    context,
                    event,
                    witness,
                    witnessRole,
                    prosecutor,
                    defense,
                    true,
                );
                await context.pause(displayPauseMs(eventTurn.dialogue));
            }

            // Judge interrupt or objection check — mutually exclusive
            if (shouldJudgeInterrupt()) {
                const judgeInterruptTurn = await context.generateBudgetedTurn({
                    store: context.store,
                    session: context.session,
                    speaker: judge,
                    role: 'judge',
                    userInstruction:
                        'Briefly clarify a procedural point or give a short instruction to the jury. One or two sentences.',
                });
                await context.pause(displayPauseMs(judgeInterruptTurn.dialogue));
            } else {
                await handleObjectionRound({
                    dialogue: prosecutorTurn.dialogue,
                    objectingAgentId: defense,
                    objectingRole: 'defense',
                    judgeAgentId: judge,
                    generateBudgetedTurn: context.generateBudgetedTurn,
                    store: context.store,
                    session: context.session,
                    pause: context.pause,
                    pauseMs: PAUSE_MS.witnessBetweenTurns,
                    auditLogStore: context.auditLogStore,
                });
            }
        }

        // 3. Cross-examination
        for (let q = 0; q < script.crossRounds; q++) {
            const defenseTurn = await context.generateBudgetedTurn({
                store: context.store,
                session: context.session,
                speaker: defense,
                role: 'defense',
                userInstruction: `Cross-examine ${witnessConfig.displayName} with one pointed challenge. Cross question ${q + 1} of ${script.crossRounds}.`,
            });
            await context.pause(displayPauseMs(defenseTurn.dialogue));

            const witnessCrossTurn = await context.generateBudgetedTurn({
                store: context.store,
                session: context.session,
                speaker: witness,
                role: witnessRole,
                userInstruction:
                    'Respond to the cross-examination in 1–3 sentences. You may be evasive, emotional, or suspiciously specific.',
                maxTokens: Math.min(
                    MAX_WITNESS_TURN_TOKENS,
                    effectiveTokenLimit(context.witnessCapConfig).limit ??
                        MAX_WITNESS_TURN_TOKENS,
                ),
                capConfig: context.witnessCapConfig,
            });
            await context.pause(displayPauseMs(witnessCrossTurn.dialogue));

            // Random event check
            const crossEvent = checkRandomEvent();
            if (crossEvent) {
                const crossEventTurn = await runRandomEvent(
                    context,
                    crossEvent,
                    witness,
                    witnessRole,
                    prosecutor,
                    defense,
                    false,
                );
                await context.pause(displayPauseMs(crossEventTurn.dialogue));
            }

            // Judge interrupt or objection check — mutually exclusive
            if (shouldJudgeInterrupt()) {
                const judgeInterruptTurn = await context.generateBudgetedTurn({
                    store: context.store,
                    session: context.session,
                    speaker: judge,
                    role: 'judge',
                    userInstruction:
                        'Briefly clarify a procedural point or give a short instruction to the jury. One or two sentences.',
                });
                await context.pause(displayPauseMs(judgeInterruptTurn.dialogue));
            } else {
                await handleObjectionRound({
                    dialogue: defenseTurn.dialogue,
                    objectingAgentId: prosecutor,
                    objectingRole: 'prosecutor',
                    judgeAgentId: judge,
                    generateBudgetedTurn: context.generateBudgetedTurn,
                    store: context.store,
                    session: context.session,
                    pause: context.pause,
                    pauseMs: PAUSE_MS.witnessBetweenTurns,
                    auditLogStore: context.auditLogStore,
                });
            }
        }

        // Judge recap at configured cadence
        witnessIndex += 1;
        if (witnessIndex % context.recapCadence === 0) {
            await context.pause(PAUSE_MS.recapLeadIn);
            const recapTurn = await context.generateBudgetedTurn({
                store: context.store,
                session: context.session,
                speaker: judge,
                role: 'judge',
                userInstruction:
                    'Give a two-sentence recap of what matters so far and keep the jury oriented.',
                dialoguePrefix: 'Recap:',
            });

            await context.store.recordRecap({
                sessionId: context.session.id,
                turnId: recapTurn.id,
                phase: context.session.phase,
                cycleNumber: witnessIndex,
            });

            await context.safelySpeak('speakRecap', () =>
                context.tts.speakRecap({
                    sessionId: context.session.id,
                    phase: 'witness_exam',
                    text: recapTurn.dialogue,
                }),
            );
        }

        await context.pause(PAUSE_MS.witnessBetweenCycles);
    }
}

export async function runClosingsPhase(
    context: SessionRuntimeContext,
): Promise<void> {
    const { prosecutor, defense } = context.session.metadata.roleAssignments;

    await beginPhase(context, 'closings', PHASE_DURATION_MS.closings);
    await context.safelySpeak('speakCue', () =>
        context.tts.speakCue({
            sessionId: context.session.id,
            phase: 'closings',
            text: 'Closing arguments begin now.',
        }),
    );

    const prosecutorClosing = await context.generateBudgetedTurn({
        store: context.store,
        session: context.session,
        speaker: prosecutor,
        role: 'prosecutor',
        userInstruction:
            'Deliver closing argument in 2-4 sentences with one memorable line.',
    });
    await context.pause(displayPauseMs(prosecutorClosing.dialogue));

    await context.generateBudgetedTurn({
        store: context.store,
        session: context.session,
        speaker: defense,
        role: 'defense',
        userInstruction:
            'Deliver closing argument in 2-4 sentences and request acquittal/non-liability.',
    });
}

export async function runVerdictVotePhase(
    context: SessionRuntimeContext,
    verdictChoices: string[],
): Promise<void> {
    const { bailiff } = context.session.metadata.roleAssignments;

    await beginPhase(
        context,
        'verdict_vote',
        context.session.metadata.verdictVoteWindowMs,
    );
    await emitSceneSwitch(context, 'verdict_vote');

    await context.store.addTurn({
        sessionId: context.session.id,
        speaker: bailiff,
        role: 'bailiff',
        phase: 'verdict_vote',
        dialogue: `Jury poll is open: ${verdictChoices.join(' / ')}. Cast your votes now.`,
    });

    await context.safelySpeak('speakCue', () =>
        context.tts.speakCue({
            sessionId: context.session.id,
            phase: 'verdict_vote',
            text: `Verdict poll is now open: ${verdictChoices.join(' or ')}.`,
        }),
    );

    await context.pause(context.session.metadata.verdictVoteWindowMs);
}

export async function runSentenceVotePhase(
    context: SessionRuntimeContext,
): Promise<void> {
    const { bailiff } = context.session.metadata.roleAssignments;

    await beginPhase(
        context,
        'sentence_vote',
        context.session.metadata.sentenceVoteWindowMs,
    );
    await emitSceneSwitch(context, 'sentence_vote');

    await context.store.addTurn({
        sessionId: context.session.id,
        speaker: bailiff,
        role: 'bailiff',
        phase: 'sentence_vote',
        dialogue: `Sentence poll is now open. Options: ${context.session.metadata.sentenceOptions.join(' | ')}`,
    });

    await context.safelySpeak('speakCue', () =>
        context.tts.speakCue({
            sessionId: context.session.id,
            phase: 'sentence_vote',
            text: 'Sentence poll is now open. The jury may vote.',
        }),
    );

    await context.pause(context.session.metadata.sentenceVoteWindowMs);
}

export async function runFinalRulingPhase(
    context: SessionRuntimeContext,
    verdictChoices: string[],
): Promise<void> {
    const { judge } = context.session.metadata.roleAssignments;

    await beginPhase(context, 'final_ruling', PHASE_DURATION_MS.finalRuling);
    await context.safelySpeak('speakCue', () =>
        context.tts.speakCue({
            sessionId: context.session.id,
            phase: 'final_ruling',
            text: 'All rise for the final ruling.',
        }),
    );

    const latest = await context.store.getSession(context.session.id);
    if (!latest) {
        throw new Error(
            `Session not found during final ruling: ${context.session.id}`,
        );
    }

    const winningVerdict = mostVotedChoice(
        latest.metadata.verdictVotes,
        verdictChoices[0],
    );
    const winningSentence = mostVotedChoice(
        latest.metadata.sentenceVotes,
        latest.metadata.sentenceOptions[0],
    );

    await context.store.recordFinalRuling({
        sessionId: context.session.id,
        verdict: winningVerdict,
        sentence: winningSentence,
    });

    await context.safelySpeak('speakVerdict', () =>
        context.tts.speakVerdict({
            sessionId: context.session.id,
            verdict: winningVerdict,
            sentence: winningSentence,
        }),
    );

    await context.generateBudgetedTurn({
        store: context.store,
        session: context.session,
        speaker: judge,
        role: 'judge',
        userInstruction: `Deliver the final ruling with dramatic comedic flair. Winning verdict: ${winningVerdict}. Winning sentence: ${winningSentence}. Mention both explicitly.`,
    });

    await context.store.completeSession(context.session.id);
}
