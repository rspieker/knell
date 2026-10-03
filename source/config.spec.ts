import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from './config.ts';

describe('loadConfig', () => {
	it('defaults to a 30 minute interval and anonymous access', () => {
		assert.deepEqual(loadConfig({ MQTT_URL: 'mqtt://broker' }), {
			mqtt: { url: 'mqtt://broker', username: undefined, password: undefined },
			interval: 30,
		});
	});

	describe('refuses to start', () => {
		const cases: Array<[string, NodeJS.ProcessEnv, RegExp]> = [
			['without a broker', {}, /MQTT_URL is required/],
			['with an interval that is not a number', { MQTT_URL: 'mqtt://broker', INTERVAL: 'often' }, /INTERVAL/],
			['with an interval of zero', { MQTT_URL: 'mqtt://broker', INTERVAL: '0' }, /INTERVAL/],
		];

		for (const [description, env, error] of cases) {
			it(description, () => assert.throws(() => loadConfig(env), error));
		}
	});
});
