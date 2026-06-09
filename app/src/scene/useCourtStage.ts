import { useCallback, useState } from 'react';
import type { CharacterId, PoseId, CameraTarget, SceneEvent } from './types';
import { defaultStageState } from './Stage';

export function useCourtStage() {
  const [state, setState] = useState(defaultStageState);

  const applyEvent = useCallback((event: SceneEvent) => {
    if (event.type === 'set_pose') {
      setState((prev) => ({
        ...prev,
        characters: {
          ...prev.characters,
          [event.character]: { ...prev.characters[event.character], pose: event.pose },
        },
      }));
    }

    if (event.type === 'cut_to') {
      setState((prev) => ({ ...prev, camera: event.camera }));
    }

    if (event.type === 'say' && event.speaker) {
      setState((prev) => ({
        ...prev,
        activeSpeaker: event.speaker,
        camera: event.camera ?? prev.camera,
        characters: event.pose ? {
          ...prev.characters,
          [event.speaker]: { ...prev.characters[event.speaker], pose: event.pose },
        } : prev.characters,
      }));
    }
  }, []);

  const reset = useCallback(() => setState(defaultStageState()), []);

  return { state, applyEvent, reset };
}
