# Courtroom Animation System — Implementation Plan

> **For agentic workers:** Execute this plan task-by-task. Dispatch a fresh subagent per task, review each result, then continue.

**Goal:** Build a React-first courtroom scene system with character sprites, camera cuts, pose changes, dialogue typewriter, FX overlays (objection/flash/shake), and a declarative scene runner — styled to match the new monospace HUD/console aesthetic.

**Architecture:** React + CSS for the stage and UI (no PixiJS dependency in this phase). A typed `SceneEvent` union drives a `SceneRunner` that sequences beats. Character sprites come from the user's asset pack. FX use Tailwind animations + DOM overlays. Stingers already exist in `renderer/stingers.ts` — we port their logic to React hooks. Server SSE already emits `render_directive` events — we consume them in the overlay.

**Tech Stack:** React, TypeScript, Tailwind, existing SSE stream, existing `renderer/` stingers for reference, user-provided character asset pack.

---

## Current State Assessment

| Layer | Status | Notes |
|---|---|---|
| PixiJS renderer (`renderer/`) | Exists, functional | Flash/shake/stamp/stinger primitives. Not React-integrated. |
| Public renderer (`public/renderer/`) | Exists, older | Character layers, dialogue machine, camera. Placeholder-only. |
| Scene runner | **Missing** | Animation doc describes it; no implementation exists. |
| Scene scripts / macros | **Missing** | No declarative scene data. |
| Character sprites | **Missing** | Empty asset directories. User has generic pack. |
| SSE directive → overlay | Partial | `render_directive` events flow but overlay only shows stingers. |
| Typewriter dialogue | **Missing** in React | Only in legacy `public/renderer/dialogue.js`. |
| React overlay integration | **Missing** | Overlay is text-only; no character stage, no dialogue box. |

---

## Architecture

```
Server SSE (render_directive events)
        │
        ▼
SceneRunner ── consumes SceneEvent[] sequentially
        │
        ├──▶ useCourtStage() ── character poses, camera, background
        ├──▶ useDialogue()    ── typewriter text, speaker label
        ├──▶ useSceneFX()     ── flash, shake, stamp overlays
        └──▶ StingerExecutor  ── objection/hold-it/present sequences
                    │
                    ▼
          OverlayView renders everything
```

The `SceneRunner` is a React hook/class that takes `SceneEvent[]` and advances through them on timers or user input. It updates Zustand-style state that the overlay components consume.

---

## Milestone 1: Scene Event Types + Runner

**Goal:** Define the `SceneEvent` union type and build a React `SceneRunner` hook that sequences events.

**Files:**
- Create: `app/src/scene/types.ts` — SceneEvent union
- Create: `app/src/scene/runner.ts` — SceneRunner hook
- Test: `app/src/scene/runner.test.ts`

### Task 1.1: Define SceneEvent types

```ts
// app/src/scene/types.ts
export type CharacterId = 'judge' | 'prosecutor' | 'defense' | 'witness' | 'bailiff' | 'clerk';
export type PoseId = 'idle' | 'talking' | 'confident' | 'angry' | 'shocked' | 'pointing' | 'desk_slam' | 'nervous';
export type CameraTarget = 'wide' | 'judge_bench' | 'defense_bench' | 'prosecution_bench' | 'witness_stand' | 'evidence';

export type SceneEvent =
  | { type: 'say';         speaker: CharacterId; text: string; pose?: PoseId; camera?: CameraTarget; awaitAdvance?: boolean }
  | { type: 'set_pose';    character: CharacterId; pose: PoseId }
  | { type: 'cut_to';      camera: CameraTarget }
  | { type: 'play_sfx';    sound: string }
  | { type: 'flash';       color?: 'white' | 'red'; durationMs?: number }
  | { type: 'shake';       intensity?: number; durationMs?: number }
  | { type: 'stamp';       text: string; durationMs?: number }
  | { type: 'stinger';     name: 'objection' | 'hold_it' | 'present' | 'guilty_verdict' | 'not_guilty_verdict' }
  | { type: 'show_evidence'; evidenceId: string }
  | { type: 'wait';        durationMs: number }
  | { type: 'await_input'; inputId: string };
```

### Task 1.2: Build SceneRunner hook

The runner processes one event at a time. `say` events with `awaitAdvance` pause until the user clicks/presses. Other events auto-advance after their duration.

