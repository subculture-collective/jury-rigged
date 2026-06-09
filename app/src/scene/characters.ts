import type { CharacterId, PoseId } from './types';

export interface CharacterDef {
  id: CharacterId;
  label: string;
  position: { left: string; top: string };
  sprites: Partial<Record<PoseId, string>>;
  defaultPose: PoseId;
}

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  judge: {
    id: 'judge',
    label: 'Judge',
    position: { left: '50%', top: '2%' },
    sprites: {
      idle: '/assets/characters/judge_idle.png',
      talking: '/assets/characters/judge_talking.png',
      angry: '/assets/characters/judge_angry.png',
      confident: '/assets/characters/judge_confident.png',
    },
    defaultPose: 'idle',
  },
  prosecutor: {
    id: 'prosecutor',
    label: 'Prosecutor',
    position: { left: '72%', top: '20%' },
    sprites: {
      idle: '/assets/characters/prosecutor_idle.png',
      confident: '/assets/characters/prosecutor_confident.png',
      pointing: '/assets/characters/prosecutor_pointing.png',
      shocked: '/assets/characters/prosecutor_shocked.png',
      talking: '/assets/characters/prosecutor_talking.png',
    },
    defaultPose: 'idle',
  },
  defense: {
    id: 'defense',
    label: 'Defense',
    position: { left: '28%', top: '20%' },
    sprites: {
      idle: '/assets/characters/defense_idle.png',
      confident: '/assets/characters/defense_confident.png',
      pointing: '/assets/characters/defense_pointing.png',
      shocked: '/assets/characters/defense_shocked.png',
      desk_slam: '/assets/characters/defense_desk_slam.png',
    },
    defaultPose: 'idle',
  },
  witness: {
    id: 'witness',
    label: 'Witness',
    position: { left: '50%', top: '28%' },
    sprites: {
      idle: '/assets/characters/witness_idle.png',
      nervous: '/assets/characters/witness_nervous.png',
      shocked: '/assets/characters/witness_shocked.png',
    },
    defaultPose: 'idle',
  },
  bailiff: {
    id: 'bailiff',
    label: 'Bailiff',
    position: { left: '88%', top: '40%' },
    sprites: { idle: '/assets/characters/bailiff_idle.png' },
    defaultPose: 'idle',
  },
  clerk: {
    id: 'clerk',
    label: 'Clerk',
    position: { left: '12%', top: '40%' },
    sprites: { idle: '/assets/characters/clerk_idle.png' },
    defaultPose: 'idle',
  },
};

export const CAMERA_PRESETS: Record<string, string> = {
  wide: '',
  judge_bench: 'scale-[1.3] translate-y-[10%]',
  defense_bench: 'scale-[1.4] translate-x-[15%] translate-y-[5%]',
  prosecution_bench: 'scale-[1.4] -translate-x-[15%] translate-y-[5%]',
  witness_stand: 'scale-[1.5] translate-y-[5%]',
  evidence: 'scale-[1.6] -translate-y-[5%]',
};
