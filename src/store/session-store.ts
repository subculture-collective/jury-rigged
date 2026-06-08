import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import postgres, {
    type JSONValue,
    type Sql,
    type TransactionSql,
} from 'postgres';
import type {
    AgentId,
    CaseType,
    CourtEvent,
    CourtPhase,
    CourtRole,
    CourtSession,
    CourtSessionMetadata,
    CourtTurn,
    TranscriptSearchResult,
} from '../types.js';
import { runMigrations } from '../db/migrations.js';

export class CourtValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CourtValidationError';
    }
}

export class CourtNotFoundError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CourtNotFoundError';
    }
}

function deepCopy<T>(value: T): T {
    return structuredClone(value);
}

const PHASE_SEQUENCE: CourtPhase[] = [
    'case_prompt',
    'openings',
    'witness_exam',
    'evidence_reveal',
    'closings',
    'verdict_vote',
    'sentence_vote',
    'final_ruling',
];

function phaseIndex(phase: CourtPhase): number {
    return PHASE_SEQUENCE.indexOf(phase);
}

function assertValidPhaseTransition(
    current: CourtPhase,
    next: CourtPhase,
): void {
    const currentIndex = phaseIndex(current);
    const nextIndex = phaseIndex(next);
    if (currentIndex === -1) {
        throw new CourtValidationError(`Unknown current phase: ${current}`);
    }
    if (nextIndex === -1) {
        throw new CourtValidationError(`Unknown next phase: ${next}`);
    }
    const isNoop = currentIndex === nextIndex;
    const isForwardStep = nextIndex === currentIndex + 1;
    const skipEvidenceReveal =
        current === 'witness_exam' && next === 'closings';
    if (!isNoop && !isForwardStep && !skipEvidenceReveal) {
        throw new CourtValidationError(
            `Invalid phase transition: ${current} -> ${next}`,
        );
    }
}

function allowedVerdictChoices(caseType: CaseType): string[] {
    return caseType === 'civil' ?
            ['liable', 'not_liable']
        :   ['guilty', 'not_guilty'];
}

function pollTypeForPhase(
    phase: CourtPhase,
): 'verdict' | 'sentence' | undefined {
    if (phase === 'verdict_vote') return 'verdict';
    if (phase === 'sentence_vote') return 'sentence';
    return undefined;
}

function compareTranscriptSessions(
    left: { completedAt?: string; createdAt: string },
    right: { completedAt?: string; createdAt: string },
): number {
    const leftCompletedAt = left.completedAt ?? '';
    const rightCompletedAt = right.completedAt ?? '';

    if (leftCompletedAt && rightCompletedAt) {
        return rightCompletedAt.localeCompare(leftCompletedAt);
    }

    if (leftCompletedAt) return -1;
    if (rightCompletedAt) return 1;

    return right.createdAt.localeCompare(left.createdAt);
}

function mapSessionToTranscriptSearchResult(
    session: Pick<
        CourtSession,
        | 'id'
        | 'topic'
        | 'status'
        | 'phase'
        | 'metadata'
        | 'createdAt'
        | 'startedAt'
        | 'completedAt'
        | 'turnCount'
    >,
): TranscriptSearchResult {
    return {
        id: session.id,
        topic: session.topic,
        status: session.status,
        phase: session.phase,
        caseType: session.metadata.caseType,
        casePrompt: session.metadata.casePrompt,
        createdAt: session.createdAt,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        turnCount: session.turnCount,
    };
}

export interface CourtSessionStore {
    createSession(input: {
        topic: string;
        participants: AgentId[];
        metadata: CourtSessionMetadata;
    }): Promise<CourtSession>;
    listSessions(): Promise<CourtSession[]>;
    getSession(sessionId: string): Promise<CourtSession | undefined>;
    searchTranscripts(
        query: string,
        limit?: number,
    ): Promise<TranscriptSearchResult[]>;
    startSession(sessionId: string): Promise<CourtSession>;
    setPhase(
        sessionId: string,
        phase: CourtPhase,
        phaseDurationMs?: number,
    ): Promise<CourtSession>;
    addTurn(input: {
        sessionId: string;
        speaker: AgentId;
        role: CourtRole;
        phase: CourtPhase;
        dialogue: string;
        moderationResult?: {
            flagged: boolean;
            reasons: string[];
        };
    }): Promise<CourtTurn>;
    castVote(input: {
        sessionId: string;
        voteType: 'verdict' | 'sentence';
        choice: string;
    }): Promise<CourtSession>;
    recordFinalRuling(input: {
        sessionId: string;
        verdict: string;
        sentence: string;
    }): Promise<CourtSession>;
    recordRecap(input: {
        sessionId: string;
        turnId: string;
        phase: CourtPhase;
        cycleNumber: number;
    }): Promise<void>;
    completeSession(sessionId: string): Promise<CourtSession>;
    failSession(sessionId: string, reason: string): Promise<CourtSession>;
    recoverInterruptedSessions(): Promise<string[]>;
    subscribe(
        sessionId: string,
        handler: (event: CourtEvent) => void,
    ): () => void;
    emitEvent(
        sessionId: string,
        type: CourtEvent['type'],
        payload: Record<string, unknown>,
    ): void;
    patchMetadata(
        sessionId: string,
        patch: Partial<CourtSessionMetadata>,
    ): Promise<void>;
}

