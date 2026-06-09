import type { CharacterId, PoseId, CameraTarget } from './types';
import { CHARACTERS, CAMERA_PRESETS } from './characters';

interface StageState {
  camera: CameraTarget;
  activeSpeaker?: CharacterId;
  characters: Record<CharacterId, { pose: PoseId; visible: boolean }>;
}

export function defaultStageState(): StageState {
  const chars: StageState['characters'] = {} as StageState['characters'];
  for (const id of Object.keys(CHARACTERS) as CharacterId[]) {
    chars[id] = { pose: CHARACTERS[id].defaultPose, visible: true };
  }
  return { camera: 'wide', characters: chars };
}

export function CourtStage({ state, className }: { state: StageState; className?: string }) {
  const cameraClass = CAMERA_PRESETS[state.camera] ?? '';

  return (
    <div className={`relative w-full h-full overflow-hidden bg-[hsl(var(--void))] ${className ?? ''}`}>
      <div className={`w-full h-full transition-transform duration-300 ease-out ${cameraClass}`}>
        {(Object.keys(CHARACTERS) as CharacterId[]).map((id) => {
          const def = CHARACTERS[id];
          const charState = state.characters[id];
          if (!charState?.visible) return null;
          const sprite = def.sprites[charState.pose] ?? def.sprites[def.defaultPose];
          const isActive = state.activeSpeaker === id;
          return (
            <img
              key={id}
              src={sprite}
              alt={def.label}
              className="absolute max-h-[42%] object-contain transition-all duration-200 select-none"
              style={{
                left: def.position.left,
                top: def.position.top,
                transform: 'translate(-50%, 0)',
                opacity: isActive ? 1 : 0.55,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
