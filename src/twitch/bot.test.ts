import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { destroyTwitchBot, initTwitchBot, TwitchBot } from './bot.js';

describe('TwitchBot.parseCommand', () => {
    // Instantiate without credentials → noop mode, but parseCommand still works
    const bot = new TwitchBot();

    it('parses !press command', () => {
        const result = bot.parseCommand('!press 2', 'viewer1');
        assert.ok(result, 'should return a command');
        assert.equal(result.action, 'press');
        assert.equal(result.params.statementNumber, 2);
        assert.equal(result.username, 'viewer1');
    });

    it('parses !present command', () => {
        const result = bot.parseCommand('!present banana', 'viewer2');
        assert.ok(result, 'should return a command');
        assert.equal(result.action, 'present');
        assert.equal(result.params.evidenceId, 'banana');
    });

    it('parses !prompt command', () => {
        const result = bot.parseCommand(
            '!prompt The defendant stole the moon with office glitter',
            'viewer2',
        );
        assert.ok(result, 'should return a command');
        assert.equal(result.action, 'prompt');
        assert.equal(
            result.params.prompt,
            'The defendant stole the moon with office glitter',
        );
    });

    it('returns null for unknown command', () => {
        const result = bot.parseCommand('!unknown', 'viewer3');
        assert.equal(result, null);
    });

    it('returns null for non-command message', () => {
        const result = bot.parseCommand('hello world', 'viewer4');
        assert.equal(result, null);
    });

    it('rate-limits duplicate commands from same user', () => {
        // First command allowed
        const first = bot.parseCommand('!press 1', 'spammer');
        assert.ok(first);
        // Same command within duplicate window → blocked
        const second = bot.parseCommand('!press 1', 'spammer');
        assert.equal(second, null, 'duplicate should be rate-limited');
    });
});

