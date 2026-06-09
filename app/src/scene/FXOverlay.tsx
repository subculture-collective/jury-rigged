import type { SceneEvent } from './types';

export function FXOverlay({ event }: { event: SceneEvent | null }) {
  if (!event) return null;

  if (event.type === 'flash') {
    return (
      <div
        className="pointer-events-none absolute inset-0 z-30 animate-flash"
        style={{ backgroundColor: event.color === 'red' ? 'hsl(var(--alert) / 0.6)' : 'rgba(255,255,255,0.85)' }}
      />
    );
  }

  if (event.type === 'shake') {
    return (
      <div className="pointer-events-none absolute inset-0 z-25 animate-stinger-shake" />
    );
  }

  if (event.type === 'stamp') {
    return (
      <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center animate-slide-in-right">
        <div className="border-3 border-[hsl(var(--signal))] bg-[hsl(var(--void-900)/0.95)] px-10 py-5">
          <p className="text-4xl font-black text-[hsl(var(--signal))] uppercase tracking-[0.05em]">{event.text}</p>
        </div>
      </div>
    );
  }

  return null;
}
