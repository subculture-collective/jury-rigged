export type AgentId =
    | 'phoenix'
    | 'edgeworth'
    | 'mia'
    | 'franziska'
    | 'godot'
    | 'gumshoe'
    | 'maya'
    | 'apollo'
    | 'athena'
    | 'ema'
    | 'klavier'
    | 'blackquill'
    | 'trucy';

/** Archetype-level role classification used for casting pools.
 * Distinct from CourtRole: 'witness' here maps to the witness_1/2/3 slots in CourtRole. */
export type RoleArchetype = 'judge' | 'prosecutor' | 'defense' | 'witness' | 'bailiff';

export interface AgentConfig {
    id: AgentId;
    displayName: string;
    role: string;
    description: string;
    color: string;
    voicePersona: string;
    roleArchetypes: RoleArchetype[];
    transcriptDir: string;
}

export type CaseType = 'criminal' | 'civil';

export type GenreTag =
    | 'absurd_civil'
    | 'cosmic_crime'
    | 'workplace_tribunal'
    | 'fantasy_court';

export interface PromptBankEntry {
    id: string;
    genre: GenreTag;
    casePrompt: string;
    caseType: CaseType;
    active: boolean;
}

export interface GenreRotationConfig {
    minDistance: number; // Minimum number of sessions before genre repeats
    maxHistorySize: number; // Maximum genre history to track
}

export interface EvidenceCard {
    id: string;
    text: string;
    revealedAt: string; // ISO 8601
}

export type CourtRole =
    | 'judge'
    | 'prosecutor'
    | 'defense'
    | 'witness_1'
    | 'witness_2'
    | 'witness_3'
    | 'bailiff';

export type CourtPhase =
    | 'case_prompt'
    | 'openings'
    | 'witness_exam'
    | 'evidence_reveal'
    | 'closings'
    | 'verdict_vote'
    | 'sentence_vote'
    | 'final_ruling';

export type SessionStatus = 'pending' | 'running' | 'completed' | 'failed';
export type CourtSessionStatus = SessionStatus;

export interface CourtRoleAssignments {
    judge: AgentId;
    prosecutor: AgentId;
    defense: AgentId;
    witnesses: AgentId[];
    bailiff: AgentId;
}

export interface CourtTurn {
    id: string;
    sessionId: string;
    turnNumber: number;
    speaker: AgentId;
    role: CourtRole;
    phase: CourtPhase;
    dialogue: string;
    createdAt: string;
}

export interface CourtSessionMetadata {
    mode: 'juryrigged';
    casePrompt: string;
    caseType: CaseType;
    caseSource?: 'generated' | 'operator' | 'twitch' | 'public_page';
    queueItemId?: string;
    sentenceOptions: string[];
    phaseStartedAt?: string;
    phaseDurationMs?: number;
    verdictVoteWindowMs: number;
    sentenceVoteWindowMs: number;
    verdictVotes: Record<string, number>;
    sentenceVotes: Record<string, number>;
    pressVotes: Record<number, number>;
    presentVotes: Record<string, number>;
    voteSnapshots?: {
        verdict?: {
            closedAt: string;
            votes: Record<string, number>;
        };
        sentence?: {
            closedAt: string;
            votes: Record<string, number>;
        };
        press?: {
            closedAt: string;
            votes: Record<number, number>;
        };
        present?: {
            closedAt: string;
            votes: Record<string, number>;
        };
    };
    recapTurnIds?: string[];
    finalRuling?: {
        verdict: string;
        sentence: string;
        decidedAt: string;
    };
    roleAssignments: CourtRoleAssignments;
    // Phase 3 additions
    currentGenre?: GenreTag;
    genreHistory?: GenreTag[]; // Last N genres used
    evidenceCards?: EvidenceCard[];
    objectionCount?: number;
    // Phase 7 additions
    caseFile?: CaseFile;
    witnessStatements?: WitnessStatement[];
    lastRenderDirective?: RenderDirective;
}

export interface CourtSession {
    id: string;
    topic: string;
    status: SessionStatus;
    participants: AgentId[];
    phase: CourtPhase;
    turnCount: number;
    turns: CourtTurn[];
    metadata: CourtSessionMetadata;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    failureReason?: string;
}

export interface TranscriptSearchResult {
    id: string;
    topic: string;
    status: CourtSessionStatus;
    phase: CourtPhase;
    caseType?: string;
    casePrompt?: string;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    turnCount: number;
    finalRuling?: CourtSessionMetadata['finalRuling'];
}

export interface TranscriptSearchResponse {
    query: string;
    results: TranscriptSearchResult[];
    count: number;
}

