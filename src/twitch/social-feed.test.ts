import assert from 'node:assert/strict';
import test from 'node:test';
import { TwitchSocialFeed } from './social-feed.js';

test('TwitchSocialFeed tracks latest follower subscriber gifter and most gifted', () => {
    const feed = new TwitchSocialFeed();

    feed.record({
        type: 'follow',
        user: { id: 'u1', login: 'newfan', displayName: 'NewFan' },
        occurredAt: '2026-06-08T10:00:00.000Z',
    });
    feed.record({
        type: 'subscribe',
        user: { id: 'u2', login: 'subfan', displayName: 'SubFan' },
        tier: '1000',
        occurredAt: '2026-06-08T10:01:00.000Z',
    });
    feed.record({
        type: 'gift_sub',
        user: { displayName: 'Gift recipient' },
        gifter: { id: 'u3', login: 'gifter', displayName: 'Gifter' },
        giftCount: 3,
        occurredAt: '2026-06-08T10:02:00.000Z',
    });
    feed.record({
        type: 'gift_sub',
        user: { displayName: 'Gift recipient' },
        gifter: { id: 'u3', login: 'gifter', displayName: 'Gifter' },
        giftCount: 2,
        occurredAt: '2026-06-08T10:03:00.000Z',
    });

    const snapshot = feed.getSnapshot();
    assert.equal(snapshot.latestFollower?.displayName, 'NewFan');
    assert.equal(snapshot.latestSubscriber?.displayName, 'SubFan');
    assert.equal(snapshot.latestGifter?.displayName, 'Gifter');
    assert.equal(snapshot.mostGifted?.giftCount, 5);
    assert.equal(snapshot.updatedAt, '2026-06-08T10:03:00.000Z');
});

test('TwitchSocialFeed returns a defensive snapshot copy', () => {
    const feed = new TwitchSocialFeed();
    feed.record({
        type: 'follow',
        user: { displayName: 'CopyCat' },
        occurredAt: '2026-06-08T10:04:00.000Z',
    });

    const snapshot = feed.getSnapshot();
    if (snapshot.latestFollower) {
        snapshot.latestFollower.displayName = 'Mutated';
    }

    assert.equal(feed.getSnapshot().latestFollower?.displayName, 'CopyCat');
});
