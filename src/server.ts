import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidAgent } from './agents.js';
import { assignCourtRoles, participantsFromRoleAssignments } from './court/roles.js';
import {
    FallbackCircuitOpenError,
    runCourtSession,
    type RunCourtSessionOptions,
} from './court/orchestrator.js';
import {
    CaseQueue,
    CaseQueueValidationError,
    estimateQueueStartMinutes,
    validateCasePrompt,
    type CaseQueueItem,
    type CaseQueueSource,
} from './court/case-queue.js';
import {
    selectNextSafePrompt,
    DEFAULT_ROTATION_CONFIG,
} from './court/prompt-bank.js';
import { moderateContent } from './moderation/content-filter.js';
import { parsePositiveInt } from './parse-env.js';
import {
    CourtNotFoundError,
    CourtValidationError,
    type CourtSessionStore,
    createCourtSessionStore,
} from './store/session-store.js';
import { VoteSpamGuard } from './moderation/vote-spam.js';
import {
    validateEventSubSignature,
    parseEventSubChallenge,
    parseEventSubWebhook,
    parseSocialEventSubNotification,
    mapRedemptionToAction,
    RedemptionRateLimiter,
    DEFAULT_REDEMPTION_RATE_LIMIT,
} from './twitch/eventsub.js';
import { initTwitchBot } from './twitch/bot.js';
import { TwitchSocialFeed } from './twitch/social-feed.js';
import {
    createLLMAuditLogStore,
    resolveLLMAuditConfig,
    type LLMAuditLogStore,
    type LLMAuditStatus,
} from './llm/audit-log-store.js';
import {
    elapsedSecondsSince,
    instrumentCourtSessionStore,
    metricsContentType,
    recordSseConnectionClosed,
    recordSseConnectionOpened,
    recordSseEventSent,
    recordVoteCast,
    recordVoteRejected,
    renderMetrics,
} from './metrics.js';
import { logger } from './logger.js';
import {
    createSyntheticEvent,
    loadReplayRecording,
    parseReplaySpeed,
    resolveRecordingsDir,
    rewriteReplayEventForSession,
    SessionEventRecorderManager,
    type LoadedReplayRecording,
} from './replay/session-replay.js';
import type {
    AdminTriggerKind,
    AdminTriggerRequest,
    AgentId,
    CaseType,
    CourtPhase,
    GenreTag,
    PromptBankEntry,
    TwitchSocialSnapshot,
    TranscriptSearchResponse,
} from './types.js';

const validPhases: CourtPhase[] = [
    'case_prompt',
    'openings',
    'witness_exam',
    'evidence_reveal',
    'closings',
    'verdict_vote',
    'sentence_vote',
    'final_ruling',
];

const validAdminTriggerKinds: AdminTriggerKind[] = [
    'message',
    'phase_stinger',
    'evidence_stinger',
    'objection_stinger',
];

const PUBLIC_QUEUE_NONCE_TTL_MS = 10 * 60 * 1000;
const PUBLIC_QUEUE_DUPLICATE_TTL_MS = 15 * 60 * 1000;

async function verifyTurnstile(token: string, ip?: string): Promise<boolean> {
    const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
    if (!secret) return false;

    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);

    try {
        const response = await fetch(
            'https://challenges.cloudflare.com/turnstile/v0/siteverify',
            { method: 'POST', body },
        );
        const json = (await response.json()) as { success?: boolean };
        return json.success === true;
    } catch (error) {
        logger.warn('[public-queue] Turnstile verification failed', { error });
        return false;
    }
}

function redactTwitchSocialSnapshot(snapshot: TwitchSocialSnapshot): TwitchSocialSnapshot {
    return {
        latestFollower: snapshot.latestFollower ? {
            displayName: snapshot.latestFollower.displayName,
            followedAt: snapshot.latestFollower.followedAt,
        } : undefined,
        latestSubscriber: snapshot.latestSubscriber ? {
            displayName: snapshot.latestSubscriber.displayName,
            subscribedAt: snapshot.latestSubscriber.subscribedAt,
            tier: snapshot.latestSubscriber.tier,
        } : undefined,
        latestGifter: snapshot.latestGifter ? {
            displayName: snapshot.latestGifter.displayName,
            giftedAt: snapshot.latestGifter.giftedAt,
            giftCount: snapshot.latestGifter.giftCount,
        } : undefined,
        mostGifted: snapshot.mostGifted ? {
            displayName: snapshot.mostGifted.displayName,
            giftCount: snapshot.mostGifted.giftCount,
            updatedAt: snapshot.mostGifted.updatedAt,
        } : undefined,
        updatedAt: snapshot.updatedAt,
    };
}

function isAdminTriggerKind(value: unknown): value is AdminTriggerKind {
    return (
        typeof value === 'string' &&
        validAdminTriggerKinds.includes(value as AdminTriggerKind)
    );
}

function normalizeAdminTriggerRequest(
    body: unknown,
): AdminTriggerRequest | undefined {
    const payload =
        body && typeof body === 'object' ?
            (body as Record<string, unknown>)
        :   undefined;

    if (!payload) return undefined;

    const sessionId = payload.sessionId;
    const kind = payload.kind;
    const title = payload.title;
    const message = payload.message;

    if (
        typeof sessionId !== 'string' ||
        !isAdminTriggerKind(kind) ||
        typeof title !== 'string' ||
        typeof message !== 'string'
    ) {
        return undefined;
    }

    return {
        sessionId: sessionId.trim(),
        kind,
        title: title.trim().slice(0, 80),
        message: message.trim().slice(0, 280),
    };
}

const ADMIN_COOKIE_NAME = 'jr_admin_session';
const ADMIN_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

type AdminAuthConfig = {
    enabled: boolean;
    password: string;
    tokenSecret: string;
    secureCookie: boolean;
};

function resolveAdminAuthConfig(): AdminAuthConfig {
    const password = process.env.ADMIN_PASSWORD?.trim() ?? '';
    return {
        enabled: password.length > 0,
        password,
        tokenSecret:
            process.env.ADMIN_TOKEN_SECRET?.trim() || password || 'dev-only',
        secureCookie: process.env.ADMIN_COOKIE_SECURE === 'true',
    };
}

function parseCookies(header: string | undefined): Record<string, string> {
    if (!header) return {};
    return Object.fromEntries(
        header
            .split(';')
            .map(part => part.trim())
            .filter(Boolean)
            .map(part => {
                const index = part.indexOf('=');
                if (index === -1) return [part, ''];
                return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
            }),
    );
}

function signAdminPayload(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function timingSafeEqualStrings(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return (
        leftBuffer.length === rightBuffer.length &&
        crypto.timingSafeEqual(leftBuffer, rightBuffer)
    );
}

function createAdminToken(config: AdminAuthConfig): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
        JSON.stringify({
            iat: now,
            exp: now + ADMIN_SESSION_MAX_AGE_SECONDS,
            nonce: crypto.randomBytes(16).toString('base64url'),
        }),
    ).toString('base64url');
    return `${payload}.${signAdminPayload(payload, config.tokenSecret)}`;
}

function verifyAdminToken(token: string | undefined, config: AdminAuthConfig): boolean {
    if (!config.enabled || !token) return false;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return false;

    const expected = signAdminPayload(payload, config.tokenSecret);
    if (!timingSafeEqualStrings(signature, expected)) return false;

    try {
        const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
            exp?: unknown;
        };
        return typeof parsed.exp === 'number' && parsed.exp > Math.floor(Date.now() / 1000);
    } catch {
        return false;
    }
}

function adminCookie(token: string, config: AdminAuthConfig): string {
    const parts = [
        `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
        'HttpOnly',
        'SameSite=Lax',
        'Path=/',
        `Max-Age=${ADMIN_SESSION_MAX_AGE_SECONDS}`,
    ];
    if (config.secureCookie) parts.push('Secure');
    return parts.join('; ');
}

function clearedAdminCookie(config: AdminAuthConfig): string {
    const parts = [
        `${ADMIN_COOKIE_NAME}=`,
        'HttpOnly',
        'SameSite=Lax',
        'Path=/',
        'Max-Age=0',
    ];
    if (config.secureCookie) parts.push('Secure');
    return parts.join('; ');
}

function isSameOriginAdminRequest(req: Request): boolean {
    const origin = req.get('origin');
    const referer = req.get('referer');
    const source = origin || referer;
    if (!source) return true;

    try {
        const sourceUrl = new URL(source);
        return sourceUrl.host === req.get('host');
    } catch {
        return false;
    }
}

function wantsHtml(req: Request): boolean {
    return req.accepts(['html', 'json']) === 'html';
}

function escapeHtml(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function requireAdmin(config: AdminAuthConfig) {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!config.enabled) return next();
        const token = parseCookies(req.get('cookie'))[ADMIN_COOKIE_NAME];
        if (verifyAdminToken(token, config)) return next();

        if (!req.originalUrl.startsWith('/api/') && wantsHtml(req)) {
            res.redirect(302, `/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
            return;
        }

        res.status(401).json({ code: 'ADMIN_AUTH_REQUIRED', error: 'Admin authentication required' });
    };
}

