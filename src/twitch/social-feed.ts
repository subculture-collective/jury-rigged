import type {
    TwitchSocialEvent,
    TwitchSocialSnapshot,
    TwitchSocialUser,
} from '../types.js';

function cloneUser<T extends TwitchSocialUser>(user: T): T {
    return { ...user };
}

function giftKey(user: TwitchSocialUser): string {
    return (
        user.id?.trim() ||
        user.login?.trim().toLowerCase() ||
        user.displayName.trim().toLowerCase()
    );
}

function normalizeGiftCount(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
    return Math.max(1, Math.trunc(value));
}

function selectMostGifted(
    current:
        | (TwitchSocialUser & { giftCount: number; updatedAt: string })
        | undefined,
    candidate: TwitchSocialUser & { giftCount: number; updatedAt: string },
): TwitchSocialUser & { giftCount: number; updatedAt: string } {
    if (!current) return candidate;
    if (candidate.giftCount > current.giftCount) return candidate;
    if (candidate.giftCount < current.giftCount) return current;
    if (candidate.updatedAt > current.updatedAt) return candidate;
    if (candidate.updatedAt < current.updatedAt) return current;
    return candidate.displayName.localeCompare(current.displayName) < 0 ? candidate : current;
}

export class TwitchSocialFeed {
    private snapshot: TwitchSocialSnapshot = {};

    private readonly giftedTotals = new Map<
        string,
        TwitchSocialUser & { giftCount: number; updatedAt: string }
    >();

    record(event: TwitchSocialEvent): TwitchSocialSnapshot {
        const user = cloneUser(event.user);

        if (event.type === 'follow') {
            this.snapshot.latestFollower = {
                ...user,
                followedAt: event.occurredAt,
            };
        }

        if (event.type === 'subscribe') {
            this.snapshot.latestSubscriber = {
                ...user,
                subscribedAt: event.occurredAt,
                tier: event.tier,
            };
        }

        if (event.type === 'gift_sub' && event.gifter) {
            const giftCount = normalizeGiftCount(event.giftCount);
            const gifter = cloneUser(event.gifter);

            this.snapshot.latestGifter = {
                ...gifter,
                giftedAt: event.occurredAt,
                giftCount,
            };

            const key = giftKey(gifter);
            const previous = this.giftedTotals.get(key);
            const updated = {
                ...gifter,
                giftCount: (previous?.giftCount ?? 0) + giftCount,
                updatedAt: event.occurredAt,
            };
            this.giftedTotals.set(key, updated);

            const currentMostGifted = this.snapshot.mostGifted;
            this.snapshot.mostGifted = selectMostGifted(
                currentMostGifted,
                updated,
            );
        }

        this.snapshot.updatedAt = event.occurredAt;
        return this.getSnapshot();
    }

    getSnapshot(): TwitchSocialSnapshot {
        return structuredClone(this.snapshot);
    }
}
