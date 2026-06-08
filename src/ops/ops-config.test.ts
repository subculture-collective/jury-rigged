import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Comparator = '<' | '>' | '<=' | '>=' | '==';

interface DashboardPanel {
    id: string;
    title: string;
    eventTaxonomyRefs?: string[];
    eventName?: string;
    query?: string;
}

interface DashboardDefinition {
    panels: DashboardPanel[];
}

interface AlertRule {
    id: string;
    metric: string;
    comparator: Comparator;
    threshold: number;
    runbook: string;
}

interface AlertConfig {
    alerts: AlertRule[];
}

interface SyntheticScenario {
    id: string;
    metrics: Record<string, number>;
    expectedTriggered: string[];
}

interface SyntheticScenarioConfig {
    scenarios: SyntheticScenario[];
}

function readJson<T>(relativePath: string): T {
    const absolutePath = join(process.cwd(), relativePath);
    const raw = readFileSync(absolutePath, 'utf8');
    return JSON.parse(raw) as T;
}

function compare(value: number, comparator: Comparator, threshold: number): boolean {
    switch (comparator) {
        case '<':
            return value < threshold;
        case '>':
            return value > threshold;
        case '<=':
            return value <= threshold;
        case '>=':
            return value >= threshold;
        case '==':
            return value === threshold;
        default: {
            const _never: never = comparator;
            throw new Error(`Unsupported comparator: ${String(_never)}`);
        }
    }
}

function evaluateTriggeredAlertIds(
    rules: AlertRule[],
    metrics: Record<string, number>,
): string[] {
    const triggered: string[] = [];

    for (const rule of rules) {
        const value = metrics[rule.metric];
        if (typeof value !== 'number') {
            continue;
        }

        if (compare(value, rule.comparator, rule.threshold)) {
            triggered.push(rule.id);
        }
    }

    return triggered.sort();
}

test('runtime dashboard contains required Phase 5 SLI panels', () => {
    const dashboard = readJson<DashboardDefinition>(
        'ops/dashboards/runtime-health.dashboard.json',
    );

    const panelIds = dashboard.panels.map(panel => panel.id);
    assert.deepEqual(panelIds.sort(), [
        'moderation_events_15m',
        'session_completion_rate_15m',
        'stream_and_api_health',
        'vote_latency_p95_10m',
    ]);

    const completionPanel = dashboard.panels.find(
        panel => panel.id === 'session_completion_rate_15m',
    );
    assert.ok(completionPanel?.query?.includes('FROM court_sessions'));
    assert.ok(completionPanel?.query?.includes("status = 'completed'"));

    const moderationPanel = dashboard.panels.find(
        panel => panel.id === 'moderation_events_15m',
    );
    assert.ok(moderationPanel?.query?.includes('FROM court_turns'));
    assert.ok(
        moderationPanel?.query?.includes(
            '[The witness statement has been redacted by the court for decorum violations.]',
        ),
    );
});

test('runtime dashboard event references align with event taxonomy', () => {
    const dashboard = readJson<DashboardDefinition>(
        'ops/dashboards/runtime-health.dashboard.json',
    );
    const knownEventTypes = new Set([
        'analytics_event',
        'moderation_action',
        'phase_changed',
        'session_completed',
        'session_failed',
        'session_started',
    ]);
    const knownAnalyticsEvents = new Set([
        'poll_closed',
        'poll_started',
        'vote_completed',
    ]);

    const refs = dashboard.panels.flatMap(panel => panel.eventTaxonomyRefs ?? []);
    assert.ok(refs.length > 0);

    for (const panel of dashboard.panels) {
        for (const reference of panel.eventTaxonomyRefs ?? []) {
            const eventType = reference.split('.')[0];
            assert.ok(
                knownEventTypes.has(eventType),
                `Expected known event reference ${reference}`,
            );

            if (eventType === 'analytics_event' && panel.eventName) {
                assert.ok(
                    knownAnalyticsEvents.has(panel.eventName),
                    `Expected known analytics event ${panel.eventName}`,
                );
            }
        }
    }
});

test('alert thresholds have runbook links and metrics used by scenarios', () => {
    const alertConfig = readJson<AlertConfig>('ops/alerts/thresholds.json');
    const scenarios = readJson<SyntheticScenarioConfig>(
        'ops/alerts/synthetic-scenarios.json',
    );

    assert.ok(alertConfig.alerts.length >= 4);
    const ruleIds = new Set(alertConfig.alerts.map(rule => rule.id));

    for (const rule of alertConfig.alerts) {
        assert.ok(
            rule.runbook.startsWith('docs/ops-runbook.md#'),
            `Alert ${rule.id} must include runbook anchor`,
        );

        assert.equal(typeof rule.threshold, 'number');
        assert.ok(Number.isFinite(rule.threshold));
    }

    for (const scenario of scenarios.scenarios) {
        const triggered = evaluateTriggeredAlertIds(
            alertConfig.alerts,
            scenario.metrics,
        );
        assert.deepEqual(
            triggered,
            [...scenario.expectedTriggered].sort(),
            `Scenario mismatch: ${scenario.id}`,
        );

        for (const expectedRuleId of scenario.expectedTriggered) {
            assert.ok(
                ruleIds.has(expectedRuleId),
                `Scenario ${scenario.id} references unknown rule ${expectedRuleId}`,
            );
        }
    }
});
