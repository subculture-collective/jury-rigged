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
                const auditJson = await auditRes.json() as { entries?: LLMAuditEntry[] };
                const statsJson = await statsRes.json() as { stats?: LLMAuditStats };
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

    return (
        <section className='grid gap-5 xl:grid-cols-[0.8fr_1.2fr]'>
            <div className='space-y-5'>
                <div className='rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.82)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl'>
                    <p className='font-monoish text-[10px] uppercase tracking-[0.34em] text-[hsl(var(--cyan))]'>LLM audit</p>
                    <h2 className='mt-2 text-2xl font-semibold text-[hsl(var(--text))]'>Prompt / response control feed</h2>
                    <p className='mt-3 text-sm leading-6 text-[hsl(var(--muted))]'>Admin-only request metadata is always separated from the public stream. Full prompt and response bodies appear only when explicit body persistence is enabled.</p>
                    {error ? <p className='mt-4 rounded-2xl border border-[hsl(var(--red)/0.5)] bg-[hsl(var(--red)/0.12)] px-4 py-3 text-sm text-[hsl(var(--text))]'>{error}</p> : null}
                </div>

                <div className='grid gap-3 sm:grid-cols-2'>
                    {[
                        ['Total calls', stats?.total ?? 0],
                        ['Bodies stored', stats?.bodyPersisted ?? 0],
                        ['Avg latency', `${stats?.avgLatencyMs ?? 0}ms`],
                        ['P95 latency', `${stats?.p95LatencyMs ?? 0}ms`],
                    ].map(([label, value]) => (
                        <div key={label} className='rounded-[1.5rem] border border-[hsl(var(--border))] bg-black/10 p-4'>
                            <p className='text-xs uppercase tracking-[0.22em] text-[hsl(var(--muted))]'>{label}</p>
                            <p className='mt-2 text-2xl font-semibold text-[hsl(var(--text))]'>{value}</p>
                        </div>
                    ))}
                </div>

                <div className='rounded-[2rem] border border-[hsl(var(--border))] bg-black/10 p-5'>
                    <p className='font-monoish text-[10px] uppercase tracking-[0.34em] text-[hsl(var(--gold))]'>Filters</p>
                    <div className='mt-4 space-y-3'>
                        <input value={query} onChange={event => setQuery(event.target.value)} placeholder='Search model, role, phase, error…' className='w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-4 py-3 text-sm text-[hsl(var(--text))] outline-none focus:border-[hsl(var(--cyan)/0.6)]' />
                        <select value={status} onChange={event => setStatus(event.target.value)} className='w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-4 py-3 text-sm text-[hsl(var(--text))] outline-none'>
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
            </div>

            <div className='rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.82)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl'>
                <div className='flex items-center justify-between gap-3'>
                    <p className='font-monoish text-[10px] uppercase tracking-[0.34em] text-[hsl(var(--purple))]'>Live calls</p>
                    <span className='rounded-full border border-[hsl(var(--border))] px-3 py-1 text-xs text-[hsl(var(--muted))]'>{entries.length} shown</span>
                </div>
                <div className='mt-4 max-h-[720px] space-y-3 overflow-auto pr-1'>
                    {entries.length === 0 ? (
                        <p className='rounded-2xl border border-[hsl(var(--border))] bg-black/10 p-5 text-sm text-[hsl(var(--muted))]'>No LLM audit calls recorded yet.</p>
                    ) : entries.map(entry => (
                        <article key={entry.id} className='rounded-2xl border border-[hsl(var(--border))] bg-black/10 p-4'>
                            <div className='flex flex-wrap items-center gap-2'>
                                <span className='rounded-full border border-[hsl(var(--border))] px-2 py-1 font-monoish text-[10px] uppercase tracking-[0.2em] text-[hsl(var(--cyan))]'>{entry.status}</span>
                                <span className='text-sm font-semibold text-[hsl(var(--text))]'>{entry.speaker} · {entry.role}</span>
                                <span className='text-xs text-[hsl(var(--muted))]'>{entry.phase} · {entry.model} · {entry.latencyMs}ms</span>
                            </div>
                            <p className='mt-2 text-xs text-[hsl(var(--muted))]'>{new Date(entry.createdAt).toLocaleString()} · prompt {entry.promptChars} chars · response {entry.responseChars ?? 0} chars</p>
                            {entry.errorMessage ? <p className='mt-2 text-xs text-[hsl(var(--red))]'>{entry.errorMessage}</p> : null}
                            {entry.messages ? (
                                <details className='mt-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-3 text-sm'>
                                    <summary className='cursor-pointer text-[hsl(var(--gold))]'>Prompt and response body</summary>
                                    <pre className='mt-3 whitespace-pre-wrap break-words text-xs leading-5 text-[hsl(var(--muted))]'>{entry.messages.map(message => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n')}</pre>
                                    {entry.sanitizedResponse ? <pre className='mt-3 whitespace-pre-wrap break-words border-t border-[hsl(var(--border))] pt-3 text-xs leading-5 text-[hsl(var(--text))]'>{entry.sanitizedResponse}</pre> : null}
                                </details>
                            ) : null}
                        </article>
                    ))}
                </div>
            </div>
        </section>
    );
}
