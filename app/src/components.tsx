import type { ReactNode } from 'react';
import type { CaseItem, JuryMember, TranscriptItem, VoteOption } from './data';

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function Surface({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-3xl border border-[hsl(var(--border)/0.85)] bg-[hsl(var(--surface)/0.78)] shadow-[0_18px_60px_rgba(0,0,0,0.32)] backdrop-blur-xl', className)}>
      {children}
    </div>
  );
}

export function SectionLabel({ eyebrow, title, note }: { eyebrow: string; title: string; note?: string }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <p className="font-monoish text-[10px] uppercase tracking-[0.36em] text-[hsl(var(--cyan))]">{eyebrow}</p>
        <h2 className="mt-2 text-lg font-semibold text-[hsl(var(--text))] md:text-xl">{title}</h2>
      </div>
      {note ? <p className="max-w-md text-right text-xs text-[hsl(var(--muted))]">{note}</p> : null}
    </div>
  );
}

export function LivePill({ text = 'LIVE' }: { text?: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--red)/0.45)] bg-[hsl(var(--red)/0.12)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.32em] text-[hsl(var(--text))]">
      <span className="size-2 rounded-full bg-[hsl(var(--red))] shadow-[0_0_0_6px_hsl(var(--red)/0.14)] motion-safe:animate-pulse" aria-hidden="true" />
      {text}
    </span>
  );
}

export function StatChip({ label, value, tone = 'cyan' }: { label: string; value: string; tone?: 'cyan' | 'gold' | 'red' | 'purple' | 'green' }) {
  const toneMap = {
    cyan: 'text-[hsl(var(--cyan))]',
    gold: 'text-[hsl(var(--gold))]',
    red: 'text-[hsl(var(--red))]',
    purple: 'text-[hsl(var(--purple))]',
    green: 'text-[hsl(var(--green))]',
  } as const;

  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-black/10 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.28em] text-[hsl(var(--muted))]">{label}</p>
      <p className={cn('mt-1 font-monoish text-sm font-semibold', toneMap[tone])}>{value}</p>
    </div>
  );
}

export function TabButton({
  active,
  label,
  note,
  onClick,
}: {
  active: boolean;
  label: string;
  note: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      onClick={onClick}
      className={cn(
        'group rounded-2xl border px-3 py-2 text-left transition duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--cyan))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]',
        active
          ? 'border-[hsl(var(--cyan)/0.55)] bg-[hsl(var(--surface-2))] shadow-[0_0_0_1px_hsl(var(--cyan)/0.18),0_14px_30px_rgba(0,0,0,0.2)]'
          : 'border-[hsl(var(--border))] bg-black/10 hover:border-[hsl(var(--border)/1)] hover:bg-[hsl(var(--surface-2)/0.68)]',
      )}
      aria-selected={active}
    >
      <p className="text-sm font-semibold text-[hsl(var(--text))]">{label}</p>
      <p className="mt-1 text-[11px] leading-tight text-[hsl(var(--muted))]">{note}</p>
    </button>
  );
}

export function TranscriptLog({ items }: { items: TranscriptItem[] }) {
  const toneClass: Record<TranscriptItem['tone'], string> = {
    accent: 'border-l-[hsl(var(--cyan))]',
    neutral: 'border-l-[hsl(var(--gold))]',
    success: 'border-l-[hsl(var(--green))]',
    warning: 'border-l-[hsl(var(--red))]',
  };

  return (
    <section className="space-y-3">
      <SectionLabel
        eyebrow="Aria-live transcript"
        title="Text-first courtroom feed"
        note="Readable even without audio. Latest entries are announced politely for assistive tech."
      />
      <div
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-atomic="false"
        className="max-h-[720px] space-y-3 overflow-auto pr-1"
      >
        {items.map((item) => (
          <article
            key={`${item.time}-${item.speaker}`}
            className={cn('rounded-2xl border border-l-4 border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.82)] p-4 transition hover:border-[hsl(var(--cyan)/0.35)]', toneClass[item.tone])}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-monoish text-[hsl(var(--cyan))]">{item.time}</span>
              <span className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-[hsl(var(--muted))]">{item.role}</span>
              <span className="font-semibold text-[hsl(var(--text))]">{item.speaker}</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-[hsl(var(--text))]">{item.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function PhaseRail({ phases }: { phases: Array<{ step: string; note: string; state: string }> }) {
  return (
    <Surface className="p-5">
      <SectionLabel eyebrow="Phase rail" title="Courtroom state" note="At-a-glance timeline; active phase is emphasized with text, not just color." />
      <div className="mt-5 space-y-4">
        {phases.map((phase, index) => (
          <div key={phase.step} className="flex gap-4">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'mt-1 size-3 rounded-full border',
                  phase.state === 'active'
                    ? 'border-[hsl(var(--cyan))] bg-[hsl(var(--cyan))] shadow-[0_0_0_6px_hsl(var(--cyan)/0.14)]'
                    : phase.state === 'complete'
                      ? 'border-[hsl(var(--green))] bg-[hsl(var(--green))]'
                      : 'border-[hsl(var(--border))] bg-[hsl(var(--surface-2))]',
                )}
                aria-hidden="true"
              />
              {index < phases.length - 1 ? <span className="mt-2 h-full w-px bg-[hsl(var(--border))]" aria-hidden="true" /> : null}
            </div>
            <div className="pb-5">
              <p className="text-sm font-semibold text-[hsl(var(--text))]">{phase.step}</p>
              <p className="mt-1 text-sm text-[hsl(var(--muted))]">{phase.note}</p>
              <p className="mt-2 font-monoish text-[10px] uppercase tracking-[0.28em] text-[hsl(var(--muted))]">{phase.state}</p>
            </div>
          </div>
        ))}
      </div>
    </Surface>
  );
}

export function JuryGrid({ jurors }: { jurors: JuryMember[] }) {
  const tone = (status: JuryMember['status']) => {
    if (status === 'Steady') return 'bg-[hsl(var(--green))]';
    if (status === 'Split') return 'bg-[hsl(var(--gold))]';
    if (status === 'Cautious') return 'bg-[hsl(var(--cyan))]';
    if (status === 'Excused') return 'bg-[hsl(var(--red))]';
    return 'bg-[hsl(var(--purple))]';
  };

  return (
    <Surface className="p-5">
      <SectionLabel eyebrow="Jury panel" title="Dot matrix + readable status" note="Each juror has a label and text status so meaning survives low color contrast." />
      <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-3">
        {jurors.map((juror) => (
          <div
            key={juror.id}
            role="group"
            className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-3"
            aria-label={`${juror.label} ${juror.status} ${juror.note}`}
          >
            <div className="flex items-center gap-3">
              <span className={cn('size-3 rounded-full', tone(juror.status))} aria-hidden="true" />
              <span className="font-monoish text-sm font-semibold text-[hsl(var(--text))]">{juror.label}</span>
            </div>
            <p className="mt-2 text-xs uppercase tracking-[0.24em] text-[hsl(var(--muted))]">{juror.status}</p>
            <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted))]">{juror.note}</p>
          </div>
        ))}
      </div>
    </Surface>
  );
}