export type AdminTriggerKind =
    | 'message'
    | 'phase_stinger'
    | 'evidence_stinger'
    | 'objection_stinger';

export interface AdminTriggerRequest {
    sessionId: string;
    kind: AdminTriggerKind;
    title: string;
    message: string;
}

export type TwitchSocialEventType = 'follow' | 'subscribe' | 'gift_sub';

export interface TwitchSocialUser {
    id?: string;
    login?: string;
    displayName: string;
}

export interface TwitchSocialEvent {
    type: TwitchSocialEventType;
    user: TwitchSocialUser;
    gifter?: TwitchSocialUser;
    giftCount?: number;
    tier?: string;
    occurredAt: string;
}

export interface TwitchSocialSnapshot {
    latestFollower?: TwitchSocialUser & { followedAt: string };
    latestSubscriber?: TwitchSocialUser & { subscribedAt: string; tier?: string };
    latestGifter?: TwitchSocialUser & { giftedAt: string; giftCount: number };
    mostGifted?: TwitchSocialUser & { giftCount: number; updatedAt: string };
    updatedAt?: string;
}

export type ModerationReasonCode =
    | 'hate_speech'
    | 'violence'
    | 'harassment'
    | 'sexual_content'
    | 'slur';

export interface ModerationResult {
    flagged: boolean;
    reasons: ModerationReasonCode[];
    original: string;
    sanitized: string;
}

export type CourtEventType =
    | 'session_created'
    | 'session_started'
    | 'phase_changed'
    | 'turn'
    | 'vote_updated'
    | 'vote_closed'
    | 'press_vote_updated'
    | 'present_vote_updated'
    | 'witness_response_capped'
    | 'judge_recap_emitted'
    | 'token_budget_applied'
    | 'session_token_estimate'
    | 'analytics_event'
    | 'moderation_action'
    | 'vote_spam_blocked'
    | 'session_completed'
    | 'session_failed'
    // Phase 3 additions
    | 'broadcast_hook_triggered'
    | 'broadcast_hook_failed'
    | 'evidence_revealed'
    | 'objection_count_changed'
    | 'twitch_social_updated'
    // Phase 7 additions
    | 'render_directive'
    | 'witness_statement'
    | 'case_file_generated'
    | 'admin_trigger';

export interface CourtEvent {
    id: string;
    sessionId: string;
    type: CourtEventType;
    at: string;
    payload: Record<string, unknown>;
}

export interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface LLMGenerateOptions {
    messages: LLMMessage[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
}

// ---------------------------------------------------------------------------
// Phase 7: Render Directives (#70)
// ---------------------------------------------------------------------------

export type RenderEffectCue =
    | 'flash'
    | 'shake'
    | 'freeze'
    | 'stamp'
    | 'objection'
    | 'hold_it'
    | 'take_that';

export type CameraPreset =
    | 'wide'
    | 'judge'
    | 'prosecution'
    | 'defense'
    | 'witness'
    | 'evidence'
    | 'verdict';

export type CharacterPose =
    | 'idle'
    | 'talk'
    | 'point'
    | 'slam'
    | 'think'
    | 'shock';

export type CharacterFace =
    | 'neutral'
    | 'angry'
    | 'happy'
    | 'surprised'
    | 'sweating';

export interface RenderDirective {
    camera?: CameraPreset;
    effect?: RenderEffectCue;
    effectOpts?: Record<string, unknown>;
    poses?: Partial<Record<CourtRole, CharacterPose>>;
    faces?: Partial<Record<CourtRole, CharacterFace>>;
    evidencePresent?: string; // evidence ID to present
}

// ---------------------------------------------------------------------------
// Phase 7: Structured Case File (#67)
// ---------------------------------------------------------------------------

export interface CaseFileWitness {
    role: CourtRole;
    agentId: AgentId;
    displayName: string;
    bio: string;
}

export interface CaseFileEvidence {
    id: string;
    label: string;
    description: string;
    revealPhase: CourtPhase;
}

export interface CaseFile {
    title: string;
    genre: GenreTag;
    caseType: CaseType;
    synopsis: string;
    charges: string[];
    witnesses: CaseFileWitness[];
    evidence: CaseFileEvidence[];
    sentenceOptions: string[];
}

// ---------------------------------------------------------------------------
// Phase 7: Witness Statement (#75)
// ---------------------------------------------------------------------------

export interface WitnessStatement {
    witnessRole: CourtRole;
    agentId: AgentId;
    statementText: string;
    issuedAt: string; // ISO 8601
    contradictions?: string[]; // IDs of evidence that contradict
}
