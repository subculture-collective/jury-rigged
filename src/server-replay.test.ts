import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSseDataParser } from './scripts/sse-fixture.js';
import { createServerApp } from './server.js';
import type { CourtEvent } from './types.js';

function makeReplayEvent(input: {
    type: CourtEvent['type'];
    at: string;
    payload: Record<string, unknown>;
}): CourtEvent {
    return {
        id: `${input.type}-${input.at}`,
        sessionId: 'recorded-session',
        type: input.type,
        at: input.at,
        payload: input.payload,
    };
}

async function readSseMessages(input: {
    url: string;
    expectedMessages: number;
    timeoutMs: number;
}): Promise<Array<Record<string, unknown>>> {
    const response = await fetch(input.url, {
        headers: { Accept: 'text/event-stream' },
    });

    assert.equal(response.ok, true);
    assert.ok(response.body);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const messages: Array<Record<string, unknown>> = [];

    const parser = createSseDataParser(data => {
        try {
            messages.push(JSON.parse(data) as Record<string, unknown>);
        } catch {
            // Ignore malformed chunks for resilience
        }
    });

    const deadline = Date.now() + input.timeoutMs;

    try {
        while (
            messages.length < input.expectedMessages &&
            Date.now() < deadline
        ) {
            const chunk = await Promise.race([
                reader.read(),
                new Promise<never>((_, reject) => {
                    const remaining = Math.max(1, deadline - Date.now());
                    setTimeout(
                        () => reject(new Error('SSE read timeout')),
                        remaining,
                    );
                }),
            ]);

            if (chunk.done) {
                break;
            }

            parser.push(decoder.decode(chunk.value, { stream: true }));
        }
    } finally {
        parser.flush();
        await reader.cancel();
    }

    return messages;
}

test('replay mode re-emits NDJSON events on SSE with session rewriting', async () => {
    const replayDir = await mkdtemp(join(tmpdir(), 'juryrigged-replay-'));
    const replayFile = join(replayDir, 'session.ndjson');

    const replayEvents: CourtEvent[] = [
        makeReplayEvent({
            type: 'session_started',
            at: '2026-02-28T10:00:00.000Z',
            payload: {
                sessionId: 'recorded-session',
                startedAt: '2026-02-28T10:00:00.000Z',
            },
        }),
        makeReplayEvent({
            type: 'turn',
            at: '2026-02-28T10:00:00.040Z',
            payload: {
                turn: {
                    id: 'turn-1',
                    sessionId: 'recorded-session',
                    turnNumber: 0,
                    speaker: 'godot',
                    role: 'judge',
                    phase: 'case_prompt',
                    dialogue: 'Court is now in session.',
                    createdAt: '2026-02-28T10:00:00.040Z',
                },
            },
        }),
    ];

    await writeFile(
        replayFile,
        `${replayEvents.map(event => JSON.stringify(event)).join('\n')}\n`,
        'utf8',
    );

    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousAdminPassword = process.env.ADMIN_PASSWORD;
    const previousAdminTokenSecret = process.env.ADMIN_TOKEN_SECRET;
    process.env.DATABASE_URL = '';
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_TOKEN_SECRET;

    let server: Server | undefined;
    let dispose: (() => void) | undefined;

    try {
        const created = await createServerApp({
            replay: { filePath: replayFile, speed: 4 },
            startTwitchBot: false,
        });

        dispose = created.dispose;
        server = created.app.listen(0);
        await once(server, 'listening');

        const address = server.address() as AddressInfo | null;
        assert.ok(address && typeof address !== 'string');
        const baseUrl = `http://127.0.0.1:${address.port}`;

        const createResponse = await fetch(`${baseUrl}/api/court/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                topic: 'Did someone replace all office coffee with soup?',
                caseType: 'criminal',
            }),
        });

        assert.equal(createResponse.status, 201);
        const createdPayload = (await createResponse.json()) as {
            session: { id: string };
        };
        const sessionId = createdPayload.session.id;

        const messages = await readSseMessages({
            url: `${baseUrl}/api/court/sessions/${sessionId}/stream`,
            expectedMessages: 3,
            timeoutMs: 2_000,
        });

        assert.equal(messages.length >= 3, true);
        assert.equal(messages[0]?.type, 'snapshot');
        assert.equal(messages[1]?.type, 'session_started');
        assert.equal(messages[2]?.type, 'turn');
        assert.equal(messages[1]?.sessionId, sessionId);

        const turnPayload = messages[2]?.payload as {
            turn?: { sessionId?: string };
        };
        assert.equal(turnPayload.turn?.sessionId, sessionId);
    } finally {
        if (server) {
            await new Promise<void>(resolve => {
                server?.close(() => resolve());
            });
        }
        dispose?.();

        if (previousDatabaseUrl === undefined) {
            delete process.env.DATABASE_URL;
        } else {
            process.env.DATABASE_URL = previousDatabaseUrl;
        }
        if (previousAdminPassword === undefined) {
            delete process.env.ADMIN_PASSWORD;
        } else {
            process.env.ADMIN_PASSWORD = previousAdminPassword;
        }
        if (previousAdminTokenSecret === undefined) {
            delete process.env.ADMIN_TOKEN_SECRET;
        } else {
            process.env.ADMIN_TOKEN_SECRET = previousAdminTokenSecret;
        }
    }
});