function requireAdminPost(config: AdminAuthConfig) {
    const auth = requireAdmin(config);
    return (req: Request, res: Response, next: NextFunction): void => {
        auth(req, res, () => {
            if (!config.enabled) return next();
            if (req.get('x-admin-request') !== '1' || !isSameOriginAdminRequest(req)) {
                res.status(403).json({ code: 'ADMIN_CSRF_REQUIRED', error: 'Admin request header and same-origin request required' });
                return;
            }
            next();
        });
    };
}

function requireConfiguredAdmin(config: AdminAuthConfig) {
    const auth = requireAdmin(config);
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!config.enabled) {
            res.status(404).json({ code: 'ADMIN_AUTH_NOT_CONFIGURED', error: 'Admin authentication is not configured' });
            return;
        }
        auth(req, res, next);
    };
}

function sendError(
    res: Response,
    status: number,
    code: string,
    error: string,
    details?: Record<string, unknown>,
): Response {
    return res.status(status).json({ code, error, ...(details ?? {}) });
}

function mapSessionMutationError(input: {
    error: unknown;
    validationCode: string;
    fallbackCode: string;
    fallbackMessage: string;
}): {
    status: number;
    code: string;
    message: string;
} {
    const message =
        input.error instanceof Error ?
            input.error.message
        :   input.fallbackMessage;

    if (input.error instanceof CourtValidationError) {
        return {
            status: 400,
            code: input.validationCode,
            message,
        };
    }

    if (input.error instanceof CourtNotFoundError) {
        return {
            status: 404,
            code: 'SESSION_NOT_FOUND',
            message,
        };
    }

    return {
        status: 500,
        code: input.fallbackCode,
        message,
    };
}

export interface ReplayRuntimeOptions {
    filePath: string;
    speed?: number;
}

export interface ReplayLaunchConfig {
    filePath: string;
    speed: number;
}

export function parseReplayLaunchConfig(
    argv: string[] = process.argv.slice(2),
    env: NodeJS.ProcessEnv = process.env,
): ReplayLaunchConfig | undefined {
    let replayFile = env.REPLAY_FILE?.trim() ?? '';
    let replaySpeed = parseReplaySpeed(env.REPLAY_SPEED);

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--replay') {
            const value = argv[index + 1];
            if (!value || value.startsWith('--')) {
                throw new Error('Missing value for --replay <file-path>');
            }
            replayFile = value;
            index += 1;
            continue;
        }

        if (token === '--speed') {
            const value = argv[index + 1];
            if (!value || value.startsWith('--')) {
                throw new Error('Missing value for --speed <multiplier>');
            }
            replaySpeed = parseReplaySpeed(value);
            index += 1;
        }
    }

    if (!replayFile) {
        return undefined;
    }

    return {
        filePath: path.resolve(replayFile),
        speed: replaySpeed,
    };
}

type TrustProxySetting = boolean | number | string | string[];

export function resolveTrustProxySetting(
    env: NodeJS.ProcessEnv = process.env,
): TrustProxySetting | undefined {
    const raw = env.TRUST_PROXY?.trim();
    if (!raw) {
        return undefined;
    }

    const normalized = raw.toLowerCase();
    if (normalized === 'true') {
        return true;
    }

    if (normalized === 'false') {
        return false;
    }

    if (/^\d+$/.test(raw)) {
        return Number.parseInt(raw, 10);
    }

    if (raw.includes(',')) {
        const trustedProxies = raw
            .split(',')
            .map(segment => segment.trim())
            .filter(Boolean);

        if (trustedProxies.length > 0) {
            return trustedProxies;
        }
    }

    return raw;
}

interface SessionRouteDeps {
    store: CourtSessionStore;
    auditLogStore: LLMAuditLogStore;
    autoRunCourtSession: boolean;
    verdictWindowMs: number;
    sentenceWindowMs: number;
    recorder: SessionEventRecorderManager;
    replay?: LoadedReplayRecording;
    onLlmFallback?: RunCourtSessionOptions['onLlmFallback'];
    onLlmSuccess?: RunCourtSessionOptions['onLlmSuccess'];
    onSessionCompleted?: (sessionId: string) => void | Promise<void>;
}

interface CreateCourtSessionInput {
    topic?: unknown;
    caseType?: unknown;
    participants?: unknown;
    sentenceOptions?: unknown;
    caseSource?: CaseQueueSource;
    queueItemId?: string;
}

interface SimulationControlState {
    automationPaused: boolean;
    errorState: boolean;
    errorReason?: string;
    pausedAt?: string;
    resumedAt?: string;
    fallbackThreshold: number;
    consecutiveFallbacks: number;
    lastFallbackAt?: string;
}

function courtValidationError(
    message: string,
    code: string,
    details?: Record<string, unknown>,
): CourtValidationError {
    return Object.assign(new CourtValidationError(message), { code, details });
}

