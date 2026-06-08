import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { after, before } from 'node:test';
import { createServerApp } from './server.js';
import type { CourtSessionStore } from './store/session-store.js';

let server: Server;
let baseUrl = '';
let dispose: () => void;
let store: CourtSessionStore;
let previousDatabaseUrl: string | undefined;
let previousAdminPassword: string | undefined;
let previousAdminTokenSecret: string | undefined;

before(async () => {
    previousDatabaseUrl = process.env.DATABASE_URL;
    previousAdminPassword = process.env.ADMIN_PASSWORD;
    previousAdminTokenSecret = process.env.ADMIN_TOKEN_SECRET;
    process.env.DATABASE_URL = '';
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_TOKEN_SECRET;

    const created = await createServerApp({
        autoRunCourtSession: false,
        startTwitchBot: false,
    });

    store = created.store;
    dispose = created.dispose;
    server = created.app.listen(0);
    await once(server, 'listening');

    const address = server.address() as AddressInfo | null;
    if (!address || typeof address === 'string') {
        throw new Error('Expected server to bind to an ephemeral TCP port');
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
    await new Promise<void>(resolve => {
        server.close(() => resolve());
    });
    dispose();

    if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
    } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
    }
    if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousAdminPassword;
    if (previousAdminTokenSecret === undefined) delete process.env.ADMIN_TOKEN_SECRET;
    else process.env.ADMIN_TOKEN_SECRET = previousAdminTokenSecret;
});

async function postJson(path: string, body: Record<string, unknown>) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    const json = (await response.json()) as Record<string, unknown>;
    return { response, json };
}

test('integration: api votes and snapshots stay consistent', async () => {
    const { response, json } = await postJson('/api/court/sessions', {
        topic: 'Did the defendant replace all office coffee with soup?',
        caseType: 'criminal',
        sentenceOptions: ['Fine', 'Community service'],
    });

    assert.equal(response.status, 201);
    const session = json.session as { id: string };
    const sessionId = session.id;
    assert.ok(sessionId);

    const phases: Array<'openings' | 'witness_exam' | 'closings' | 'verdict_vote'> = [
        'openings',
        'witness_exam',
        'closings',
        'verdict_vote',
    ];

    for (const phase of phases) {
        const { response: phaseResponse } = await postJson(
            `/api/court/sessions/${sessionId}/phase`,
            { phase },
        );
        assert.equal(phaseResponse.status, 200);
    }

    const verdictVote1 = await postJson(
        `/api/court/sessions/${sessionId}/vote`,
        {
            type: 'verdict',
            choice: 'guilty',
        },
    );
    assert.equal(verdictVote1.response.status, 200);

    const verdictVote2 = await postJson(
        `/api/court/sessions/${sessionId}/vote`,
        {
            type: 'verdict',
            choice: 'not_guilty',
        },
    );
    assert.equal(verdictVote2.response.status, 200);

    const toSentence = await postJson(
        `/api/court/sessions/${sessionId}/phase`,
        { phase: 'sentence_vote' },
    );
    assert.equal(toSentence.response.status, 200);

    const sentenceVote = await postJson(
        `/api/court/sessions/${sessionId}/vote`,
        {
            type: 'sentence',
            choice: 'Fine',
        },
    );
    assert.equal(sentenceVote.response.status, 200);

    const toFinal = await postJson(
        `/api/court/sessions/${sessionId}/phase`,
        { phase: 'final_ruling' },
    );
    assert.equal(toFinal.response.status, 200);

    const stored = await store.getSession(sessionId);
    assert.ok(stored);
    assert.deepEqual(stored?.metadata.voteSnapshots?.verdict?.votes, {
        guilty: 1,
        not_guilty: 1,
    });
    assert.deepEqual(stored?.metadata.voteSnapshots?.sentence?.votes, {
        Fine: 1,
    });
});
