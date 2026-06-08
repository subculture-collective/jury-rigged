/**
 * Twitch Chat Bot Integration
 *
 * IRC client for reading chat commands and EventSub webhook for channel point redemptions.
 * Commands are forwarded to court API endpoints. Runs in noop mode when credentials absent.
 */

import type { EventEmitter } from 'events';
import { Client as TmiClient, type ChatUserstate } from 'tmi.js';
import {
    CommandRateLimiter,
    DEFAULT_COMMAND_RATE_LIMIT,
} from './command-rate-limit.js';
import { parseCommand as parseChatCommand } from './commands.js';
import {
    normalizeIrcToken,
    readRuntimeTwitchToken,
    refreshTwitchToken,
    runtimeTokenFromRefresh,
    type TwitchTokenValidation,
    validateTwitchToken,
    writeRuntimeTwitchToken,
} from './oauth.js';

export interface BotConfig {
    channel: string;
    /** Bot account username; defaults to channel name when omitted. */
    botUsername?: string;
    botToken: string;
    clientId: string;
    /** Optional: required for OAuth/API/EventSub work, but not for IRC chat. */
    clientSecret?: string;
    /** Twitch OAuth refresh token for automatic access-token rotation. */
    refreshToken?: string;
    /** Local file used to persist refreshed access/refresh tokens. */
    tokenRuntimePath?: string;
    /** Refresh access token this many ms before expiry. */
    tokenRefreshSkewMs?: number;
    apiBaseUrl: string;
    /** Returns the current active session ID, or null if no session is running. */
    getActiveSessionId: () => Promise<string | null>;
    /** Public URL shown in chat help messages. */
    publicBaseUrl?: string;
    /** Periodic command reminder interval. Set to 0 to disable. */
    helpIntervalMs?: number;
    /** Welcome first-time chatters with a short command hint. */
    welcomeFirstChatters?: boolean;
    /** Shared secret used by the bot to submit public queue prompts. */
    caseQueueSubmitToken?: string;
    /** Minimum Twitch role allowed to submit !prompt cases. */
    promptMinRole?: TwitchPromptRole;
}

export type TwitchPromptRole =
    | 'everyone'
    | 'follower'
    | 'subscriber'
    | 'vip'
    | 'moderator'
    | 'broadcaster';

export interface TwitchChatterContext {
    userId?: string;
    isBroadcaster?: boolean;
    isModerator?: boolean;
    isVip?: boolean;
    isSubscriber?: boolean;
}

export interface ParsedCommand {
    action: 'prompt' | 'press' | 'present' | 'vote' | 'sentence';
    username: string;
    timestamp: number;
    params: Record<string, any>;
}

export interface RedemptionEvent {
    type: 'objection' | 'hold_it' | 'order_in_court';
    username: string;
    rewardId: string;
    timestamp: number;
}

/**
 * Main Twitch bot class
 * Handles IRC chat commands and EventSub redemptions
 */
export class TwitchBot {
    private config: BotConfig | null;
    private isActive: boolean = false;
    private eventEmitter: EventEmitter | null = null;
    private commandRateLimiter: CommandRateLimiter;
    private tmiClient: TmiClient | null = null;
    private helpTimer: NodeJS.Timeout | null = null;
    private tokenRefreshTimer: NodeJS.Timeout | null = null;
    private seenChatters: Set<string> = new Set();
    private followerCache = new Map<string, { follows: boolean; expiresAt: number }>();
    private channelUserId: string | null = null;
    private lastWelcomeAt = 0;
    private lastInfoResponseAt = 0;

    constructor(config?: BotConfig) {
        // Initialize rate limiter regardless of config
        this.commandRateLimiter = new CommandRateLimiter(
            DEFAULT_COMMAND_RATE_LIMIT,
        );

        // Graceful noop mode if IRC credentials are missing
        if (!config || !this.hasRequiredConfig(config)) {
            console.log(
                'Twitch bot disabled: missing credentials. Set TWITCH_CHANNEL, TWITCH_BOT_TOKEN, TWITCH_CLIENT_ID.',
            );
            this.config = null;
            this.isActive = false;
            return;
        }

        this.config = config;
    }

