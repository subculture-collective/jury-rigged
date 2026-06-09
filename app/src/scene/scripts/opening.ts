import type { SceneEvent } from '../types';
import { gavel } from '../macros';

export const OPENING_SCENE: SceneEvent[] = [
  { type: 'cut_to', camera: 'wide' },
  ...gavel(),
  { type: 'say', speaker: 'judge', text: 'Court is now in session for the trial of the accused.', pose: 'confident', awaitAdvance: true },
  { type: 'cut_to', camera: 'prosecution_bench' },
  { type: 'set_pose', character: 'prosecutor', pose: 'confident' },
  { type: 'say', speaker: 'prosecutor', text: 'The prosecution is prepared, Your Honor. We will prove beyond doubt that the defendant is guilty.', pose: 'confident', awaitAdvance: true },
  { type: 'cut_to', camera: 'defense_bench' },
  { type: 'set_pose', character: 'defense', pose: 'confident' },
  { type: 'say', speaker: 'defense', text: 'The defense is ready. The evidence will show a very different story than the prosecution claims.', awaitAdvance: true },
  { type: 'cut_to', camera: 'wide' },
  { type: 'say', speaker: 'judge', text: 'Very well. The prosecution may call its first witness.', pose: 'confident', awaitAdvance: true },
];