class InMemoryCourtSessionStore implements CourtSessionStore {
    private readonly sessions = new Map<string, CourtSession>();
    private readonly eventEmitter = new EventEmitter();

    async createSession(input: {
        topic: string;
        participants: AgentId[];
        metadata: CourtSessionMetadata;
    }): Promise<CourtSession> {
        const session: CourtSession = {
            id: randomUUID(),
            topic: input.topic,
            status: 'pending',
            participants: deepCopy(input.participants),
            phase: 'case_prompt',
            turnCount: 0,
            turns: [],
            metadata: deepCopy(input.metadata),
            createdAt: new Date().toISOString(),
        };

        this.sessions.set(session.id, session);
        this.publish({
            sessionId: session.id,
            type: 'session_created',
            payload: { sessionId: session.id },
        });

        return deepCopy(session);
    }

    async listSessions(): Promise<CourtSession[]> {
        const sorted = [...this.sessions.values()].sort((a, b) =>
            a.createdAt < b.createdAt ? 1 : -1,
        );
        return deepCopy(sorted);
    }

    async getSession(sessionId: string): Promise<CourtSession | undefined> {
        const session = this.sessions.get(sessionId);
        return session ? deepCopy(session) : undefined;
    }

    async searchTranscripts(
        query: string,
        limit = 25,
    ): Promise<TranscriptSearchResult[]> {
        const normalized = query.trim().toLowerCase();
        const cappedLimit = Math.max(1, Math.min(Math.trunc(limit), 50));
        const sessions = await this.listSessions();

        return sessions
            .filter(session => session.status === 'completed')
            .filter(session => {
                if (!normalized) return true;

                const haystack = [
                    session.id,
                    session.topic,
                    session.metadata.casePrompt,
                ]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase();

                return haystack.includes(normalized);
            })
            .sort(compareTranscriptSessions)
            .slice(0, cappedLimit)
            .map(mapSessionToTranscriptSearchResult);
    }

    async startSession(sessionId: string): Promise<CourtSession> {
        const session = this.mustGet(sessionId);
        session.status = 'running';
        session.startedAt = new Date().toISOString();

        this.publish({
            sessionId,
            type: 'session_started',
            payload: { sessionId, startedAt: session.startedAt },
        });

        return deepCopy(session);
    }

    async setPhase(
        sessionId: string,
        phase: CourtPhase,
        phaseDurationMs?: number,
    ): Promise<CourtSession> {
        const session = this.mustGet(sessionId);
        const previousPhase = session.phase;
        assertValidPhaseTransition(session.phase, phase);
        session.phase = phase;
        session.metadata.phaseStartedAt = new Date().toISOString();

        let voteClosedPayload:
            | {
                  pollType: 'verdict' | 'sentence';
                  closedAt: string;
                  votes: Record<string, number>;
                  nextPhase: CourtPhase;
              }
            | undefined;

        if (phaseDurationMs != null) {
            session.metadata.phaseDurationMs = phaseDurationMs;
        }

        const closingPoll = pollTypeForPhase(previousPhase);
        if (closingPoll && previousPhase !== phase) {
            const closedAt = new Date().toISOString();
            const votes =
                closingPoll === 'verdict' ?
                    { ...session.metadata.verdictVotes }
                :   { ...session.metadata.sentenceVotes };
            session.metadata.voteSnapshots ??= {};
            session.metadata.voteSnapshots[closingPoll] = {
                closedAt,
                votes,
            };
            voteClosedPayload = {
                pollType: closingPoll,
                closedAt,
                votes,
                nextPhase: phase,
            };
        }

        this.publish({
            sessionId,
            type: 'phase_changed',
            payload: {
                phase,
                phaseStartedAt: session.metadata.phaseStartedAt,
                phaseDurationMs: session.metadata.phaseDurationMs,
            },
        });

        if (voteClosedPayload) {
            this.publish({
                sessionId,
                type: 'vote_closed',
                payload: voteClosedPayload,
            });

            this.publish({
                sessionId,
                type: 'analytics_event',
                payload: {
                    name: 'poll_closed',
                    pollType: voteClosedPayload.pollType,
                    phase,
                },
            });
        }

        const openingPoll = pollTypeForPhase(phase);
        if (openingPoll && previousPhase !== phase) {
            this.publish({
                sessionId,
                type: 'analytics_event',
                payload: {
                    name: 'poll_started',
                    pollType: openingPoll,
                    phase,
                },
            });
        }

        return deepCopy(session);
    }