export function EvidenceList({ items, compact = false }: { items: Array<{ id: string; label: string; type: string; source: string; confidence: string; summary: string; badge: string }>; compact?: boolean }) {
  return (
    <Surface className="p-5">
      <SectionLabel eyebrow="Evidence" title="Admissible materials" note="Cards stay short and scannable; the useful detail is always the first line." />
      <div className={cn('mt-5 space-y-3', compact && 'space-y-2')}>
        {items.map((item) => (
          <article key={item.id} className={cn('rounded-2xl border border-[hsl(var(--border))] bg-black/10 p-4', compact && 'p-3')}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[hsl(var(--text))]">{item.label}</p>
                <p className="mt-1 text-xs text-[hsl(var(--muted))]">{item.type} · {item.source}</p>
              </div>
              <span className="rounded-full border border-[hsl(var(--border))] px-2 py-1 text-[10px] uppercase tracking-[0.22em] text-[hsl(var(--gold))]">{item.badge}</span>
            </div>
            <p className="mt-3 text-sm leading-6 text-[hsl(var(--text))]">{item.summary}</p>
            <p className="mt-3 font-monoish text-[10px] uppercase tracking-[0.26em] text-[hsl(var(--muted))]">{item.confidence}</p>
          </article>
        ))}
      </div>
    </Surface>
  );
}

export function CaseCard({ item, active, onClick }: { item: CaseItem; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-3xl border p-4 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--cyan))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]',
        active
          ? 'border-[hsl(var(--cyan)/0.55)] bg-[hsl(var(--surface-2))] shadow-[0_0_0_1px_hsl(var(--cyan)/0.12)]'
          : 'border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.7)] hover:border-[hsl(var(--border)/1)] hover:bg-[hsl(var(--surface-2)/0.84)]',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-monoish text-[10px] uppercase tracking-[0.32em] text-[hsl(var(--cyan))]">{item.docket}</p>
          <h3 className="mt-2 text-lg font-semibold text-[hsl(var(--text))]">{item.title}</h3>
        </div>
        <span className="rounded-full border border-[hsl(var(--border))] px-2 py-1 text-[10px] uppercase tracking-[0.22em] text-[hsl(var(--muted))]">{item.risk}</span>
      </div>
      <p className="mt-3 text-sm text-[hsl(var(--muted))]">{item.summary}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {item.tags.map((tag) => (
          <span key={tag} className="rounded-full border border-[hsl(var(--border))] bg-black/10 px-2 py-1 text-[10px] uppercase tracking-[0.22em] text-[hsl(var(--text))]">{tag}</span>
        ))}
      </div>
    </button>
  );
}

export function VoteCard({ option }: { option: VoteOption }) {
  return (
    <button
      type="button"
      disabled={option.disabled}
      className={cn(
        'w-full rounded-3xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--cyan))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]',
        option.disabled
          ? 'cursor-not-allowed border-[hsl(var(--border))] bg-black/5 opacity-70'
          : 'border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.72)] hover:border-[hsl(var(--cyan)/0.35)] hover:bg-[hsl(var(--surface-2)/0.9)]',
      )}
      aria-describedby={`${option.label.replace(/\s+/g, '-').toLowerCase()}-reason`}
    >
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-semibold text-[hsl(var(--text))]">{option.label}</p>
        <span className={cn('rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.22em]', option.disabled ? 'border-[hsl(var(--red)/0.45)] text-[hsl(var(--red))]' : 'border-[hsl(var(--green)/0.45)] text-[hsl(var(--green))]')}>
          {option.disabled ? 'Unavailable' : 'Available'}
        </span>
      </div>
      <p id={`${option.label.replace(/\s+/g, '-').toLowerCase()}-reason`} className="mt-3 text-sm leading-6 text-[hsl(var(--muted))]">
        {option.reason}
      </p>
      <p className="mt-3 text-xs leading-5 text-[hsl(var(--text))]">{option.note}</p>
    </button>
  );
}

export function HealthCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-4">
      <p className="text-[10px] uppercase tracking-[0.28em] text-[hsl(var(--muted))]">{label}</p>
      <p className="mt-2 font-monoish text-lg font-semibold text-[hsl(var(--text))]">{value}</p>
      <p className="mt-2 text-sm text-[hsl(var(--muted))]">{note}</p>
    </div>
  );
}
