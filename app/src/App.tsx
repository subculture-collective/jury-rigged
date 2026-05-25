import { useMemo, useState } from 'react';
import {
  cases,
  detailTabs,
  evidence,
  health,
  howItWorks,
  jury,
  liveMeta,
  operatorQueue,
  recapMoments,
  timeline,
  transcript,
  views,
  voteOptions,
  type ViewKey,
} from './data';
import {
  CaseCard,
  EvidenceList,
  HealthCard,
  JuryGrid,
  LivePill,
  PhaseRail,
  SectionLabel,
  StatChip,
  Surface,
  TabButton,
  TranscriptLog,
  VoteCard,
  cn,
} from './components';

function App() {
  const [activeView, setActiveView] = useState<ViewKey>('viewer');
  const [selectedCaseId, setSelectedCaseId] = useState(cases[0].id);

  const selectedCase = useMemo(() => cases.find((item) => item.id === selectedCaseId) ?? cases[0], [selectedCaseId]);

  return (
    <div className="min-h-screen bg-[hsl(var(--bg))] text-[hsl(var(--text))]">
      <div className="mx-auto flex min-h-screen max-w-[1680px] flex-col gap-5 px-4 py-4 lg:px-6">
        <header className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.82)] px-4 py-4 shadow-[0_24px_80px_rgba(0,0,0,0.3)] backdrop-blur-xl lg:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <p className="font-monoish text-[10px] uppercase tracking-[0.38em] text-[hsl(var(--cyan))]">JuryRigged</p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[hsl(var(--text))] md:text-3xl">Dark courtroom broadcast UI</h1>
                </div>
                <LivePill />
                <span className="rounded-full border border-[hsl(var(--border))] bg-black/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-[hsl(var(--muted))]">{liveMeta.mode}</span>
              </div>
              <p className="max-w-3xl text-sm leading-6 text-[hsl(var(--muted))]">
                A compact, cinematic legal control surface. Internal tabs swap views without routing; every screen is mock data only.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[520px]">
              <StatChip label="Courtroom" value={liveMeta.courtroom} tone="cyan" />
              <StatChip label="Signal" value={liveMeta.signal} tone="green" />
              <StatChip label="Uptime" value={liveMeta.uptime} tone="gold" />
              <StatChip label="Selected" value={selectedCase.docket} tone="purple" />
            </div>
          </div>

          <nav className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-4" aria-label="View navigation" role="tablist">
            {views.map((view) => (
              <TabButton
                key={view.key}
                active={activeView === view.key}
                label={view.label}
                note={view.note}
                onClick={() => setActiveView(view.key)}
              />
            ))}
          </nav>
        </header>

        <main className="flex-1">
          {activeView === 'viewer' ? <ViewerView selectedCase={selectedCase} onSelectCase={setSelectedCaseId} /> : null}
          {activeView === 'overlay' ? <OverlayView selectedCase={selectedCase} /> : null}
          {activeView === 'directory' ? <DirectoryView selectedCaseId={selectedCaseId} onSelectCase={setSelectedCaseId} /> : null}
          {activeView === 'details' ? <DetailsView selectedCase={selectedCase} onSelectCase={setSelectedCaseId} /> : null}
          {activeView === 'voting' ? <VotingView selectedCase={selectedCase} /> : null}
          {activeView === 'operator' ? <OperatorView selectedCase={selectedCase} /> : null}
          {activeView === 'about' ? <AboutView /> : null}
          {activeView === 'recap' ? <RecapView selectedCase={selectedCase} /> : null}
        </main>
      </div>
    </div>
  );
}

