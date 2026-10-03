import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { schedule } from './scheduler.ts';

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('schedule', () => {
	beforeEach(() => {
		mock.timers.enable({ apis: ['setTimeout'] });
		mock.method(console, 'error', () => {});
	});

	afterEach(() => {
		mock.timers.reset();
		mock.restoreAll();
	});

	it('waits for a slow task to finish before counting down to the next run', async () => {
		const { promise, resolve } = Promise.withResolvers<void>();
		const task = mock.fn(() => (task.mock.callCount() === 1 ? promise : Promise.resolve()));

		schedule(task, 1);
		mock.timers.tick(5 * 60_000);
		assert.equal(task.mock.callCount(), 1);

		resolve();
		await settle();
		mock.timers.tick(60_000);
		assert.equal(task.mock.callCount(), 2);
	});

	it('keeps running after a task fails', async () => {
		const task = mock.fn(() => Promise.reject(new Error('broker gone')));

		schedule(task, 1);
		await settle();
		mock.timers.tick(60_000);
		await settle();

		assert.equal(task.mock.callCount(), 2);
	});

	it('lets stop wait for the running task', async () => {
		const { promise, resolve } = Promise.withResolvers<void>();
		let finished = false;
		const stop = schedule(() => promise.then(() => void (finished = true)), 1);
		const stopped = stop().then(() => finished);

		resolve();

		assert.equal(await stopped, true);
	});
});
