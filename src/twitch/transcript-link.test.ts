import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTranscriptUrl, TwitchBot } from './bot.js';

test('buildTranscriptUrl returns public transcript URL', () => {
    assert.equal(
        buildTranscriptUrl('https://jury.example/', 'session-123'),
        'https://jury.example/app/?view=transcripts&case=session-123',
    );
});

test('announceTranscriptLink sends one chat message per completed session', async () => {
    const messages: string[] = [];
    const bot = new TwitchBot({
        channel: 'test-channel',
        botUsername: 'testbot',
        botToken: 'oauth:test',
        clientId: 'cid',
        apiBaseUrl: 'http://localhost:3000',
        publicBaseUrl: 'https://jury.example',
        getActiveSessionId: async () => null,
    });

    (bot as unknown as { tmiClient: { say: (_channel: string, message: string) => Promise<void> } }).tmiClient = {
        say: async (_channel: string, message: string) => {
            messages.push(message);
        },
    };

    await bot.announceTranscriptLink('session-123');
    await bot.announceTranscriptLink('session-123');

    assert.deepEqual(messages, [
        'Transcript ready: https://jury.example/app/?view=transcripts&case=session-123',
    ]);
});
