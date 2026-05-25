import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidAgent } from './agents.js';
import { assignCourtRoles, participantsFromRoleAssignments } from './court/roles.js';
import { runCourtSession } from './court/orchestrator.js';
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
    parseEventSubWebhook,
    mapRedemptionToAction,
    RedemptionRateLimiter,
    DEFAULT_REDEMPTION_RATE_LIMIT,
} from './twitch/eventsub.js';
import { initTwitchBot } from './twitch/bot.js';
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
    AgentId,
    CaseType,
    CourtPhase,
    GenreTag,
    PromptBankEntry,
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
    autoRunCourtSession: boolean;
    verdictWindowMs: number;
    sentenceWindowMs: number;
    recorder: SessionEventRecorderManager;
    replay?: LoadedReplayRecording;
}

function createSessionHandler(deps: SessionRouteDeps) {
    return async (req: Request, res: Response): Promise<Response> => {
        try {
            // Phase 3: Build genre history from recent sessions
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

            // Phase 3: Select next prompt from bank using genre rotation
            let selectedPrompt: PromptBankEntry;
            try {
                selectedPrompt = selectNextSafePrompt(genreHistory);
            } catch (error) {
                logger.error('[server] selectNextSafePrompt failed:', {
                    error: error instanceof Error ? error.message : error,
                });
                return sendError(
                    res,
                    503,
                    'SAFE_PROMPT_UNAVAILABLE',
                    'No safe prompts available',
                );
            }

            const userTopic =
                typeof req.body?.topic === 'string' ?
                    req.body.topic.trim()
                :   '';

            if (userTopic && userTopic.length < 10) {
                return sendError(
                    res,
                    400,
                    'INVALID_TOPIC',
                    'topic must be at least 10 characters',
                );
            }

            if (userTopic) {
                const moderation = moderateContent(userTopic);
                if (moderation.flagged) {
                    return sendError(
                        res,
                        400,
                        'TOPIC_REJECTED',
                        'topic violates safety policy',
                        { reasons: moderation.reasons },
                    );
                }
            }

            const topic = userTopic || selectedPrompt.casePrompt;

            const caseType: CaseType =
                req.body?.caseType === 'civil' ? 'civil'
                : req.body?.caseType === 'criminal' ? 'criminal'
                : selectedPrompt.caseType; // Use selected prompt's case type if not specified

            const rawOverride = Array.isArray(req.body?.participants)
                ? (req.body.participants as string[]).filter((id): id is AgentId => isValidAgent(id))
                : undefined;

            const roleAssignments = assignCourtRoles(rawOverride && rawOverride.length > 0 ? rawOverride : undefined);
            const participants = participantsFromRoleAssignments(roleAssignments);

            const sentenceOptions =
                (
                    Array.isArray(req.body?.sentenceOptions) &&
                    req.body.sentenceOptions.length > 0
                ) ?
                    req.body.sentenceOptions
                        .map((option: unknown) => String(option).trim())
                        .filter(Boolean)
                :   [
                        'Community service in the meme archives',
                        'Banished to the shadow realm',
                        'Mandatory apology haikus',
                        'Ethics training hosted by a raccoon',
                        'Ukulele ankle-monitor probation',
                    ];

            // Phase 3: Update genre history
            const updatedGenreHistory = [
                ...genreHistory,
                selectedPrompt.genre,
            ].slice(-DEFAULT_ROTATION_CONFIG.maxHistorySize);

            const session = await deps.store.createSession({
                topic,
                participants,
                metadata: {
                    mode: 'juryrigged',
                    casePrompt: topic,
                    caseType,
                    sentenceOptions,
                    verdictVoteWindowMs: deps.verdictWindowMs,
                    sentenceVoteWindowMs: deps.sentenceWindowMs,
                    verdictVotes: {},
                    sentenceVotes: {},
                    pressVotes: {},
                    presentVotes: {},
                    roleAssignments,
                    // Phase 3: Add genre tracking
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
                void runCourtSession(session.id, deps.store);
            }

            return res.status(201).json({ session });
        } catch (error) {
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

function registerStaticAndSpaRoutes(
    app: ExpressApp,
    dirs: { appDir: string; dashboardDir: string },
): void {
    // Serve operator dashboard
    app.use('/operator', express.static(dirs.dashboardDir));

    // Serve fresh public app
    app.use(express.static(dirs.appDir));

    // Catch-all for operator dashboard (SPA routing)
    app.get('/operator/*', (_req, res) => {
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
    },
): void {
    app.get('/api/health', (_req, res) => {
        res.json({ ok: true, service: 'juryrigged' });
    });

    app.get('/api/metrics', async (_req, res) => {
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

    app.post(
        '/api/court/sessions',
        createSessionHandler({
            store: deps.store,
            autoRunCourtSession: deps.autoRunCourtSession,
            verdictWindowMs: deps.verdictWindowMs,
            sentenceWindowMs: deps.sentenceWindowMs,
            recorder: deps.recorder,
            replay: deps.replay,
        }),
    );

    app.post(
        '/api/court/sessions/:id/vote',
        createVoteHandler(deps.store, deps.voteSpamGuard),
    );

    app.post('/api/court/sessions/:id/phase', createPhaseHandler(deps.store));

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

            // Parse webhook
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
    const replay =
        options.replay ?
            await loadReplayRecording({
                filePath: options.replay.filePath,
                speed: options.replay.speed,
            })
        :   undefined;

    const autoRunCourtSession = options.autoRunCourtSession ?? !replay;
    const recorder = new SessionEventRecorderManager(
        store,
        resolveRecordingsDir(),
    );

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

    app.use(express.json());

    registerApiRoutes(app, {
        store,
        voteSpamGuard,
        autoRunCourtSession,
        verdictWindowMs,
        sentenceWindowMs,
        recorder,
        replay,
    });

    // Start Twitch bot (noop if credentials absent)
    const twitchBot = initTwitchBot({
        channel: process.env.TWITCH_CHANNEL ?? '',
        botToken: process.env.TWITCH_BOT_TOKEN ?? '',
        clientId: process.env.TWITCH_CLIENT_ID ?? '',
        clientSecret: process.env.TWITCH_CLIENT_SECRET ?? '',
        apiBaseUrl: `http://localhost:${process.env.PORT ?? 3000}`,
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

    registerStaticAndSpaRoutes(app, {
        appDir,
        dashboardDir,
    });

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
            void runCourtSession(sessionId, store);
        }
    }

    return {
        app,
        store,
        dispose: () => {
            clearInterval(pruneTimer);
            void recorder.dispose();
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