function ViewerView({ selectedCase, onSelectCase }: { selectedCase: (typeof cases)[number]; onSelectCase: (id: string) => void }) {
  return (
    <section className="grid gap-5 xl:grid-cols-[280px_minmax(0,1.5fr)_380px]">
      <div className="space-y-5">
        <PhaseRail phases={timeline} />
        <Surface className="p-5">
          <SectionLabel eyebrow="Selected case" title={selectedCase.title} note={selectedCase.phase} />
          <p className="mt-4 text-sm leading-6 text-[hsl(var(--muted))]">{selectedCase.summary}</p>
          <div className="mt-5 grid gap-2">
            {cases.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectCase(item.id)}
                className={cn(
                  'rounded-2xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--cyan))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]',
                  item.id === selectedCase.id
                    ? 'border-[hsl(var(--cyan)/0.55)] bg-[hsl(var(--surface-2))]'
                    : 'border-[hsl(var(--border))] bg-black/10 hover:border-[hsl(var(--border)/1)]',
                )}
              >
                <p className="font-monoish text-[10px] uppercase tracking-[0.28em] text-[hsl(var(--cyan))]">{item.docket}</p>
                <p className="mt-1 text-sm font-semibold text-[hsl(var(--text))]">{item.title}</p>
              </button>
            ))}
          </div>
        </Surface>
      </div>

      <TranscriptLog items={transcript} />

      <div className="space-y-5">
        <JuryGrid jurors={jury} />
        <EvidenceList items={evidence} compact />
      </div>
    </section>
  );
}

function OverlayView({ selectedCase }: { selectedCase: (typeof cases)[number] }) {
  return (
    <section className="space-y-5">
      <SectionLabel eyebrow="OBS overlay" title="16:9 broadcast mock" note="High-contrast layout, safe for on-air title treatment and lower-third composition." />
      <Surface className="p-4 lg:p-5">
        <div
          className="overflow-hidden rounded-[2rem] border border-[hsl(var(--border))] bg-[linear-gradient(135deg,hsl(var(--bg))_0%,hsl(var(--surface))_40%,hsl(var(--surface-2))_100%)] p-4"
          style={{ aspectRatio: '16 / 9' }}
        >
          <div className="flex h-full flex-col gap-3">
            <div className="flex items-center justify-between rounded-2xl border border-[hsl(var(--border))] bg-black/20 px-4 py-3">
              <div>
                <p className="font-monoish text-[10px] uppercase tracking-[0.36em] text-[hsl(var(--cyan))]">Live courtroom overlay</p>
                <h3 className="mt-1 text-lg font-semibold text-[hsl(var(--text))]">{selectedCase.title}</h3>
              </div>
              <div className="text-right">
                <p className="font-monoish text-sm text-[hsl(var(--gold))]">{selectedCase.docket}</p>
                <p className="text-xs text-[hsl(var(--muted))]">{selectedCase.room}</p>
              </div>
            </div>

            <div className="grid flex-1 gap-3 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-black/20 p-4">
                <p className="text-[10px] uppercase tracking-[0.32em] text-[hsl(var(--muted))]">Transcript</p>
                <div className="mt-3 space-y-3 overflow-hidden">
                  {transcript.slice(0, 4).map((item) => (
                    <div key={item.time} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.7)] p-3">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-monoish text-[hsl(var(--cyan))]">{item.time}</span>
                        <span className="font-semibold text-[hsl(var(--text))]">{item.speaker}</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[hsl(var(--text))]">{item.text}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-black/20 p-4">
                  <p className="text-[10px] uppercase tracking-[0.32em] text-[hsl(var(--muted))]">Right stack</p>
                  <div className="mt-3 space-y-2 text-sm text-[hsl(var(--text))]">
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.8)] p-3">Evidence pin · Exhibit 02</div>
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.8)] p-3">Jury status · 7 steady, 3 cautious</div>
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.8)] p-3">Caption feed · Healthy</div>
                  </div>
                </div>
                <div className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-black/20 p-4">
                  <p className="text-[10px] uppercase tracking-[0.32em] text-[hsl(var(--muted))]">Operator cue</p>
                  <p className="mt-3 text-sm leading-6 text-[hsl(var(--text))]">Lower-third ready. Next speaker card waits in the queue until the judge cues a transition.</p>
                </div>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-black/30 p-3">
              <div className="flex items-center gap-3 overflow-hidden">
                <span className="rounded-full border border-[hsl(var(--border))] px-3 py-1 text-[10px] uppercase tracking-[0.28em] text-[hsl(var(--cyan))]">Jury strip</span>
                <div className="flex min-w-0 gap-2 overflow-hidden text-xs text-[hsl(var(--muted))]">
                  {jury.map((member) => (
                    <span key={member.id} className="rounded-full border border-[hsl(var(--border))] px-2 py-1 whitespace-nowrap">{member.label} · {member.status}</span>
                  ))}
                </div>
              </div>
              <p className="mt-2 font-monoish text-[10px] uppercase tracking-[0.24em] text-[hsl(var(--gold))]">Ticker · {selectedCase.nextBeat}</p>
            </div>
          </div>
        </div>
      </Surface>
    </section>
  );
}