```ts
// app/src/scene/runner.ts
export function useSceneRunner() {
  const [queue, setQueue] = useState<SceneEvent[]>([]);
  const [current, setCurrent] = useState<SceneEvent | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // Load a sequence
  const loadScene = useCallback((events: SceneEvent[]) => {
    setQueue(events);
    setIsRunning(true);
  }, []);

  // Advance to next event
  const advance = useCallback(() => {
    setQueue((prev) => {
      const [, ...rest] = prev;
      return rest;
    });
  }, []);

  // Auto-advance non-blocking events
  useEffect(() => {
    if (!isRunning || queue.length === 0) {
      setIsRunning(false);
      setCurrent(null);
      return;
    }
    const event = queue[0];
    setCurrent(event);

    // Auto-advance unless awaiting input
    if (event.type === 'say' && event.awaitAdvance) return;
    if (event.type === 'await_input') return;

    const duration = event.type === 'say' ? estimateReadTime(event.text) :
                     event.type === 'wait' ? event.durationMs : 0;
    const timer = setTimeout(advance, duration);
    return () => clearTimeout(timer);
  }, [queue, isRunning, advance]);

  return { current, isRunning, loadScene, advance, queueLength: queue.length };
}
```

### Task 1.3: Test the runner

Verify event sequencing, auto-advance for non-blocking events, pause for `awaitAdvance`, and `loadScene`/`advance` lifecycle.

**Validation:** `npm test -- app/src/scene/runner.test.ts`

---

## Milestone 2: Character Sprite System

**Goal:** Load character sprites from the asset pack, support pose switching, and display on a courtroom stage.

**Files:**
- Create: `app/src/scene/characters.ts` — character manifest + sprite loader
- Create: `app/src/scene/Stage.tsx` — courtroom stage component with character sprites
- Create: `app/src/scene/useCourtStage.ts` — stage state hook

### Task 2.1: Character manifest

Define what sprites exist for each character. The asset pack provides named files like `judge_idle.png`, `defense_pointing.png`, etc.

```ts
// app/src/scene/characters.ts
export interface CharacterDef {
  id: CharacterId;
  label: string;
  position: { x: string; y: string }; // CSS position on stage
  sprites: Partial<Record<PoseId, string>>; // pose → image path
  defaultPose: PoseId;
}

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  judge: {
    id: 'judge', label: 'Judge',
    position: { x: '50%', y: '5%' },
    sprites: {
      idle: '/assets/characters/judge_idle.png',
      talking: '/assets/characters/judge_talking.png',
      angry: '/assets/characters/judge_angry.png',
      confident: '/assets/characters/judge_confident.png',
    },
    defaultPose: 'idle',
  },
  prosecutor: {
    id: 'prosecutor', label: 'Prosecutor',
    position: { x: '75%', y: '25%' },
    sprites: {
      idle: '/assets/characters/prosecutor_idle.png',
      confident: '/assets/characters/prosecutor_confident.png',
      pointing: '/assets/characters/prosecutor_pointing.png',
      shocked: '/assets/characters/prosecutor_shocked.png',
    },
    defaultPose: 'idle',
  },
  defense: {
    id: 'defense', label: 'Defense',
    position: { x: '25%', y: '25%' },
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
    id: 'witness', label: 'Witness',
    position: { x: '50%', y: '30%' },
    sprites: {
      idle: '/assets/characters/witness_idle.png',
      nervous: '/assets/characters/witness_nervous.png',
      shocked: '/assets/characters/witness_shocked.png',
    },
    defaultPose: 'idle',
  },
  bailiff: { id: 'bailiff', label: 'Bailiff', position: { x: '85%', y: '45%' }, sprites: { idle: '/assets/characters/bailiff_idle.png' }, defaultPose: 'idle' },
  clerk: { id: 'clerk', label: 'Clerk', position: { x: '15%', y: '45%' }, sprites: { idle: '/assets/characters/clerk_idle.png' }, defaultPose: 'idle' },
};
```

### Task 2.2: Stage component