    async addTurn(input: {
        sessionId: string;
        speaker: AgentId;
        role: CourtRole;
        phase: CourtPhase;
        dialogue: string;
        moderationResult?: {
            flagged: boolean;
            reasons: string[];
        };
    }): Promise<CourtTurn> {
        const session = this.mustGet(input.sessionId);

        const turn: CourtTurn = {
            id: randomUUID(),
            sessionId: input.sessionId,
            turnNumber: session.turns.length,
            speaker: input.speaker,
            role: input.role,
            phase: input.phase,
            dialogue: input.dialogue,
            createdAt: new Date().toISOString(),
        };

        session.turns.push(turn);
        session.turnCount = session.turns.length;

        this.publish({
            sessionId: input.sessionId,
            type: 'turn',
            payload: { turn },
        });

        if (input.moderationResult?.flagged) {
            this.publish({
                sessionId: input.sessionId,
                type: 'moderation_action',
                payload: {
                    turnId: turn.id,
                    speaker: input.speaker,
                    reasons: input.moderationResult.reasons,
                    phase: input.phase,
                },
            });
        }

        return deepCopy(turn);
    }

    async castVote(input: {
        sessionId: string;
        voteType: 'verdict' | 'sentence';
        choice: string;
    }): Promise<CourtSession> {
        const session = this.mustGet(input.sessionId);
        if (
            (input.voteType === 'verdict' &&
                session.phase !== 'verdict_vote') ||
            (input.voteType === 'sentence' && session.phase !== 'sentence_vote')
        ) {
            throw new CourtValidationError(
                `Cannot cast ${input.voteType} vote during phase ${session.phase}`,
            );
        }

        if (input.voteType === 'verdict') {
            const validChoices = allowedVerdictChoices(
                session.metadata.caseType,
            );
            if (!validChoices.includes(input.choice)) {
                throw new CourtValidationError(
                    `Invalid verdict choice: ${input.choice}. Valid choices: ${validChoices.join(', ')}`,
                );
            }
        } else if (!session.metadata.sentenceOptions.includes(input.choice)) {
            throw new CourtValidationError(
                `Invalid sentence choice: ${input.choice}. Valid choices: ${session.metadata.sentenceOptions.join(', ')}`,
            );
        }

        if (input.voteType === 'verdict') {
            session.metadata.verdictVotes[input.choice] =
                (session.metadata.verdictVotes[input.choice] ?? 0) + 1;
        } else {
            session.metadata.sentenceVotes[input.choice] =
                (session.metadata.sentenceVotes[input.choice] ?? 0) + 1;
        }

        this.publish({
            sessionId: input.sessionId,
            type: 'vote_updated',
            payload: {
                voteType: input.voteType,
                choice: input.choice,
                verdictVotes: session.metadata.verdictVotes,
                sentenceVotes: session.metadata.sentenceVotes,
            },
        });
        this.publish({
            sessionId: input.sessionId,
            type: 'analytics_event',
            payload: {
                name: 'vote_completed',
                pollType: input.voteType,
                choice: input.choice,
            },
        });

        return deepCopy(session);
    }

    async recordFinalRuling(input: {
        sessionId: string;
        verdict: string;
        sentence: string;
    }): Promise<CourtSession> {
        const session = this.mustGet(input.sessionId);
        session.metadata.finalRuling = {
            verdict: input.verdict,
            sentence: input.sentence,
            decidedAt: new Date().toISOString(),
        };
        return deepCopy(session);
    }

    async recordRecap(input: {
        sessionId: string;
        turnId: string;
        phase: CourtPhase;
        cycleNumber: number;
    }): Promise<void> {
        const session = this.mustGet(input.sessionId);
        session.metadata.recapTurnIds ??= [];
        if (!session.metadata.recapTurnIds.includes(input.turnId)) {
            session.metadata.recapTurnIds.push(input.turnId);
        }

        this.publish({
            sessionId: input.sessionId,
            type: 'judge_recap_emitted',
            payload: {
                turnId: input.turnId,
                phase: input.phase,
                cycleNumber: input.cycleNumber,
            },
        });
    }

