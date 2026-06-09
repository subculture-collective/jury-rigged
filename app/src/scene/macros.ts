import type { SceneEvent, CharacterId } from './types';

export function objection(character: CharacterId): SceneEvent[] {
  return [
    { type: 'play_sfx', sound: 'desk_slam' },
    { type: 'set_pose', character, pose: 'desk_slam' },
    { type: 'shake', intensity: 12, durationMs: 200 },
    { type: 'wait', durationMs: 100 },
    { type: 'play_sfx', sound: 'objection' },
    { type: 'stamp', text: 'OBJECTION!', durationMs: 1200 },
    { type: 'cut_to', camera: character === 'prosecutor' ? 'prosecution_bench' : 'defense_bench' },
    { type: 'set_pose', character, pose: 'pointing' },
  ];
}

export function holdIt(character: CharacterId): SceneEvent[] {
  return [
    { type: 'play_sfx', sound: 'hold_it' },
    { type: 'flash', durationMs: 100 },
    { type: 'stamp', text: 'HOLD IT!', durationMs: 1000 },
    { type: 'set_pose', character, pose: 'pointing' },
    { type: 'shake', intensity: 8, durationMs: 250 },
  ];
}

export function takeThat(character: CharacterId): SceneEvent[] {
  return [
    { type: 'play_sfx', sound: 'take_that' },
    { type: 'flash', durationMs: 120 },
    { type: 'stamp', text: 'TAKE THAT!', durationMs: 1200 },
    { type: 'set_pose', character, pose: 'pointing' },
    { type: 'shake', intensity: 10, durationMs: 280 },
  ];
}

export function gavel(): SceneEvent[] {
  return [
    { type: 'play_sfx', sound: 'gavel' },
    { type: 'cut_to', camera: 'judge_bench' },
    { type: 'set_pose', character: 'judge', pose: 'confident' },
  ];
}

export function witnessTestimony(witnessName: string, statements: string[]): SceneEvent[] {
  const events: SceneEvent[] = [];
  events.push(
    { type: 'cut_to', camera: 'witness_stand' },
    { type: 'set_pose', character: 'witness', pose: 'nervous' },
    { type: 'say', speaker: 'witness', text: `I am ${witnessName}, and I will testify to what I witnessed.`, pose: 'nervous', awaitAdvance: true },
  );

  for (const stmt of statements) {
    events.push({ type: 'say', speaker: 'witness', text: stmt, awaitAdvance: true });
  }

  return events;
}

export function presentEvidence(character: CharacterId, evidenceName: string, statement: string): SceneEvent[] {
  return [
    { type: 'stamp', text: 'EVIDENCE', durationMs: 800 },
    { type: 'cut_to', camera: 'evidence' },
    { type: 'say', speaker: character, text: `I present ${evidenceName} to the court.`, pose: 'pointing', camera: character === 'defense' ? 'defense_bench' : 'prosecution_bench', awaitAdvance: true },
    { type: 'say', speaker: character, text: statement, pose: 'confident', awaitAdvance: true },
  ];
}
