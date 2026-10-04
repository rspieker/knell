import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { forget } from '../source/forget.ts';
import { createBroker } from './broker.ts';

describe('forget', () => {
	function seeded() {
		const broker = createBroker();

		broker.retain('knell/status', 'offline');
		broker.retain('knell/github/status', 'online');
		broker.retain('knell/github/state', { values: {} });
		broker.retain('knell/github/rspieker_tui/state', { values: {} });
		broker.retain('homeassistant/device/knell_github/config', { origin: { name: 'knell' } });
		broker.retain('homeassistant/device/knell_github_rspieker_tui/config', { origin: { name: 'knell' } });
		broker.retain('homeassistant/device/zigbee_lamp/config', { origin: { name: 'zigbee2mqtt' } });
		broker.retain('homeassistant/sensor/mqtt_test_presence/config', { name: 'MQTT test' });
		broker.retain('homeassistant/device/handmade/config', 'not quite json');

		return broker;
	}

	it('clears everything knell left behind, removing its devices from HA', async () => {
		const broker = seeded();
		const count = await forget(broker.connect(), 0);

		assert.equal(count, 6);
		assert.deepEqual([...broker.retained.keys()].filter((topic) => topic.includes('knell')), []);
	});

	it('leaves the announcements of others alone', async () => {
		const broker = seeded();

		await forget(broker.connect(), 0);

		assert.deepEqual([...broker.retained.keys()].sort(), [
			'homeassistant/device/handmade/config',
			'homeassistant/device/zigbee_lamp/config',
			'homeassistant/sensor/mqtt_test_presence/config',
		]);
	});
});