    async completeSession(sessionId: string): Promise<CourtSession> {
        const session = this.mustGet(sessionId);
        session.status = 'completed';
        session.completedAt = new Date().toISOString();

        this.publish({
            sessionId,
            type: 'session_completed',
            payload: { sessionId, completedAt: session.completedAt },
        });

        return deepCopy(session);
    }

    async failSession(
        sessionId: string,
        reason: string,
    ): Promise<CourtSession> {
        const session = this.mustGet(sessionId);
        session.status = 'failed';
        session.failureReason = reason;
        session.completedAt = new Date().toISOString();

        this.publish({
            sessionId,
            type: 'session_failed',
            payload: { sessionId, reason, completedAt: session.completedAt },
        });

        return deepCopy(session);
    }

    async recoverInterruptedSessions(): Promise<string[]> {
        // In-memory store loses all state on restart,
        // so there are never any sessions to recover
        return [];
    }

    subscribe(
        sessionId: string,
        handler: (event: CourtEvent) => void,
    ): () => void {
        const channel = this.channel(sessionId);
        this.eventEmitter.on(channel, handler);

        return () => {
            this.eventEmitter.off(channel, handler);
        };
    }

    emitEvent(
        sessionId: string,
        type: CourtEvent['type'],
        payload: Record<string, unknown>,
    ): void {
        this.publish({ sessionId, type, payload });
    }

    private publish(input: {
        sessionId: string;
        type: CourtEvent['type'];
        payload: Record<string, unknown>;
    }): void {
        const event: CourtEvent = {
            id: randomUUID(),
            sessionId: input.sessionId,
            type: input.type,
            at: new Date().toISOString(),
            payload: input.payload,
        };

        this.eventEmitter.emit(this.channel(input.sessionId), event);
    }

    private mustGet(sessionId: string): CourtSession {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new CourtNotFoundError(`Session not found: ${sessionId}`);
        }
        return session;
    }

    async patchMetadata(
        sessionId: string,
        patch: Partial<CourtSessionMetadata>,
    ): Promise<void> {
        const session = this.mustGet(sessionId);
        Object.assign(session.metadata, patch);
    }

    private channel(sessionId: string): string {
        return `session:${sessionId}`;
    }
}

interface SessionRow {
    id: string;
    topic: string;
    status: CourtSession['status'];
    participants: AgentId[];
    phase: CourtPhase;
    turn_count: number;
    metadata: CourtSessionMetadata;
    failure_reason: string | null;
    created_at: Date | string;
    started_at: Date | string | null;
    completed_at: Date | string | null;
}

interface TurnRow {
    id: string;
    session_id: string;
    turn_number: number;
    speaker: AgentId;
    role: CourtRole;
    phase: CourtPhase;
    dialogue: string;
    created_at: Date | string;
}

type CourtTx = TransactionSql;

class PostgresCourtSessionStore implements CourtSessionStore {
    private readonly eventEmitter = new EventEmitter();

    constructor(private readonly db: Sql) {}

    static async create(
        databaseUrl: string,
    ): Promise<PostgresCourtSessionStore> {
        const db = postgres(databaseUrl, { max: 10 });
        await runMigrations(db);
        return new PostgresCourtSessionStore(db);
    }

    async createSession(input: {
        topic: string;
        participants: AgentId[];
        metadata: CourtSessionMetadata;
    }): Promise<CourtSession> {
        const sessionId = randomUUID();

        const [row] = await this.db<SessionRow[]>`
            INSERT INTO court_sessions (
                id,
                topic,
                status,
                participants,
                phase,
                turn_count,
                metadata
            ) VALUES (
                ${sessionId},
                ${input.topic},
                'pending',
                ${this.db.json(input.participants)},
                'case_prompt',
                0,
                ${this.db.json(input.metadata as unknown as JSONValue)}
            )
            RETURNING *
        `;

        const session = this.mapSession(row, []);
        this.publish({
            sessionId,
            type: 'session_created',
            payload: { sessionId },
        });

        return session;
    }

    async listSessions(): Promise<CourtSession[]> {
        const rows = await this.db<SessionRow[]>`
            SELECT *
            FROM court_sessions
            ORDER BY created_at DESC
        `;

        const sessions = await Promise.all(
            rows.map(async row => {
                const turns = await this.fetchTurns(row.id);
                return this.mapSession(row, turns);
            }),
        );

        return sessions;
    }