describe('TwitchBot.forwardCommand routing', () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const originalFetch = globalThis.fetch;

    // Save original env var values so we can restore them (not just delete them)
    let origChannel: string | undefined;
    let origBotToken: string | undefined;
    let origClientId: string | undefined;
    let origClientSecret: string | undefined;

    before(() => {
        origChannel = process.env.TWITCH_CHANNEL;
        origBotToken = process.env.TWITCH_BOT_TOKEN;
        origClientId = process.env.TWITCH_CLIENT_ID;
        origClientSecret = process.env.TWITCH_CLIENT_SECRET;

        // Set only IRC-required env vars; client secret is optional for chat.
        process.env.TWITCH_CHANNEL = 'test';
        process.env.TWITCH_BOT_TOKEN = 'oauth:test';
        process.env.TWITCH_CLIENT_ID = 'cid';
        delete process.env.TWITCH_CLIENT_SECRET;

        // Replace fetch with a recorder
        globalThis.fetch = async (url: string | Request | URL, init?: RequestInit) => {
            requests.push({
                url: String(url),
                body: JSON.parse((init?.body as string) ?? '{}'),
            });
            return { ok: true, status: 200, json: async () => ({}) } as Response;
        };
    });

    after(() => {
        // Restore original env var values
        if (origChannel === undefined) delete process.env.TWITCH_CHANNEL;
        else process.env.TWITCH_CHANNEL = origChannel;

        if (origBotToken === undefined) delete process.env.TWITCH_BOT_TOKEN;
        else process.env.TWITCH_BOT_TOKEN = origBotToken;

        if (origClientId === undefined) delete process.env.TWITCH_CLIENT_ID;
        else process.env.TWITCH_CLIENT_ID = origClientId;

        if (origClientSecret === undefined) delete process.env.TWITCH_CLIENT_SECRET;
        else process.env.TWITCH_CLIENT_SECRET = origClientSecret;

        globalThis.fetch = originalFetch;
    });

    function makeBot(): TwitchBot {
        return new TwitchBot({
            channel: 'test',
            botUsername: 'testbot',
            botToken: 'oauth:test',
            clientId: 'cid',
            apiBaseUrl: 'http://localhost:3000',
            caseQueueSubmitToken: 'queue-secret',
            getActiveSessionId: async () => 'session-abc',
        });
    }

    it('!press routes to /press with statementNumber', async () => {
        requests.length = 0;
        const bot = makeBot();
        const cmd = bot.parseCommand('!press 3', 'viewer1');
        assert.ok(cmd);
        await (bot as any).forwardCommand(cmd, 'session-abc');
        assert.equal(requests.length, 1);
        assert.ok(requests[0].url.includes('/api/court/sessions/session-abc/press'));
        assert.equal((requests[0].body as any).statementNumber, 3);
    });

    it('!present routes to /present with evidenceId', async () => {
        requests.length = 0;
        const bot = makeBot();
        const cmd = bot.parseCommand('!present banana 2', 'viewer2');
        assert.ok(cmd);
        await (bot as any).forwardCommand(cmd, 'session-abc');
        assert.equal(requests.length, 1);
        assert.ok(requests[0].url.includes('/api/court/sessions/session-abc/present'));
        assert.equal((requests[0].body as any).evidenceId, 'banana');
    });

    it('!vote routes to /vote with voteType verdict', async () => {
        requests.length = 0;
        const bot = makeBot();
        const cmd = bot.parseCommand('!vote guilty', 'viewer3');
        assert.ok(cmd);
        await (bot as any).forwardCommand(cmd, 'session-abc');
        assert.equal(requests.length, 1);
        assert.ok(requests[0].url.includes('/api/court/sessions/session-abc/vote'));
        assert.equal((requests[0].body as any).voteType, 'verdict');
        assert.equal((requests[0].body as any).choice, 'guilty');
    });

    it('!sentence routes to /vote with voteType sentence', async () => {
        requests.length = 0;
        const bot = makeBot();
        const cmd = bot.parseCommand('!sentence probation', 'viewer4');
        assert.ok(cmd);
        await (bot as any).forwardCommand(cmd, 'session-abc');
        assert.equal(requests.length, 1);
        assert.ok(requests[0].url.includes('/api/court/sessions/session-abc/vote'));
        assert.equal((requests[0].body as any).voteType, 'sentence');
        assert.equal((requests[0].body as any).choice, 'probation');
    });

    it('!prompt routes to the case queue without an active session', async () => {
        requests.length = 0;
        const bot = new TwitchBot({
            channel: 'test',
            botToken: 'oauth:test',
            clientId: 'cid',
            apiBaseUrl: 'http://localhost:3000',
            caseQueueSubmitToken: 'queue-secret',
            getActiveSessionId: async () => null,
        });
        await bot.handleChatMessage(
            '!prompt The bailiff arrested a sandwich for contempt',
            'viewer5',
        );
        assert.equal(requests.length, 1);
        assert.ok(requests[0].url.includes('/api/court/case-queue'));
        assert.equal((requests[0].body as any).source, 'twitch');
        assert.equal((requests[0].body as any).submittedBy, 'viewer5');
    });

    it('blocks !prompt when minimum Twitch role is not met', async () => {
        requests.length = 0;
        const bot = new TwitchBot({
            channel: 'test',
            botToken: 'oauth:test',
            clientId: 'cid',
            apiBaseUrl: 'http://localhost:3000',
            caseQueueSubmitToken: 'queue-secret',
            promptMinRole: 'subscriber',
            getActiveSessionId: async () => null,
        });
        await bot.handleChatMessage(
            '!prompt The bailiff sued the fog machine',
            'viewer7',
            { isSubscriber: false },
        );
        assert.equal(requests.length, 0);
    });

    it('allows !prompt when minimum Twitch role is met', async () => {
        requests.length = 0;
        const bot = new TwitchBot({
            channel: 'test',
            botToken: 'oauth:test',
            clientId: 'cid',
            apiBaseUrl: 'http://localhost:3000',
            caseQueueSubmitToken: 'queue-secret',
            promptMinRole: 'subscriber',
            getActiveSessionId: async () => null,
        });
        await bot.handleChatMessage(
            '!prompt The bailiff sued the fog machine',
            'viewer8',
            { isSubscriber: true },
        );
        assert.equal(requests.length, 1);
        assert.ok(requests[0].url.includes('/api/court/case-queue'));
    });

    it('allows !prompt for followers verified through Twitch Helix', async () => {
        requests.length = 0;
        const seenUrls: string[] = [];
        globalThis.fetch = async (url: string | Request | URL, init?: RequestInit) => {
            const urlString = String(url);
            seenUrls.push(urlString);
            if (urlString.includes('/helix/users')) {
                return { ok: true, status: 200, json: async () => ({ data: [{ id: 'channel-1' }] }) } as Response;
            }
            if (urlString.includes('/helix/channels/followers')) {
                return { ok: true, status: 200, json: async () => ({ data: [{ user_id: 'viewer-1' }] }) } as Response;
            }
            requests.push({
                url: urlString,
                body: JSON.parse((init?.body as string) ?? '{}'),
            });
            return { ok: true, status: 200, json: async () => ({}) } as Response;
        };

        const bot = new TwitchBot({
            channel: 'testchannel',
            botToken: 'oauth:test-token',
            clientId: 'cid',
            apiBaseUrl: 'http://localhost:3000',
            caseQueueSubmitToken: 'queue-secret',
            promptMinRole: 'follower',
            getActiveSessionId: async () => null,
        });
        await bot.handleChatMessage(
            '!prompt The witness was a suspiciously informed mailbox',
            'viewer9',
            { userId: 'viewer-1' },
        );

        assert.ok(seenUrls.some(url => url.includes('/helix/users')));
        assert.ok(seenUrls.some(url => url.includes('/helix/channels/followers')));
        assert.equal(requests.length, 1);
        assert.ok(requests[0].url.includes('/api/court/case-queue'));
    });

    it('does not require TWITCH_CLIENT_SECRET for IRC command forwarding', async () => {
        requests.length = 0;
        delete process.env.TWITCH_CLIENT_SECRET;
        const bot = makeBot();
        await bot.handleChatMessage('!vote liable', 'viewer5');
        assert.equal(requests.length, 1);
        assert.equal((requests[0].body as any).voteType, 'verdict');
        assert.equal((requests[0].body as any).choice, 'liable');
    });

    it('ignores valid commands when there is no active session', async () => {
        requests.length = 0;
        const bot = new TwitchBot({
            channel: 'test',
            botToken: 'oauth:test',
            clientId: 'cid',
            apiBaseUrl: 'http://localhost:3000',
            getActiveSessionId: async () => null,
        });
        await bot.handleChatMessage('!vote guilty', 'viewer6');
        assert.equal(requests.length, 0);
    });
});

