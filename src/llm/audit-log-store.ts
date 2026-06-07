import { randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import postgres, { type Sql } from 'postgres';
import type { AgentId, CourtPhase, CourtRole, LLMMessage } from '../types.js';
import { emitPhoenixLLMTrace } from './phoenix.js';

export type LLMAuditStatus = 'mock' | 'succeeded' | 'failed' | 'fallback';
export type LLMAuditBodyMode = 'off' | 'metadata' | 'full';

export interface LLMAuditConfig {
    enabled: boolean;
    bodyMode: LLMAuditBodyMode;
    maxBodyChars: number;
    retentionDays: number;
}

export interface LLMAuditRecordInput {
    sessionId: string;
    turnId?: string;
    phase: CourtPhase;
    speaker: AgentId;
    role: CourtRole;
    source: 'main_turn' | 'objection_classifier';
    provider: 'openrouter' | 'mock';
    model: string;
    status: LLMAuditStatus;
    messages: LLMMessage[];
    rawResponse?: string;
    sanitizedResponse?: string;
    latencyMs: number;
    errorCode?: string;
    errorMessage?: string;
    createdAt?: string;
    completedAt?: string;
}

export interface LLMAuditLogEntry {
    id: string;
    sessionId: string;
    turnId?: string;
    phase: CourtPhase;
    speaker: AgentId;
    role: CourtRole;
    source: string;
    provider: string;
    model: string;
    status: LLMAuditStatus;
    promptHash: string;
    responseHash?: string;
    promptChars: number;
    responseChars?: number;
    promptTokensEstimate?: number;
    responseTokensEstimate?: number;
    latencyMs: number;
    errorCode?: string;
    errorMessage?: string;
    bodyPersisted: boolean;
    createdAt: string;
    completedAt?: string;
    messages?: LLMMessage[];
    rawResponse?: string;
    sanitizedResponse?: string;
}

export interface LLMAuditQuery {
    sessionId?: string;
    status?: LLMAuditStatus;
    model?: string;
    q?: string;
    limit?: number;
    includeBody?: boolean;
}

export interface LLMAuditStats {
    total: number;
    bodyPersisted: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    byStatus: Record<string, number>;
    byModel: Record<string, number>;
    byPhase: Record<string, number>;
}

export interface LLMAuditLogStore {
    append(input: LLMAuditRecordInput): Promise<LLMAuditLogEntry | undefined>;
    list(query?: LLMAuditQuery): Promise<LLMAuditLogEntry[]>;
    stats(): Promise<LLMAuditStats>;
    subscribe(handler: (entry: LLMAuditLogEntry) => void): () => void;
    dispose(): Promise<void> | void;
}

const DEFAULT_MAX_BODY_CHARS = 50_000;
const DEFAULT_RETENTION_DAYS = 7;
const MAX_LIST_LIMIT = 200;

export function resolveLLMAuditConfig(env: NodeJS.ProcessEnv = process.env): LLMAuditConfig {
    const rawMode = (env.LLM_AUDIT_BODY_PERSISTENCE ?? '').trim().toLowerCase();
    const bodyMode: LLMAuditBodyMode =
        rawMode === 'full' ? 'full'
        : rawMode === 'metadata' ? 'metadata'
        : 'off';
    const enabled = env.LLM_AUDIT_ENABLED === 'true' || bodyMode !== 'off';
    return {
        enabled,
        bodyMode,
        maxBodyChars: parsePositiveInt(env.LLM_AUDIT_MAX_BODY_CHARS, DEFAULT_MAX_BODY_CHARS),
        retentionDays: parsePositiveInt(env.LLM_AUDIT_RETENTION_DAYS, DEFAULT_RETENTION_DAYS),
    };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function estimateTokens(text: string): number {
    return Math.ceil(text.trim().split(/\s+/).filter(Boolean).length * 1.3);
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function clampText(value: string | undefined, maxChars: number): string | undefined {
    if (value === undefined) return undefined;
    return value.length > maxChars ? `${value.slice(0, maxChars)}…[truncated]` : value;
}

function buildEntry(input: LLMAuditRecordInput, config: LLMAuditConfig): LLMAuditLogEntry {
    const promptText = input.messages.map(message => `${message.role}: ${message.content}`).join('\n\n');
    const responseText = input.sanitizedResponse ?? input.rawResponse ?? '';
    const bodyPersisted = config.enabled && config.bodyMode === 'full';
    return {
        id: randomUUID(),
        sessionId: input.sessionId,
        turnId: input.turnId,
        phase: input.phase,
        speaker: input.speaker,
        role: input.role,
        source: input.source,
        provider: input.provider,
        model: input.model,
        status: input.status,
        promptHash: sha256(promptText),
        responseHash: responseText ? sha256(responseText) : undefined,
        promptChars: promptText.length,
        responseChars: responseText.length || undefined,
        promptTokensEstimate: estimateTokens(promptText),
        responseTokensEstimate: responseText ? estimateTokens(responseText) : undefined,
        latencyMs: input.latencyMs,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage?.slice(0, 500),
        bodyPersisted,
        createdAt: input.createdAt ?? new Date().toISOString(),
        completedAt: input.completedAt ?? new Date().toISOString(),
        messages: bodyPersisted ? input.messages : undefined,
        rawResponse: bodyPersisted ? clampText(input.rawResponse, config.maxBodyChars) : undefined,
        sanitizedResponse: bodyPersisted ? clampText(input.sanitizedResponse, config.maxBodyChars) : undefined,
    };
}

function withoutBody(entry: LLMAuditLogEntry): LLMAuditLogEntry {
    const { messages, rawResponse, sanitizedResponse, ...metadata } = entry;
    return metadata;
}

function computeStats(entries: LLMAuditLogEntry[]): LLMAuditStats {
    const latencies = entries.map(entry => entry.latencyMs).sort((a, b) => a - b);
    const countBy = (key: keyof LLMAuditLogEntry) =>
        entries.reduce<Record<string, number>>((acc, entry) => {
            const value = String(entry[key] ?? 'unknown');
            acc[value] = (acc[value] ?? 0) + 1;
            return acc;
        }, {});
    const p95Index = latencies.length ? Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1) : 0;
    return {
        total: entries.length,
        bodyPersisted: entries.filter(entry => entry.bodyPersisted).length,
        avgLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
        p95LatencyMs: latencies[p95Index] ?? 0,
        byStatus: countBy('status'),
        byModel: countBy('model'),
        byPhase: countBy('phase'),
    };
}

export class InMemoryLLMAuditLogStore implements LLMAuditLogStore {
    private readonly entries: LLMAuditLogEntry[] = [];
    private readonly emitter = new EventEmitter();
    constructor(private readonly config: LLMAuditConfig = resolveLLMAuditConfig()) {}

    async append(input: LLMAuditRecordInput): Promise<LLMAuditLogEntry | undefined> {
        if (!this.config.enabled) return undefined;
        const entry = buildEntry(input, this.config);
        this.entries.unshift(entry);
        this.entries.splice(1000);
        this.emitter.emit('entry', withoutBody(entry));
        void emitPhoenixLLMTrace(input).catch(error => {
            console.warn(`[phoenix] ${error instanceof Error ? error.message : String(error)}`);
        });
        return entry;
    }

    async list(query: LLMAuditQuery = {}): Promise<LLMAuditLogEntry[]> {
        const limit = Math.min(query.limit ?? 50, MAX_LIST_LIMIT);
        const q = query.q?.toLowerCase();
        return this.entries
            .filter(entry => !query.sessionId || entry.sessionId === query.sessionId)
            .filter(entry => !query.status || entry.status === query.status)
            .filter(entry => !query.model || entry.model === query.model)
            .filter(entry => !q || [entry.model, entry.phase, entry.role, entry.speaker, entry.errorMessage].filter(Boolean).join(' ').toLowerCase().includes(q))
            .slice(0, limit)
            .map(entry => query.includeBody ? entry : withoutBody(entry));
    }

    async stats(): Promise<LLMAuditStats> {
        return computeStats(this.entries);
    }

    subscribe(handler: (entry: LLMAuditLogEntry) => void): () => void {
        this.emitter.on('entry', handler);
        return () => this.emitter.off('entry', handler);
    }

    dispose(): void {
        this.emitter.removeAllListeners();
    }
}

export class PostgresLLMAuditLogStore implements LLMAuditLogStore {
    private readonly emitter = new EventEmitter();
    private constructor(private readonly sql: Sql, private readonly config: LLMAuditConfig) {}

    static create(databaseUrl: string, config: LLMAuditConfig = resolveLLMAuditConfig()): PostgresLLMAuditLogStore {
        return new PostgresLLMAuditLogStore(postgres(databaseUrl, { max: 4 }), config);
    }

    async append(input: LLMAuditRecordInput): Promise<LLMAuditLogEntry | undefined> {
        if (!this.config.enabled) return undefined;
        const entry = buildEntry(input, this.config);
        await this.sql`
            INSERT INTO llm_audit_logs (
                id, session_id, turn_id, phase, speaker, role, source, provider, model, status,
                prompt_hash, response_hash, prompt_chars, response_chars, prompt_tokens_estimate,
                response_tokens_estimate, latency_ms, error_code, error_message, body_persisted,
                created_at, completed_at
            ) VALUES (
                ${entry.id}, ${entry.sessionId}, ${entry.turnId ?? null}, ${entry.phase}, ${entry.speaker}, ${entry.role}, ${entry.source}, ${entry.provider}, ${entry.model}, ${entry.status},
                ${entry.promptHash}, ${entry.responseHash ?? null}, ${entry.promptChars}, ${entry.responseChars ?? null}, ${entry.promptTokensEstimate ?? null},
                ${entry.responseTokensEstimate ?? null}, ${entry.latencyMs}, ${entry.errorCode ?? null}, ${entry.errorMessage ?? null}, ${entry.bodyPersisted},
                ${entry.createdAt}, ${entry.completedAt ?? null}
            )
        `;
        if (entry.bodyPersisted) {
            const messagesJson = JSON.parse(JSON.stringify(entry.messages ?? [])) as never;
            await this.sql`
                INSERT INTO llm_audit_bodies (audit_id, messages_json, raw_response, sanitized_response)
                VALUES (${entry.id}, ${this.sql.json(messagesJson)}, ${entry.rawResponse ?? null}, ${entry.sanitizedResponse ?? null})
            `;
        }
        this.emitter.emit('entry', withoutBody(entry));
        void emitPhoenixLLMTrace(input).catch(error => {
            console.warn(`[phoenix] ${error instanceof Error ? error.message : String(error)}`);
        });
        return entry;
    }

    async list(query: LLMAuditQuery = {}): Promise<LLMAuditLogEntry[]> {
        const limit = Math.min(query.limit ?? 50, MAX_LIST_LIMIT);
        const rows = await this.sql`
            SELECT l.*, b.messages_json, b.raw_response, b.sanitized_response
            FROM llm_audit_logs l
            LEFT JOIN llm_audit_bodies b ON b.audit_id = l.id
            WHERE (${query.sessionId ?? null}::uuid IS NULL OR l.session_id = ${query.sessionId ?? null}::uuid)
              AND (${query.status ?? null}::text IS NULL OR l.status = ${query.status ?? null})
              AND (${query.model ?? null}::text IS NULL OR l.model = ${query.model ?? null})
              AND (${query.q ?? null}::text IS NULL OR concat_ws(' ', l.model, l.phase, l.role, l.speaker, l.error_message) ILIKE '%' || ${query.q ?? null} || '%')
            ORDER BY l.created_at DESC
            LIMIT ${limit}
        `;
        return rows.map(row => rowToEntry(row, Boolean(query.includeBody)));
    }

    async stats(): Promise<LLMAuditStats> {
        const entries = await this.list({ limit: MAX_LIST_LIMIT });
        return computeStats(entries);
    }

    subscribe(handler: (entry: LLMAuditLogEntry) => void): () => void {
        this.emitter.on('entry', handler);
        return () => this.emitter.off('entry', handler);
    }

    async dispose(): Promise<void> {
        this.emitter.removeAllListeners();
        await this.sql.end({ timeout: 5 });
    }
}

function rowToEntry(row: Record<string, unknown>, includeBody: boolean): LLMAuditLogEntry {
    const entry: LLMAuditLogEntry = {
        id: String(row.id),
        sessionId: String(row.session_id),
        turnId: row.turn_id ? String(row.turn_id) : undefined,
        phase: String(row.phase) as CourtPhase,
        speaker: String(row.speaker) as AgentId,
        role: String(row.role) as CourtRole,
        source: String(row.source),
        provider: String(row.provider),
        model: String(row.model),
        status: String(row.status) as LLMAuditStatus,
        promptHash: String(row.prompt_hash),
        responseHash: row.response_hash ? String(row.response_hash) : undefined,
        promptChars: Number(row.prompt_chars),
        responseChars: row.response_chars === null ? undefined : Number(row.response_chars),
        promptTokensEstimate: row.prompt_tokens_estimate === null ? undefined : Number(row.prompt_tokens_estimate),
        responseTokensEstimate: row.response_tokens_estimate === null ? undefined : Number(row.response_tokens_estimate),
        latencyMs: Number(row.latency_ms),
        errorCode: row.error_code ? String(row.error_code) : undefined,
        errorMessage: row.error_message ? String(row.error_message) : undefined,
        bodyPersisted: Boolean(row.body_persisted),
        createdAt: new Date(String(row.created_at)).toISOString(),
        completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : undefined,
    };
    if (includeBody) {
        entry.messages = (row.messages_json ?? undefined) as LLMMessage[] | undefined;
        entry.rawResponse = row.raw_response ? String(row.raw_response) : undefined;
        entry.sanitizedResponse = row.sanitized_response ? String(row.sanitized_response) : undefined;
    }
    return entry;
}

export function createLLMAuditLogStore(config: LLMAuditConfig = resolveLLMAuditConfig()): LLMAuditLogStore {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (databaseUrl) return PostgresLLMAuditLogStore.create(databaseUrl, config);
    return new InMemoryLLMAuditLogStore(config);
}
