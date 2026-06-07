import type { AgentId, CourtRole, CourtSession } from '../../types.js';
import type { CourtSessionStore } from '../../store/session-store.js';
import { llmGenerateDetailed, sanitizeDialogue } from '../../llm/client.js';
import type { LLMAuditLogStore } from '../../llm/audit-log-store.js';
import type { GenerateBudgetedTurn } from './session-flow.js';

/**
 * Checks if the attorney self-triggered an objection by beginning dialogue with "OBJECTION:".
 * Returns the text after "OBJECTION:" (the objection type + explanation), or null.
 */
export function detectOrganicObjection(dialogue: string): string | null {
    const match = dialogue.match(/^OBJECTION:\s*(.+)/i);
    return match ? match[1].trim() : null;
}

/**
 * Parses the raw response from the objection classifier LLM call.
 * Returns the objection type string, or null if the model said no.
 */
export function parseClassifierResponse(text: string): string | null {
    const match = text.match(/^yes:\s*(.+)/i);
    return match ? match[1].trim() : null;
}

/**
 * Calls the LLM as a lightweight classifier to check whether dialogue
 * gives opposing counsel legal grounds to object.
 */
async function runObjectionClassifier(input: {
    dialogue: string;
    session: CourtSession;
    objectingAgentId: AgentId;
    objectingRole: CourtRole;
    auditLogStore?: LLMAuditLogStore;
}): Promise<string | null> {
    const messages = [
        {
            role: 'user' as const,
            content: `Does the following courtroom dialogue give opposing counsel clear legal grounds to object — hearsay, speculation, badgering, or a leading question? Reply only: yes: <type> or no.\n\n"${input.dialogue}"`,
        },
    ];
    const result = await llmGenerateDetailed({
        messages,
        temperature: 0.1,
        maxTokens: 15,
    });
    void input.auditLogStore?.append({
        sessionId: input.session.id,
        phase: input.session.phase,
        speaker: input.objectingAgentId,
        role: input.objectingRole,
        source: 'objection_classifier',
        provider: result.provider,
        model: result.model,
        status: result.status,
        messages,
        rawResponse: result.text,
        sanitizedResponse: sanitizeDialogue(result.text),
        latencyMs: result.latencyMs,
        errorCode: result.errors.length ? 'MODEL_RETRY_OR_FALLBACK' : undefined,
        errorMessage: result.errors.join('\n') || undefined,
    });
    return parseClassifierResponse(result.text);
}

export interface ObjectionRoundInput {
    dialogue: string;
    objectingAgentId: AgentId;
    objectingRole: CourtRole;
    judgeAgentId: AgentId;
    generateBudgetedTurn: GenerateBudgetedTurn;
    store: CourtSessionStore;
    session: CourtSession;
    pause: (ms: number) => Promise<void>;
    pauseMs: number;
    auditLogStore?: LLMAuditLogStore;
}

/**
 * Two-layer objection check for one round.
 * 1. Check if the attorney organically self-triggered (dialogue starts with OBJECTION:).
 * 2. If not, run the LLM classifier as a safety net.
 * 3. If either fires and organic did NOT already produce the turn, generate an objection turn.
 * 4. Judge ALWAYS rules after any objection.
 */
export async function handleObjectionRound(input: ObjectionRoundInput): Promise<void> {
    const organic = detectOrganicObjection(input.dialogue);
    let objectionType = organic;

    if (!objectionType) {
        objectionType = await runObjectionClassifier({
            dialogue: input.dialogue,
            session: input.session,
            objectingAgentId: input.objectingAgentId,
            objectingRole: input.objectingRole,
            auditLogStore: input.auditLogStore,
        });
    }

    if (!objectionType) return;

    // Only generate the attorney objection turn if it was NOT already part of their dialogue
    if (!organic) {
        await input.generateBudgetedTurn({
            store: input.store,
            session: input.session,
            speaker: input.objectingAgentId,
            role: input.objectingRole,
            userInstruction: `Object to the preceding testimony on grounds of ${objectionType}. Begin your turn with "OBJECTION:" followed by the type and a one-sentence explanation.`,
        });
        await input.pause(input.pauseMs);
    }

    // Judge always rules
    await input.generateBudgetedTurn({
        store: input.store,
        session: input.session,
        speaker: input.judgeAgentId,
        role: 'judge',
        userInstruction:
            'Rule on the objection that was just raised: sustained or overruled. One sentence, then direct proceedings to continue.',
    });
}