async function createCourtSession(
    deps: SessionRouteDeps,
    input: CreateCourtSessionInput = {},
) {
    const recentSessions = await deps.store.listSessions();
    const genreHistory: GenreTag[] = recentSessions
        .filter(s => s.metadata.currentGenre)
        .sort(
            (a, b) =>
                new Date(a.createdAt).getTime() -
                new Date(b.createdAt).getTime(),
        )
        .slice(-DEFAULT_ROTATION_CONFIG.maxHistorySize)
        .map(s => s.metadata.currentGenre!)
        .filter(Boolean);

    let selectedPrompt: PromptBankEntry;
    try {
        selectedPrompt = selectNextSafePrompt(genreHistory);
    } catch (error) {
        logger.error('[server] selectNextSafePrompt failed:', {
            error: error instanceof Error ? error.message : error,
        });
        throw courtValidationError('No safe prompts available', 'SAFE_PROMPT_UNAVAILABLE');
    }

    const userTopic = typeof input.topic === 'string' ? input.topic.trim() : '';
    if (userTopic && userTopic.length < 10) {
        throw courtValidationError('topic must be at least 10 characters', 'INVALID_TOPIC');
    }

    if (userTopic) {
        const moderation = moderateContent(userTopic);
        if (moderation.flagged) {
            throw courtValidationError('topic violates safety policy', 'TOPIC_REJECTED', {
                reasons: moderation.reasons,
            });
        }
    }

    const topic = userTopic || selectedPrompt.casePrompt;
    const caseType: CaseType =
        input.caseType === 'civil' ? 'civil'
        : input.caseType === 'criminal' ? 'criminal'
        : selectedPrompt.caseType;

    const rawOverride = Array.isArray(input.participants)
        ? (input.participants as string[]).filter((id): id is AgentId =>
              isValidAgent(id),
          )
        : undefined;
    const roleAssignments = assignCourtRoles(
        rawOverride && rawOverride.length > 0 ? rawOverride : undefined,
    );
    const participants = participantsFromRoleAssignments(roleAssignments);

    const sentenceOptions =
        Array.isArray(input.sentenceOptions) && input.sentenceOptions.length > 0
            ? input.sentenceOptions
                  .map((option: unknown) => String(option).trim())
                  .filter(Boolean)
            : [
                  'Community service in the meme archives',
                  'Banished to the shadow realm',
                  'Mandatory apology haikus',
                  'Ethics training hosted by a raccoon',
                  'Ukulele ankle-monitor probation',
              ];

    const updatedGenreHistory = [...genreHistory, selectedPrompt.genre].slice(
        -DEFAULT_ROTATION_CONFIG.maxHistorySize,
    );

    const session = await deps.store.createSession({
        topic,
        participants,
        metadata: {
            mode: 'juryrigged',
            casePrompt: topic,
            caseType,
            caseSource: input.caseSource ?? (userTopic ? 'operator' : 'generated'),
            queueItemId: input.queueItemId,
            sentenceOptions,
            verdictVoteWindowMs: deps.verdictWindowMs,
            sentenceVoteWindowMs: deps.sentenceWindowMs,
            verdictVotes: {},
            sentenceVotes: {},
            pressVotes: {},
            presentVotes: {},
            roleAssignments,
            currentGenre: selectedPrompt.genre,
            genreHistory: updatedGenreHistory,
            evidenceCards: [],
            objectionCount: 0,
        },
    });

    if (deps.autoRunCourtSession && !deps.replay) {
        try {
            await deps.recorder.start({
                sessionId: session.id,
                initialEvents: [
                    createSyntheticEvent({
                        sessionId: session.id,
                        type: 'session_created',
                        payload: { sessionId: session.id },
                    }),
                ],
            });
        } catch (error) {
            logger.warn(
                `[replay] failed to start recorder for session=${session.id}: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    if (deps.autoRunCourtSession) {
        void runCourtSession(session.id, deps.store, {
            auditLogStore: deps.auditLogStore,
            onLlmFallback: deps.onLlmFallback,
            onLlmSuccess: deps.onLlmSuccess,
        }).then(async () => {
            const completed = await deps.store.getSession(session.id);
            if (completed?.status === 'completed') {
                await deps.onSessionCompleted?.(session.id);
            }
        });
    }

    return session;
}

function createSessionHandler(deps: SessionRouteDeps) {
    return async (req: Request, res: Response): Promise<Response> => {
        try {
            const session = await createCourtSession(deps, {
                topic: req.body?.topic,
                caseType: req.body?.caseType,
                participants: req.body?.participants,
                sentenceOptions: req.body?.sentenceOptions,
                caseSource: req.body?.topic ? 'operator' : 'generated',
            });

            return res.status(201).json({ session });
        } catch (error) {
            if (error instanceof CourtValidationError) {
                const enriched = error as CourtValidationError & {
                    code?: string;
                    details?: Record<string, unknown>;
                };
                return sendError(
                    res,
                    enriched.code === 'SAFE_PROMPT_UNAVAILABLE' ? 503 : 400,
                    enriched.code ?? 'INVALID_SESSION_INPUT',
                    error.message,
                    enriched.details,
                );
            }
            const message =
                error instanceof Error ?
                    error.message
                :   'Failed to create session';
            return sendError(res, 500, 'SESSION_CREATE_FAILED', message);
        }
    };
}

function createVoteHandler(
    store: CourtSessionStore,
    voteSpamGuard: VoteSpamGuard,
) {
    return async (req: Request, res: Response): Promise<Response> => {
        const voteType = req.body?.type;
        const voteTypeLabel =
            typeof voteType === 'string' ? voteType : 'unknown';
        const choice =
            typeof req.body?.choice === 'string' ? req.body.choice.trim() : '';

        if (voteType !== 'verdict' && voteType !== 'sentence') {
            recordVoteRejected(voteTypeLabel, 'invalid_vote_type');
            return sendError(
                res,
                400,
                'INVALID_VOTE_TYPE',
                "type must be 'verdict' or 'sentence'",
            );
        }

        if (!choice) {
            recordVoteRejected(voteTypeLabel, 'missing_vote_choice');
            return sendError(
                res,
                400,
                'MISSING_VOTE_CHOICE',
                'choice is required',
            );
        }

        const clientIp = req.ip ?? req.socket.remoteAddress ?? 'unknown';
        const spamDecision = voteSpamGuard.check(
            req.params.id,
            clientIp,
            voteType,
            choice,
        );
        if (!spamDecision.allowed) {
            const spamReason = spamDecision.reason ?? 'unknown';
            recordVoteRejected(voteType, spamReason);
            logger.warn(
                `[vote-spam] blocked ip=${clientIp} session=${req.params.id} reason=${spamReason}`,
            );
            store.emitEvent(req.params.id, 'vote_spam_blocked', {
                ip: clientIp,
                voteType,
                reason: spamReason,
                retryAfterMs: spamDecision.retryAfterMs,
            });
            const code =
                spamDecision.reason === 'duplicate_vote' ?
                    'VOTE_DUPLICATE'
                :   'VOTE_RATE_LIMITED';
            const errorMessage =
                spamDecision.reason === 'duplicate_vote' ?
                    'Duplicate vote detected. Please wait before retrying.'
                :   'Too many votes. Please slow down.';
            return res.status(429).json({
                code,
                error: errorMessage,
                reason: spamDecision.reason,
                retryAfterMs: spamDecision.retryAfterMs,
            });
        }

        const voteStartedAt = process.hrtime.bigint();

        try {
            const session = await store.castVote({
                sessionId: req.params.id,
                voteType,
                choice,
            });
            recordVoteCast(voteType, elapsedSecondsSince(voteStartedAt));

            return res.json({
                sessionId: session.id,
                verdictVotes: session.metadata.verdictVotes,
                sentenceVotes: session.metadata.sentenceVotes,
            });
        } catch (error) {
            const mapped = mapSessionMutationError({
                error,
                validationCode: 'VOTE_REJECTED',
                fallbackCode: 'VOTE_FAILED',
                fallbackMessage: 'Failed to cast vote',
            });
            recordVoteRejected(voteType, mapped.code);
            return sendError(res, mapped.status, mapped.code, mapped.message);
        }
    };
}

function createPhaseHandler(store: CourtSessionStore) {
    return async (req: Request, res: Response): Promise<Response> => {
        const phase = req.body?.phase as CourtPhase;
        const durationMs =
            typeof req.body?.durationMs === 'number' ?
                req.body.durationMs
            :   undefined;

        if (!validPhases.includes(phase)) {
            return sendError(res, 400, 'INVALID_PHASE', 'invalid phase');
        }

        try {
            const session = await store.setPhase(
                req.params.id,
                phase,
                durationMs,
            );
            return res.json({ session });
        } catch (error) {
            const mapped = mapSessionMutationError({
                error,
                validationCode: 'INVALID_PHASE_TRANSITION',
                fallbackCode: 'PHASE_SET_FAILED',
                fallbackMessage: 'Failed to set phase',
            });
            return sendError(res, mapped.status, mapped.code, mapped.message);
        }
    };
}

function createStreamHandler(
    store: CourtSessionStore,
    replay?: LoadedReplayRecording,
) {
    return async (
        req: Request,
        res: Response,
    ): Promise<Response | undefined> => {
        const session = await store.getSession(req.params.id);
        if (!session) {
            return sendError(
                res,
                404,
                'SESSION_NOT_FOUND',
                'Session not found',
            );
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const openedAt = recordSseConnectionOpened();

        const send = (event: unknown) => {
            const eventType =
                (
                    typeof event === 'object' &&
                    event !== null &&
                    'type' in event &&
                    typeof (event as { type?: unknown }).type === 'string'
                ) ?
                    (event as { type: string }).type
                :   'unknown';
            recordSseEventSent(eventType);
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        };

        send({
            type: 'snapshot',
            payload: {
                session,
                turns: session.turns,
                verdictVotes: session.metadata.verdictVotes,
                sentenceVotes: session.metadata.sentenceVotes,
                recapTurnIds: session.metadata.recapTurnIds ?? [],
            },
        });

        let streamClosed = false;
        const cleanup: Array<() => void> = [];

        if (replay) {
            let currentTimer: ReturnType<typeof setTimeout> | null = null;
            let frameIndex = 0;
            const frames = replay.frames;
            const startMs = Date.now();

            function scheduleNext(): void {
                if (streamClosed || frameIndex >= frames.length) return;
                const frame = frames[frameIndex];
                const elapsed = Date.now() - startMs;
                const delay = Math.max(0, frame.delayMs - elapsed);
                currentTimer = setTimeout(() => {
                    if (streamClosed) return;
                    send(
                        rewriteReplayEventForSession(
                            frame.event,
                            req.params.id,
                        ),
                    );
                    frameIndex += 1;
                    scheduleNext();
                }, delay);
            }

            scheduleNext();

            cleanup.push(() => {
                if (currentTimer !== null) {
                    clearTimeout(currentTimer);
                }
            });
        } else {
            const unsubscribe = store.subscribe(req.params.id, event => {
                send(event);
            });
            cleanup.push(unsubscribe);
        }

        const closeStream = (reason: string) => {
            if (streamClosed) return;
            streamClosed = true;
            for (const dispose of cleanup) {
                dispose();
            }
            recordSseConnectionClosed(openedAt, reason);
        };

        req.on('close', () => closeStream('request_close'));
        req.on('aborted', () => closeStream('request_aborted'));
        res.on('error', () => closeStream('response_error'));
        res.on('close', () => closeStream('response_close'));

        return undefined;
    };
}

type ExpressApp = ReturnType<typeof express>;

// Rate limiter for SPA index route to prevent abuse of filesystem access
const spaIndexLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
});

// Rate limiter for audience interaction endpoints (press/present)
const audienceInteractionLimiter = rateLimit({
    windowMs: 10_000, // 10 seconds
    max: 10, // 10 requests per IP per window
    standardHeaders: true,
    legacyHeaders: false,
});

const adminLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
});

function registerStaticAndSpaRoutes(
    app: ExpressApp,
    dirs: { appDir: string; dashboardDir: string },
    adminAuth: AdminAuthConfig,
): void {
    const operatorAuth = requireAdmin(adminAuth);

    // Serve operator dashboard
    app.use('/operator', operatorAuth, express.static(dirs.dashboardDir));

    // Serve fresh public app
    app.use(express.static(dirs.appDir));

    // Catch-all for operator dashboard (SPA routing)
    app.get('/operator/*', operatorAuth, (_req, res) => {
        const indexPath = path.join(dirs.dashboardDir, 'index.html');
        res.sendFile(indexPath, err => {
            if (err) {
                if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                    res.status(404).send(
                        'Operator dashboard not found. Run `npm run build:dashboard` first.',
                    );
                } else {
                    res.status(500).send('Failed to load operator dashboard.');
                }
            }
        });
    });

    // Catch-all for main app (SPA routing)
    app.get('*', spaIndexLimiter, (_req, res) => {
        const indexPath = path.join(dirs.appDir, 'index.html');
        res.sendFile(indexPath, err => {
            if (err) {
                if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                    res.status(404).send(
                        'Public app not found. Run `npm run build:app` first.',
                    );
                } else {
                    res.status(500).send('Failed to load public app.');
                }
            }
        });
    });
}

function registerApiRoutes(
    app: ExpressApp,
    deps: {
        store: CourtSessionStore;
        voteSpamGuard: VoteSpamGuard;
        autoRunCourtSession: boolean;
        verdictWindowMs: number;
        sentenceWindowMs: number;
        recorder: SessionEventRecorderManager;
        replay?: LoadedReplayRecording;
        adminAuth: AdminAuthConfig;
        auditLogStore: LLMAuditLogStore;
        caseQueue: CaseQueue;
        autoGenerateCases: boolean;
        autoCaseIdleDelayMs: number;
        simulationControl: SimulationControlState;
        socialFeed: TwitchSocialFeed;
        onLlmFallback?: RunCourtSessionOptions['onLlmFallback'];
        onLlmSuccess?: RunCourtSessionOptions['onLlmSuccess'];
        onSessionCompleted?: (sessionId: string) => void | Promise<void>;
    },
): void {
    const adminGet = requireAdmin(deps.adminAuth);
    const adminPost = requireAdminPost(deps.adminAuth);
    const strictAdminGet = requireConfiguredAdmin(deps.adminAuth);

    app.get('/api/health', (_req, res) => {
        res.json({ ok: true, service: 'juryrigged' });
    });

    app.get('/admin/login', (req, res) => {
        if (!deps.adminAuth.enabled) {
            res.status(404).send('Admin authentication is not configured. Set ADMIN_PASSWORD to enable it.');
            return;
        }

        const next = typeof req.query.next === 'string' ? req.query.next : '/operator';
        res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>JuryRigged Admin Login</title>
  <style>
    :root { color-scheme: dark; --bg: 210 42% 7%; --surface: 212 38% 10%; --surface-2: 212 34% 14%; --border: 205 28% 23%; --text: 205 40% 92%; --muted: 207 18% 64%; --cyan: 190 92% 58%; --gold: 38 68% 60%; --purple: 260 75% 62%; }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; }
    body {
      margin: 0;
      display: grid;
      place-items: center;
      padding: 32px 20px;
      color: hsl(var(--text));
      font-family: 'Space Grotesk', 'Inter', system-ui, sans-serif;
      background:
        radial-gradient(circle at 15% 10%, hsl(var(--purple) / 0.14), transparent 30%),
        radial-gradient(circle at 85% 0%, hsl(var(--cyan) / 0.12), transparent 24%),
        radial-gradient(circle at 75% 80%, hsl(var(--gold) / 0.08), transparent 28%),
        linear-gradient(180deg, hsl(var(--bg)) 0%, hsl(211 41% 5%) 100%);
    }
    body::before {
      content: '';
      pointer-events: none;
      position: fixed;
      inset: 0;
      background-image: linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px);
      background-size: 100% 5px;
      mix-blend-mode: soft-light;
      opacity: 0.1;
    }
    .shell {
      position: relative;
      width: min(100%, 440px);
      border: 1px solid hsl(var(--border));
      border-radius: 28px;
      padding: 28px;
      background: linear-gradient(180deg, hsl(var(--surface) / 0.88) 0%, hsl(var(--surface-2) / 0.78) 100%);
      box-shadow: 0 24px 90px rgba(0, 0, 0, 0.42);
      backdrop-filter: blur(20px);
    }
    .eyebrow { margin: 0 0 10px; font-size: 10px; letter-spacing: 0.34em; text-transform: uppercase; color: hsl(var(--cyan)); font-family: 'JetBrains Mono', monospace; }
    h1 { margin: 0; font-size: 1.9rem; line-height: 1.1; letter-spacing: -0.02em; }
    .lede { margin: 14px 0 22px; color: hsl(var(--muted)); line-height: 1.55; font-size: 0.95rem; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px; }
    .pill { border: 1px solid hsl(var(--border)); border-radius: 999px; padding: 7px 10px; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: hsl(var(--muted)); background: rgba(0, 0, 0, 0.12); }
    label { display: block; margin-bottom: 8px; font-size: .78rem; text-transform: uppercase; letter-spacing: .18em; color: hsl(var(--cyan)); }
    input {
      box-sizing: border-box;
      width: 100%;
      border: 1px solid hsl(var(--border));
      border-radius: 14px;
      padding: 13px 14px;
      background: rgba(0, 0, 0, 0.22);
      color: inherit;
      font: inherit;
      outline: none;
      transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease;
    }
    input:focus { border-color: hsl(var(--cyan) / 0.7); box-shadow: 0 0 0 4px hsl(var(--cyan) / 0.12); }
    button {
      width: 100%;
      margin-top: 16px;
      border: 0;
      border-radius: 999px;
      padding: 13px 16px;
      background: linear-gradient(135deg, hsl(var(--gold)) 0%, #f3d48d 100%);
      color: #17120a;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 10px 28px rgba(216, 180, 95, 0.18);
    }
    .hint { margin: 16px 0 0; font-size: 12px; line-height: 1.5; color: hsl(var(--muted)); }
  </style>
</head>
<body>
  <form class="shell" method="post" action="/api/admin/login">
    <p class="eyebrow">JuryRigged · Operator Access</p>
    <h1>Enter the protected dashboard</h1>
    <p class="lede">Broadcast controls, moderation, and recap tools live behind this court seal.</p>
    <div class="meta">
      <span class="pill">/operator</span>
      <span class="pill">Protected</span>
      <span class="pill">Courtroom broadcast</span>
    </div>
    <input type="hidden" name="next" value="${escapeHtml(next)}" />
    <label for="password">Admin password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" autofocus required />
    <button type="submit">Enter operator</button>
    <p class="hint">Need the public broadcast? Use the main app or the overlay deep link; this login only opens the dashboard.</p>
  </form>
</body>
</html>`);
    });

    app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
        if (!deps.adminAuth.enabled) {
            return sendError(res, 404, 'ADMIN_AUTH_NOT_CONFIGURED', 'Admin authentication is not configured');
        }

        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        if (!timingSafeEqualStrings(password, deps.adminAuth.password)) {
            return sendError(res, 401, 'ADMIN_LOGIN_FAILED', 'Invalid admin credentials');
        }

        res.setHeader('Set-Cookie', adminCookie(createAdminToken(deps.adminAuth), deps.adminAuth));
        const next = typeof req.body?.next === 'string' && req.body.next.startsWith('/') ? req.body.next : '/operator';
        if (wantsHtml(req)) {
            res.redirect(303, next);
            return;
        }
        return res.json({ ok: true });
    });

    app.post('/api/admin/logout', adminGet, (_req, res) => {
        res.setHeader('Set-Cookie', clearedAdminCookie(deps.adminAuth));
        res.json({ ok: true });
    });

    app.get('/api/admin/llm-audit', strictAdminGet, async (req, res) => {
        const includeBody = req.query.includeBody === '1';
        const limit = Number.parseInt(String(req.query.limit ?? '50'), 10);
        const entries = await deps.auditLogStore.list({
            sessionId: typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined,
            status: typeof req.query.status === 'string' ? req.query.status as LLMAuditStatus : undefined,
            model: typeof req.query.model === 'string' ? req.query.model : undefined,
            q: typeof req.query.q === 'string' ? req.query.q : undefined,
            limit: Number.isFinite(limit) ? limit : 50,
            includeBody,
        });
        res.json({ entries });
    });

    app.get('/api/admin/llm-audit/stats', strictAdminGet, async (_req, res) => {
        res.json({ stats: await deps.auditLogStore.stats() });
    });

    app.get('/api/admin/llm-audit/feed', strictAdminGet, (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
        const send = (entry: unknown) => {
            res.write(`data: ${JSON.stringify(entry)}\n\n`);
        };
        send({ type: 'connected', at: new Date().toISOString() });
        const unsubscribe = deps.auditLogStore.subscribe(entry => send({ type: 'llm_audit', entry }));
        req.on('close', unsubscribe);
    });

    app.post('/api/admin/triggers', adminPost, async (req, res) => {
        const trigger = normalizeAdminTriggerRequest(req.body);
        if (!trigger || !trigger.sessionId || !trigger.title || !trigger.message) {
            return sendError(
                res,
                400,
                'INVALID_TRIGGER_PAYLOAD',
                'invalid trigger payload',
            );
        }

        const session = await deps.store.getSession(trigger.sessionId);
        if (!session) {
            return sendError(
                res,
                404,
                'SESSION_NOT_FOUND',
                'session not found',
            );
        }

        deps.store.emitEvent(trigger.sessionId, 'admin_trigger', {
            ...trigger,
            emittedAt: new Date().toISOString(),
        });

        return res.status(202).json({ ok: true });
    });

    app.get('/api/metrics', adminGet, async (_req, res) => {
        try {
            const metrics = await renderMetrics();
            res.setHeader('Content-Type', metricsContentType);
            res.status(200).send(metrics);
        } catch (error) {
            logger.error('[metrics] failed to render metrics:', {
                error: error instanceof Error ? error.message : error,
            });
            res.status(500).send('failed to render metrics');
        }
    });

    app.get('/api/court/sessions', async (_req, res) => {
        const sessions = await deps.store.listSessions();
        res.json({ sessions });
    });

    app.get('/api/public/transcripts', audienceInteractionLimiter, async (req, res) => {
        const query = (typeof req.query.q === 'string' ? req.query.q : '')
            .trim()
            .slice(0, 120);
        const rawLimit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 25;
        const limit = Number.isFinite(rawLimit) ? rawLimit : 25;
        const results = await deps.store.searchTranscripts(query, limit);
        const response: TranscriptSearchResponse = {
            query,
            results,
            count: results.length,
        };
        res.json(response);
    });

    app.get('/api/public/twitch/social', audienceInteractionLimiter, (_req, res) => {
        res.json({ social: redactTwitchSocialSnapshot(deps.socialFeed.getSnapshot()) });
    });

    const getRunningOrPendingSession = async () => {
        const sessions = await deps.store.listSessions();
        return sessions.find(
            session =>
                session.status === 'running' || session.status === 'pending',
        );
    };

    const queueSnapshot = async () => {
        const active = await getRunningOrPendingSession();
        const publicBaseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
        const streamUrl = publicBaseUrl ? `${publicBaseUrl}/app/?view=overlay` : '/app/?view=overlay';
        const transcriptsUrl = publicBaseUrl ? `${publicBaseUrl}/app/?view=transcripts` : '/app/?view=transcripts';
        return {
            ...deps.caseQueue.snapshot(active?.id ?? null, {
                estimatedCaseMinutes: parsePositiveInt(
                    process.env.CASE_QUEUE_ESTIMATED_CASE_MINUTES,
                    12,
                ),
                streamUrl,
                transcriptsUrl,
            }),
            automationEnabled: deps.autoGenerateCases,
            automationPaused: deps.simulationControl.automationPaused,
            errorState: deps.simulationControl.errorState,
            errorReason: deps.simulationControl.errorReason,
            consecutiveFallbacks: deps.simulationControl.consecutiveFallbacks,
            fallbackThreshold: deps.simulationControl.fallbackThreshold,
            generatedFallback: deps.autoGenerateCases && deps.caseQueue.queued().length === 0,
        };
    };

    const publicQueueSnapshot = async () => {
        const snapshot = await queueSnapshot();
        return {
            queuedCount: snapshot.queuedCount,
            runningSessionId: snapshot.runningSessionId,
            automationEnabled: snapshot.automationEnabled,
            generatedFallback: snapshot.generatedFallback,
            queue: snapshot.queue
                .filter(item => item.status === 'queued')
                .map(({ submittedBy: _submittedBy, ...item }) => item),
        };
    };

    const publicQueueNonces = new Map<string, number>();
    const recentPublicPrompts = new Map<string, number>();

    const prunePublicQueueSecurityCaches = () => {
        const now = Date.now();
        for (const [nonce, expiresAt] of publicQueueNonces) {
            if (expiresAt <= now) publicQueueNonces.delete(nonce);
        }
        for (const [key, expiresAt] of recentPublicPrompts) {
            if (expiresAt <= now) recentPublicPrompts.delete(key);
        }
    };

    const consumePublicQueueNonce = (nonce: unknown): boolean => {
        if (process.env.PUBLIC_QUEUE_ALLOW_NONCE_SUBMISSIONS !== 'true') return false;
        if (typeof nonce !== 'string' || !nonce.trim()) return false;
        prunePublicQueueSecurityCaches();
        const expiresAt = publicQueueNonces.get(nonce);
        publicQueueNonces.delete(nonce);
        return typeof expiresAt === 'number' && expiresAt > Date.now();
    };

    const publicPromptDuplicateKey = (req: Request, prompt: string): string => {
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const digest = crypto
            .createHash('sha256')
            .update(prompt.toLowerCase())
            .digest('base64url');
        return `${ip}:${digest}`;
    };

    const isDuplicatePublicPrompt = (req: Request, prompt: string): boolean => {
        prunePublicQueueSecurityCaches();
        const key = publicPromptDuplicateKey(req, prompt);
        if (recentPublicPrompts.has(key)) return true;
        recentPublicPrompts.set(key, Date.now() + PUBLIC_QUEUE_DUPLICATE_TTL_MS);
        return false;
    };

    const enqueueCase = (input: {
        prompt: unknown;
        source: CaseQueueSource;
        submittedBy?: unknown;
    }) => {
        const prompt = typeof input.prompt === 'string' ? input.prompt : '';
        const moderation = moderateContent(prompt);
        if (moderation.flagged) {
            throw new CaseQueueValidationError('prompt violates safety policy');
        }
        return deps.caseQueue.enqueue({
            prompt,
            source: input.source,
            submittedBy:
                typeof input.submittedBy === 'string' ? input.submittedBy : undefined,
        });
    };

    const startQueuedCase = async (item: CaseQueueItem) => {
        const active = await getRunningOrPendingSession();
        if (active) return { started: false, active };
        const session = await createCourtSession(
            {
                store: deps.store,
                auditLogStore: deps.auditLogStore,
                autoRunCourtSession: deps.autoRunCourtSession,
                verdictWindowMs: deps.verdictWindowMs,
                sentenceWindowMs: deps.sentenceWindowMs,
                recorder: deps.recorder,
                replay: deps.replay,
                onLlmFallback: deps.onLlmFallback,
                onLlmSuccess: deps.onLlmSuccess,
            },
            {
                topic: item.prompt,
                caseSource: item.source,
                queueItemId: item.id,
            },
        );
        deps.caseQueue.markRunning(item.id, session.id);
        return { started: true, session };
    };

    app.get('/api/court/case-queue', async (_req, res) => {
        res.json(await queueSnapshot());
    });

    app.get('/api/public/case-queue', audienceInteractionLimiter, async (_req, res) => {
        res.json(await publicQueueSnapshot());
    });

    app.get('/api/public/case-queue/nonce', audienceInteractionLimiter, (_req, res) => {
        if (process.env.PUBLIC_QUEUE_ALLOW_NONCE_SUBMISSIONS !== 'true') {
            return sendError(
                res,
                404,
                'PUBLIC_QUEUE_NONCE_DISABLED',
                'Public queue nonce submissions are disabled.',
            );
        }
        prunePublicQueueSecurityCaches();
        const nonce = crypto.randomUUID();
        publicQueueNonces.set(nonce, Date.now() + PUBLIC_QUEUE_NONCE_TTL_MS);
        res.json({ nonce, expiresInSeconds: PUBLIC_QUEUE_NONCE_TTL_MS / 1000 });
    });

    app.get('/api/admin/simulation-control', adminGet, async (_req, res) => {
        res.json({ control: deps.simulationControl, queue: await queueSnapshot() });
    });

    app.post('/api/admin/simulation-control/pause', adminPost, async (req, res) => {
        deps.simulationControl.automationPaused = true;
        deps.simulationControl.pausedAt = new Date().toISOString();
        if (typeof req.body?.reason === 'string' && req.body.reason.trim()) {
            deps.simulationControl.errorReason = req.body.reason.trim();
        }
        return res.json({ control: deps.simulationControl, queue: await queueSnapshot() });
    });

    app.post('/api/admin/simulation-control/resume', adminPost, async (_req, res) => {
        deps.simulationControl.automationPaused = false;
        deps.simulationControl.errorState = false;
        deps.simulationControl.errorReason = undefined;
        deps.simulationControl.consecutiveFallbacks = 0;
        deps.simulationControl.resumedAt = new Date().toISOString();
        return res.json({ control: deps.simulationControl, queue: await queueSnapshot() });
    });

    const requireCaseQueueSubmitToken = (req: Request, res: Response, next: NextFunction) => {
        const configuredToken = process.env.CASE_QUEUE_SUBMIT_TOKEN;
        if (!configuredToken) {
            return sendError(
                res,
                503,
                'CASE_QUEUE_SUBMISSIONS_DISABLED',
                'Public case queue submissions are disabled until CASE_QUEUE_SUBMIT_TOKEN is configured',
            );
        }
        const providedToken = req.header('X-Case-Queue-Token') ?? '';
        const configured = Buffer.from(configuredToken);
        const provided = Buffer.from(providedToken);
        const matches =
            configured.length === provided.length &&
            crypto.timingSafeEqual(configured, provided);
        if (!matches) {
            return sendError(res, 401, 'CASE_QUEUE_UNAUTHORIZED', 'Not authorized to submit cases');
        }
        next();
    };

    app.post(
        '/api/court/case-queue',
        audienceInteractionLimiter,
        requireCaseQueueSubmitToken,
        async (req, res) => {
            try {
                const item = enqueueCase({
                    prompt: req.body?.prompt,
                    source: 'twitch',
                    submittedBy: req.body?.submittedBy,
                });
                return res.status(201).json({ item, snapshot: await queueSnapshot() });
            } catch (error) {
                if (error instanceof CaseQueueValidationError) {
                    return sendError(res, 400, 'CASE_PROMPT_REJECTED', error.message);
                }
                throw error;
            }
        },
    );

    app.post('/api/public/case-queue', audienceInteractionLimiter, async (req, res) => {
        const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';
        const turnstileToken =
            typeof req.body?.turnstileToken === 'string' ? req.body.turnstileToken : '';
        const nonceValid = consumePublicQueueNonce(req.body?.nonce);
        const turnstileValid =
            turnstileToken ? await verifyTurnstile(turnstileToken, req.ip) : false;

        if (!nonceValid && !turnstileValid) {
            return sendError(
                res,
                403,
                'PUBLIC_QUEUE_VERIFICATION_REQUIRED',
                'Public submissions require a fresh verification token.',
            );
        }

        try {
            const normalizedPrompt = validateCasePrompt(prompt);
            const moderation = moderateContent(normalizedPrompt);
            if (moderation.flagged) {
                throw new CaseQueueValidationError('prompt violates safety policy');
            }

            if (isDuplicatePublicPrompt(req, normalizedPrompt)) {
                return sendError(
                    res,
                    409,
                    'DUPLICATE_PUBLIC_PROMPT',
                    'This prompt was already submitted recently.',
                );
            }

            const item = deps.caseQueue.enqueue({
                prompt: normalizedPrompt,
                source: 'public_page',
                submittedBy: 'public-page',
            });

            const queued = deps.caseQueue.queued();
            const position = queued.findIndex(candidate => candidate.id === item.id) + 1;
            return res.status(202).json({
                item,
                position,
                estimatedStartMinutes: estimateQueueStartMinutes(
                    deps.caseQueue,
                    item.id,
                    parsePositiveInt(process.env.CASE_QUEUE_ESTIMATED_CASE_MINUTES, 12),
                ),
                snapshot: await publicQueueSnapshot(),
            });
        } catch (error) {
            if (error instanceof CaseQueueValidationError) {
                return sendError(res, 400, 'CASE_PROMPT_REJECTED', error.message);
            }
            throw error;
        }
    });

    app.post('/api/admin/case-queue', adminPost, async (req, res) => {
        try {
            const item = enqueueCase({
                prompt: req.body?.prompt,
                source: 'operator',
                submittedBy: req.body?.submittedBy ?? 'operator',
            });
            return res.status(201).json({ item, snapshot: await queueSnapshot() });
        } catch (error) {
            if (error instanceof CaseQueueValidationError) {
                return sendError(res, 400, 'CASE_PROMPT_REJECTED', error.message);
            }
            throw error;
        }
    });

    app.post('/api/admin/case-queue/:id/start', adminPost, async (req, res) => {
        const item = deps.caseQueue
            .queued()
            .find(candidate => candidate.id === req.params.id);
        if (!item) {
            return sendError(res, 404, 'CASE_QUEUE_ITEM_NOT_FOUND', 'Queued case not found');
        }
        const result = await startQueuedCase(item);
        if (!result.started) {
            return sendError(res, 409, 'CASE_ALREADY_RUNNING', 'A case is already running');
        }
        return res.json({ ...result, snapshot: await queueSnapshot() });
    });

    app.post('/api/admin/case-queue/:id/skip', adminPost, async (req, res) => {
        const item = deps.caseQueue.skip(req.params.id);
        if (!item) {
            return sendError(res, 404, 'CASE_QUEUE_ITEM_NOT_FOUND', 'Queued case not found');
        }
        return res.json({ item, snapshot: await queueSnapshot() });
    });

    app.get('/api/court/sessions/:id', async (req, res) => {
        const session = await deps.store.getSession(req.params.id);
        if (!session) {
            return sendError(
                res,
                404,
                'SESSION_NOT_FOUND',
                'Session not found',
            );
        }
        return res.json({ session });
    });

    app.get('/api/public/transcripts/:id', audienceInteractionLimiter, async (req, res) => {
        const session = await deps.store.getSession(req.params.id);
        if (!session || session.status !== 'completed') {
            return sendError(
                res,
                404,
                'TRANSCRIPT_NOT_FOUND',
                'Transcript not found',
            );
        }
        return res.json({ session });
    });

    app.post(
        '/api/court/sessions',
        adminPost,
        createSessionHandler({
            store: deps.store,
            auditLogStore: deps.auditLogStore,
            autoRunCourtSession: deps.autoRunCourtSession,
            verdictWindowMs: deps.verdictWindowMs,
            sentenceWindowMs: deps.sentenceWindowMs,
            recorder: deps.recorder,
            replay: deps.replay,
            onLlmFallback: deps.onLlmFallback,
            onLlmSuccess: deps.onLlmSuccess,
        }),
    );

    app.post(
        '/api/court/sessions/:id/vote',
        createVoteHandler(deps.store, deps.voteSpamGuard),
    );

    app.post(
        '/api/court/sessions/:id/phase',
        adminPost,
        createPhaseHandler(deps.store),
    );

    // Phase 7: Audience interaction endpoints (#77)
    app.post(
        '/api/court/sessions/:id/press',
        audienceInteractionLimiter,
        async (req: Request, res: Response) => {
            try {
                const session = await deps.store.getSession(req.params.id);
                if (!session) {
                    return sendError(
                        res,
                        404,
                        'SESSION_NOT_FOUND',
                        'Session not found',
                    );
                }

                const statementNumber = parseInt(req.body?.statementNumber, 10);
                if (isNaN(statementNumber) || statementNumber < 1) {
                    return sendError(
                        res,
                        400,
                        'INVALID_STATEMENT_NUMBER',
                        'statementNumber must be a positive integer',
                    );
                }

                // Increment vote count for this statement
                session.metadata.pressVotes[statementNumber] =
                    (session.metadata.pressVotes[statementNumber] ?? 0) + 1;

                // Emit vote_updated event
                deps.store.emitEvent(req.params.id, 'press_vote_updated', {
                    statementNumber,
                    pressVotes: session.metadata.pressVotes,
                    phase: session.phase,
                });

                return res.json({
                    ok: true,
                    action: 'press',
                    statementNumber,
                    pressVotes: session.metadata.pressVotes,
                });
            } catch (error) {
                console.error('Error in press endpoint:', error);
                return sendError(
                    res,
                    500,
                    'PRESS_FAILED',
                    'Failed to record press vote',
                );
            }
        },
    );

    app.post(
        '/api/court/sessions/:id/present',
        audienceInteractionLimiter,
        async (req: Request, res: Response) => {
            try {
                const session = await deps.store.getSession(req.params.id);
                if (!session) {
                    return sendError(
                        res,
                        404,
                        'SESSION_NOT_FOUND',
                        'Session not found',
                    );
                }

                const evidenceId =
                    typeof req.body?.evidenceId === 'string' ?
                        req.body.evidenceId.trim()
                    :   undefined;
                if (!evidenceId) {
                    return sendError(
                        res,
                        400,
                        'MISSING_EVIDENCE_ID',
                        'evidenceId is required',
                    );
                }

                // Increment vote count for this evidence
                session.metadata.presentVotes[evidenceId] =
                    (session.metadata.presentVotes[evidenceId] ?? 0) + 1;

                // Emit vote_updated event
                deps.store.emitEvent(req.params.id, 'present_vote_updated', {
                    evidenceId,
                    presentVotes: session.metadata.presentVotes,
                    phase: session.phase,
                });

                return res.json({
                    ok: true,
                    action: 'present',
                    evidenceId,
                    presentVotes: session.metadata.presentVotes,
                });
            } catch (error) {
                console.error('Error in present endpoint:', error);
                return sendError(
                    res,
                    500,
                    'PRESENT_FAILED',
                    'Failed to record present vote',
                );
            }
        },
    );

    // EventSub webhook for channel point redemptions
    const redemptionLimiter = new RedemptionRateLimiter(
        DEFAULT_REDEMPTION_RATE_LIMIT,
    );

    app.post(
        '/api/twitch/eventsub',
        express.json(),
        async (req: Request, res: Response) => {
            // Validate EventSub signature if client secret is available
            const clientSecret = process.env.TWITCH_CLIENT_SECRET;
            if (clientSecret && !validateEventSubSignature(req, clientSecret)) {
                console.warn('[EventSub] Invalid signature');
                return res.status(403).json({ error: 'Invalid signature' });
            }

            const challenge = parseEventSubChallenge(req.body);
            if (challenge) {
                return res.status(200).type('text/plain').send(challenge);
            }

            // Parse webhook
            const socialEvent = parseSocialEventSubNotification(req.body);
            if (socialEvent) {
                const social = deps.socialFeed.record(socialEvent);
                const redactedSocial = redactTwitchSocialSnapshot(social);
                const active = await getRunningOrPendingSession();
                if (active) {
                    deps.store.emitEvent(active.id, 'twitch_social_updated', {
                        social: redactedSocial,
                    });
                }
                return res.json({ ok: true, social: redactedSocial });
            }

            const event = parseEventSubWebhook(req.body);
            if (!event) {
                // Return 204 for verification or non-redemption events
                return res.status(204).send();
            }

            // Only handle channel point redemptions
            if (
                event.subscription.type !==
                'channel.channel_points_custom_reward_redemption.add'
            ) {
                return res.status(204).send();
            }

            const sessionId = req.query.sessionId as string | undefined;
            if (!sessionId) {
                console.warn('[EventSub] Missing sessionId query parameter');
                return res
                    .status(400)
                    .json({ error: 'sessionId query parameter required' });
            }

            try {
                const session = await deps.store.getSession(sessionId);
                if (!session) {
                    console.warn(`[EventSub] Session not found: ${sessionId}`);
                    return res.status(404).json({ error: 'Session not found' });
                }

                const rewardTitle = event.event.reward.title;
                const actionMapping = mapRedemptionToAction(rewardTitle);

                if (!actionMapping) {
                    console.log(`[EventSub] Unknown reward: ${rewardTitle}`);
                    return res.status(204).send();
                }

                const action = actionMapping.action;
                const username = event.event.user_name;

                // Check rate limit
                const rateLimitCheck = redemptionLimiter.check(
                    sessionId,
                    action,
                );
                if (!rateLimitCheck.allowed) {
                    console.log(
                        `[EventSub] Redemption rate limited: ${action} from ${username} (${rateLimitCheck.reason})`,
                    );
                    return res.status(429).json({
                        error: 'Rate limited',
                        reason: rateLimitCheck.reason,
                    });
                }

                // Record the redemption
                redemptionLimiter.record(sessionId, action);

                // Emit event for each redemption type
                deps.store.emitEvent(sessionId, 'render_directive', {
                    directive: {
                        effect:
                            action === 'objection' ? 'present_force'
                            : action === 'hold_it' ? 'witness_interrupt'
                            : 'judge_intervention',
                        redemptionUsername: username,
                        redemptionType: action,
                    },
                    phase: session.phase,
                    emittedAt: new Date().toISOString(),
                });

                console.log(
                    `[EventSub] Processed redemption: ${action} from ${username} in session ${sessionId}`,
                );

                return res.json({ ok: true, action, username });
            } catch (error) {
                console.error('[EventSub] Error processing webhook:', error);
                return res.status(500).json({ error: 'Internal server error' });
            }
        },
    );

    app.get(
        '/api/court/sessions/:id/stream',
        createStreamHandler(deps.store, deps.replay),
    );
}

