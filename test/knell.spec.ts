import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import type { Device, Entity, Source } from '../source/device.ts';
import { status } from '../source/discovery.ts';
import { createKnell } from '../source/knell.ts';
import { createBroker } from './broker.ts';

const config = 'homeassistant/device/knell_bell_konfirm_geojson/config';
const state = 'knell/bell/konfirm_geojson/state';

function repository(id: string, stars = 0): Device {
	return {
		id,
		name: id,
		url: `https://github.com/${id}`,
		manufacturer: 'GitHub',
		entities: [
			{
				key: 'stars',
				name: 'Stars',
				component: 'sensor',
				value: stars,
				config: { state_class: 'total' },
			},
			{
				key: 'actions',
				name: 'Actions',
				component: 'binary_sensor',
				value: false,
				attributes: { conclusion: 'success' },
				config: { device_class: 'problem' },
			},
			{ key: 'latest_release', name: 'Latest release', component: 'sensor', value: null },
		],
	};
}

type Bell = Source & {
	devices: Array<Device>;
	entities?: Array<Entity>;
	failure?: Error;
};

function bell(devices: Array<Device>): Bell {
	const source: Bell = {
		id: 'bell',
		devices,
		async poll() {
			if (source.failure) {
				throw source.failure;
			}
			return { devices: source.devices, entities: source.entities };
		},
	};

	return source;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('knell', () => {
	let broker: ReturnType<typeof createBroker>;

	async function ring(source: Source) {
		const transport = broker.connect({ status });
		const knell = createKnell({ transport, sources: [source], interval: 30 });

		await knell.start();
		await settle();

		return { knell, transport };
	}

	async function toll() {
		mock.timers.tick(30 * 60_000);
		await settle();
	}

	beforeEach(() => {
		broker = createBroker();
		mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-04T12:00:00Z') });
		mock.method(console, 'info', () => {});
		mock.method(console, 'error', () => {});
	});

	afterEach(() => {
		mock.timers.reset();
		mock.restoreAll();
	});

	describe('announces', () => {
		it('a device per repository, retained, with all entities as components', async () => {
			await ring(bell([repository('konfirm/geojson')]));

			const shared = {
				json_attributes_topic: state,
				availability: [{ topic: 'knell/status' }, { topic: 'knell/bell/status' }],
				availability_mode: 'all',
				qos: 1,
			};

			assert.deepEqual(broker.read(config), {
				device: {
					identifiers: ['knell_bell_konfirm_geojson'],
					name: 'konfirm/geojson',
					manufacturer: 'GitHub',
					configuration_url: 'https://github.com/konfirm/geojson',
					via_device: 'knell_bell',
				},
				origin: { name: 'knell' },
				state_topic: state,
				components: {
					stars: {
						platform: 'sensor',
						unique_id: 'knell_bell_konfirm_geojson_stars',
						default_entity_id: 'sensor.knell_bell_konfirm_geojson_stars',
						name: 'Stars',
						value_template: "{{ value_json['values']['stars'] }}",
						json_attributes_template: "{{ value_json['attributes']['stars'] | tojson }}",
						...shared,
						state_class: 'total',
					},
					actions: {
						platform: 'binary_sensor',
						unique_id: 'knell_bell_konfirm_geojson_actions',
						default_entity_id: 'binary_sensor.knell_bell_konfirm_geojson_actions',
						name: 'Actions',
						value_template: "{{ value_json['values']['actions'] }}",
						json_attributes_template: "{{ value_json['attributes']['actions'] | tojson }}",
						...shared,
						device_class: 'problem',
					},
					latest_release: {
						platform: 'sensor',
						unique_id: 'knell_bell_konfirm_geojson_latest_release',
						default_entity_id: 'sensor.knell_bell_konfirm_geojson_latest_release',
						name: 'Latest release',
						value_template: "{{ value_json['values']['latest_release'] }}",
						json_attributes_template: "{{ value_json['attributes']['latest_release'] | tojson }}",
						...shared,
					},
				},
			});
		});

		it('only options HA accepts at device level, as it rejects the entire device otherwise', async () => {
			await ring(bell([repository('konfirm/geojson')]));

			assert.deepEqual(Object.keys(broker.read(config) as object).sort(), [
				'components',
				'device',
				'origin',
				'state_topic',
			]);
		});

		it('the state of all entities of a device in a single retained message', async () => {
			await ring(bell([repository('konfirm/geojson', 3)]));

			assert.deepEqual(broker.read(state), {
				values: { stars: 3, actions: 'OFF', latest_release: null },
				attributes: { stars: {}, actions: { conclusion: 'success' }, latest_release: {} },
			});
		});

		it('unknown values as null, which HA shows as unknown', async () => {
			const device = repository('konfirm/geojson');

			device.entities = device.entities.map((entity) => ({ ...entity, value: null }));
			await ring(bell([device]));

			assert.deepEqual(broker.read(state), {
				values: { stars: null, actions: null, latest_release: null },
				attributes: { stars: {}, actions: { conclusion: 'success' }, latest_release: {} },
			});
		});

		it('itself and each source as online', async () => {
			await ring(bell([]));

			assert.equal(broker.retained.get('knell/status'), 'online');
			assert.equal(broker.retained.get('knell/bell/status'), 'online');
		});

		it('new states on every interval', async () => {
			const source = bell([repository('konfirm/geojson', 3)]);

			await ring(source);
			source.devices = [repository('konfirm/geojson', 4)];
			await toll();

			assert.deepEqual(broker.read(state), {
				values: { stars: 4, actions: 'OFF', latest_release: null },
				attributes: { stars: {}, actions: { conclusion: 'success' }, latest_release: {} },
			});
		});
	});

	describe('rings its own bell', () => {
		const bellConfig = 'homeassistant/device/knell_bell/config';

		it('as a device through which the devices of its source are connected', async () => {
			const source = bell([repository('konfirm/geojson')]);

			source.name = 'Bell';
			source.entities = [{ key: 'rate_limit', name: 'Rate limit', component: 'sensor', value: 42 }];
			await ring(source);

			const announcement = broker.read(bellConfig) as {
				device: unknown;
				components: Record<string, { availability: unknown }>;
			};

			assert.deepEqual(announcement.device, {
				identifiers: ['knell_bell'],
				name: 'knell Bell',
				manufacturer: 'knell',
				model: 'Bell',
			});
			assert.deepEqual(Object.keys(announcement.components), ['poll', 'last_poll', 'devices', 'rate_limit']);
			assert.deepEqual(broker.read('knell/bell/state'), {
				values: { poll: 'OFF', last_poll: '2026-10-04T12:00:00.000Z', devices: 1, rate_limit: 42 },
				attributes: { poll: { error: null }, last_poll: {}, devices: {}, rate_limit: {} },
			});
		});

		it('reporting a failing poll and why, while remembering the last good one', async () => {
			const source = bell([repository('konfirm/geojson')]);

			await ring(source);
			source.failure = new Error('rate limited');
			await toll();

			assert.deepEqual(broker.read('knell/bell/state'), {
				values: { poll: 'ON', last_poll: '2026-10-04T12:00:00.000Z', devices: 1 },
				attributes: { poll: { error: 'rate limited' }, last_poll: {}, devices: {} },
			});
		});

		it('remaining available while its source is not, as that is when it matters', async () => {
			await ring(bell([]));

			const { components } = broker.read(bellConfig) as { components: Record<string, { availability: unknown }> };

			assert.deepEqual(components.poll?.availability, [{ topic: 'knell/status' }]);
		});
	});

	describe('removes', () => {
		it('an entity no longer returned, announcing it with only its platform once', async () => {
			const source = bell([repository('konfirm/geojson')]);
			const withoutActions = repository('konfirm/geojson');
			const components = () => (broker.read(config) as { components: Record<string, unknown> }).components;

			withoutActions.entities = withoutActions.entities.filter(({ key }) => key !== 'actions');
			await ring(source);
			source.devices = [withoutActions];
			await toll();

			assert.deepEqual(components().actions, { platform: 'binary_sensor' });

			await toll();

			assert.deepEqual(Object.keys(components()), ['stars', 'latest_release']);
		});

		it('a device that is no longer returned by its source', async () => {
			const source = bell([repository('konfirm/geojson'), repository('konfirm/flugrekorder')]);

			await ring(source);
			source.devices = [repository('konfirm/flugrekorder')];
			await toll();

			assert.equal(broker.retained.has(config), false);
			assert.equal(broker.retained.has(state), false);
			assert.equal(broker.retained.has('homeassistant/device/knell_bell_konfirm_flugrekorder/config'), true);
		});

		it('a device announced by an earlier run that no longer exists', async () => {
			broker.retain(config, { origin: { name: 'knell' }, state_topic: state });
			broker.retain(state, { values: {} });

			await ring(bell([]));

			assert.equal(broker.retained.has(config), false);
			assert.equal(broker.retained.has(state), false);
		});
	});

	describe('leaves alone', () => {
		it('devices announced by others', async () => {
			const foreign = 'homeassistant/device/zigbee_lamp/config';

			broker.retain(foreign, { origin: { name: 'zigbee2mqtt' }, state_topic: 'zigbee2mqtt/lamp' });
			await ring(bell([]));

			assert.equal(broker.retained.has(foreign), true);
		});

		it('devices of other sources', async () => {
			const other = 'homeassistant/device/knell_other_thing/config';

			broker.retain(other, { origin: { name: 'knell' }, state_topic: 'knell/other/thing/state' });
			await ring(bell([]));

			assert.equal(broker.retained.has(other), true);
		});

		it('devices when the source fails, marking the source offline instead', async () => {
			const source = bell([repository('konfirm/geojson')]);

			await ring(source);
			source.failure = new Error('rate limited');
			await toll();

			assert.equal(broker.retained.has(config), true);
			assert.equal(broker.retained.get('knell/bell/status'), 'offline');
			assert.equal(broker.retained.get('knell/status'), 'online');
		});
	});

	describe('falls silent', () => {
		it('marking the source online again once it recovers', async () => {
			const source = bell([repository('konfirm/geojson')]);

			await ring(source);
			source.failure = new Error('rate limited');
			await toll();
			source.failure = undefined;
			await toll();

			assert.equal(broker.retained.get('knell/bell/status'), 'online');
		});

		it('when stopped, announcing itself offline and polling no more', async () => {
			const source = bell([repository('konfirm/geojson')]);
			const poll = mock.method(source, 'poll');
			const { knell } = await ring(source);

			await knell.stop();
			await toll();

			assert.equal(broker.retained.get('knell/status'), 'offline');
			assert.equal(poll.mock.callCount(), 1);
		});

		it('when it vanishes, by way of its last will', async () => {
			const { transport } = await ring(bell([]));

			transport.vanish();

			assert.equal(broker.retained.get('knell/status'), 'offline');
		});
	});
});
