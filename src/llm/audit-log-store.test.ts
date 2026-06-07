import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryLLMAuditLogStore, resolveLLMAuditConfig } from './audit-log-store.js';

const baseInput = {
    sessionId: '11111111-1111-1111-1111-111111111111',
    turnId: '22222222-2222-2222-2222-222222222222',
    phase: 'openings' as const,
    speaker: 'phoenix' as const,
    role: 'defense' as const,
    source: 'main_turn' as const,
    provider: 'mock' as const,
    model: 'mock',
    status: 'mock' as const,
    messages: [
        { role: 'system' as const, content: 'system prompt' },
        { role: 'user' as const, content: 'user prompt' },
    ],
    rawResponse: 'raw model output',
    sanitizedResponse: 'clean model output',
    latencyMs: 42,
};

test('LLM audit config is disabled by default', () => {
    const config = resolveLLMAuditConfig({});
    assert.equal(config.enabled, false);
    assert.equal(config.bodyMode, 'off');
});

test('metadata mode stores audit metadata without prompt/response bodies', async () => {
    const store = new InMemoryLLMAuditLogStore({
        enabled: true,
        bodyMode: 'metadata',
        maxBodyChars: 50_000,
        retentionDays: 7,
    });

    await store.append(baseInput);
    const [entry] = await store.list({ includeBody: true });

    assert.ok(entry);
    assert.equal(entry.bodyPersisted, false);
    assert.equal(entry.promptChars > 0, true);
    assert.equal(entry.responseChars, 'clean model output'.length);
    assert.equal(entry.messages, undefined);
    assert.equal(entry.sanitizedResponse, undefined);
});

test('full mode stores prompt and response bodies only when requested', async () => {
    const store = new InMemoryLLMAuditLogStore({
        enabled: true,
        bodyMode: 'full',
        maxBodyChars: 50_000,
        retentionDays: 7,
    });

    await store.append(baseInput);
    const [metadataOnly] = await store.list();
    const [withBody] = await store.list({ includeBody: true });

    assert.equal(metadataOnly?.bodyPersisted, true);
    assert.equal(metadataOnly?.messages, undefined);
    assert.equal(withBody?.messages?.[0]?.content, 'system prompt');
    assert.equal(withBody?.sanitizedResponse, 'clean model output');
});

test('audit stats summarize status, model, phase, and latency', async () => {
    const store = new InMemoryLLMAuditLogStore({
        enabled: true,
        bodyMode: 'metadata',
        maxBodyChars: 50_000,
        retentionDays: 7,
    });

    await store.append({ ...baseInput, latencyMs: 100 });
    await store.append({ ...baseInput, status: 'fallback', latencyMs: 200 });

    const stats = await store.stats();
    assert.equal(stats.total, 2);
    assert.equal(stats.byStatus.mock, 1);
    assert.equal(stats.byStatus.fallback, 1);
    assert.equal(stats.byModel.mock, 2);
    assert.equal(stats.byPhase.openings, 2);
    assert.equal(stats.avgLatencyMs, 150);
});