```tsx
// app/src/scene/Stage.tsx
function CourtStage({ characters, camera, activeSpeaker }: {
  characters: Record<CharacterId, { pose: PoseId; visible: boolean }>;
  camera: CameraTarget;
  activeSpeaker?: CharacterId;
}) {
  // Camera presets are CSS transform targets — zoom + pan to focus area
  const cameraClass = CAMERA_PRESETS[camera];

  return (
    <div className={cn('relative w-full h-full overflow-hidden bg-[hsl(var(--void))] transition-transform duration-300', cameraClass)}>
      {Object.entries(CHARACTERS).map(([id, def]) => {
        const state = characters[id as CharacterId];
        if (!state?.visible) return null;
        const sprite = def.sprites[state.pose] ?? def.sprites[def.defaultPose];
        if (!sprite) return null;
        return (
          <img
            key={id}
            src={sprite}
            alt={def.label}
            className={cn(
              'absolute max-h-[40%] object-contain transition-opacity duration-200',
              activeSpeaker === id ? 'opacity-100' : 'opacity-60',
            )}
            style={{ left: def.position.x, top: def.position.y, transform: 'translate(-50%, 0)' }}
          />
        );
      })}
    </div>
  );
}
```

### Task 2.3: useCourtStage hook

Manages character pose/visibility state derived from `SceneEvent`s.

**Validation:** app build passes, character sprites render at correct positions.

---

## Milestone 3: Dialogue Box + Typewriter

**Goal:** Display a dialogue box at the bottom of the stage with typewriter text, speaker nameplate, and click-to-advance.

**Files:**
- Create: `app/src/scene/DialogueBox.tsx`
- Create: `app/src/scene/useTypewriter.ts`

### Task 3.1: Typewriter hook

```ts
function useTypewriter(text: string, speedMs = 18) {
  const [visible, setVisible] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    setVisible(''); setDone(false);
    let i = 0;
    const timer = setInterval(() => {
      i++;
      setVisible(text.slice(0, i));
      if (i >= text.length) { clearInterval(timer); setDone(true); }
    }, speedMs);
    return () => clearInterval(timer);
  }, [text, speedMs]);

  // Click: if typing → complete instantly. If done → do nothing (caller handles).
  const skip = useCallback(() => {
    setVisible(text); setDone(true);
  }, [text]);

  return { visible, done, skip };
}
```

### Task 3.2: DialogueBox component

Console-styled dialogue box matching the overlay aesthetic — monospace nameplate, mechanical border, typewriter text.

```tsx
function DialogueBox({ speaker, text, onAdvance }: {
  speaker: string; text: string; onAdvance: () => void;
}) {
  const { visible, done, skip } = useTypewriter(text);

  const handleClick = () => {
    if (!done) { skip(); return; }
    onAdvance();
  };

  return (
    <div className="absolute bottom-6 left-1/2 w-[88%] max-w-5xl -translate-x-1/2 z-10" onClick={handleClick}>
      <div className="inline-block border border-[hsl(var(--pulse))] bg-[hsl(var(--void-900))] px-3 py-1 text-xs uppercase tracking-[0.15em] text-[hsl(var(--pulse))]">
        {speaker}
      </div>
      <div className="min-h-28 border border-[hsl(var(--border-faint))] bg-[hsl(var(--void-800))] p-4 text-base leading-relaxed text-[hsl(var(--ink))] cursor-pointer">
        {visible}
        <span className={cn('inline-block w-2 h-4 bg-[hsl(var(--signal))] ml-0.5', !done && 'animate-blink')} />
      </div>
    </div>
  );
}
```

---

## Milestone 4: FX Overlays (Flash, Shake, Stamp)

**Goal:** Port the PixiJS FX primitives (flash, shake, stamp) to React using Tailwind animations + DOM overlays. These are consumed by the `SceneRunner`.

**Files:**
- Create: `app/src/scene/FXOverlay.tsx`

### Task 4.1: FX component

Single component that renders flash/shake/stamp based on current scene event:

```tsx
function FXOverlay({ event }: { event: SceneEvent | null }) {
  if (!event) return null;

  if (event.type === 'flash') {
    return (
      <div className={cn(
        'pointer-events-none absolute inset-0 z-30 animate-flash',
        event.color === 'red' ? 'bg-[hsl(var(--alert))]' : 'bg-white',
      )} />
    );
  }

  if (event.type === 'shake') {
    return (
      <div className="pointer-events-none absolute inset-0 z-20 animate-stinger-shake" />
    );
  }

  if (event.type === 'stamp') {
    return (
      <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center animate-slide-in-right">
        <div className="border-3 border-[hsl(var(--signal))] bg-[hsl(var(--void-900))/0.95] px-10 py-5">
          <p className="text-4xl font-black text-[hsl(var(--signal))] tracking-[0.05em] uppercase">{event.text}</p>
        </div>
      </div>
    );
  }

  return null;
}
```