    async getSession(sessionId: string): Promise<CourtSession | undefined> {
        const [row] = await this.db<SessionRow[]>`
            SELECT *
            FROM court_sessions
            WHERE id = ${sessionId}
            LIMIT 1
        `;

        if (!row) return undefined;

        const turns = await this.fetchTurns(sessionId);
        return this.mapSession(row, turns);
    }

    async searchTranscripts(
        query: string,
        limit = 25,
    ): Promise<TranscriptSearchResult[]> {
        const normalized = query.trim().toLowerCase();
        const cappedLimit = Math.max(1, Math.min(Math.trunc(limit), 50));

        const rows = normalized ? await this.db<SessionRow[]>`
            SELECT *
            FROM court_sessions
            WHERE status = 'completed'
              AND (
                   lower(id::text) LIKE ${`%${normalized}%`}
                OR lower(topic) LIKE ${`%${normalized}%`}
                OR lower(coalesce(metadata ->> 'casePrompt', '')) LIKE ${`%${normalized}%`}
              )
            ORDER BY completed_at DESC NULLS LAST, created_at DESC
            LIMIT ${cappedLimit}
        ` : await this.db<SessionRow[]>`
            SELECT *
            FROM court_sessions
            WHERE status = 'completed'
            ORDER BY completed_at DESC NULLS LAST, created_at DESC
            LIMIT ${cappedLimit}
        `;

        return rows.map(row =>
            mapSessionToTranscriptSearchResult({
                id: row.id,
                topic: row.topic,
                status: row.status,
                phase: row.phase,
                metadata: row.metadata,
                createdAt: this.mustIso(row.created_at),
                startedAt: this.optionalIso(row.started_at),
                completedAt: this.optionalIso(row.completed_at),
                turnCount: row.turn_count,
            }),
        );
    }

    async startSession(sessionId: string): Promise<CourtSession> {
        const [row] = await this.db<SessionRow[]>`
            UPDATE court_sessions
            SET status = 'running',
                started_at = COALESCE(started_at, NOW())
            WHERE id = ${sessionId}
            RETURNING *
        `;

        if (!row) {
            throw new CourtNotFoundError(`Session not found: ${sessionId}`);
        }

        const turns = await this.fetchTurns(sessionId);
        const session = this.mapSession(row, turns);

        this.publish({
            sessionId,
            type: 'session_started',
            payload: { sessionId, startedAt: session.startedAt },
        });

        return session;
    }

    async setPhase(
        sessionId: string,
        phase: CourtPhase,
        phaseDurationMs?: number,
    ): Promise<CourtSession> {
        const result = await this.withTxQuery(async txQuery => {

            const [current] = await txQuery<SessionRow[]>`
                SELECT *
                FROM court_sessions
                WHERE id = ${sessionId}
                FOR UPDATE
            `;

            if (!current) {
                throw new CourtNotFoundError(`Session not found: ${sessionId}`);
            }
            assertValidPhaseTransition(current.phase, phase);

            const metadata = {
                ...(current.metadata ?? {}),
            } as CourtSessionMetadata;
            metadata.phaseStartedAt = new Date().toISOString();
            if (phaseDurationMs != null) {
                metadata.phaseDurationMs = phaseDurationMs;
            }

            const closingPoll = pollTypeForPhase(current.phase);
            let voteClosedPayload:
                | {
                      pollType: 'verdict' | 'sentence';
                      closedAt: string;
                      votes: Record<string, number>;
                      nextPhase: CourtPhase;
                  }
                | undefined;
            if (closingPoll && current.phase !== phase) {
                const closedAt = new Date().toISOString();
                const votes =
                    closingPoll === 'verdict' ?
                        { ...(metadata.verdictVotes ?? {}) }
                    :   { ...(metadata.sentenceVotes ?? {}) };
                metadata.voteSnapshots ??= {};
                metadata.voteSnapshots[closingPoll] = {
                    closedAt,
                    votes,
                };
                voteClosedPayload = {
                    pollType: closingPoll,
                    closedAt,
                    votes,
                    nextPhase: phase,
                };
            }

            const [updated] = await txQuery<SessionRow[]>`
                UPDATE court_sessions
                SET phase = ${phase},
                    metadata = ${txQuery.json(metadata as unknown as JSONValue)}
                WHERE id = ${sessionId}
                RETURNING *
            `;

            return {
                updated,
                previousPhase: current.phase,
                voteClosedPayload,
            };
        });

        const turns = await this.fetchTurns(sessionId);
        const session = this.mapSession(result.updated, turns);

        this.publish({
            sessionId,
            type: 'phase_changed',
            payload: {
                phase,
                phaseStartedAt: session.metadata.phaseStartedAt,
                phaseDurationMs: session.metadata.phaseDurationMs,
            },
        });

        if (result.voteClosedPayload) {
            this.publish({
                sessionId,
                type: 'vote_closed',
                payload: result.voteClosedPayload,
            });

            this.publish({
                sessionId,
                type: 'analytics_event',
                payload: {
                    name: 'poll_closed',
                    pollType: result.voteClosedPayload.pollType,
                    phase,
                },
            });
        }

        const openingPoll = pollTypeForPhase(phase);
        if (openingPoll && result.previousPhase !== phase) {
            this.publish({
                sessionId,
                type: 'analytics_event',
                payload: {
                    name: 'poll_started',
                    pollType: openingPoll,
                    phase,
                },
            });
        }

        return session;
    }

