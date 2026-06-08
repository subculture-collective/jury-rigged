import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createServerApp } from './server.js';

async function withAdminServer(
    fn: (input: {
        baseUrl: string;
        cookie: string;
    }) => Promise<void>,
): Promise<void> {
    const savedDatabaseUrl = process.env.DATABASE_URL;
    const savedAdminPassword = process.env.ADMIN_PASSWORD;
    const savedAdminTokenSecret = process.env.ADMIN_TOKEN_SECRET;
    const savedAdminCookieSecure = process.env.ADMIN_COOKIE_SECURE;

    process.env.DATABASE_URL = '';
    process.env.ADMIN_PASSWORD = 'test-admin-password';
    process.env.ADMIN_TOKEN_SECRET = 'test-admin-token-secret';
    process.env.ADMIN_COOKIE_SECURE = 'false';

    const created = await createServerApp({
        autoRunCourtSession: false,
        startTwitchBot: false,
    });
    const server: Server = created.app.listen(0);

    try {
        await once(server, 'listening');
        const address = server.address() as AddressInfo | null;
        assert.ok(address && typeof address !== 'string');
        const baseUrl = `http://127.0.0.1:${address.port}`;

        const login = await fetch(`${baseUrl}/api/admin/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({ password: 'test-admin-password' }),
        });
        assert.equal(login.status, 200);
        const cookie = login.headers.get('set-cookie') ?? '';
        assert.match(cookie, /jr_admin_session=/);

        await fn({ baseUrl, cookie });
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
        created.dispose();

        if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = savedDatabaseUrl;

        if (savedAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
        else process.env.ADMIN_PASSWORD = savedAdminPassword;

        if (savedAdminTokenSecret === undefined) {
            delete process.env.ADMIN_TOKEN_SECRET;
        } else {
            process.env.ADMIN_TOKEN_SECRET = savedAdminTokenSecret;
        }

        if (savedAdminCookieSecure === undefined) {
            delete process.env.ADMIN_COOKIE_SECURE;
        } else {
            process.env.ADMIN_COOKIE_SECURE = savedAdminCookieSecure;
        }
    }
}

async function postTrigger(
    baseUrl: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
): Promise<{ response: Response; json: Record<string, unknown> }> {
    const response = await fetch(`${baseUrl}/api/admin/triggers`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...headers,
        },
        body: JSON.stringify(body),
    });
    const json = (await response.json()) as Record<string, unknown>;
    return { response, json };
}

async function createAdminSession(baseUrl: string, cookie: string): Promise<string> {
    const response = await fetch(`${baseUrl}/api/court/sessions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            Origin: baseUrl,
            'X-Admin-Request': '1',
        },
        body: JSON.stringify({
            topic: 'Did the defendant replace all office coffee with soup?',
            caseType: 'criminal',
        }),
    });
    assert.equal(response.status, 201);
    const json = (await response.json()) as { session: { id: string } };
    return json.session.id;
}

async function readUntil(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    pattern: RegExp,
): Promise<string> {
    const decoder = new TextDecoder();
    let body = '';

    for (let index = 0; index < 10; index += 1) {
        const chunk = await reader.read();
        if (chunk.done) break;
        body += decoder.decode(chunk.value, { stream: true });
        if (pattern.test(body)) return body;
    }

    return body;
}

test('POST /api/admin/triggers requires admin auth and CSRF header', async () => {
    await withAdminServer(async ({ baseUrl, cookie }) => {
        const sessionId = await createAdminSession(baseUrl, cookie);

        const unauthenticated = await postTrigger(baseUrl, {
            sessionId,
            kind: 'message',
            title: 'Court note',
            message: 'Stand by for operator update.',
        });
        assert.equal(unauthenticated.response.status, 401);
        assert.equal(unauthenticated.json.code, 'ADMIN_AUTH_REQUIRED');

        const missingCsrf = await postTrigger(
            baseUrl,
            {
                sessionId,
                kind: 'message',
                title: 'Court note',
                message: 'Stand by for operator update.',
            },
            { Cookie: cookie },
        );
        assert.equal(missingCsrf.response.status, 403);
        assert.equal(missingCsrf.json.code, 'ADMIN_CSRF_REQUIRED');
    });
});

test('POST /api/admin/triggers emits admin trigger for known session', async () => {
    await withAdminServer(async ({ baseUrl, cookie }) => {
        const sessionId = await createAdminSession(baseUrl, cookie);

        const controller = new AbortController();
        const stream = await fetch(
            `${baseUrl}/api/court/sessions/${sessionId}/stream`,
            { signal: controller.signal },
        );
        assert.equal(stream.status, 200);
        assert.ok(stream.body);
        const reader = stream.body.getReader();
        await readUntil(reader, /"type":"snapshot"/);

        const posted = await postTrigger(
            baseUrl,
            {
                sessionId,
                kind: 'objection_stinger',
                title: 'OBJECTION',
                message: 'Operator-triggered objection sting.',
            },
            {
                Cookie: cookie,
                Origin: baseUrl,
                'X-Admin-Request': '1',
            },
        );

        assert.equal(posted.response.status, 202);
        assert.equal(posted.json.ok, true);

        const body = await readUntil(reader, /Operator-triggered objection sting\./);
        await reader.cancel();
        controller.abort();
        assert.match(body, /"type":"admin_trigger"/);
        assert.match(body, /Operator-triggered objection sting\./);
    });
});

test('POST /api/admin/triggers rejects unknown session and invalid payload', async () => {
    await withAdminServer(async ({ baseUrl, cookie }) => {
        const adminHeaders = {
            Cookie: cookie,
            Origin: baseUrl,
            'X-Admin-Request': '1',
        };

        const invalid = await postTrigger(
            baseUrl,
            {
                sessionId: 'not-real',
                kind: 'banana',
                title: 'Nope',
                message: 'Invalid trigger kind.',
            },
            adminHeaders,
        );
        assert.equal(invalid.response.status, 400);
        assert.equal(invalid.json.code, 'INVALID_TRIGGER_PAYLOAD');

        const missing = await postTrigger(
            baseUrl,
            {
                sessionId: 'not-real',
                kind: 'message',
                title: 'Missing',
                message: 'This session does not exist.',
            },
            adminHeaders,
        );
        assert.equal(missing.response.status, 404);
        assert.equal(missing.json.code, 'SESSION_NOT_FOUND');
    });
});