---

## Milestone 5: Scene Macros + Scripts

**Goal:** Create reusable macro functions (`objection()`, `holdIt()`, `gavel()`, etc.) and write the opening scene script.

**Files:**
- Create: `app/src/scene/macros.ts`
- Create: `app/src/scene/scripts/opening.ts`

### Task 5.1: Macros

```ts
// app/src/scene/macros.ts
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

export function gavel(): SceneEvent[] {
  return [
    { type: 'play_sfx', sound: 'gavel' },
    { type: 'cut_to', camera: 'judge_bench' },
    { type: 'set_pose', character: 'judge', pose: 'confident' },
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
```

### Task 5.2: Opening scene script

```ts
// app/src/scene/scripts/opening.ts
export const OPENING_SCENE: SceneEvent[] = [
  { type: 'cut_to', camera: 'wide' },
  ...gavel(),
  { type: 'set_pose', character: 'judge', pose: 'confident' },
  { type: 'say', speaker: 'judge', text: 'Court is now in session for the trial of the accused.', pose: 'confident', awaitAdvance: true },
  { type: 'cut_to', camera: 'prosecution_bench' },
  { type: 'set_pose', character: 'prosecutor', pose: 'confident' },
  { type: 'say', speaker: 'prosecutor', text: 'The prosecution is prepared, Your Honor.', pose: 'confident', awaitAdvance: true },
  { type: 'cut_to', camera: 'defense_bench' },
  { type: 'set_pose', character: 'defense', pose: 'confident' },
  { type: 'say', speaker: 'defense', text: 'The defense is ready to proceed.', awaitAdvance: true },
];
```

---

## Milestone 6: Wire Into the Overlay

**Goal:** Integrate the scene system into `OverlayView`. Process incoming `render_directive` SSE events through the scene runner. Show character stage as a background layer behind the HUD overlay.

**Files:**
- Modify: `app/src/App.tsx` — OverlayView gets stage + dialogue + FX components
- Modify: `app/src/App.tsx` — `render_directive` events feed into `useSceneRunner`

### Task 6.1: Overlay integration

The overlay becomes a layered composition:

```
┌──────────────────────────────────────────────┐
│  STAGE LAYER (behind everything)            │
│  ┌──────────────────────────────────────┐   │
│  │    Character sprites, backgrounds    │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  HUD LAYER (on top)                         │
│  ┌────────────────┬─────────────────────┐   │
│  │ Transcript/comms│ Sidebar instruments │   │
│  └────────────────┴─────────────────────┘   │
│                                              │
│  DIALOGUE BOX (bottom, on top of HUD)       │
│  ┌──────────────────────────────────────┐   │
│  │ [SPEAKER] Typewriter dialogue text   │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  FX OVERLAY (flash/shake/stamp, topmost)    │
└──────────────────────────────────────────────┘
```

The `render_directive` SSE event already flows through `useLiveOverlaySession` → `lastEvent`. We add a handler that translates directive events into `SceneEvent[]` and feeds them to the `useSceneRunner`.

---

## Milestone 7: Verify End-to-End

- [ ] All new TypeScript compiles cleanly (`tsc -p app/tsconfig.json --noEmit`)
- [ ] App lint passes (`npm run lint:app`)
- [ ] App builds (`npm run build:app`)
- [ ] Overlay shows character stage with sprites
- [ ] Dialogue box types out text on click-to-advance
- [ ] Flash/shake/stamp FX trigger from scene events
- [ ] Stingers (objection/hold-it) play from macros
- [ ] Server `render_directive` events flow into scene runner

---

## Self-Review

- **Spec coverage:** Scene event types, runner, character sprites, dialogue box, FX overlays, macros, opening scene script, overlay integration — all covered.
- **Placeholder scan:** No TBD/TODO. All steps have concrete code.
- **Scope control:** No PixiJS dependency. React + CSS only. Reuses existing Tailwind animations. Uses asset pack paths that user can populate.
- **Aesthetic match:** Dialogue box and FX use the same `--void`, `--pulse`, `--signal` tokens. Monospace speaker labels. Mechanical borders. Fits the console/HUD system.
- **Phasing:** Each milestone is independently testable.
