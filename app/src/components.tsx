import type { KeyboardEvent, ReactNode } from 'react';
import type { CaseItem, JuryMember, VoteOption } from './data';

// ── Utility ──
export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

// ── Panel (console surface) ──
export function ConsolePanel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('min-w-0 border border-[hsl(var(--border-faint))] bg-[hsl(var(--panel))]', className)}>
      {children}
    </div>
  );
}

// ── Section header (terminal-style) ──
export function HudSection({ label, note }: { label: string; note?: string }) {
  return (
    <div className="hud-section">
      <span className="hud-section-label">{label}</span>
      <span className="hud-section-line" />
      {note ? <span className="text-2xs text-[hsl(var(--ink-mute))]">{note}</span> : null}
    </div>
  );
}

// ── Status LED indicator ──
export function StatusLed({ state }: { state: 'live' | 'sync' | 'ok' | 'warn' | 'dead' }) {
  const map = { live: 'hud-led-live', sync: 'hud-led-sync', ok: 'hud-led-ok', warn: 'hud-led-warn', dead: '' };
  return <span className={cn('hud-led', map[state])} aria-hidden="true" />;
}

// ── Badge ──
export function HudBadge({ children, tone = 'ink-dim' }: { children: ReactNode; tone?: string }) {
  return (
    <span className="inline-flex items-center border px-1.5 py-0 text-2xs uppercase tracking-[0.12em]" style={{ borderColor: `hsl(var(--${tone}))`, color: `hsl(var(--${tone}))` }}>
      {children}
    </span>
  );
}

// ── Tab button ──
export function TabButton({
  active, label, note, onClick, controls, id, onKeyDown,
}: {
  active: boolean; label: string; note: string; onClick: () => void;
  controls?: string; id?: string; onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button" role="tab" id={id}
      aria-selected={active} aria-controls={controls}
      tabIndex={active ? 0 : -1}
      onClick={onClick} onKeyDown={onKeyDown}
      className={cn(
        'shrink-0 border px-3 py-1.5 text-left transition duration-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--pulse))]',
        active
          ? 'border-[hsl(var(--pulse))] bg-[hsl(var(--panel-raised))]'
          : 'border-[hsl(var(--border-faint))] bg-[hsl(var(--panel))] hover:border-[hsl(var(--pulse))] hover:bg-[hsl(var(--panel-raised))]',
      )}
    >
      <p className="text-xs font-semibold text-[hsl(var(--ink))]">{label}</p>
      {note ? <p className="text-2xs text-[hsl(var(--ink-dim))]">{note}</p> : null}
    </button>
  );
}

// ── Row display (key: value) ──
export function HudRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="hud-row">
      <span className="hud-row-key">{label}</span>
      <span className="hud-row-val" style={accent ? { color: `hsl(var(--${accent}))` } : undefined}>{value}</span>
    </div>
  );
}

// ── Transcript entry (for public transcript view) ──
export function TranscriptRow({
  speaker, role, dialogue, turnNumber, phase, alignRight, roleColor,
}: {
  speaker: string; role: string; dialogue: string; turnNumber: number; phase: string;
  alignRight: boolean; roleColor: string;
}) {
  return (
    <article className={cn('flex w-full py-1', alignRight ? 'justify-end text-right' : 'justify-start text-left')}>
      <div className={cn('max-w-[88%] border-l-2 pl-3', alignRight && 'border-l-0 border-r-2 pl-0 pr-3')} style={{ borderColor: roleColor }}>
        <p className="text-xs font-semibold" style={{ color: roleColor }}>
          [{role.slice(0, 5).toUpperCase()}]{' '}
          <span className="text-[hsl(var(--ink))]">{speaker}</span>
        </p>
        <p className="text-2xs uppercase tracking-[0.1em] text-[hsl(var(--ink-mute))] mt-0.5">
          #{turnNumber} · {phase}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-[hsl(var(--ink-dim))]">{dialogue}</p>
      </div>
    </article>
  );
}

