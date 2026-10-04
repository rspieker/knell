import { matches } from '../source/topic.ts';
import type { Handler, Message, Transport } from '../source/transport.ts';

type Client = {
	subscriptions: Array<[string, Handler]>;
};

/**
 * Just enough of an MQTT broker to observe knell: retained messages,
 * wildcard subscriptions and a last will on an ungraceful disconnect.
 */
export function createBroker() {
	const retained = new Map<string, string>();
	const published: Array<Message> = [];
	const clients = new Set<Client>();

	function route(message: Message): void {
		published.push(message);

		if (message.retain) {
			if (message.payload === '') {
				retained.delete(message.topic);
			} else {
				retained.set(message.topic, message.payload);
			}
		}

		for (const client of clients) {
			for (const [filter, handler] of client.subscriptions) {
				if (matches(filter, message.topic)) {
					handler({ ...message, retain: false });
				}
			}
		}
	}

	return {
		retained,
		published,

		/** Seed retained state, as left behind by an earlier run */
		retain(topic: string, payload: unknown): void {
			retained.set(topic, typeof payload === 'string' ? payload : JSON.stringify(payload));
		},

		/** Parsed retained payload of a topic */
		read(topic: string): unknown {
			const payload = retained.get(topic);

			return payload === undefined ? undefined : JSON.parse(payload);
		},

		connect({ status }: { status?: string } = {}): Transport & { vanish(): void } {
			const client: Client = { subscriptions: [] };
			const leave = (): void => {
				if (clients.delete(client) && status) {
					route({ topic: status, payload: 'offline', retain: true });
				}
			};

			clients.add(client);

			if (status) {
				route({ topic: status, payload: 'online', retain: true });
			}

			return {
				async publish(topic, payload, { retain = false } = {}) {
					route({ topic, payload, retain });
				},
				async subscribe(filter, handler) {
					client.subscriptions.push([filter, handler]);

					for (const [topic, payload] of retained) {
						if (matches(filter, topic)) {
							handler({ topic, payload, retain: true });
						}
					}
				},
				async end() {
					leave();
				},
				vanish: leave,
			};
		},
	};
}
