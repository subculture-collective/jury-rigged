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

export interface BotConfig {
    channel: string;
    /** Bot account username; defaults to channel name when omitted. */
    botUsername?: string;
    botToken: string;
    clientId: string;
    /** Optional: required for OAuth/API/EventSub work, but not for IRC chat. */
    clientSecret?: string;
    apiBaseUrl: string;
    /** Returns the current active session ID, or null if no session is running. */
    getActiveSessionId: () => Promise<string | null>;
}

export interface ParsedCommand {
    action: 'press' | 'present' | 'vote' | 'sentence';
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
            await this.connectIRC();
            console.log('[Twitch Bot] IRC connected');

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
                    await this.handleChatMessage(message, username);
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
    ): Promise<void> {
        const command = this.parseCommand(message, username);
        if (!command || !this.config) return;

        const sessionId = await this.config.getActiveSessionId();
        if (!sessionId) return;

        await this.forwardCommand(command, sessionId);
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

        if (command.action === 'press') {
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
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                console.warn(
                    `[Twitch Bot] API error ${res.status} for ${command.action} from ${command.username}`,
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
        apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
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
