import { useCallback, useEffect, useState } from 'react';
import type { SceneEvent } from './types';
import { estimateReadTime } from './types';

export interface SceneRunnerState {
  current: SceneEvent | null;
  isRunning: boolean;
  queueLength: number;
  advance: () => void;
  loadScene: (events: SceneEvent[]) => void;
  stop: () => void;
}

export function useSceneRunner(): SceneRunnerState {
  const [queue, setQueue] = useState<SceneEvent[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const current = queue.length > 0 ? queue[0] : null;

  const advance = useCallback(() => {
    setQueue((prev) => {
      const [, ...rest] = prev;
      return rest;
    });
  }, []);

  const loadScene = useCallback((events: SceneEvent[]) => {
    setQueue(events);
    setIsRunning(true);
  }, []);

  const stop = useCallback(() => {
    setQueue([]);
    setIsRunning(false);
  }, []);

  useEffect(() => {
    if (!isRunning || queue.length === 0) {
      if (queue.length === 0 && isRunning) setIsRunning(false);
      return;
    }
    const event = queue[0];

    if (event.type === 'say' && event.awaitAdvance) return;
    if (event.type === 'await_input') return;

    const duration =
      event.type === 'say' ? estimateReadTime(event.text) :
      event.type === 'wait' ? event.durationMs :
      event.type === 'flash' ? (event.durationMs ?? 200) :
      event.type === 'stamp' ? (event.durationMs ?? 1000) :
      event.type === 'shake' ? (event.durationMs ?? 200) :
      0;

    if (duration <= 0) {
      advance();
      return;
    }

    const timer = window.setTimeout(advance, duration);
    return () => window.clearTimeout(timer);
  }, [queue, isRunning, advance]);

  return { current, isRunning, queueLength: queue.length, advance, loadScene, stop };
}
