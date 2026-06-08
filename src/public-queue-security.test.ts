import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createServerApp } from './server.js';

async function withPublicQueueServer(
    fn: (input: { baseUrl: string }) => Promise<void>,
): Promise<void> {
    const savedDatabaseUrl = process.env.DATABASE_URL;
    const savedTurnstileSecret = process.env.TURNSTILE_SECRET_KEY;
    const savedEstimatedCaseMinutes = process.env.CASE_QUEUE_ESTIMATED_CASE_MINUTES;
    const savedNonceBypass = process.env.PUBLIC_QUEUE_ALLOW_NONCE_SUBMISSIONS;

    process.env.DATABASE_URL = '';
    delete process.env.TURNSTILE_SECRET_KEY;
    process.env.CASE_QUEUE_ESTIMATED_CASE_MINUTES = '12';
    process.env.PUBLIC_QUEUE_ALLOW_NONCE_SUBMISSIONS = 'true';

    const created = await createServerApp({
        autoRunCourtSession: false,
        autoGenerateCases: false,
        startTwitchBot: false,
    });
    const server: Server = created.app.listen(0);

    try {
        await once(server, 'listening');
        const address = server.address() as AddressInfo | null;
        assert.ok(address && typeof address !== 'string');
        await fn({ baseUrl: `http://127.0.0.1:${address.port}` });
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
        created.dispose();

        if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = savedDatabaseUrl;

        if (savedTurnstileSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
        else process.env.TURNSTILE_SECRET_KEY = savedTurnstileSecret;

        if (savedEstimatedCaseMinutes === undefined) {
            delete process.env.CASE_QUEUE_ESTIMATED_CASE_MINUTES;
        } else {
            process.env.CASE_QUEUE_ESTIMATED_CASE_MINUTES = savedEstimatedCaseMinutes;
        }

        if (savedNonceBypass === undefined) {
            delete process.env.PUBLIC_QUEUE_ALLOW_NONCE_SUBMISSIONS;
        } else {
            process.env.PUBLIC_QUEUE_ALLOW_NONCE_SUBMISSIONS = savedNonceBypass;
        }
    }
}

async function issueNonce(baseUrl: string): Promise<string> {
    const response = await fetch(`${baseUrl}/api/public/case-queue/nonce`);
    assert.equal(response.status, 200);
    const json = (await response.json()) as { nonce?: string; expiresInSeconds?: number };
    assert.equal(json.expiresInSeconds, 600);
    assert.ok(json.nonce);
    return json.nonce;
}

async function postPublicPrompt(
    baseUrl: string,
    body: Record<string, unknown>,
): Promise<{ response: Response; json: Record<string, unknown> }> {
    const response = await fetch(`${baseUrl}/api/public/case-queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const json = (await response.json()) as Record<string, unknown>;
    return { response, json };
}

test('POST /api/public/case-queue requires nonce or Turnstile verification', async () => {
    await withPublicQueueServer(async ({ baseUrl }) => {
        const { response, json } = await postPublicPrompt(baseUrl, {
            prompt: 'The defendant taught the courthouse printer to object.',
            source: 'public_page',
        });

        assert.equal(response.status, 403);
        assert.equal(json.code, 'PUBLIC_QUEUE_VERIFICATION_REQUIRED');
    });
});

test('POST /api/public/case-queue rejects short prompts after nonce verification', async () => {
    await withPublicQueueServer(async ({ baseUrl }) => {
        const nonce = await issueNonce(baseUrl);
        const { response, json } = await postPublicPrompt(baseUrl, {
            prompt: 'tiny',
            source: 'public_page',
            nonce,
        });

        assert.equal(response.status, 400);
        assert.equal(json.code, 'CASE_PROMPT_REJECTED');
    });
});

test('POST /api/public/case-queue rejects duplicate prompts from same client', async () => {
    await withPublicQueueServer(async ({ baseUrl }) => {
        const prompt = 'The defendant filled the jury box with interpretive raccoons.';

        const first = await postPublicPrompt(baseUrl, {
            prompt,
            source: 'public_page',
            nonce: await issueNonce(baseUrl),
        });
        assert.equal(first.response.status, 202);

        const duplicate = await postPublicPrompt(baseUrl, {
            prompt,
            source: 'public_page',
            nonce: await issueNonce(baseUrl),
        });
        assert.equal(duplicate.response.status, 409);
        assert.equal(duplicate.json.code, 'DUPLICATE_PUBLIC_PROMPT');
    });
});

test('POST /api/public/case-queue enqueues valid nonce submissions with position and ETA', async () => {
    await withPublicQueueServer(async ({ baseUrl }) => {
        const { response, json } = await postPublicPrompt(baseUrl, {
            prompt: 'The defendant replaced the evidence locker key with a kazoo.',
            source: 'public_page',
            nonce: await issueNonce(baseUrl),
        });

        assert.equal(response.status, 202);
        assert.equal(json.position, 1);
        assert.equal(json.estimatedStartMinutes, 0);
        const item = json.item as { source?: string; prompt?: string } | undefined;
        assert.equal(item?.source, 'public_page');
        assert.equal(
            item?.prompt,
            'The defendant replaced the evidence locker key with a kazoo.',
        );
        const snapshot = json.snapshot as
            | {
            queue?: Array<{ prompt?: string; submittedBy?: string; status?: string }>;
          }
            | undefined;
        assert.ok(snapshot);
        assert.equal(snapshot.queue?.length, 1);
        assert.equal(snapshot.queue?.[0]?.status, 'queued');
        assert.equal(snapshot.queue?.[0]?.submittedBy, undefined);
    });
});
