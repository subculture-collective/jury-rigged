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
      idle: '/assets/kenney-characters/Male person/PNG/Poses HD/character_malePerson_idle.png',
      talking: '/assets/kenney-characters/Male person/PNG/Poses HD/character_malePerson_talk.png',
      confident: '/assets/kenney-characters/Male person/PNG/Poses HD/character_malePerson_cheer0.png',
      angry: '/assets/kenney-characters/Male person/PNG/Poses HD/character_malePerson_attack0.png',
      shocked: '/assets/kenney-characters/Male person/PNG/Poses HD/character_malePerson_hurt.png',
    },
    defaultPose: 'idle',
  },
  prosecutor: {
    id: 'prosecutor',
    label: 'Prosecutor',
    position: { left: '72%', top: '20%' },
    sprites: {
      idle: '/assets/kenney-characters/Male adventurer/PNG/Poses HD/character_maleAdventurer_idle.png',
      confident: '/assets/kenney-characters/Male adventurer/PNG/Poses HD/character_maleAdventurer_cheer0.png',
      pointing: '/assets/kenney-characters/Male adventurer/PNG/Poses HD/character_maleAdventurer_show.png',
      shocked: '/assets/kenney-characters/Male adventurer/PNG/Poses HD/character_maleAdventurer_hurt.png',
      talking: '/assets/kenney-characters/Male adventurer/PNG/Poses HD/character_maleAdventurer_talk.png',
    },
    defaultPose: 'idle',
  },
  defense: {
    id: 'defense',
    label: 'Defense',
    position: { left: '28%', top: '20%' },
    sprites: {
      idle: '/assets/kenney-characters/Female person/PNG/Poses HD/character_femalePerson_idle.png',
      confident: '/assets/kenney-characters/Female person/PNG/Poses HD/character_femalePerson_cheer0.png',
      pointing: '/assets/kenney-characters/Female person/PNG/Poses HD/character_femalePerson_show.png',
      shocked: '/assets/kenney-characters/Female person/PNG/Poses HD/character_femalePerson_hurt.png',
      desk_slam: '/assets/kenney-characters/Female person/PNG/Poses HD/character_femalePerson_attack0.png',
    },
    defaultPose: 'idle',
  },
  witness: {
    id: 'witness',
    label: 'Witness',
    position: { left: '50%', top: '28%' },
    sprites: {
      idle: '/assets/kenney-characters/Female adventurer/PNG/Poses HD/character_femaleAdventurer_idle.png',
      nervous: '/assets/kenney-characters/Female adventurer/PNG/Poses HD/character_femaleAdventurer_think.png',
      shocked: '/assets/kenney-characters/Female adventurer/PNG/Poses HD/character_femaleAdventurer_hurt.png',
    },
    defaultPose: 'idle',
  },
  bailiff: {
    id: 'bailiff',
    label: 'Bailiff',
    position: { left: '88%', top: '40%' },
    sprites: { idle: '/assets/kenney-characters/Robot/PNG/Poses HD/character_robot_idle.png' },
    defaultPose: 'idle',
  },
  clerk: {
    id: 'clerk',
    label: 'Clerk',
    position: { left: '12%', top: '40%' },
    sprites: { idle: '/assets/kenney-characters/Zombie/PNG/Poses HD/character_zombie_idle.png' },
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
