import { randomUUID } from 'node:crypto';
import { connect } from 'mqtt';
import { log } from './log.ts';
import { matches } from './topic.ts';
import type { Handler, Transport } from './transport.ts';

export type MqttOptions = {
	url: string;
	username?: string;
	password?: string;
	/** Topic carrying `online`/`offline`, the latter doubling as last will */
	status: string;
};

/**
 * Resolves once connected, retrying for as long as the broker is unreachable
 * (e.g. when started alongside it).
 */
export async function connectMqtt({ url, username, password, status }: MqttOptions): Promise<Transport> {
	const client = connect(url, {
		clientId: `knell_${randomUUID().slice(0, 8)}`,
		username,
		password,
		reconnectPeriod: 5_000,
		will: { topic: status, payload: 'offline', qos: 1, retain: true },
	});
	const connected = new Promise((resolve) => client.once('connect', resolve));
	const subscriptions: Array<[string, Handler]> = [];
	const announce = (payload: 'online' | 'offline') =>
		client.publishAsync(status, payload, { qos: 1, retain: true });

	client.on('connect', () => {
		log.info(`connected to ${url}`);
		announce('online').catch((error: unknown) => log.error('failed to announce online', error));
	});
	client.on('offline', () => log.warn(`no connection to ${url}, retrying`));
	client.on('error', (error) => log.error(`mqtt: ${error.message || ('code' in error && error.code) || error.name}`));
	client.on('message', (topic, payload, packet) => {
		for (const [filter, handler] of subscriptions) {
			if (matches(filter, topic)) {
				handler({ topic, payload: payload.toString(), retain: packet.retain });
			}
		}
	});

	await connected;

	return {
		async publish(topic, payload, { retain = false } = {}) {
			await client.publishAsync(topic, payload, { qos: 1, retain });
		},
		async subscribe(filter, handler) {
			subscriptions.push([filter, handler]);
			await client.subscribeAsync(filter, { qos: 1 });
		},
		async end() {
			await announce('offline');
			await client.endAsync();
		},
	};
}