function DirectoryView({ selectedCaseId, onSelectCase }: { selectedCaseId: string; onSelectCase: (id: string) => void }) {
  const groupedCases = [
    { title: 'Live Now', items: cases.filter((item) => item.status.toLowerCase().includes('live')) },
    { title: 'Upcoming Sessions', items: cases.filter((item) => item.status.toLowerCase().includes('pre')) },
    { title: 'Archived Cases', items: cases.filter((item) => item.status.toLowerCase().includes('archive')) },
  ];

  return (
    <section className="space-y-5">
      <SectionLabel eyebrow="Case directory" title="Active docket map" note="Compact cards for scanning status, phase, and risk without a router." />
      <div className="grid gap-5 xl:grid-cols-3">
        {groupedCases.map((group) => (
          <Surface key={group.title} className="p-4">
            <p className="font-monoish text-[10px] uppercase tracking-[0.32em] text-[hsl(var(--cyan))]">{group.title}</p>
            <div className="mt-4 space-y-4">
              {group.items.map((item) => (
                <CaseCard key={item.id} item={item} active={item.id === selectedCaseId} onClick={() => onSelectCase(item.id)} />
              ))}
            </div>
          </Surface>
        ))}
      </div>
    </section>
  );
}

function DetailsView({ selectedCase, onSelectCase }: { selectedCase: (typeof cases)[number]; onSelectCase: (id: string) => void }) {
  return (
    <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
      <Surface className="p-5">
        <SectionLabel eyebrow="Case details" title={selectedCase.title} note={`${selectedCase.docket} · ${selectedCase.status}`} />
        <p className="mt-4 text-sm leading-6 text-[hsl(var(--muted))]">{selectedCase.summary}</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <StatChip label="Judge" value={selectedCase.judge} tone="gold" />
          <StatChip label="Room" value={selectedCase.room} tone="cyan" />
          <StatChip label="Jurors" value={selectedCase.jurorLean} tone="green" />
          <StatChip label="Exhibits" value={`${selectedCase.evidenceCount} items`} tone="purple" />
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-5" aria-label="Case file tabs">
          {detailTabs.map((tab) => (
            <div key={tab.label} className="rounded-2xl border border-[hsl(var(--border))] bg-black/10 p-3">
              <p className="text-sm font-semibold text-[hsl(var(--text))]">{tab.label}</p>
              <p className="mt-2 text-xs leading-5 text-[hsl(var(--muted))]">{tab.detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 grid gap-2">
          {cases.map((item) => (
            <button key={item.id} type="button" onClick={() => onSelectCase(item.id)} className="rounded-2xl border border-[hsl(var(--border))] bg-black/10 px-3 py-2 text-left text-sm text-[hsl(var(--text))] transition hover:bg-[hsl(var(--surface-2))]">
              Switch to {item.docket} · {item.title}
            </button>
          ))}
        </div>
      </Surface>
      <EvidenceList items={evidence} />
    </section>
  );
}

function VotingView({ selectedCase }: { selectedCase: (typeof cases)[number] }) {
  return (
    <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
      <Surface className="p-5">
        <SectionLabel eyebrow="Jury voting" title="Ballot state" note="Disabled choices explain why they are unavailable; no mystery toggles." />
        <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-black/10 p-4">
          <p className="text-sm text-[hsl(var(--muted))]">Current case</p>
          <p className="mt-1 text-lg font-semibold text-[hsl(var(--text))]">{selectedCase.title}</p>
          <p className="mt-1 font-monoish text-[10px] uppercase tracking-[0.28em] text-[hsl(var(--cyan))]">{selectedCase.docket} · {selectedCase.phase}</p>
        </div>
        <div className="mt-4 grid gap-3">
          {voteOptions.map((option) => (
            <VoteCard key={option.label} option={option} />
          ))}
        </div>
      </Surface>
      <Surface className="p-5">
        <SectionLabel eyebrow="Eligibility" title="Why some votes are blocked" note="Clear reasons reduce confusion, especially when the UI is used from the broadcast booth." />
        <div className="mt-5 space-y-3">
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-4">
            <p className="text-sm font-semibold text-[hsl(var(--text))]">Open phase</p>
            <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted))]">A verdict can be recorded now. Sentence controls stay hidden, and special verdict branches stay disabled until a judge opens the matching procedural window.</p>
          </div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-4">
            <p className="text-sm font-semibold text-[hsl(var(--text))]">Accessibility note</p>
            <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted))]">Button labels say exactly what happens. The disabled message is text, not color-only decoration.</p>
          </div>
        </div>
      </Surface>
    </section>
  );
}