describe('initTwitchBot env config', () => {
    let origChannel: string | undefined;
    let origBotUsername: string | undefined;
    let origBotToken: string | undefined;
    let origClientId: string | undefined;
    let origClientSecret: string | undefined;

    before(() => {
        origChannel = process.env.TWITCH_CHANNEL;
        origBotUsername = process.env.TWITCH_BOT_USERNAME;
        origBotToken = process.env.TWITCH_BOT_TOKEN;
        origClientId = process.env.TWITCH_CLIENT_ID;
        origClientSecret = process.env.TWITCH_CLIENT_SECRET;
    });

    after(() => {
        if (origChannel === undefined) delete process.env.TWITCH_CHANNEL;
        else process.env.TWITCH_CHANNEL = origChannel;

        if (origBotUsername === undefined) delete process.env.TWITCH_BOT_USERNAME;
        else process.env.TWITCH_BOT_USERNAME = origBotUsername;

        if (origBotToken === undefined) delete process.env.TWITCH_BOT_TOKEN;
        else process.env.TWITCH_BOT_TOKEN = origBotToken;

        if (origClientId === undefined) delete process.env.TWITCH_CLIENT_ID;
        else process.env.TWITCH_CLIENT_ID = origClientId;

        if (origClientSecret === undefined) delete process.env.TWITCH_CLIENT_SECRET;
        else process.env.TWITCH_CLIENT_SECRET = origClientSecret;

        destroyTwitchBot();
    });

    it('initializes from env with bot username and no client secret', () => {
        destroyTwitchBot();
        process.env.TWITCH_CHANNEL = 'jury_rigged';
        process.env.TWITCH_BOT_USERNAME = 'jury_bot';
        process.env.TWITCH_BOT_TOKEN = 'oauth:test';
        process.env.TWITCH_CLIENT_ID = 'cid';
        delete process.env.TWITCH_CLIENT_SECRET;

        const bot = initTwitchBot();
        assert.equal((bot as any).config.channel, 'jury_rigged');
        assert.equal((bot as any).config.botUsername, 'jury_bot');
        assert.equal((bot as any).config.clientSecret, undefined);
    });
});