    private hasRequiredConfig(config: BotConfig): boolean {
        return Boolean(
            config.channel.trim() &&
                config.botToken.trim() &&
                config.clientId.trim(),
        );
    }

    /**
     * Initialize bot: connect to IRC and register EventSub
     */
    public async start(): Promise<void> {
        if (!this.config || this.isActive) {
            return;
        }

        console.log(`[Twitch Bot] Starting bot for ${this.config.channel}`);

        try {
            await this.prepareTokenForStartup();
            await this.connectIRC();
            console.log('[Twitch Bot] IRC connected');
            this.startTimedHelpMessages();

            const eventSubRegistered = await this.registerEventSub();
            if (eventSubRegistered) {
                console.log('[Twitch Bot] EventSub registered');
            }

            this.isActive = true;
        } catch (err) {
            console.error('[Twitch Bot] Failed to start:', err);
            this.isActive = false;
        }
    }

    private async prepareTokenForStartup(): Promise<void> {
        if (!this.config) return;

        const runtimePath = this.config.tokenRuntimePath;
        const runtimeToken = runtimePath ? await readRuntimeTwitchToken(runtimePath) : null;
        const envRefreshToken = this.config.refreshToken;
        const runtimeRefreshToken = runtimeToken?.refreshToken;
        const refreshToken = runtimeRefreshToken || envRefreshToken;

        const candidates = [
            runtimeToken?.accessToken,
            this.config.botToken,
        ].filter((token): token is string => Boolean(token?.trim()));

        for (const candidate of candidates) {
            const validation: TwitchTokenValidation = await validateTwitchToken(candidate).catch(error => ({
                valid: false,
                scopes: [],
                message: error instanceof Error ? error.message : String(error),
            }));
            if (validation.valid && (validation.expiresIn ?? 0) > this.refreshSkewSeconds()) {
                this.config.botToken = normalizeIrcToken(candidate);
                this.scheduleTokenRefresh(validation.expiresIn, refreshToken);
                console.log(
                    `[Twitch Bot] OAuth token valid for ${Math.round((validation.expiresIn ?? 0) / 60)} minutes`,
                );
                return;
            }
        }

        if (!refreshToken || !this.config.clientSecret) {
            console.warn('[Twitch Bot] OAuth token invalid/expiring and refresh credentials are incomplete');
            return;
        }

        await this.refreshAccessToken(refreshToken, true);
    }

    private async refreshAccessToken(
        refreshToken: string,
        reconnect: boolean,
    ): Promise<void> {
        if (!this.config?.clientSecret) return;
        const refreshed = await refreshTwitchToken({
            refreshToken,
            clientId: this.config.clientId,
            clientSecret: this.config.clientSecret,
        });
        this.config.botToken = normalizeIrcToken(refreshed.accessToken);
        if (refreshed.refreshToken) {
            this.config.refreshToken = refreshed.refreshToken;
        }
        if (this.config.tokenRuntimePath) {
            await writeRuntimeTwitchToken(
                this.config.tokenRuntimePath,
                runtimeTokenFromRefresh(refreshed),
            );
        }
        this.scheduleTokenRefresh(
            refreshed.expiresIn,
            refreshed.refreshToken || refreshToken,
        );
        console.log(
            `[Twitch Bot] OAuth token refreshed; expires in ${Math.round(refreshed.expiresIn / 60)} minutes`,
        );

        if (reconnect && this.isActive && this.tmiClient) {
            await this.tmiClient.disconnect().catch(() => {});
            this.tmiClient.removeAllListeners();
            this.tmiClient = null;
            await this.connectIRC();
            console.log('[Twitch Bot] IRC reconnected after OAuth refresh');
        }
    }

