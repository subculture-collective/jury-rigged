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
                const [healthRes, metricsRes] = await Promise.all([fetch('/api/health'), fetch('/api/metrics')]);
                if (metricsRes.status === 401) {
                    throw new Error('JuryRigged admin session expired. Open /admin/login, sign in, then return to the operator dashboard.');
                }
                if (!healthRes.ok || !metricsRes.ok) {
                    throw new Error('Metrics API unavailable. Check the server health and operator auth.');
                }
                const healthJson = (await healthRes.json()) as Record<string, unknown>;
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

    const cards = useMemo(
        () => [
            ['Service', String(health?.service ?? 'juryrigged')],
            ['Health', health?.ok ? 'OK' : 'Unknown'],
            ['SSE opened', parseMetricValue(metrics, 'juryrigged_sse_connections_opened_total')],
            ['SSE closed', parseMetricValue(metrics, 'juryrigged_sse_connections_closed_total')],
        ],
        [health, metrics],
    );

    return (
        <section className='grid gap-5 xl:grid-cols-[0.8fr_1.2fr]'>
            <div className='space-y-5'>
                <div className='admin-panel-strong p-6'>
                    <p className='admin-kicker'>Ops monitoring</p>
                    <h2 className='admin-title mt-2'>Health + Prometheus metrics</h2>
                    <p className='admin-copy mt-3'>
                        Admin-only view of the built-in health and metrics endpoints. This gives the dashboard a direct operational
                        readout without exposing metrics publicly.
                    </p>
                    {error ? <p className='mt-4 border border-[hsl(var(--red)/0.5)] bg-[hsl(var(--red)/0.12)] px-4 py-3 text-sm text-[hsl(var(--text))]'>{error}</p> : null}
                </div>

                <div className='grid gap-3 sm:grid-cols-2'>
                    {cards.map(([label, value]) => (
                        <Metric key={label} label={label} value={String(value)} />
                    ))}
                </div>
            </div>

            <div className='admin-panel-strong p-5'>
                <div className='flex items-center justify-between gap-3'>
                    <p className='admin-kicker text-[hsl(var(--cyan))]'>Raw metrics</p>
                    <span className='admin-chip'>Prometheus</span>
                </div>
                <pre className='admin-scroll mt-4 max-h-[44rem] overflow-auto whitespace-pre-wrap border border-[hsl(var(--border))] bg-black/20 p-4 text-xs leading-5 text-[hsl(var(--muted))]'>
                    {metrics || 'No metrics loaded yet.'}
                </pre>
            </div>
        </section>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className='border border-[hsl(var(--border))] bg-black/10 p-4'>
            <p className='text-xs uppercase tracking-[0.22em] text-[hsl(var(--muted))]'>{label}</p>
            <p className='mt-2 text-2xl font-semibold text-[hsl(var(--text))]'>{value}</p>
        </div>
    );
}
