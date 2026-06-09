/**
 * Twitch EventSub Webhook Handler
 *
 * Handles channel point redemptions from Twitch EventSub webhook
 * Maps redemptions to court actions (objection, hold it, order in court)
 */

import crypto from 'crypto';
import type { Request, Response } from 'express';
import type { TwitchSocialEvent } from '../types.js';

type RawBodyRequest = Request & { rawBody?: Buffer };

export interface EventSubEvent {
    subscription: {
        id: string;
        type: string;
        version: string;
        status: string;
        created_at: string;
        transport: {
            method: string;
            callback: string;
        };
        condition: Record<string, string>;
    };
    event: {
        id: string;
        user_id: string;
        user_login: string;
        user_name: string;
        broadcaster_user_id: string;
        broadcaster_user_login: string;
        broadcaster_user_name: string;
        reward: {
            id: string;
            title: string;
            cost: number;
        };
        redeemed_at: string;
        status?: string;
    };
}

/**
 * Validates Twitch EventSub webhook signature
 * Returns true if signature is valid, false otherwise
 */
export function validateEventSubSignature(
    request: Request,
    clientSecret: string,
): boolean {
    const twitch_message_id = request.headers[
        'twitch-eventsub-message-id'
    ] as string;
    const twitch_timestamp = request.headers[
        'twitch-eventsub-message-timestamp'
    ] as string;
    const twitch_signature = request.headers[
        'twitch-eventsub-message-signature'
    ] as string;

    if (!twitch_message_id || !twitch_timestamp || !twitch_signature) {
        console.warn('Missing EventSub headers');
        return false;
    }

    // Prevent replay attacks (within 10 minutes)
    const now = Math.floor(Date.now() / 1000);
    const timestamp = parseInt(twitch_timestamp, 10);
    if (Math.abs(now - timestamp) > 600) {
        console.warn('EventSub message timestamp outside acceptable window');
        return false;
    }

    const body = (request as RawBodyRequest).rawBody?.toString('utf8') ?? JSON.stringify(request.body);
    const message = twitch_message_id + twitch_timestamp + body;
    const hmac = crypto.createHmac('sha256', clientSecret);
    hmac.update(message);
    const computed_signature = `sha256=${hmac.digest('hex')}`;

    const received = Buffer.from(twitch_signature);
    const computed = Buffer.from(computed_signature);
    if (received.length !== computed.length) return false;

    // Use constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(received, computed);
}

export function parseEventSubChallenge(body: unknown): string | undefined {
    if (typeof body !== 'object' || body === null) return undefined;
    const event = body as { challenge?: unknown };
    return typeof event.challenge === 'string' && event.challenge.trim() ? event.challenge : undefined;
}

/**
 * Parse EventSub webhook body
 */
export function parseEventSubWebhook(body: unknown): EventSubEvent | null {
    if (typeof body !== 'object' || body === null) {
        return null;
    }

    const event = body as any;

    // Handle challenge request (initial verification)
    if (event.subscription?.type === 'webhook_callback_verification') {
        console.log('[EventSub] Received challenge request');
        return null;
    }

    // Validate event structure
    if (
        !event.subscription ||
        !event.event ||
        !event.subscription.type ||
        !event.event.user_name
    ) {
        console.warn('[EventSub] Invalid event structure');
        return null;
    }

    return event as EventSubEvent;
}

function readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseSocialUser(event: Record<string, unknown>):
    | { id?: string; login?: string; displayName: string }
    | undefined {
    const displayName = readString(event.user_name) ?? readString(event.user_display_name);
    if (!displayName) return undefined;

    return {
        id: readString(event.user_id),
        login: readString(event.user_login),
        displayName,
    };
}