    private scheduleTokenRefresh(
        expiresInSeconds: number | undefined,
        refreshToken?: string,
    ): void {
        if (!expiresInSeconds || !refreshToken || !this.config?.clientSecret) return;
        if (this.tokenRefreshTimer) clearTimeout(this.tokenRefreshTimer);
        const delayMs = Math.max(
            30_000,
            expiresInSeconds * 1000 - (this.config.tokenRefreshSkewMs ?? 10 * 60_000),
        );
        this.tokenRefreshTimer = setTimeout(() => {
            void this.refreshAccessToken(refreshToken, true).catch(error => {
                console.warn(
                    `[Twitch Bot] OAuth refresh failed: ${error instanceof Error ? error.message : String(error)}`,
                );
            });
        }, delayMs);
        this.tokenRefreshTimer.unref();
    }

    private refreshSkewSeconds(): number {
        return Math.ceil((this.config?.tokenRefreshSkewMs ?? 10 * 60_000) / 1000);
    }

    /**
     * Connect to Twitch IRC
     * Stub implementation — will use tmi.js
     */
    private async connectIRC(): Promise<void> {
        if (!this.config) return;

        const identityUsername = this.config.botUsername ?? this.config.channel;

        this.tmiClient = new TmiClient({
            identity: {
                username: identityUsername,
                password: this.config.botToken,
            },
            channels: [this.config.channel],
        });

        this.tmiClient.on(
            'message',
            async (
                _channel: string,
                tags: ChatUserstate,
                message: string,
                self: boolean,
            ) => {
                try {
                    // Ignore messages sent by the bot itself to avoid feedback loops
                    if (self) return;

                    const username =
                        tags.username ?? tags['display-name'] ?? 'unknown';
                    await this.maybeWelcomeChatter(username);
                    await this.handleChatMessage(
                        message,
                        username,
                        chatterContextFromTags(tags, this.config?.channel),
                    );
                } catch (error) {
                    console.error(
                        '[Twitch Bot] Error handling IRC message:',
                        error,
                    );
                }
            },
        );

        await this.tmiClient.connect();
        console.log(`[Twitch Bot] IRC connected to #${this.config.channel}`);
    }

    /**
     * Register WebSocket subscription for channel point redemptions
     * Stub implementation — will use EventSub client
     */
    private async registerEventSub(): Promise<boolean> {
        if (!this.config?.clientSecret) {
            console.log(
                '[Twitch Bot] EventSub registration skipped: missing TWITCH_CLIENT_SECRET',
            );
            return false;
        }

        // Will be implemented with EventSub API
        // For now, stub
        console.log('[Twitch Bot] EventSub registration stub');
        return true;
    }

    /**
     * Parse and forward a chat message when a court session is running.
     */
    public async handleChatMessage(
        message: string,
        username: string,
        context: TwitchChatterContext = {},
    ): Promise<void> {
        if (!this.config) return;

        if (await this.handleInfoCommand(message, username)) {
            return;
        }

        const command = this.parseCommand(message, username);
        if (!command) return;

        if (command.action === 'prompt') {
            if (!(await this.canSubmitPrompt(context))) {
                await this.say(
                    `@${username} case prompts are currently limited to ${this.config.promptMinRole ?? 'everyone'} and above.`,
                );
                return;
            }
            await this.forwardCommand(command, '');
            return;
        }

        const sessionId = await this.config.getActiveSessionId();
        if (!sessionId) {
            await this.say(
                `@${username} no court session is running yet. Watch ${this.publicUrl()} and try again once court is in session.`,
            );
            return;
        }

        await this.forwardCommand(command, sessionId);
    }