function OperatorView({ selectedCase }: { selectedCase: (typeof cases)[number] }) {
  return (
    <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
      <Surface className="p-5">
        <SectionLabel eyebrow="Operator dashboard" title="Queue + control health" note="Short, scannable diagnostics for broadcast operators." />
        <div className="mt-5 grid gap-3">
          {operatorQueue.map((item) => (
            <div key={item.task} className="rounded-2xl border border-[hsl(var(--border))] bg-black/10 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[hsl(var(--text))]">{item.task}</p>
                  <p className="mt-1 text-sm text-[hsl(var(--muted))]">{item.detail}</p>
                </div>
                <span className="rounded-full border border-[hsl(var(--border))] px-2 py-1 text-[10px] uppercase tracking-[0.22em] text-[hsl(var(--cyan))]">{item.state}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <StatChip label="Selected case" value={selectedCase.docket} tone="purple" />
          <StatChip label="Next action" value="Cue lower-third" tone="gold" />
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {['Advance phase', 'Pause stream', 'Send system notice'].map((label) => (
            <button key={label} type="button" className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-3 py-2 text-sm font-semibold text-[hsl(var(--text))] transition hover:border-[hsl(var(--cyan)/0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--cyan))]">
              {label}
            </button>
          ))}
        </div>
        <div className="mt-5 rounded-2xl border border-[hsl(var(--red)/0.45)] bg-[hsl(var(--red)/0.08)] p-4">
          <p className="font-monoish text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--red))]">Confirmation required</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {['End Session', 'Reset Session', 'Lock Chat'].map((label) => (
              <button key={label} type="button" className="rounded-full border border-[hsl(var(--red)/0.45)] px-3 py-1 text-xs font-semibold text-[hsl(var(--text))] transition hover:bg-[hsl(var(--red)/0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--red))]">
                {label}
              </button>
            ))}
          </div>
        </div>
      </Surface>

      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {health.map((item) => (
            <HealthCard key={item.label} label={item.label} value={item.value} note={item.note} />
          ))}
        </div>
        <Surface className="p-5">
          <SectionLabel eyebrow="Watchlist" title="Operator alerts" note="Issues are phrased as actions, not vague red statuses." />
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-4">
              <p className="text-sm font-semibold text-[hsl(var(--text))]">No signal loss detected</p>
              <p className="mt-2 text-sm text-[hsl(var(--muted))]">Caption feed remains under threshold and the archive write queue is healthy.</p>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-4">
              <p className="text-sm font-semibold text-[hsl(var(--text))]">Lower-third ready</p>
              <p className="mt-2 text-sm text-[hsl(var(--muted))]">Prepared for the next speaker change or exhibit callout.</p>
            </div>
          </div>
        </Surface>
      </div>
    </section>
  );
}

function AboutView() {
  return (
    <section className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
      <Surface className="p-5">
        <SectionLabel eyebrow="About / How it works" title="What this interface is doing" note="The design is broadcast-grade, but still a simple mock app with internal tab switching." />
        <div className="mt-5 space-y-3">
          {howItWorks.map((item) => (
            <div key={item.title} className="rounded-2xl border border-[hsl(var(--border))] bg-black/10 p-4">
              <p className="text-sm font-semibold text-[hsl(var(--text))]">{item.title}</p>
              <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted))]">{item.text}</p>
            </div>
          ))}
        </div>
      </Surface>
      <Surface className="p-5">
        <SectionLabel eyebrow="Accessibility" title="Built-in safeguards" note="Labels, focus rings, reduced-motion support, and aria-live transcript logging." />
        <div className="mt-5 space-y-3 text-sm leading-6 text-[hsl(var(--muted))]">
          <p>• Transcript log uses <span className="text-[hsl(var(--text))]">role="log"</span> and <span className="text-[hsl(var(--text))]">aria-live</span>.</p>
          <p>• Juror states include visible text labels; color never carries meaning alone.</p>
          <p>• Focus states are high contrast and keyboard friendly on all buttons.</p>
          <p>• Motion respects reduced-motion preferences via CSS and Tailwind-safe classes.</p>
        </div>
      </Surface>
    </section>
  );
}