    async addTurn(input: {
        sessionId: string;
        speaker: AgentId;
        role: CourtRole;
        phase: CourtPhase;
        dialogue: string;
        moderationResult?: {
            flagged: boolean;
            reasons: string[];
        };
    }): Promise<CourtTurn> {
        const turn = await this.withTxQuery(async txQuery => {

            const [session] = await txQuery<SessionRow[]>`
                SELECT id, turn_count
                FROM court_sessions
                WHERE id = ${input.sessionId}
                FOR UPDATE
            `;

            if (!session) {
                throw new CourtNotFoundError(
                    `Session not found: ${input.sessionId}`,
                );
            }

            const turnId = randomUUID();
            const turnNumber = session.turn_count;
            const createdAt = new Date().toISOString();

            await txQuery`
                INSERT INTO court_turns (
                    id,
                    session_id,
                    turn_number,
                    speaker,
                    role,
                    phase,
                    dialogue,
                    created_at
                ) VALUES (
                    ${turnId},
                    ${input.sessionId},
                    ${turnNumber},
                    ${input.speaker},
                    ${input.role},
                    ${input.phase},
                    ${input.dialogue},
                    ${createdAt}
                )
            `;

            await txQuery`
                UPDATE court_sessions
                SET turn_count = turn_count + 1
                WHERE id = ${input.sessionId}
            `;

            return {
                id: turnId,
                sessionId: input.sessionId,
                turnNumber,
                speaker: input.speaker,
                role: input.role,
                phase: input.phase,
                dialogue: input.dialogue,
                createdAt,
            } satisfies CourtTurn;
        });

        this.publish({
            sessionId: input.sessionId,
            type: 'turn',
            payload: { turn },
        });

        if (input.moderationResult?.flagged) {
            this.publish({
                sessionId: input.sessionId,
                type: 'moderation_action',
                payload: {
                    turnId: turn.id,
                    speaker: input.speaker,
                    reasons: input.moderationResult.reasons,
                    phase: input.phase,
                },
            });
        }

        return turn;
    }

    async castVote(input: {
        sessionId: string;
        voteType: 'verdict' | 'sentence';
        choice: string;
    }): Promise<CourtSession> {
        const row = await this.withTxQuery(async txQuery => {

            const [current] = await txQuery<SessionRow[]>`
                SELECT *
                FROM court_sessions
                WHERE id = ${input.sessionId}
                FOR UPDATE
            `;

            if (!current) {
                throw new CourtNotFoundError(
                    `Session not found: ${input.sessionId}`,
                );
            }

            const metadata = {
                ...(current.metadata ?? {}),
            } as CourtSessionMetadata;
            metadata.verdictVotes ??= {};
            metadata.sentenceVotes ??= {};
            if (
                (input.voteType === 'verdict' &&
                    current.phase !== 'verdict_vote') ||
                (input.voteType === 'sentence' &&
                    current.phase !== 'sentence_vote')
            ) {
                throw new CourtValidationError(
                    `Cannot cast ${input.voteType} vote during phase ${current.phase}`,
                );
            }

            if (input.voteType === 'verdict') {
                const validChoices = allowedVerdictChoices(metadata.caseType);
                if (!validChoices.includes(input.choice)) {
                    throw new CourtValidationError(
                        `Invalid verdict choice: ${input.choice}. Valid choices: ${validChoices.join(', ')}`,
                    );
                }
                metadata.verdictVotes[input.choice] =
                    (metadata.verdictVotes[input.choice] ?? 0) + 1;
            } else {
                if (!metadata.sentenceOptions.includes(input.choice)) {
                    throw new CourtValidationError(
                        `Invalid sentence choice: ${input.choice}. Valid choices: ${metadata.sentenceOptions.join(', ')}`,
                    );
                }
                metadata.sentenceVotes[input.choice] =
                    (metadata.sentenceVotes[input.choice] ?? 0) + 1;
            }

            const [updated] = await txQuery<SessionRow[]>`
                UPDATE court_sessions
                SET metadata = ${txQuery.json(metadata as unknown as JSONValue)}
                WHERE id = ${input.sessionId}
                RETURNING *
            `;

            return updated;
        });

        const turns = await this.fetchTurns(input.sessionId);
        const session = this.mapSession(row, turns);

        this.publish({
            sessionId: input.sessionId,
            type: 'vote_updated',
            payload: {
                voteType: input.voteType,
                choice: input.choice,
                verdictVotes: session.metadata.verdictVotes,
                sentenceVotes: session.metadata.sentenceVotes,
            },
        });
        this.publish({
            sessionId: input.sessionId,
            type: 'analytics_event',
            payload: {
                name: 'vote_completed',
                pollType: input.voteType,
                choice: input.choice,
            },
        });

        return session;
    }

