import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    CaseQueue,
    CaseQueueValidationError,
    validateCasePrompt,
} from './case-queue.js';

describe('CaseQueue', () => {
    it('trims and stores queued prompts', () => {
        const queue = new CaseQueue();
        const item = queue.enqueue({
            prompt: '  The defendant replaced every gavel with a baguette.  ',
            source: 'twitch',
            submittedBy: 'viewer1',
        });

        assert.equal(item.prompt, 'The defendant replaced every gavel with a baguette.');
        assert.equal(item.status, 'queued');
        assert.equal(item.source, 'twitch');
        assert.equal(item.submittedBy, 'viewer1');
        assert.equal(queue.queued().length, 1);
    });

    it('rejects empty or tiny prompts', () => {
        assert.throws(
            () => validateCasePrompt('tiny'),
            CaseQueueValidationError,
        );
    });

    it('rejects too-long prompts', () => {
        assert.throws(
            () => validateCasePrompt('x'.repeat(501)),
            CaseQueueValidationError,
        );
    });

    it('returns queued items in FIFO order', () => {
        const queue = new CaseQueue();
        const first = queue.enqueue({
            prompt: 'First case about an illegally loud sandwich.',
            source: 'operator',
        });
        const second = queue.enqueue({
            prompt: 'Second case about a haunted office stapler.',
            source: 'twitch',
        });

        assert.equal(queue.nextQueued()?.id, first.id);
        queue.markRunning(first.id, 'session-1');
        assert.equal(queue.nextQueued()?.id, second.id);
    });

    it('marks running items completed by session id', () => {
        const queue = new CaseQueue();
        const item = queue.enqueue({
            prompt: 'The defendant trained pigeons to file tax objections.',
            source: 'twitch',
        });

        const running = queue.markRunning(item.id, 'session-abc');
        assert.equal(running?.status, 'running');
        assert.equal(running?.sessionId, 'session-abc');

        const completed = queue.markCompletedForSession('session-abc');
        assert.equal(completed?.status, 'completed');
        assert.equal(queue.queued().length, 0);
    });

    it('skips only queued items', () => {
        const queue = new CaseQueue();
        const item = queue.enqueue({
            prompt: 'The defendant forged a passport for a houseplant.',
            source: 'operator',
        });

        assert.equal(queue.skip(item.id)?.status, 'skipped');
        assert.equal(queue.skip(item.id), undefined);
        assert.equal(queue.nextQueued(), undefined);
    });
});
