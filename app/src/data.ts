export type ViewKey =
  | 'viewer'
  | 'overlay'
  | 'directory'
  | 'details'
  | 'voting'
  | 'operator'
  | 'about'
  | 'recap';

export type CaseItem = {
  id: string;
  docket: string;
  title: string;
  status: string;
  phase: string;
  room: string;
  judge: string;
  summary: string;
  nextBeat: string;
  jurorLean: string;
  evidenceCount: number;
  risk: 'Low' | 'Moderate' | 'Elevated';
  tags: string[];
};

export type TranscriptItem = {
  time: string;
  speaker: string;
  role: string;
  tone: 'neutral' | 'warning' | 'success' | 'accent';
  text: string;
};

export type EvidenceItem = {
  id: string;
  label: string;
  type: string;
  source: string;
  confidence: string;
  summary: string;
  badge: string;
};

export type JuryMember = {
  id: string;
  label: string;
  status: 'Steady' | 'Split' | 'Cautious' | 'Excused' | 'Undecided';
  note: string;
};

export type VoteOption = {
  label: string;
  disabled: boolean;
  reason: string;
  note: string;
};

export const views: Array<{ key: ViewKey; label: string; note: string }> = [
  { key: 'viewer', label: 'Live Viewer', note: 'Control room + transcript' },
  { key: 'overlay', label: 'Broadcast Overlay', note: '16:9 on-air mock' },
  { key: 'directory', label: 'Case Directory', note: 'Active docket list' },
  { key: 'details', label: 'Case Details', note: 'Evidence + timeline' },
  { key: 'voting', label: 'Jury Voting', note: 'Ballot + eligibility' },
  { key: 'operator', label: 'Operator Dashboard', note: 'Queue + health' },
  { key: 'about', label: 'About / How It Works', note: 'Workflow explainer' },
  { key: 'recap', label: 'Replay / Recap', note: 'Moments + summaries' },
];

export const cases: CaseItem[] = [
  {
    id: 'vael-07',
    docket: 'JR-2048',
    title: 'State v. Vale Mercer',
    status: 'Live deliberation',
    phase: 'Phase 04 · Jury review',
    room: 'Courtroom A / Broadcast 01',
    judge: 'Hon. Mara Sloane',
    summary: 'A compact evidence set, live captions, and a split jury leaning toward narrow liability.',
    nextBeat: 'Foreperson question queue clears in 03:20',
    jurorLean: '7 steady · 3 cautious · 2 undecided',
    evidenceCount: 8,
    risk: 'Elevated',
    tags: ['Live', 'Captioned', 'Exhibits open'],
  },
  {
    id: 'atlas-12',
    docket: 'JR-2051',
    title: 'Atlas Lift Co. Hearing',
    status: 'Replay archived',
    phase: 'Phase 06 · Recap ready',
    room: 'Courtroom B / Broadcast 02',
    judge: 'Hon. Ilya Corbett',
    summary: 'Procedural challenge with clean operator notes and a high-confidence evidence trail.',
    nextBeat: 'Archived clip markers available',
    jurorLean: '9 steady · 1 split · 2 excused',
    evidenceCount: 14,
    risk: 'Moderate',
    tags: ['Archived', 'Clean audio', 'Replay'],
  },
  {
    id: 'glass-19',
    docket: 'JR-2059',
    title: 'People v. Glass Meridian',
    status: 'Pre-hearing',
    phase: 'Phase 01 · Intake',
    room: 'Holding / Queue',
    judge: 'Pending assignment',
    summary: 'Fresh intake with incomplete metadata and a waiting room of unresolved submissions.',
    nextBeat: 'Clerk verification due next',
    jurorLean: 'TBD',
    evidenceCount: 3,
    risk: 'Low',
    tags: ['Pending', 'Review', 'Queued'],
  },
];

export const transcript: TranscriptItem[] = [
  {
    time: '00:14',
    speaker: 'Bailiff',
    role: 'Channel open',
    tone: 'accent',
    text: 'All feeds stable. Broadcast locked. Juror audio is clean.',
  },
  {
    time: '00:41',
    speaker: 'Judge',
    role: 'Procedural note',
    tone: 'neutral',
    text: 'The record reflects the exhibit was admitted without objection.',
  },
  {
    time: '01:06',
    speaker: 'Defense',
    role: 'Objection overruled',
    tone: 'warning',
    text: 'We reserve the right to challenge the timeline on cross.',
  },
  {
    time: '01:28',
    speaker: 'Foreperson',
    role: 'Jury signal',
    tone: 'success',
    text: 'We are split, but the center of gravity is moving toward a narrow finding.',
  },
  {
    time: '01:53',
    speaker: 'Clerk',
    role: 'Evidence fetch',
    tone: 'neutral',
    text: 'Exhibit 06 queued. Transcript anchors and timestamps are in sync.',
  },
];

export const evidence: EvidenceItem[] = [
  {
    id: 'ex-01',
    label: 'Exhibit 01 · Audio capture',
    type: 'Waveform + transcript',
    source: 'Lobby mic array',
    confidence: '92% verified',
    summary: 'Short clipped exchange with redundant capture on the third channel.',
    badge: 'Admitted',
  },
  {
    id: 'ex-02',
    label: 'Exhibit 02 · Door log',
    type: 'Access record',
    source: 'Security gateway',
    confidence: 'High confidence',
    summary: 'Badge trail shows the relevant corridor was occupied for under two minutes.',
    badge: 'Corroborates',
  },
  {
    id: 'ex-03',
    label: 'Exhibit 03 · CCTV stills',
    type: 'Frame strip',
    source: 'Camera 7',
    confidence: 'Reviewed',
    summary: 'Frames are time-aligned and bright enough for face-ID comparison.',
    badge: 'Pending note',
  },
];

