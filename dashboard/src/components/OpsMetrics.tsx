import React, { useEffect, useMemo, useState } from 'react';

function parseMetricValue(metrics: string, name: string): string {
    const line = metrics.split('\n').find(row => row.startsWith(`${name} `));
    return line?.split(/\s+/)[1] ?? '—';
}

export function OpsMetrics() {
    const [health, setHealth] = useState<Record<string, unknown> | null>(null);
    const [metrics, setMetrics] = useState('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [healthRes, metricsRes] = await Promise.all([
                    fetch('/api/health'),
                    fetch('/api/metrics'),
                ]);
                if (!healthRes.ok || !metricsRes.ok) throw new Error('Metrics unavailable or require admin auth');
                const healthJson = await healthRes.json() as Record<string, unknown>;
                const metricsText = await metricsRes.text();
                if (!cancelled) {
                    setHealth(healthJson);
                    setMetrics(metricsText);
                    setError(null);
                }
            } catch (err) {
                if (!cancelled) setError((err as Error).message);
            }
        };
        void load();
        const interval = setInterval(() => void load(), 10_000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, []);

    const cards = useMemo(() => [
        ['Service', String(health?.service ?? 'juryrigged')],
        ['Health', health?.ok ? 'OK' : 'Unknown'],
        ['SSE opened', parseMetricValue(metrics, 'juryrigged_sse_connections_opened_total')],
        ['SSE closed', parseMetricValue(metrics, 'juryrigged_sse_connections_closed_total')],
    ], [health, metrics]);

    return (
        <section className='grid gap-5 xl:grid-cols-[0.8fr_1.2fr]'>
            <div className='space-y-5'>
                <div className='rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.82)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl'>
                    <p className='font-monoish text-[10px] uppercase tracking-[0.34em] text-[hsl(var(--green))]'>Ops monitoring</p>
                    <h2 className='mt-2 text-2xl font-semibold text-[hsl(var(--text))]'>Health + Prometheus metrics</h2>
                    <p className='mt-3 text-sm leading-6 text-[hsl(var(--muted))]'>Admin-only view of the built-in health and metrics endpoints. This gives the dashboard a direct operational readout without exposing metrics publicly.</p>
                    {error ? <p className='mt-4 rounded-2xl border border-[hsl(var(--red)/0.5)] bg-[hsl(var(--red)/0.12)] px-4 py-3 text-sm text-[hsl(var(--text))]'>{error}</p> : null}
                </div>
                <div className='grid gap-3 sm:grid-cols-2'>
                    {cards.map(([label, value]) => (
                        <div key={label} className='rounded-[1.5rem] border border-[hsl(var(--border))] bg-black/10 p-4'>
                            <p className='text-xs uppercase tracking-[0.22em] text-[hsl(var(--muted))]'>{label}</p>
                            <p className='mt-2 text-2xl font-semibold text-[hsl(var(--text))]'>{value}</p>
                        </div>
                    ))}
                </div>
            </div>
            <div className='rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.82)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl'>
                <p className='font-monoish text-[10px] uppercase tracking-[0.34em] text-[hsl(var(--cyan))]'>Raw metrics</p>
                <pre className='mt-4 max-h-[720px] overflow-auto whitespace-pre-wrap rounded-2xl border border-[hsl(var(--border))] bg-black/20 p-4 text-xs leading-5 text-[hsl(var(--muted))]'>{metrics || 'No metrics loaded yet.'}</pre>
            </div>
        </section>
    );
}