// ── Case card ──
export function CaseCard({ item, active, onClick }: { item: CaseItem; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      className={cn(
        'w-full border p-3 text-left transition duration-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--pulse))]',
        active
          ? 'border-[hsl(var(--pulse))] bg-[hsl(var(--panel-raised))]'
          : 'border-[hsl(var(--border-faint))] bg-[hsl(var(--panel))] hover:border-[hsl(var(--pulse))]',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-2xs uppercase tracking-[0.15em] text-[hsl(var(--signal))]">{item.docket}</p>
          <p className="text-sm font-semibold text-[hsl(var(--ink))] truncate">{item.title}</p>
        </div>
        <HudBadge tone={item.risk === 'Elevated' ? 'alert' : item.risk === 'Moderate' ? 'caution' : 'ink-mute'}>{item.risk}</HudBadge>
      </div>
      <p className="mt-2 text-xs text-[hsl(var(--ink-dim))] line-clamp-2">{item.summary}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {item.tags.map((tag) => (
          <HudBadge key={tag}>{tag}</HudBadge>
        ))}
      </div>
    </button>
  );
}

// ── Evidence item ──
export function EvidenceRow({ item }: { item: { id: string; label: string; type: string; source: string; confidence: string; summary: string; badge: string } }) {
  return (
    <div className="border border-[hsl(var(--border-faint))] bg-[hsl(var(--panel))] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[hsl(var(--ink))]">{item.label}</p>
          <p className="text-2xs text-[hsl(var(--ink-dim))]">{item.type} · {item.source}</p>
        </div>
        <HudBadge tone="caution">{item.badge}</HudBadge>
      </div>
      <p className="mt-2 text-xs text-[hsl(var(--ink-dim))]">{item.summary}</p>
      <p className="mt-2 text-2xs uppercase tracking-[0.1em] text-[hsl(var(--ink-mute))]">{item.confidence}</p>
    </div>
  );
}

// ── Vote card ──
export function VoteCard({ option }: { option: VoteOption }) {
  return (
    <button
      type="button" disabled={option.disabled}
      className={cn(
        'w-full border p-3 text-left transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--pulse))]',
        option.disabled
          ? 'cursor-not-allowed border-[hsl(var(--border-faint))] opacity-60'
          : 'border-[hsl(var(--border-faint))] bg-[hsl(var(--panel))] hover:border-[hsl(var(--pulse))]',
      )}
      aria-describedby={`${option.label.replace(/\s+/g, '-').toLowerCase()}-reason`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-[hsl(var(--ink))]">{option.label}</p>
        <HudBadge tone={option.disabled ? 'alert' : 'confirm'}>{option.disabled ? 'UNAVAILABLE' : 'AVAILABLE'}</HudBadge>
      </div>
      <p id={`${option.label.replace(/\s+/g, '-').toLowerCase()}-reason`} className="mt-2 text-xs text-[hsl(var(--ink-dim))]">{option.reason}</p>
      <p className="mt-1 text-2xs text-[hsl(var(--ink))]">{option.note}</p>
    </button>
  );
}

// ── Jury member row ──
export function JuryRow({ juror }: { juror: JuryMember }) {
  const dotColor = juror.status === 'Steady' ? 'confirm' : juror.status === 'Split' ? 'caution' : juror.status === 'Cautious' ? 'pulse' : juror.status === 'Excused' ? 'alert' : 'signal';
  return (
    <div className="flex items-center gap-2 py-1 border-b border-[hsl(var(--border-faint)/0.4)] last:border-0">
      <span className={cn('size-2', `bg-[hsl(var(--${dotColor}))]`)} aria-hidden="true" />
      <span className="text-2xs text-[hsl(var(--ink-mute))] w-7">{juror.label}</span>
      <span className="text-xs text-[hsl(var(--ink))] flex-1 truncate">{juror.status}</span>
      <span className="text-2xs text-[hsl(var(--ink-dim))] hidden sm:inline">{juror.note}</span>
    </div>
  );
}