export interface CreateServerAppOptions {
    autoRunCourtSession?: boolean;
    autoGenerateCases?: boolean;
    startTwitchBot?: boolean;
    store?: CourtSessionStore;
    replay?: ReplayRuntimeOptions;
}

export async function createServerApp(
    options: CreateServerAppOptions = {},
): Promise<{
    app: ReturnType<typeof express>;
    store: CourtSessionStore;
    dispose: () => void;
}> {
    const app = express();

    const trustProxy = resolveTrustProxySetting();
    if (trustProxy !== undefined) {
        app.set('trust proxy', trustProxy);
    }

    const baseStore = options.store ?? (await createCourtSessionStore());
    const store = instrumentCourtSessionStore(baseStore);
    const auditConfig = resolveLLMAuditConfig();
    const auditLogStore = createLLMAuditLogStore(auditConfig);
    const replay =
        options.replay ?
            await loadReplayRecording({
                filePath: options.replay.filePath,
                speed: options.replay.speed,
            })
        :   undefined;

    const autoRunCourtSession = options.autoRunCourtSession ?? !replay;
    const autoGenerateCases =
        options.autoGenerateCases ?? process.env.AUTO_GENERATE_CASES !== 'false';
    const autoCaseIdleDelayMs = parsePositiveInt(
        process.env.AUTO_CASE_IDLE_DELAY_MS,
        10_000,
    );
    const caseQueuePollMs = parsePositiveInt(
        process.env.CASE_QUEUE_POLL_MS,
        5_000,
    );
    const caseQueue = new CaseQueue();
    const simulationControl: SimulationControlState = {
        automationPaused: process.env.SIMULATION_AUTOSTART === 'false',
        errorState: false,
        fallbackThreshold: parsePositiveInt(
            process.env.LLM_FALLBACK_STOP_THRESHOLD,
            5,
        ),
        consecutiveFallbacks: 0,
    };
    const onLlmSuccess: RunCourtSessionOptions['onLlmSuccess'] = () => {
        simulationControl.consecutiveFallbacks = 0;
    };
    const onLlmFallback: RunCourtSessionOptions['onLlmFallback'] = async event => {
        simulationControl.consecutiveFallbacks += 1;
        simulationControl.lastFallbackAt = new Date().toISOString();
        if (
            simulationControl.consecutiveFallbacks <
            simulationControl.fallbackThreshold
        ) {
            return;
        }

        simulationControl.automationPaused = true;
        simulationControl.errorState = true;
        simulationControl.pausedAt = new Date().toISOString();
        simulationControl.errorReason = `LLM fallback circuit opened after ${simulationControl.consecutiveFallbacks} consecutive fallback/mock responses (${event.provider}/${event.model}).`;
        logger.error('[simulation] fallback circuit opened', {
            sessionId: event.sessionId,
            status: event.status,
            provider: event.provider,
            model: event.model,
            threshold: simulationControl.fallbackThreshold,
        });
        throw new FallbackCircuitOpenError(simulationControl.errorReason);
    };
    const recorder = new SessionEventRecorderManager(
        store,
        resolveRecordingsDir(),
    );
    const socialFeed = new TwitchSocialFeed();

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const appDir = path.resolve(__dirname, '../dist/app');
    const dashboardDir = path.resolve(__dirname, '../dist/dashboard');

    const verdictWindowMs = Number.parseInt(
        process.env.VERDICT_VOTE_WINDOW_MS ?? '20000',
        10,
    );
    const sentenceWindowMs = Number.parseInt(
        process.env.SENTENCE_VOTE_WINDOW_MS ?? '20000',
        10,
    );

    const voteSpamGuard = new VoteSpamGuard({
        maxVotesPerWindow: parsePositiveInt(
            process.env.VOTE_SPAM_MAX_VOTES_PER_WINDOW,
            10,
        ),
        windowMs: parsePositiveInt(process.env.VOTE_SPAM_WINDOW_MS, 60_000),
        duplicateWindowMs: parsePositiveInt(
            process.env.VOTE_SPAM_DUPLICATE_WINDOW_MS,
            5_000,
        ),
    });
    const PRUNE_INTERVAL_MS = 60_000;
    const pruneTimer = setInterval(
        () => voteSpamGuard.prune(),
        PRUNE_INTERVAL_MS,
    );
    pruneTimer.unref();

    app.use(express.json({
        verify: (req, _res, buffer) => {
            (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
        },
    }));
    app.use(express.urlencoded({ extended: false }));

    const adminAuth = resolveAdminAuthConfig();
    let twitchBot: ReturnType<typeof initTwitchBot> | null = null;

    registerApiRoutes(app, {
        store,
        auditLogStore,
        voteSpamGuard,
        autoRunCourtSession,
        verdictWindowMs,
        sentenceWindowMs,
        recorder,
        replay,
        adminAuth,
        caseQueue,
        autoGenerateCases,
        autoCaseIdleDelayMs,
        simulationControl,
        socialFeed,
        onLlmFallback,
        onLlmSuccess,
        onSessionCompleted: sessionId => twitchBot?.announceTranscriptLink(sessionId),
    });

    let caseSchedulerInFlight = false;
    let lastCaseStartAt = 0;
    const runCaseScheduler = async () => {
        if (
            !autoRunCourtSession ||
            replay ||
            caseSchedulerInFlight ||
            simulationControl.automationPaused ||
            simulationControl.errorState
        ) return;
        caseSchedulerInFlight = true;
        try {
            const sessions = await store.listSessions();
            for (const session of sessions) {
                if (session.status === 'completed' || session.status === 'failed') {
                    caseQueue.markCompletedForSession(session.id);
                }
            }

            const active = sessions.find(
                session =>
                    session.status === 'running' || session.status === 'pending',
            );
            if (active) return;

            const queued = caseQueue.nextQueued();
            const now = Date.now();
            if (
                !queued &&
                (!autoGenerateCases || now - lastCaseStartAt < autoCaseIdleDelayMs)
            ) {
                return;
            }

            const session = await createCourtSession(
                {
                    store,
                    auditLogStore,
                    autoRunCourtSession,
                    verdictWindowMs,
                    sentenceWindowMs,
                    recorder,
                    replay,
                    onLlmFallback,
                    onLlmSuccess,
                },
                queued ?
                    {
                        topic: queued.prompt,
                        caseSource: queued.source,
                        queueItemId: queued.id,
                    }
                :   { caseSource: 'generated' },
            );
            if (queued) {
                caseQueue.markRunning(queued.id, session.id);
            }
            lastCaseStartAt = now;
        } catch (error) {
            logger.warn(
                `[case-queue] scheduler failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        } finally {
            caseSchedulerInFlight = false;
        }
    };
    const caseSchedulerTimer = setInterval(
        () => void runCaseScheduler(),
        caseQueuePollMs,
    );
    caseSchedulerTimer.unref();
    void runCaseScheduler();

    // Start Twitch bot (noop if credentials absent)
    if (options.startTwitchBot !== false) {
        twitchBot = initTwitchBot({
            channel: process.env.TWITCH_CHANNEL ?? '',
            botUsername: process.env.TWITCH_BOT_USERNAME || undefined,
            botToken: process.env.TWITCH_BOT_TOKEN ?? '',
            clientId: process.env.TWITCH_CLIENT_ID ?? '',
            clientSecret: process.env.TWITCH_CLIENT_SECRET || undefined,
            refreshToken: process.env.TWITCH_REFRESH_TOKEN || undefined,
            tokenRuntimePath:
                process.env.TWITCH_TOKEN_RUNTIME_PATH || '/app/.runtime/twitch-token.json',
            tokenRefreshSkewMs: Number(
                process.env.TWITCH_TOKEN_REFRESH_SKEW_MS ?? 600000,
            ),
            apiBaseUrl: `http://localhost:${process.env.PORT ?? 3000}`,
            publicBaseUrl:
                process.env.PUBLIC_BASE_URL || 'https://jury-rigged.subcult.tv',
            helpIntervalMs: Number(process.env.TWITCH_HELP_INTERVAL_MS ?? 900000),
            welcomeFirstChatters:
                process.env.TWITCH_WELCOME_FIRST_CHATTERS !== 'false',
            caseQueueSubmitToken: process.env.CASE_QUEUE_SUBMIT_TOKEN || undefined,
            promptMinRole:
                process.env.TWITCH_PROMPT_MIN_ROLE === 'follower' ? 'follower'
                : process.env.TWITCH_PROMPT_MIN_ROLE === 'subscriber' ? 'subscriber'
                : process.env.TWITCH_PROMPT_MIN_ROLE === 'vip' ? 'vip'
                : process.env.TWITCH_PROMPT_MIN_ROLE === 'moderator' ? 'moderator'
                : process.env.TWITCH_PROMPT_MIN_ROLE === 'broadcaster' ? 'broadcaster'
                : 'everyone',
            getActiveSessionId: (() => {
                let cachedId: string | null = null;
                let cacheExpiresAt = 0;
                return async () => {
                    const now = Date.now();
                    if (now < cacheExpiresAt) return cachedId;
                    const sessions = await store.listSessions();
                    const running = sessions.find(s => s.status === 'running');
                    cachedId = running?.id ?? null;
                    cacheExpiresAt = now + 5_000; // cache for 5 sec; commands to a just-ended session fail gracefully
                    return cachedId;
                };
            })(),
        });

        twitchBot.start().catch(err => {
            logger.warn(
                `[Twitch Bot] Failed to start: ${err instanceof Error ? err.message : String(err)}`,
            );
        });
    }

    registerStaticAndSpaRoutes(app, {
        appDir,
        dashboardDir,
    }, adminAuth);

    const restartPendingIds = await store.recoverInterruptedSessions();
    if (autoRunCourtSession) {
        for (const sessionId of restartPendingIds) {
            try {
                await recorder.start({ sessionId });
            } catch (error) {
                logger.warn(
                    `[replay] failed to start recorder for recovered session=${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
            void runCourtSession(sessionId, store, {
                auditLogStore,
                onLlmFallback,
                onLlmSuccess,
            }).then(async () => {
                const completed = await store.getSession(sessionId);
                if (completed?.status === 'completed') {
                    await twitchBot?.announceTranscriptLink(sessionId);
                }
            });
        }
    }

    return {
        app,
        store,
        dispose: () => {
            clearInterval(pruneTimer);
            clearInterval(caseSchedulerTimer);
            void recorder.dispose();
            void auditLogStore.dispose();
        },
    };
}

export async function bootstrap(): Promise<void> {
    const replayLaunch = parseReplayLaunchConfig();
    const { app } = await createServerApp({
        replay: replayLaunch,
        autoRunCourtSession: replayLaunch ? false : undefined,
    });

    const port = Number.parseInt(process.env.PORT ?? '3000', 10);
    app.listen(port, () => {
        logger.info(`JuryRigged running on http://localhost:${port}`);
        logger.info(`Operator Dashboard: http://localhost:${port}/operator`);
        if (replayLaunch) {
            logger.info(
                `[replay] enabled file=${replayLaunch.filePath} speed=${replayLaunch.speed}x`,
            );
        }
    });
}

const isMainModule = (() => {
    const entry = process.argv[1];
    if (!entry) return false;
    return path.resolve(entry) === fileURLToPath(import.meta.url);
})();

if (isMainModule) {
    bootstrap().catch(error => {
        const context =
            error instanceof Error ?
                { message: error.message, stack: error.stack }
            :   { error };
        logger.error('Bootstrap failed', context);
        process.exit(1);
    });
}