    async recordFinalRuling(input: {
        sessionId: string;
        verdict: string;
        sentence: string;
    }): Promise<CourtSession> {
        const row = await this.withTxQuery(async txQuery => {

            const [current] = await txQuery<SessionRow[]>`
                SELECT *
                FROM court_sessions
                WHERE id = ${input.sessionId}
                FOR UPDATE
            `;

            if (!current) {
                throw new CourtNotFoundError(
                    `Session not found: ${input.sessionId}`,
                );
            }

            const metadata = {
                ...(current.metadata ?? {}),
            } as CourtSessionMetadata;
            metadata.finalRuling = {
                verdict: input.verdict,
                sentence: input.sentence,
                decidedAt: new Date().toISOString(),
            };

            const [updated] = await txQuery<SessionRow[]>`
                UPDATE court_sessions
                SET metadata = ${txQuery.json(metadata as unknown as JSONValue)}
                WHERE id = ${input.sessionId}
                RETURNING *
            `;

            return updated;
        });

        const turns = await this.fetchTurns(input.sessionId);
        return this.mapSession(row, turns);
    }

    async recordRecap(input: {
        sessionId: string;
        turnId: string;
        phase: CourtPhase;
        cycleNumber: number;
    }): Promise<void> {
        await this.withTxQuery(async txQuery => {

            const [current] = await txQuery<SessionRow[]>`
                SELECT *
                FROM court_sessions
                WHERE id = ${input.sessionId}
                FOR UPDATE
            `;

            if (!current) {
                throw new CourtNotFoundError(
                    `Session not found: ${input.sessionId}`,
                );
            }

            const metadata = {
                ...(current.metadata ?? {}),
            } as CourtSessionMetadata;
            metadata.recapTurnIds ??= [];
            if (!metadata.recapTurnIds.includes(input.turnId)) {
                metadata.recapTurnIds.push(input.turnId);
            }

            const [updated] = await txQuery<SessionRow[]>`
                UPDATE court_sessions
                SET metadata = ${txQuery.json(metadata as unknown as JSONValue)}
                WHERE id = ${input.sessionId}
                RETURNING *
            `;

            return updated;
        });

        this.publish({
            sessionId: input.sessionId,
            type: 'judge_recap_emitted',
            payload: {
                turnId: input.turnId,
                phase: input.phase,
                cycleNumber: input.cycleNumber,
            },
        });
    }

    async completeSession(sessionId: string): Promise<CourtSession> {
        const [row] = await this.db<SessionRow[]>`
            UPDATE court_sessions
            SET status = 'completed',
                completed_at = NOW()
            WHERE id = ${sessionId}
            RETURNING *
        `;

        if (!row) {
            throw new CourtNotFoundError(`Session not found: ${sessionId}`);
        }

        const turns = await this.fetchTurns(sessionId);
        const session = this.mapSession(row, turns);

        this.publish({
            sessionId,
            type: 'session_completed',
            payload: { sessionId, completedAt: session.completedAt },
        });

        return session;
    }

    async failSession(
        sessionId: string,
        reason: string,
    ): Promise<CourtSession> {
        const [row] = await this.db<SessionRow[]>`
            UPDATE court_sessions
            SET status = 'failed',
                failure_reason = ${reason},
                completed_at = NOW()
            WHERE id = ${sessionId}
            RETURNING *
        `;

        if (!row) {
            throw new CourtNotFoundError(`Session not found: ${sessionId}`);
        }

        const turns = await this.fetchTurns(sessionId);
        const session = this.mapSession(row, turns);

        this.publish({
            sessionId,
            type: 'session_failed',
            payload: { sessionId, reason, completedAt: session.completedAt },
        });

        return session;
    }