    private async handleInfoCommand(
        message: string,
        username: string,
    ): Promise<boolean> {
        const command = message.trim().split(/\s+/)[0]?.toLowerCase();
        if (!command?.startsWith('!')) return false;

        if (command === '!help' || command === '!commands') {
            await this.say(`@${username} ${this.commandHelpText()}`);
            return true;
        }

        if (command === '!case' || command === '!status') {
            const sessionId = await this.config?.getActiveSessionId();
            await this.say(
                sessionId
                    ? `@${username} court is live. Watch along: ${this.publicUrl()}`
                    : `@${username} no court session is running yet. Watch for the next case: ${this.publicUrl()}`,
            );
            return true;
        }

        if (command === '!objection') {
            await this.say(
                `@${username} objection noted for the record. For live controls use !press <number>, !present <evidence>, !vote <choice>, or !sentence <choice>.`,
            );
            return true;
        }

        return false;
    }

    private startTimedHelpMessages(): void {
        const interval = this.config?.helpIntervalMs ?? 15 * 60_000;
        if (!this.config || interval <= 0 || this.helpTimer) return;

        this.helpTimer = setInterval(() => {
            void this.say(this.commandHelpText());
        }, interval);
        this.helpTimer.unref();
    }

    private async maybeWelcomeChatter(username: string): Promise<void> {
        if (!this.config?.welcomeFirstChatters) return;

        const normalized = username.toLowerCase();
        if (normalized === (this.config.botUsername ?? '').toLowerCase()) return;
        if (this.seenChatters.has(normalized)) return;
        this.seenChatters.add(normalized);

        const now = Date.now();
        if (now - this.lastWelcomeAt < 2 * 60_000) return;
        this.lastWelcomeAt = now;

        await this.say(
            `Welcome @${username}! ${this.commandHelpText()}`,
        );
    }

    private commandHelpText(): string {
        return `JuryRigged commands: !prompt <case idea>, !commands, !case, !press <#>, !present <evidence>, !vote guilty|not-guilty, !sentence mercy|maximum. Watch: ${this.publicUrl()}`;
    }

    private publicUrl(): string {
        return (this.config?.publicBaseUrl ?? 'https://jury-rigged.subcult.tv').replace(/\/$/, '');
    }

    private async canSubmitPrompt(context: TwitchChatterContext): Promise<boolean> {
        const required = this.config?.promptMinRole ?? 'everyone';
        if (required === 'everyone') return true;
        if (context.isBroadcaster) return true;
        if (required === 'broadcaster') return Boolean(context.isBroadcaster);
        if (required === 'moderator') return Boolean(context.isModerator);
        if (required === 'vip') return Boolean(context.isVip || context.isModerator);
        if (required === 'subscriber') {
            return Boolean(context.isSubscriber || context.isVip || context.isModerator);
        }
        if (required === 'follower') {
            if (context.isSubscriber || context.isVip || context.isModerator) return true;
            return this.isFollower(context.userId);
        }
        return false;
    }

