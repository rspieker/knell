import type { Device, Entity, Source } from './device.ts';
import { availability, payload, prefix, state, topics } from './discovery.ts';
import { log } from './log.ts';
import { createRegistry } from './registry.ts';
import { schedule } from './scheduler.ts';
import type { Transport } from './transport.ts';

export type KnellOptions = {
	transport: Transport;
	sources: Array<Source>;
	/** Default poll interval in minutes */
	interval: number;
};

type Tally = {
	/** Moment of the last successful poll */
	polled: string | null;
	error: string | null;
	devices: number | null;
	entities: Array<Entity>;
};

/** The bell itself as a device, reporting on its own polls */
function bell(source: Source, { polled, error, devices, entities }: Tally): Device {
	return {
		id: '',
		name: `knell ${source.name ?? source.id}`,
		manufacturer: 'knell',
		model: 'Bell',
		entities: [
			{
				key: 'poll',
				name: 'Poll',
				component: 'binary_sensor',
				value: error !== null,
				attributes: { error },
				config: { device_class: 'problem' },
			},
			{
				key: 'last_poll',
				name: 'Last poll',
				component: 'sensor',
				value: polled,
				config: { device_class: 'timestamp', icon: 'mdi:bell-ring' },
			},
			{
				key: 'devices',
				name: 'Devices',
				component: 'sensor',
				value: devices,
				config: { state_class: 'measurement', icon: 'mdi:bell-outline' },
			},
			...entities,
		],
	};
}

export function createKnell({ transport, sources, interval }: KnellOptions) {
	const registry = createRegistry();
	const tallies = new Map<string, Tally>();
	const stops: Array<() => Promise<void>> = [];

	async function announce(source: Source, devices: Array<Device>): Promise<void> {
		for (const device of devices) {
			const { config, state: topic } = topics(source.id, device);
			const announcement = payload(source.id, device, registry.components(config));

			await transport.publish(config, JSON.stringify(announcement), { retain: true });
			await transport.publish(topic, JSON.stringify(state(device)), { retain: true });
		}
	}

	async function prune(source: Source, devices: Array<Device>): Promise<void> {
		const current = new Set(devices.map((device) => topics(source.id, device).config));

		for (const [config, entry] of registry.owned(source.id)) {
			if (!current.has(config)) {
				log.info(`${source.id}: removing ${config}`);
				registry.forget(config);
				await transport.publish(config, '', { retain: true });
				await transport.publish(entry.state, '', { retain: true });
			}
		}
	}

	async function poll(source: Source): Promise<void> {
		const previous = tallies.get(source.id) ?? { polled: null, error: null, devices: null, entities: [] };
		let devices: Array<Device>;
		let tally: Tally;

		try {
			const result = await source.poll();

			devices = result.devices;
			tally = {
				polled: new Date().toISOString(),
				error: null,
				devices: devices.length,
				entities: result.entities ?? [],
			};
		} catch (error) {
			log.error(`${source.id}: poll failed`, error);
			tally = { ...previous, error: error instanceof Error ? error.message : String(error) };
			tallies.set(source.id, tally);
			await announce(source, [bell(source, tally)]);
			await transport.publish(availability(source.id), 'offline', { retain: true });
			return;
		}

		tallies.set(source.id, tally);

		// the bell first, as its devices refer to it
		const announced = [bell(source, tally), ...devices];

		await announce(source, announced);
		await prune(source, announced);
		await transport.publish(availability(source.id), 'online', { retain: true });
		log.info(`${source.id}: announced ${devices.length} device(s)`);
	}

	return {
		async start(): Promise<void> {
			await transport.subscribe(`${prefix}/device/+/config`, registry.record);

			for (const source of sources) {
				stops.push(schedule(() => poll(source), source.interval ?? interval));
			}
		},

		async stop(): Promise<void> {
			await Promise.all(stops.splice(0).map((stop) => stop()));
			await transport.end();
		},
	};
}