    async recoverInterruptedSessions(): Promise<string[]> {
        // Return IDs of sessions that were running when the server stopped
        // These can be resumed by the orchestrator
        const rows = await this.db<Array<{ id: string }>>`
            SELECT id
            FROM court_sessions
            WHERE status = 'running'
            ORDER BY created_at ASC
        `;

        return rows.map(row => row.id);
    }

    subscribe(
        sessionId: string,
        handler: (event: CourtEvent) => void,
    ): () => void {
        const channel = this.channel(sessionId);
        this.eventEmitter.on(channel, handler);

        return () => {
            this.eventEmitter.off(channel, handler);
        };
    }

    emitEvent(
        sessionId: string,
        type: CourtEvent['type'],
        payload: Record<string, unknown>,
    ): void {
        this.publish({ sessionId, type, payload });
    }

    async patchMetadata(
        sessionId: string,
        patch: Partial<CourtSessionMetadata>,
    ): Promise<void> {
        await this.withTxQuery(async txQuery => {
            const [current] = await txQuery<SessionRow[]>`
                SELECT metadata
                FROM court_sessions
                WHERE id = ${sessionId}
                FOR UPDATE
            `;

            if (!current) {
                throw new CourtNotFoundError(
                    `Session not found: ${sessionId}`,
                );
            }

            const metadata = {
                ...(current.metadata ?? {}),
                ...patch,
            } as CourtSessionMetadata;

            await txQuery`
                UPDATE court_sessions
                SET metadata = ${txQuery.json(metadata as unknown as JSONValue)}
                WHERE id = ${sessionId}
            `;
        });
    }

    private publish(input: {
        sessionId: string;
        type: CourtEvent['type'];
        payload: Record<string, unknown>;
    }): void {
        const event: CourtEvent = {
            id: randomUUID(),
            sessionId: input.sessionId,
            type: input.type,
            at: new Date().toISOString(),
            payload: deepCopy(input.payload),
        };

        this.eventEmitter.emit(this.channel(input.sessionId), event);
    }

    private withTxQuery<T>(work: (txQuery: Sql) => Promise<T>): Promise<T> {
        return this.db.begin(async (tx: CourtTx) => {
            const txQuery = tx as unknown as Sql;
            return work(txQuery);
        }) as Promise<T>;
    }

    private async fetchTurns(sessionId: string): Promise<CourtTurn[]> {
        const rows = await this.db<TurnRow[]>`
            SELECT *
            FROM court_turns
            WHERE session_id = ${sessionId}
            ORDER BY turn_number ASC
        `;

        return rows.map(row => ({
            id: row.id,
            sessionId: row.session_id,
            turnNumber: row.turn_number,
            speaker: row.speaker,
            role: row.role,
            phase: row.phase,
            dialogue: row.dialogue,
            createdAt: this.mustIso(row.created_at),
        }));
    }

    private mapSession(row: SessionRow, turns: CourtTurn[]): CourtSession {
        return {
            id: row.id,
            topic: row.topic,
            status: row.status,
            participants: (row.participants ?? []) as AgentId[],
            phase: row.phase,
            turnCount: row.turn_count,
            turns,
            metadata: row.metadata,
            failureReason: row.failure_reason ?? undefined,
            createdAt: this.mustIso(row.created_at),
            startedAt: this.optionalIso(row.started_at),
            completedAt: this.optionalIso(row.completed_at),
        };
    }

    private mustIso(value: Date | string | null): string {
        if (!value) {
            throw new Error('Expected timestamp value to be non-null');
        }
        return typeof value === 'string' ?
                new Date(value).toISOString()
            :   value.toISOString();
    }

    private optionalIso(value: Date | string | null): string | undefined {
        if (!value) return undefined;
        return typeof value === 'string' ?
                new Date(value).toISOString()
            :   value.toISOString();
    }

    private channel(sessionId: string): string {
        return `session:${sessionId}`;
    }
}

export async function createCourtSessionStore(): Promise<CourtSessionStore> {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) {
        // eslint-disable-next-line no-console
        console.warn(
            'DATABASE_URL is not set; using in-memory session store. Data will not survive restarts.',
        );
        return new InMemoryCourtSessionStore();
    }

    return PostgresCourtSessionStore.create(databaseUrl);
}