export function parseSocialEventSubNotification(
    body: unknown,
): TwitchSocialEvent | undefined {
    if (!body || typeof body !== 'object') return undefined;

    const message = body as {
        subscription?: { type?: unknown };
        event?: Record<string, unknown>;
    };
    const type = readString(message.subscription?.type);
    const event = message.event;
    if (!type || !event) return undefined;

    const occurredAt = new Date().toISOString();

    if (type === 'channel.follow') {
        const user = parseSocialUser(event);
        if (!user) return undefined;
        return { type: 'follow', user, occurredAt };
    }

    if (type === 'channel.subscribe') {
        const user = parseSocialUser(event);
        if (!user) return undefined;
        return {
            type: 'subscribe',
            user,
            tier: readString(event.tier),
            occurredAt,
        };
    }

    if (type === 'channel.subscription.gift') {
        const isAnonymous = event.is_anonymous === true;
        const gifter = isAnonymous ? { displayName: 'Anonymous' } : parseSocialUser(event);
        if (!gifter) return undefined;
        return {
            type: 'gift_sub',
            user: { displayName: 'Gift recipient' },
            gifter,
            giftCount: readNumber(event.total) ?? readNumber(event.cumulative_total) ?? 1,
            tier: readString(event.tier),
            occurredAt,
        };
    }

    return undefined;
}

/**
 * Map EventSub channel point redemption to court action
 */
export function mapRedemptionToAction(
    rewardTitle: string,
): { action: 'objection' | 'hold_it' | 'order_in_court' } | null {
    const normalized = rewardTitle.toLowerCase().trim();

    if (normalized.includes('objection')) {
        return { action: 'objection' };
    }

    if (normalized.includes('hold it') || normalized.includes('hold_it')) {
        return { action: 'hold_it' };
    }

    if (normalized.includes('order')) {
        return { action: 'order_in_court' };
    }

    return null;
}

/**
 * Redemption rate limit configuration per phase loop
 */
export interface RedemptionRateLimitConfig {
    maxPerPhaseLoop: number; // Max redemptions per witness_exam loop
    maxPerSession: number; // Max redemptions per entire session
    cooldownMs: number; // Cooldown between same redemption type
}

export const DEFAULT_REDEMPTION_RATE_LIMIT: RedemptionRateLimitConfig = {
    maxPerPhaseLoop: 1,
    maxPerSession: 10,
    cooldownMs: 60_000, // 60 seconds
};

/**
 * Track redemptions for rate limiting
 */
export class RedemptionRateLimiter {
    private redemptions: Map<
        string,
        {
            count: number;
            lastTimestamp: number;
        }
    > = new Map();

    constructor(private config: RedemptionRateLimitConfig) {}

    /**
     * Check if redemption is allowed
     */
    public check(
        sessionId: string,
        action: string,
    ): { allowed: boolean; reason?: string } {
        const key = `${sessionId}:${action}`;
        const now = Date.now();
        const entry = this.redemptions.get(key);

        // Cooldown check
        if (entry && now - entry.lastTimestamp < this.config.cooldownMs) {
            return {
                allowed: false,
                reason: 'cooldown',
            };
        }

        // Session limit check
        if (entry && entry.count >= this.config.maxPerSession) {
            return {
                allowed: false,
                reason: 'session_limit',
            };
        }

        return { allowed: true };
    }

    /**
     * Record a redemption
     */
    public record(sessionId: string, action: string): void {
        const key = `${sessionId}:${action}`;
        const entry = this.redemptions.get(key) ?? {
            count: 0,
            lastTimestamp: 0,
        };
        entry.count++;
        entry.lastTimestamp = Date.now();
        this.redemptions.set(key, entry);
    }

    /**
     * Reset cooldowns for a new phase loop
     */
    public resetPhaseLoop(): void {
        // Preserve counts but reset timestamps to allow new redemptions
        for (const entry of this.redemptions.values()) {
            entry.lastTimestamp = 0;
        }
    }

    /**
     * Clear all redemptions for a session
     */
    public clearSession(sessionId: string): void {
        for (const [key] of this.redemptions.entries()) {
            if (key.startsWith(`${sessionId}:`)) {
                this.redemptions.delete(key);
            }
        }
    }
}
