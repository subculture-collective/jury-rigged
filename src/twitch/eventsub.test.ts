import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import type { Request } from 'express';
import {
    parseEventSubChallenge,
    parseSocialEventSubNotification,
    validateEventSubSignature,
} from './eventsub.js';

test('parseEventSubChallenge returns Twitch verification challenge', () => {
    assert.equal(
        parseEventSubChallenge({ subscription: { type: 'channel.follow' }, challenge: 'verify-me' }),
        'verify-me',
    );
});

test('validateEventSubSignature uses raw request body and rejects malformed signatures', () => {
    const body = '{"subscription":{"type":"channel.follow"},"event":{"user_name":"NewFan"}}';
    const messageId = 'message-1';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const secret = 'secret';
    const signature = `sha256=${crypto.createHmac('sha256', secret).update(messageId + timestamp + body).digest('hex')}`;
    const request = {
        headers: {
            'twitch-eventsub-message-id': messageId,
            'twitch-eventsub-message-timestamp': timestamp,
            'twitch-eventsub-message-signature': signature,
        },
        body: JSON.parse(body) as unknown,
        rawBody: Buffer.from(body),
    } as unknown as Request & { rawBody: Buffer };

    assert.equal(validateEventSubSignature(request, secret), true);
    request.headers['twitch-eventsub-message-signature'] = 'sha256=bad';
    assert.equal(validateEventSubSignature(request, secret), false);
});

test('parseSocialEventSubNotification parses channel.follow notifications', () => {
    const event = parseSocialEventSubNotification({
        subscription: { type: 'channel.follow' },
        event: {
            user_id: 'u1',
            user_login: 'newfan',
            user_name: 'NewFan',
        },
    });

    assert.equal(event?.type, 'follow');
    assert.equal(event?.user.displayName, 'NewFan');
    assert.equal(event?.user.login, 'newfan');
});

test('parseSocialEventSubNotification parses channel.subscribe notifications', () => {
    const event = parseSocialEventSubNotification({
        subscription: { type: 'channel.subscribe' },
        event: {
            user_id: 'u2',
            user_login: 'subfan',
            user_name: 'SubFan',
            tier: '1000',
        },
    });

    assert.equal(event?.type, 'subscribe');
    assert.equal(event?.tier, '1000');
    assert.equal(event?.user.displayName, 'SubFan');
});

test('parseSocialEventSubNotification parses channel.subscription.gift notifications', () => {
    const event = parseSocialEventSubNotification({
        subscription: { type: 'channel.subscription.gift' },
        event: {
            user_id: 'u3',
            user_login: 'gifter',
            user_name: 'Gifter',
            total: 3,
            tier: '1000',
        },
    });

    assert.equal(event?.type, 'gift_sub');
    assert.equal(event?.gifter?.displayName, 'Gifter');
    assert.equal(event?.giftCount, 3);
    assert.equal(event?.tier, '1000');
});

test('parseSocialEventSubNotification parses anonymous gift notifications', () => {
    const event = parseSocialEventSubNotification({
        subscription: { type: 'channel.subscription.gift' },
        event: {
            is_anonymous: true,
            total: 2,
            tier: '1000',
        },
    });

    assert.equal(event?.type, 'gift_sub');
    assert.equal(event?.gifter?.displayName, 'Anonymous');
    assert.equal(event?.giftCount, 2);
});

test('parseSocialEventSubNotification ignores unrelated redemption payloads', () => {
    const event = parseSocialEventSubNotification({
        subscription: { type: 'channel.channel_points_custom_reward_redemption.add' },
        event: {
            user_id: 'u4',
            user_login: 'redeemer',
            user_name: 'Redeemer',
        },
    });

    assert.equal(event, undefined);
});
