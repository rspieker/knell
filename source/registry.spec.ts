import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRegistry } from './registry.ts';

const topic = 'homeassistant/device/knell_github_x/config';

describe('registry', () => {
	describe('ignores', () => {
		const cases: Array<[string, string]> = [
			['payloads that are not JSON', 'not json'],
			['JSON that is not an object', '42'],
			['announcements without a state topic', '{"origin":{"name":"knell"}}'],
			['state topics outside of knell', '{"origin":{"name":"knell"},"state_topic":"elsewhere/x/state"}'],
		];

		for (const [description, payload] of cases) {
			it(description, () => {
				const registry = createRegistry();

				registry.record({ topic, payload, retain: true });

				assert.deepEqual(registry.owned('github'), []);
			});
		}
	});

	it('forgets a device once its config is emptied', () => {
		const registry = createRegistry();
		const payload = '{"origin":{"name":"knell"},"state_topic":"knell/github/x/state"}';

		registry.record({ topic, payload, retain: true });
		registry.record({ topic, payload: '', retain: true });

		assert.deepEqual(registry.owned('github'), []);
	});
});