function RecapView({ selectedCase }: { selectedCase: (typeof cases)[number] }) {
  return (
    <section className="grid gap-5 xl:grid-cols-[1fr_0.95fr]">
      <Surface className="p-5">
        <SectionLabel eyebrow="Replay / Recap" title="Highlights from the record" note={`Archived context for ${selectedCase.docket}; useful for recap screens and highlight reels.`} />
        <div className="mt-5 space-y-3">
          {recapMoments.map((moment) => (
            <div key={moment.stamp} className="rounded-2xl border border-[hsl(var(--border))] bg-black/10 p-4">
              <div className="flex items-center gap-3">
                <span className="rounded-full border border-[hsl(var(--border))] px-2 py-1 font-monoish text-[10px] uppercase tracking-[0.24em] text-[hsl(var(--cyan))]">{moment.stamp}</span>
                <p className="text-sm font-semibold text-[hsl(var(--text))]">{moment.title}</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted))]">{moment.detail}</p>
            </div>
          ))}
        </div>
      </Surface>
      <Surface className="p-5">
        <SectionLabel eyebrow="Recap card" title="Replay summary" note="Useful as a poster frame or archive sidebar." />
        <div className="mt-5 rounded-[2rem] border border-[hsl(var(--border))] bg-[linear-gradient(180deg,hsl(var(--surface-2))_0%,hsl(var(--surface))_100%)] p-5">
          <p className="font-monoish text-[10px] uppercase tracking-[0.34em] text-[hsl(var(--gold))]">{selectedCase.docket}</p>
          <h3 className="mt-2 text-2xl font-semibold text-[hsl(var(--text))]">{selectedCase.title}</h3>
          <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted))]">{selectedCase.summary}</p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <StatChip label="Outcome" value={selectedCase.status} tone="green" />
            <StatChip label="Phase" value={selectedCase.phase} tone="cyan" />
          </div>
        </div>
      </Surface>
    </section>
  );
}

export default App;
