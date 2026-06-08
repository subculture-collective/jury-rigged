import { randomUUID } from 'node:crypto';

export type CaseQueueSource = 'twitch' | 'operator' | 'generated';
export type CaseQueueStatus = 'queued' | 'running' | 'completed' | 'skipped';

export interface CaseQueueItem {
    id: string;
    prompt: string;
    source: CaseQueueSource;
    submittedBy?: string;
    status: CaseQueueStatus;
    sessionId?: string;
    createdAt: string;
    updatedAt: string;
}

export interface EnqueueCaseInput {
    prompt: string;
    source: CaseQueueSource;
    submittedBy?: string;
}

export const CASE_PROMPT_MIN_LENGTH = 10;
export const CASE_PROMPT_MAX_LENGTH = 500;

export class CaseQueueValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CaseQueueValidationError';
    }
}

export class CaseQueue {
    private readonly items = new Map<string, CaseQueueItem>();

    enqueue(input: EnqueueCaseInput): CaseQueueItem {
        const prompt = validateCasePrompt(input.prompt);
        const now = new Date().toISOString();
        const item: CaseQueueItem = {
            id: randomUUID(),
            prompt,
            source: input.source,
            submittedBy: input.submittedBy?.trim() || undefined,
            status: 'queued',
            createdAt: now,
            updatedAt: now,
        };
        this.items.set(item.id, item);
        return cloneItem(item);
    }

    list(): CaseQueueItem[] {
        return [...this.items.values()]
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .map(cloneItem);
    }

    queued(): CaseQueueItem[] {
        return this.list().filter(item => item.status === 'queued');
    }

    nextQueued(): CaseQueueItem | undefined {
        return this.queued()[0];
    }

    markRunning(id: string, sessionId: string): CaseQueueItem | undefined {
        const item = this.items.get(id);
        if (!item || item.status !== 'queued') return undefined;
        item.status = 'running';
        item.sessionId = sessionId;
        item.updatedAt = new Date().toISOString();
        return cloneItem(item);
    }

    markCompletedForSession(sessionId: string): CaseQueueItem | undefined {
        const item = [...this.items.values()].find(
            candidate =>
                candidate.sessionId === sessionId && candidate.status === 'running',
        );
        if (!item) return undefined;
        item.status = 'completed';
        item.updatedAt = new Date().toISOString();
        return cloneItem(item);
    }

    skip(id: string): CaseQueueItem | undefined {
        const item = this.items.get(id);
        if (!item || item.status !== 'queued') return undefined;
        item.status = 'skipped';
        item.updatedAt = new Date().toISOString();
        return cloneItem(item);
    }

    snapshot(runningSessionId?: string | null) {
        return {
            queue: this.list(),
            queuedCount: this.queued().length,
            runningSessionId: runningSessionId ?? null,
        };
    }
}

export function validateCasePrompt(raw: string): string {
    const prompt = raw.trim().replace(/\s+/g, ' ');
    if (prompt.length < CASE_PROMPT_MIN_LENGTH) {
        throw new CaseQueueValidationError(
            `prompt must be at least ${CASE_PROMPT_MIN_LENGTH} characters`,
        );
    }
    if (prompt.length > CASE_PROMPT_MAX_LENGTH) {
        throw new CaseQueueValidationError(
            `prompt must be at most ${CASE_PROMPT_MAX_LENGTH} characters`,
        );
    }
    return prompt;
}

function cloneItem(item: CaseQueueItem): CaseQueueItem {
    return { ...item };
}
