import type { Device, Source } from './device.ts';
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

export function createKnell({ transport, sources, interval }: KnellOptions) {
	const registry = createRegistry();
	const stops: Array<() => Promise<void>> = [];

	async function announce(source: Source, devices: Array<Device>): Promise<void> {
		for (const device of devices) {
			const { config, state: topic } = topics(source.id, device);

			await transport.publish(config, JSON.stringify(payload(source.id, device)), { retain: true });
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
		let devices: Array<Device>;

		try {
			devices = await source.poll();
		} catch (error) {
			log.error(`${source.id}: poll failed`, error);
			await transport.publish(availability(source.id), 'offline', { retain: true });
			return;
		}

		await announce(source, devices);
		await prune(source, devices);
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
