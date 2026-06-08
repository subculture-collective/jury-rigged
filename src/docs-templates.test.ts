import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('case automation plan documents queue and fallback behavior', () => {
    const doc = readFileSync(
        join(process.cwd(), 'docs/superpowers/plans/2026-06-08-case-automation-queue.md'),
        'utf8',
    );

    assert.match(doc, /Case Automation Queue Implementation Plan/);
    assert.match(doc, /!prompt <case idea>/);
    assert.match(doc, /generated cases/i);
    assert.match(doc, /visible queue/i);
    assert.match(doc, /LLM_FALLBACK_STOP_THRESHOLD|fallback/i);
});