    private async isFollower(userId: string | undefined): Promise<boolean> {
        if (!this.config || !userId) return false;

        const cached = this.followerCache.get(userId);
        const now = Date.now();
        if (cached && cached.expiresAt > now) return cached.follows;

        try {
            const broadcasterId = await this.getChannelUserId();
            if (!broadcasterId) return false;

            const token = this.config.botToken.replace(/^oauth:/, '');
            const url = new URL('https://api.twitch.tv/helix/channels/followers');
            url.searchParams.set('broadcaster_id', broadcasterId);
            url.searchParams.set('user_id', userId);

            const res = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Client-Id': this.config.clientId,
                },
            });
            if (!res.ok) {
                console.warn(`[Twitch Bot] follower lookup failed: ${res.status}`);
                return false;
            }

            const body = (await res.json()) as { data?: unknown[] };
            const follows = Array.isArray(body.data) && body.data.length > 0;
            this.followerCache.set(userId, {
                follows,
                expiresAt: now + 5 * 60_000,
            });
            return follows;
        } catch (error) {
            console.warn('[Twitch Bot] follower lookup failed:', error);
            return false;
        }
    }

    private async getChannelUserId(): Promise<string | null> {
        if (!this.config) return null;
        if (this.channelUserId) return this.channelUserId;

        const token = this.config.botToken.replace(/^oauth:/, '');
        const url = new URL('https://api.twitch.tv/helix/users');
        url.searchParams.set('login', this.config.channel.replace(/^#/, ''));
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Client-Id': this.config.clientId,
            },
        });
        if (!res.ok) {
            console.warn(`[Twitch Bot] channel user lookup failed: ${res.status}`);
            return null;
        }
        const body = (await res.json()) as { data?: Array<{ id?: string }> };
        this.channelUserId = body.data?.[0]?.id ?? null;
        return this.channelUserId;
    }

    private async say(message: string): Promise<void> {
        if (!this.tmiClient || !this.config) return;

        const now = Date.now();
        if (now - this.lastInfoResponseAt < 1500) return;
        this.lastInfoResponseAt = now;

        try {
            await (this.tmiClient as unknown as { say: (channel: string, message: string) => Promise<unknown> }).say(
                this.config.channel,
                message.slice(0, 450),
            );
        } catch (err) {
            console.warn('[Twitch Bot] Failed to send chat message:', err);
        }
    }

    /**
     * Handle incoming chat command
     * Returns parsed command or null if invalid
     */
    public parseCommand(
        message: string,
        username: string,
    ): ParsedCommand | null {
        const rateLimitCheck = this.commandRateLimiter.check(username, message);
        if (!rateLimitCheck.allowed) {
            console.warn(
                `[Twitch Bot] Rate limited ${username}: ${rateLimitCheck.reason}`,
            );
            return null;
        }

        const parsed = parseChatCommand(message, username);
        return parsed as ParsedCommand | null;
    }

    /**
     * Get the command rate limiter (for testing or external access)
     */
    public getCommandRateLimiter(): CommandRateLimiter {
        return this.commandRateLimiter;
    }

    /**
     * Handle channel point redemption
     */
    public handleRedemption(event: RedemptionEvent): void {
        // Will be implemented
        console.log(
            `[Twitch Bot] Redemption: ${event.type} by ${event.username}`,
        );
    }

    private async forwardCommand(
        command: ParsedCommand,
        sessionId: string,
    ): Promise<void> {
        if (!this.config) return;

        let path: string;
        let body: Record<string, unknown>;

        if (command.action === 'prompt') {
            path = `/api/court/case-queue`;
            body = {
                prompt: command.params?.prompt,
                source: 'twitch',
                submittedBy: command.username,
            };
        } else if (command.action === 'press') {
            path = `/api/court/sessions/${sessionId}/press`;
            body = { statementNumber: command.params?.statementNumber };
        } else if (command.action === 'present') {
            path = `/api/court/sessions/${sessionId}/present`;
            body = {
                evidenceId: command.params?.evidenceId,
                statementNumber: command.params?.statementNumber,
            };
        } else if (command.action === 'vote') {
            path = `/api/court/sessions/${sessionId}/vote`;
            body = {
                voteType: 'verdict',
                choice: command.params?.choice,
                username: command.username,
            };
        } else if (command.action === 'sentence') {
            path = `/api/court/sessions/${sessionId}/vote`;
            body = {
                voteType: 'sentence',
                choice: command.params?.choice,
                username: command.username,
            };
        } else {
            return;
        }

        try {
            const url = `${this.config.apiBaseUrl}${path}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(command.action === 'prompt' && this.config.caseQueueSubmitToken ?
                        { 'X-Case-Queue-Token': this.config.caseQueueSubmitToken }
                    :   {}),
                },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                console.warn(
                    `[Twitch Bot] API error ${res.status} for ${command.action} from ${command.username}`,
                );
                if (command.action === 'prompt') {
                    await this.say(
                        res.status === 401 || res.status === 403 ?
                            `@${command.username} case queue is not accepting bot submissions right now. Operator auth needs attention.`
                        :   `@${command.username} prompt was rejected. Try a fictional PG-13 case idea between 10 and 500 characters.`,
                    );
                }
            } else if (command.action === 'prompt') {
                await this.say(
                    `@${command.username} case submitted. It will run after the current case and any earlier submissions.`,
                );
            }
        } catch (err) {
            console.warn('[Twitch Bot] Failed to forward command:', err);
        }
    }

    /**
     * Stop bot and disconnect
     */
    public async stop(): Promise<void> {
        if (!this.isActive) {
            return;
        }

        console.log('[Twitch Bot] Stopping bot');
        this.isActive = false;

        if (this.tmiClient) {
            this.tmiClient.removeAllListeners();
            await this.tmiClient.disconnect().catch(() => {});
            this.tmiClient = null;
        }

        if (this.helpTimer) {
            clearInterval(this.helpTimer);
            this.helpTimer = null;
        }

        if (this.tokenRefreshTimer) {
            clearTimeout(this.tokenRefreshTimer);
            this.tokenRefreshTimer = null;
        }
    }

    public isRunning(): boolean {
        return this.isActive;
    }
}

/**
 * Global bot instance
 */
let globalBot: TwitchBot | null = null;

export function initTwitchBot(config?: BotConfig): TwitchBot {
    if (globalBot) {
        console.warn(
            'Twitch bot already initialized, returning existing instance',
        );
        return globalBot;
    }

    // Initialize from env vars if not provided
    const finalConfig: BotConfig | undefined = config || {
        channel: process.env.TWITCH_CHANNEL || '',
        botUsername: process.env.TWITCH_BOT_USERNAME || undefined,
        botToken: process.env.TWITCH_BOT_TOKEN || '',
        clientId: process.env.TWITCH_CLIENT_ID || '',
        clientSecret: process.env.TWITCH_CLIENT_SECRET || undefined,
        refreshToken: process.env.TWITCH_REFRESH_TOKEN || undefined,
        tokenRuntimePath:
            process.env.TWITCH_TOKEN_RUNTIME_PATH || '/app/.runtime/twitch-token.json',
        tokenRefreshSkewMs: Number(process.env.TWITCH_TOKEN_REFRESH_SKEW_MS ?? 600000),
        apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
        publicBaseUrl:
            process.env.PUBLIC_BASE_URL || 'https://jury-rigged.subcult.tv',
        helpIntervalMs: Number(process.env.TWITCH_HELP_INTERVAL_MS ?? 900000),
        welcomeFirstChatters: process.env.TWITCH_WELCOME_FIRST_CHATTERS === 'true',
        caseQueueSubmitToken: process.env.CASE_QUEUE_SUBMIT_TOKEN || undefined,
        promptMinRole: parsePromptRole(process.env.TWITCH_PROMPT_MIN_ROLE),
        getActiveSessionId: async () => null,
    };

    globalBot = new TwitchBot(finalConfig);
    return globalBot;
}

export function getTwitchBot(): TwitchBot | null {
    return globalBot;
}

export function destroyTwitchBot(): void {
    if (globalBot) {
        globalBot.stop();
        globalBot = null;
    }
}

function chatterContextFromTags(
    tags: ChatUserstate,
    channel?: string,
): TwitchChatterContext {
    const badges = (tags.badges ?? {}) as Record<string, string>;
    const username = (tags.username ?? '').toLowerCase();
    const normalizedChannel = (channel ?? '').replace(/^#/, '').toLowerCase();
    return {
        userId: typeof tags['user-id'] === 'string' ? tags['user-id'] : undefined,
        isBroadcaster: Boolean(badges.broadcaster) || username === normalizedChannel,
        isModerator: tags.mod === true || Boolean(badges.moderator),
        isVip: Boolean(badges.vip),
        isSubscriber:
            tags.subscriber === true ||
            Boolean(badges.subscriber) ||
            Boolean(badges.founder),
    };
}

function parsePromptRole(value: string | undefined): TwitchPromptRole {
    if (
        value === 'follower' ||
        value === 'subscriber' ||
        value === 'vip' ||
        value === 'moderator' ||
        value === 'broadcaster'
    ) {
        return value;
    }
    return 'everyone';
}
