import { createHash, randomBytes } from 'node:crypto';
import type { LLMAuditRecordInput } from './audit-log-store.js';

export interface PhoenixTraceConfig {
    enabled: boolean;
    endpoint: string;
    projectName: string;
    apiKey?: string;
    includeBodies: boolean;
}

type OtlpValue =
    | { stringValue: string }
    | { intValue: number }
    | { doubleValue: number }
    | { boolValue: boolean };

const SERVICE_NAME = 'juryrigged';

export function resolvePhoenixTraceConfig(
    env: NodeJS.ProcessEnv = process.env,
): PhoenixTraceConfig {
    const rawEndpoint = (env.PHOENIX_OTLP_ENDPOINT ?? '').trim();
    const normalizedEndpoint =
        rawEndpoint && rawEndpoint.endsWith('/v1/traces') ? rawEndpoint
        : rawEndpoint ? `${rawEndpoint.replace(/\/$/, '')}/v1/traces`
        : '';

    return {
        enabled: env.PHOENIX_ENABLED === 'true' && normalizedEndpoint.length > 0,
        endpoint: normalizedEndpoint,
        projectName: (env.PHOENIX_PROJECT_NAME ?? 'juryrigged').trim() || 'juryrigged',
        apiKey: (env.PHOENIX_API_KEY ?? '').trim() || undefined,
        includeBodies: env.PHOENIX_TRACE_INCLUDE_BODIES === 'true',
    };
}

function traceId(input: LLMAuditRecordInput): string {
    return createHash('sha256')
        .update(`${input.sessionId}:${input.turnId ?? input.source}:${input.createdAt ?? ''}`)
        .digest('hex')
        .slice(0, 32);
}

function spanId(): string {
    return randomBytes(8).toString('hex');
}

function toUnixNano(value: string | undefined, fallback: number): string {
    const ms = value ? Date.parse(value) : fallback;
    return String(BigInt(Number.isFinite(ms) ? ms : fallback) * 1_000_000n);
}

function attr(key: string, value: string | number | boolean | undefined): { key: string; value: OtlpValue } | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return { key, value: { boolValue: value } };
    if (typeof value === 'number') return Number.isInteger(value) ? { key, value: { intValue: value } } : { key, value: { doubleValue: value } };
    return { key, value: { stringValue: value } };
}

function compactMessages(input: LLMAuditRecordInput, includeBodies: boolean): string | undefined {
    if (!includeBodies) return undefined;
    return JSON.stringify(input.messages.map(message => ({ role: message.role, content: message.content })));
}

function outputValue(input: LLMAuditRecordInput, includeBodies: boolean): string | undefined {
    if (!includeBodies) return undefined;
    return input.sanitizedResponse ?? input.rawResponse;
}

export async function emitPhoenixLLMTrace(
    input: LLMAuditRecordInput,
    config: PhoenixTraceConfig = resolvePhoenixTraceConfig(),
): Promise<void> {
    if (!config.enabled) return;

    const startedMs = Date.parse(input.createdAt ?? '') || Date.now() - input.latencyMs;
    const endedMs = Date.parse(input.completedAt ?? '') || startedMs + input.latencyMs;
    const promptChars = input.messages.reduce((sum, message) => sum + message.content.length, 0);
    const responseChars = (input.sanitizedResponse ?? input.rawResponse ?? '').length;
    const promptTokens = Math.ceil(promptChars / 4);
    const completionTokens = Math.ceil(responseChars / 4);
    const attributes = [
        attr('openinference.span.kind', 'LLM'),
        attr('llm.provider', input.provider),
        attr('llm.model_name', input.model),
        attr('llm.invocation.source', input.source),
        attr('llm.token_count.prompt', promptTokens),
        attr('llm.token_count.completion', completionTokens),
        attr('llm.token_count.total', promptTokens + completionTokens),
        attr('juryrigged.session_id', input.sessionId),
        attr('juryrigged.turn_id', input.turnId),
        attr('juryrigged.phase', input.phase),
        attr('juryrigged.speaker', input.speaker),
        attr('juryrigged.role', input.role),
        attr('juryrigged.status', input.status),
        attr('juryrigged.latency_ms', input.latencyMs),
        attr('input.value', compactMessages(input, config.includeBodies)),
        attr('input.mime_type', config.includeBodies ? 'application/json' : undefined),
        attr('output.value', outputValue(input, config.includeBodies)),
        attr('output.mime_type', config.includeBodies ? 'text/plain' : undefined),
    ].filter((item): item is { key: string; value: OtlpValue } => Boolean(item));

    const body = {
        resourceSpans: [
            {
                resource: {
                    attributes: [
                        attr('service.name', SERVICE_NAME),
                        attr('service.namespace', 'jury-rigged'),
                    ].filter(Boolean),
                },
                scopeSpans: [
                    {
                        scope: { name: 'juryrigged.llm.audit', version: '0.1.0' },
                        spans: [
                            {
                                traceId: traceId(input),
                                spanId: spanId(),
                                name: `${input.source} ${input.role}`,
                                kind: 1,
                                startTimeUnixNano: toUnixNano(input.createdAt, startedMs),
                                endTimeUnixNano: toUnixNano(input.completedAt, endedMs),
                                attributes,
                                status: input.status === 'failed' ? { code: 2, message: input.errorMessage ?? 'LLM call failed' } : { code: 1 },
                            },
                        ],
                    },
                ],
            },
        ],
    };

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-project-name': config.projectName,
    };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

    const response = await fetch(config.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`Phoenix OTLP export failed: HTTP ${response.status}`);
    }
}
