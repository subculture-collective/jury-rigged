import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { AGENT_IDS } from './agents.js';
import { assignCourtRoles } from './court/roles.js';
import { createServerApp } from './server.js';
import { createCourtSessionStore } from './store/session-store.js';

function buildMetadata(casePrompt: string, caseType: 'criminal' | 'civil' = 'criminal') {
    const participants = AGENT_IDS.slice(0, 5);
    return {
        mode: 'juryrigged' as const,
        casePrompt,
        caseType,
        sentenceOptions: ['Fine', 'Community service'],
        verdictVoteWindowMs: 10,
        sentenceVoteWindowMs: 10,
        verdictVotes: {},
        sentenceVotes: {},
        pressVotes: {},
        presentVotes: {},
        roleAssignments: assignCourtRoles(participants),
    };
}

test('searchTranscripts finds sessions by topic and prompt text', async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = '';

    try {
        const store = await createCourtSessionStore();
        const participants = AGENT_IDS.slice(0, 5);
        const session = await store.createSession({
            topic: 'The Case of the Glitter Bandit',
            participants,
            metadata: buildMetadata('The glitter bandit raided the evidence locker.'),
        });

        await store.addTurn({
            sessionId: session.id,
            speaker: 'phoenix',
            role: 'judge',
            phase: 'openings',
            dialogue: 'Court is now in session.',
        });
        await store.completeSession(session.id);

        const byTopic = await store.searchTranscripts('glitter');
        assert.equal(byTopic.length, 1);
        assert.equal(byTopic[0]?.id, session.id);
        assert.equal(byTopic[0]?.turnCount, 1);
        assert.equal(byTopic[0]?.casePrompt, 'The glitter bandit raided the evidence locker.');
        assert.equal(byTopic[0]?.status, 'completed');
        assert.equal(byTopic[0]?.phase, 'case_prompt');

        const byPrompt = await store.searchTranscripts('locker');
        assert.equal(byPrompt.length, 1);
        assert.equal(byPrompt[0]?.id, session.id);
    } finally {
        if (previousDatabaseUrl === undefined) {
            delete process.env.DATABASE_URL;
        } else {
            process.env.DATABASE_URL = previousDatabaseUrl;
        }
    }
});

test('public transcript routes return search results and details', async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = '';

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

        const participants = AGENT_IDS.slice(0, 5);
        const session = await created.store.createSession({
            topic: 'The Case of the Glitter Bandit',
            participants,
            metadata: buildMetadata('The glitter bandit raided the evidence locker.'),
        });

        await created.store.addTurn({
            sessionId: session.id,
            speaker: 'phoenix',
            role: 'judge',
            phase: 'openings',
            dialogue: 'Court is now in session.',
        });
        await created.store.completeSession(session.id);

        const hiddenSession = await created.store.createSession({
            topic: 'The Unfinished Glitter Hearing',
            participants,
            metadata: buildMetadata('This pending case should not appear publicly.'),
        });

        const searchResponse = await fetch(
            `${baseUrl}/api/public/transcripts?q=glitter&limit=5`,
        );
        assert.equal(searchResponse.status, 200);
        const searchJson = (await searchResponse.json()) as {
            query: string;
            count: number;
            results: Array<{
                id: string;
                casePrompt?: string;
                turnCount: number;
            }>;
        };
        assert.equal(searchJson.query, 'glitter');
        assert.equal(searchJson.count, 1);
        assert.equal(searchJson.results[0]?.id, session.id);
        assert.equal(
            searchJson.results[0]?.casePrompt,
            'The glitter bandit raided the evidence locker.',
        );
        assert.equal(searchJson.results[0]?.turnCount, 1);
        assert.equal(
            searchJson.results.some(result => result.id === hiddenSession.id),
            false,
        );

        const detailResponse = await fetch(
            `${baseUrl}/api/public/transcripts/${session.id}`,
        );
        assert.equal(detailResponse.status, 200);
        const detailJson = (await detailResponse.json()) as {
            session: { id: string; topic: string; turnCount: number };
        };
        assert.equal(detailJson.session.id, session.id);
        assert.equal(detailJson.session.topic, session.topic);
        assert.equal(detailJson.session.turnCount, 1);

        const hiddenDetailResponse = await fetch(
            `${baseUrl}/api/public/transcripts/${hiddenSession.id}`,
        );
        assert.equal(hiddenDetailResponse.status, 404);

        const missingResponse = await fetch(
            `${baseUrl}/api/public/transcripts/not-real`,
        );
        assert.equal(missingResponse.status, 404);
        const missingJson = (await missingResponse.json()) as {
            code: string;
            error: string;
        };
        assert.equal(missingJson.code, 'TRANSCRIPT_NOT_FOUND');
        assert.equal(missingJson.error, 'Transcript not found');
    } finally {
        await new Promise<void>(resolve => {
            server.close(() => resolve());
        });
        created.dispose();

        if (previousDatabaseUrl === undefined) {
            delete process.env.DATABASE_URL;
        } else {
            process.env.DATABASE_URL = previousDatabaseUrl;
        }
    }
});