export const jury: JuryMember[] = [
  { id: 'j1', label: 'J1', status: 'Steady', note: 'Strong on chain of custody' },
  { id: 'j2', label: 'J2', status: 'Cautious', note: 'Needs one more exhibit reference' },
  { id: 'j3', label: 'J3', status: 'Split', note: 'Split between motive and timeline' },
  { id: 'j4', label: 'J4', status: 'Undecided', note: 'Waiting on clarification' },
  { id: 'j5', label: 'J5', status: 'Steady', note: 'Consistent across two rounds' },
  { id: 'J6', label: 'J6', status: 'Cautious', note: 'Prefers documented evidence' },
  { id: 'J7', label: 'J7', status: 'Steady', note: 'Procedural confidence high' },
  { id: 'J8', label: 'J8', status: 'Excused', note: 'Audio routing issue resolved' },
  { id: 'J9', label: 'J9', status: 'Undecided', note: 'Reviewing exhibit 03' },
  { id: 'J10', label: 'J10', status: 'Steady', note: 'Lead leaning is stable' },
  { id: 'J11', label: 'J11', status: 'Split', note: 'Requests side-by-side view' },
  { id: 'J12', label: 'J12', status: 'Cautious', note: 'Cross-checking timestamps' },
];

export const voteOptions: VoteOption[] = [
  {
    label: 'Guilty',
    disabled: false,
    reason: 'Eligible now; verdict phase is open and the evidence window is complete.',
    note: 'Records a guilty verdict for the seated juror.',
  },
  {
    label: 'Not Guilty',
    disabled: false,
    reason: 'Eligible now; choose this when reasonable doubt remains.',
    note: 'Records acquittal for this ballot window.',
  },
  {
    label: 'Not Guilty by Reason of Insanity',
    disabled: true,
    reason: 'Blocked: this case has not opened the insanity-instruction branch.',
    note: 'The disabled explanation stays visible for keyboard and screen-reader users.',
  },
  {
    label: 'Unable to Decide',
    disabled: false,
    reason: 'Eligible now; use when deliberation remains deadlocked.',
    note: 'Records an unresolved ballot without implying a system error.',
  },
];

export const operatorQueue = [
  { task: 'Lower-third swap', state: 'Ready', detail: 'Next speaker tag preloaded' },
  { task: 'Exhibit pin', state: 'Waiting', detail: 'Awaiting judge cue' },
  { task: 'Caption feed', state: 'Healthy', detail: '48ms latency, no drops' },
  { task: 'Jury panel sync', state: 'Healthy', detail: 'All 12 indicators online' },
];

export const health = [
  { label: 'SSE status', value: 'Open', note: 'Reconnect budget untouched' },
  { label: 'Chat rate', value: '42/min', note: 'Below moderation threshold' },
  { label: 'Latency', value: '160ms', note: 'Green, under caption SLA' },
  { label: 'Uptime', value: '02:14:38', note: 'Archive write OK' },
];

export const detailTabs = [
  { label: 'Overview', detail: 'Charge sheet, judge, risk state, and live phase summary.' },
  { label: 'Witnesses', detail: 'Live, pending, used, and unavailable witness roster placeholder.' },
  { label: 'Evidence', detail: 'Inventory mirrors the cards used in the viewer rail.' },
  { label: 'Timeline', detail: 'Phase events reuse the same taxonomy as recap playback.' },
  { label: 'Documents', detail: 'Orders, transcript anchors, and shareable case file links.' },
];

export const timeline = [
  { step: 'Intake', note: 'Case loaded from docket.', state: 'complete' },
  { step: 'Evidence', note: 'Exhibits admitted and indexed.', state: 'complete' },
  { step: 'Deliberation', note: 'Jury panel in progress.', state: 'active' },
  { step: 'Verdict', note: 'Awaiting foreperson cue.', state: 'pending' },
];

export const recapMoments = [
  { stamp: '00:14', title: 'Feeds locked', detail: 'Broadcast goes live with clean audio and caption sync.' },
  { stamp: '01:06', title: 'Defense challenge', detail: 'A narrow objection keeps the timeline under scrutiny.' },
  { stamp: '01:28', title: 'Jury split', detail: 'The panel moves toward a stable center of gravity.' },
  { stamp: '01:53', title: 'Exhibit queue', detail: 'Evidence cards are reindexed for replay.' },
];

export const howItWorks = [
  {
    title: '1. Live ingest',
    text: 'Courtroom events stream into a structured transcript, with timestamps and role tags for every speaker.',
  },
  {
    title: '2. Evidence hub',
    text: 'Each exhibit gets a card: source, confidence, admissibility state, and the note that matters on replay.',
  },
  {
    title: '3. Jury visibility',
    text: 'Jury state is summarized with readable labels, not color alone, so the panel still makes sense at a glance.',
  },
  {
    title: '4. Broadcast output',
    text: 'The overlay arranges transcript, status, and the bottom jury strip into a clean 16:9 on-air composition.',
  },
];

export const liveMeta = {
  courtroom: 'Courtroom A',
  signal: 'Live',
  uptime: '02:14:38',
  mode: 'Broadcast safe',
};
