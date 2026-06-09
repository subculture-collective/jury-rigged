export type CharacterId = 'judge' | 'prosecutor' | 'defense' | 'witness' | 'bailiff' | 'clerk';

export type PoseId = 'idle' | 'talking' | 'confident' | 'angry' | 'shocked' | 'pointing' | 'desk_slam' | 'nervous';

export type CameraTarget = 'wide' | 'judge_bench' | 'defense_bench' | 'prosecution_bench' | 'witness_stand' | 'evidence';

export type SceneEvent =
  | { type: 'say'; speaker: CharacterId; text: string; pose?: PoseId; camera?: CameraTarget; awaitAdvance?: boolean }
  | { type: 'set_pose'; character: CharacterId; pose: PoseId }
  | { type: 'cut_to'; camera: CameraTarget }
  | { type: 'play_sfx'; sound: string }
  | { type: 'flash'; color?: 'white' | 'red'; durationMs?: number }
  | { type: 'shake'; intensity?: number; durationMs?: number }
  | { type: 'stamp'; text: string; durationMs?: number }
  | { type: 'stinger'; name: 'objection' | 'hold_it' | 'present' | 'guilty_verdict' | 'not_guilty_verdict' }
  | { type: 'show_evidence'; evidenceId: string }
  | { type: 'wait'; durationMs: number }
  | { type: 'await_input'; inputId: string };

export interface CourtStageState {
  camera: CameraTarget;
  activeSpeaker?: CharacterId;
  characters: Record<CharacterId, { pose: PoseId; visible: boolean }>;
  dialogue?: { speaker: CharacterId; text: string };
  overlay?: { type: 'flash' | 'shake' | 'stamp'; params: Record<string, unknown> };
}

export function estimateReadTime(text: string): number {
  const words = text.split(/\s+/).length;
  return Math.max(1200, words * 280 + 800);
}
