import { base, origin, slug } from './discovery.ts';
import type { Message } from './transport.ts';

export type Entry = {
	source: string;
	state: string;
};

type Announcement = {
	origin?: { name?: unknown };
	state_topic?: unknown;
};

function isAnnouncement(value: unknown): value is Announcement {
	return typeof value === 'object' && value !== null;
}

function parse(payload: string): unknown {
	try {
		return JSON.parse(payload);
	} catch {
		return undefined;
	}
}

/**
 * What knell has announced, as remembered by the broker: fed by a
 * subscription on the discovery topics it receives both the retained configs
 * of earlier runs and the echo of its own publications.
 */
export function createRegistry() {
	const entries = new Map<string, Entry>();

	return {
		record({ topic, payload }: Message): void {
			const announcement = parse(payload);

			if (
				!isAnnouncement(announcement) ||
				announcement.origin?.name !== origin ||
				typeof announcement.state_topic !== 'string'
			) {
				entries.delete(topic);
				return;
			}

			const [root, source] = announcement.state_topic.split('/');

			if (root === base && source) {
				entries.set(topic, { source, state: announcement.state_topic });
			}
		},

		owned(source: string): Array<[string, Entry]> {
			return [...entries].filter(([, entry]) => entry.source === slug(source));
		},

		forget(topic: string): void {
			entries.delete(topic);
		},
	};
}
