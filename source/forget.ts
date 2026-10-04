import { base, origin, prefix } from './discovery.ts';
import type { Message, Transport } from './transport.ts';

/**
 * Whether a retained message is knell's to forget: its own topics, and
 * discovery announcements of its own origin (leaving other integrations be).
 */
function isForgettable({ topic, payload }: Message): boolean {
	if (topic.startsWith(`${base}/`)) {
		return true;
	}

	try {
		return JSON.parse(payload)?.origin?.name === origin;
	} catch {
		return false;
	}
}

/**
 * Clears every retained message knell left on the broker, removing all of its
 * devices from Home Assistant. Retained messages arrive right after
 * subscribing, `patience` (ms) is how long to wait for them. Resolves with
 * the number of topics forgotten.
 */
export async function forget(transport: Transport, patience = 2_000): Promise<number> {
	const topics = new Set<string>();
	const collect = (message: Message) => {
		if (message.retain && message.payload && isForgettable(message)) {
			topics.add(message.topic);
		}
	};

	await transport.subscribe(`${base}/#`, collect);
	await transport.subscribe(`${prefix}/device/+/config`, collect);
	await new Promise((resolve) => setTimeout(resolve, patience));

	for (const topic of topics) {
		await transport.publish(topic, '', { retain: true });
	}

	return topics.size;
}
