import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createServerApp } from './server.js';

async function postJson(baseUrl: string, path: string, body: Record<string, unknown>) {
    return fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

test('public Twitch social endpoint reflects recorded EventSub social events', async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousAdminPassword = process.env.ADMIN_PASSWORD;
    const previousAdminTokenSecret = process.env.ADMIN_TOKEN_SECRET;
    const previousAdminCookieSecure = process.env.ADMIN_COOKIE_SECURE;
    const previousTwitchClientSecret = process.env.TWITCH_CLIENT_SECRET;
    process.env.DATABASE_URL = '';
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_TOKEN_SECRET;
    delete process.env.ADMIN_COOKIE_SECURE;
    delete process.env.TWITCH_CLIENT_SECRET;

    const created = await createServerApp({
        autoRunCourtSession: false,
        autoGenerateCases: false,
        startTwitchBot: false,
    });
    const server = created.app.listen(0);

    try {
        await once(server, 'listening');
        const address = server.address() as AddressInfo | null;
        assert.ok(address && typeof address !== 'string');
        const baseUrl = `http://127.0.0.1:${address.port}`;

        const sessionResponse = await postJson(baseUrl, '/api/court/sessions', {
            topic: 'Did the defendant replace all office coffee with soup?',
            caseType: 'criminal',
        });
        assert.equal(sessionResponse.status, 201);
        const sessionJson = (await sessionResponse.json()) as { session: { id: string } };
        const sessionId = sessionJson.session.id;
        assert.ok(sessionId);

        const recorded = new Promise<Record<string, unknown>>(resolve => {
            created.store.subscribe(sessionId, event => {
                if (event.type === 'twitch_social_updated') {
                    resolve(event.payload);
                }
            });
        });

        const webhookResponse = await postJson(baseUrl, '/api/twitch/eventsub', {
            subscription: { type: 'channel.follow' },
            event: {
                user_id: 'u1',
                user_login: 'newfan',
                user_name: 'NewFan',
            },
        });
        assert.equal(webhookResponse.status, 200);

        const payload = await recorded;
        assert.equal((payload.social as { latestFollower?: { displayName?: string; login?: string; id?: string } }).latestFollower?.displayName, 'NewFan');
        assert.equal((payload.social as { latestFollower?: { login?: string } }).latestFollower?.login, undefined);
        assert.equal((payload.social as { latestFollower?: { id?: string } }).latestFollower?.id, undefined);
        assert.equal(payload.event, undefined);

        const socialResponse = await fetch(`${baseUrl}/api/public/twitch/social`);
        assert.equal(socialResponse.status, 200);
        const socialJson = (await socialResponse.json()) as { social?: { latestFollower?: { displayName?: string; login?: string; id?: string } } };
        assert.equal(socialJson.social?.latestFollower?.displayName, 'NewFan');
        assert.equal(socialJson.social?.latestFollower?.login, undefined);
        assert.equal(socialJson.social?.latestFollower?.id, undefined);

        const challengeResponse = await postJson(baseUrl, '/api/twitch/eventsub', {
            subscription: { type: 'channel.follow' },
            challenge: 'challenge-token',
        });
        assert.equal(challengeResponse.status, 200);
        assert.equal(await challengeResponse.text(), 'challenge-token');
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
        created.dispose();

        if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previousDatabaseUrl;

        if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
        else process.env.ADMIN_PASSWORD = previousAdminPassword;

        if (previousAdminTokenSecret === undefined) delete process.env.ADMIN_TOKEN_SECRET;
        else process.env.ADMIN_TOKEN_SECRET = previousAdminTokenSecret;

        if (previousAdminCookieSecure === undefined) delete process.env.ADMIN_COOKIE_SECURE;
        else process.env.ADMIN_COOKIE_SECURE = previousAdminCookieSecure;

        if (previousTwitchClientSecret === undefined) delete process.env.TWITCH_CLIENT_SECRET;
        else process.env.TWITCH_CLIENT_SECRET = previousTwitchClientSecret;
    }
});
