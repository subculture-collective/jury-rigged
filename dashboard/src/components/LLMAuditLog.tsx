import React, { useEffect, useMemo, useState } from 'react';

type LLMAuditEntry = {
    id: string;
    sessionId: string;
    turnId?: string;
    phase: string;
    speaker: string;
    role: string;
    source: string;
    provider: string;
    model: string;
    status: string;
    promptChars: number;
    responseChars?: number;
    promptTokensEstimate?: number;
    responseTokensEstimate?: number;
    latencyMs: number;
    bodyPersisted: boolean;
    createdAt: string;
    errorMessage?: string;
    messages?: Array<{ role: string; content: string }>;
    sanitizedResponse?: string;
};

type LLMAuditStats = {
    total: number;
    bodyPersisted: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    byStatus: Record<string, number>;
    byModel: Record<string, number>;
    byPhase: Record<string, number>;
};

export function LLMAuditLog({ sessionId }: { sessionId: string | null }) {
    const [entries, setEntries] = useState<LLMAuditEntry[]>([]);
    const [stats, setStats] = useState<LLMAuditStats | null>(null);
    const [includeBody, setIncludeBody] = useState(false);
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState('');
    const [error, setError] = useState<string | null>(null);

    const searchParams = useMemo(() => {
        const params = new URLSearchParams({ limit: '80' });
        if (sessionId) params.set('sessionId', sessionId);
        if (query.trim()) params.set('q', query.trim());
        if (status) params.set('status', status);
        if (includeBody) params.set('includeBody', '1');
        return params;
    }, [includeBody, query, sessionId, status]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [auditRes, statsRes] = await Promise.all([
                    fetch(`/api/admin/llm-audit?${searchParams.toString()}`),
                    fetch('/api/admin/llm-audit/stats'),
                ]);
                if (auditRes.status === 401 || statsRes.status === 401) {
                    throw new Error('JuryRigged admin session expired. Open /admin/login, sign in, then return to the operator dashboard.');
                }
                if (!auditRes.ok || !statsRes.ok) {
                    throw new Error('LLM audit API unavailable. Check the server health and operator auth.');
                }
                const auditJson = (await auditRes.json()) as { entries?: LLMAuditEntry[] };
                const statsJson = (await statsRes.json()) as { stats?: LLMAuditStats };
                if (!cancelled) {
                    setEntries(auditJson.entries ?? []);
                    setStats(statsJson.stats ?? null);
                    setError(null);
                }
            } catch (err) {
                if (!cancelled) setError((err as Error).message);
            }
        };
        void load();
        const interval = setInterval(() => void load(), 5_000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [searchParams]);

    useEffect(() => {
        const source = new EventSource('/api/admin/llm-audit/feed');
        source.onmessage = event => {
            try {
                const message = JSON.parse(event.data) as { type?: string; entry?: LLMAuditEntry };
                if (message.type !== 'llm_audit' || !message.entry) return;
                setEntries(current => [message.entry!, ...current.filter(entry => entry.id !== message.entry!.id)].slice(0, 80));
            } catch {
                // Ignore malformed keepalive/admin stream frames.
            }
        };
        source.onerror = () => {
            setError('Live LLM audit feed disconnected. If this persists, refresh after signing in at /admin/login.');
        };
        return () => source.close();
    }, []);

    const modelRows = useMemo(
        () => Object.entries(stats?.byModel ?? {}).sort(([, left], [, right]) => right - left),
        [stats?.byModel],
    );

    return (
        <section className='grid gap-5 xl:grid-cols-[0.8fr_1.2fr]'>
            <div className='space-y-5'>
                <div className='admin-panel-strong p-6'>
                    <p className='admin-kicker'>LLM audit</p>
                    <h2 className='admin-title mt-2'>Prompt / response control feed</h2>
                    <p className='admin-copy mt-3'>
                        Admin-only request metadata is always separated from the public stream. Full prompt and response bodies
                        appear only when explicit body persistence is enabled.
                    </p>
                    {error ? <p className='mt-4 border border-[hsl(var(--red)/0.5)] bg-[hsl(var(--red)/0.12)] px-4 py-3 text-sm text-[hsl(var(--text))]'>{error}</p> : null}
                </div>

                <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
                    <Metric label='Total calls' value={String(stats?.total ?? 0)} />
                    <Metric label='Bodies stored' value={String(stats?.bodyPersisted ?? 0)} />
                    <Metric label='Avg latency' value={`${stats?.avgLatencyMs ?? 0}ms`} />
                    <Metric label='P95 latency' value={`${stats?.p95LatencyMs ?? 0}ms`} />
                </div>

                <div className='admin-panel p-5'>
                    <p className='admin-kicker text-[hsl(var(--gold))]'>Filters</p>
                    <div className='mt-4 space-y-3'>
                        <input
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            placeholder='Search model, role, phase, error…'
                            className='admin-input'
                        />
                        <select
                            value={status}
                            onChange={event => setStatus(event.target.value)}
                            className='admin-select'
                        >
                            <option value=''>Any status</option>
                            <option value='mock'>mock</option>
                            <option value='succeeded'>succeeded</option>
                            <option value='fallback'>fallback</option>
                            <option value='failed'>failed</option>
                        </select>
                        <label className='flex items-center gap-3 text-sm text-[hsl(var(--muted))]'>
                            <input type='checkbox' checked={includeBody} onChange={event => setIncludeBody(event.target.checked)} />
                            Request full persisted bodies
                        </label>
                    </div>
                </div>

                <div className='admin-panel p-5'>
                    <p className='admin-kicker text-[hsl(var(--cyan))]'>Model mix</p>
                    <div className='mt-4 space-y-3'>
                        {modelRows.length > 0 ? (
                            modelRows.map(([model, count]) => (
                                <Row key={model} label={model} value={String(count)} total={stats?.total ?? 1} />
                            ))
                        ) : (
                            <p className='text-sm text-[hsl(var(--muted))]'>No model data yet.</p>
                        )}
                    </div>
                </div>
            </div>

            <div className='admin-panel-strong p-5'>
                <div className='flex items-center justify-between gap-3'>
                    <p className='admin-kicker text-[hsl(var(--purple))]'>Live calls</p>
                    <span className='admin-chip'>{entries.length} shown</span>
                </div>
                <div className='admin-scroll mt-4 max-h-[44rem] space-y-3 pr-1'>
                    {entries.length === 0 ? (
                        <p className='border border-[hsl(var(--border))] bg-black/10 p-5 text-sm text-[hsl(var(--muted))]'>
                            No LLM audit calls recorded yet.
                        </p>
                    ) : (
                        entries.map(entry => (
                            <article key={entry.id} className='border border-[hsl(var(--border))] bg-black/10 p-4'>
                                <div className='flex flex-wrap items-center gap-2'>
                                    <span className='admin-chip'>{entry.status}</span>
                                    <span className='text-sm font-semibold text-[hsl(var(--text))]'>
                                        {entry.speaker} · {entry.role}
                                    </span>
                                    <span className='text-xs text-[hsl(var(--muted))]'>
                                        {entry.phase} · {entry.model} · {entry.latencyMs}ms
                                    </span>
                                </div>
                                <div className='mt-3 grid gap-2 sm:grid-cols-2'>
                                    <Metric label='Prompt chars' value={String(entry.promptChars)} />
                                    <Metric label='Response chars' value={String(entry.responseChars ?? 0)} />
                                </div>
                                <p className='mt-3 text-xs text-[hsl(var(--muted))]'>
                                    {new Date(entry.createdAt).toLocaleString()} · session {entry.sessionId.slice(0, 8)}
                                </p>
                                {entry.errorMessage ? <p className='mt-2 text-xs text-[hsl(var(--red))]'>{entry.errorMessage}</p> : null}
                                {entry.messages ? (
                                    <details className='mt-3 border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-3 text-sm'>
                                        <summary className='cursor-pointer text-[hsl(var(--gold))]'>Prompt and response body</summary>
                                        <pre className='mt-3 whitespace-pre-wrap break-words text-xs leading-5 text-[hsl(var(--muted))]'>
                                            {entry.messages.map(message => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n')}
                                        </pre>
                                        {entry.sanitizedResponse ? (
                                            <pre className='mt-3 whitespace-pre-wrap break-words border-t border-[hsl(var(--border))] pt-3 text-xs leading-5 text-[hsl(var(--text))]'>
                                                {entry.sanitizedResponse}
                                            </pre>
                                        ) : null}
                                    </details>
                                ) : null}
                            </article>
                        ))
                    )}
                </div>
            </div>
        </section>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className='border border-[hsl(var(--border))] bg-black/10 p-4'>
            <p className='text-[0.68rem] uppercase tracking-[0.22em] text-[hsl(var(--muted))]'>{label}</p>
            <p className='mt-2 break-words text-lg font-semibold text-[hsl(var(--text))]'>{value}</p>
        </div>
    );
}

function Row({ label, value, total }: { label: string; value: string; total: number }) {
    return (
        <div>
            <div className='mb-1 flex items-center justify-between gap-3'>
                <span className='text-sm font-medium text-[hsl(var(--text))]'>{label}</span>
                <span className='text-xs text-[hsl(var(--muted))]'>{value}</span>
            </div>
            <div className='h-2 border border-[hsl(var(--border))] bg-black/20'>
                <div className='h-full bg-[hsl(var(--cyan))]' style={{ width: `${(Number(value) / Math.max(total, 1)) * 100}%` }} />
            </div>
        </div>
    );
}
