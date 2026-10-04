import { base, origin, slug } from './discovery.ts';
import type { Message } from './transport.ts';

export type Entry = {
	source: string;
	state: string;
	/** Components announced (key → platform), excluding those being removed */
	components: Record<string, string>;
};

type Announcement = {
	origin?: { name?: unknown };
	state_topic?: unknown;
	components?: unknown;
};

function isAnnouncement(value: unknown): value is Announcement {
	return typeof value === 'object' && value !== null;
}

/**
 * The live components of an announcement; a component announced with
 * nothing but its platform is on its way out and does not count.
 */
function components(value: unknown): Record<string, string> {
	if (typeof value !== 'object' || value === null) {
		return {};
	}

	return Object.fromEntries(
		Object.entries(value).flatMap(([key, config]) =>
			typeof config?.platform === 'string' && Object.keys(config).length > 1 ? [[key, config.platform]] : [],
		),
	);
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
				entries.set(topic, {
					source,
					state: announcement.state_topic,
					components: components(announcement.components),
				});
			}
		},

		owned(source: string): Array<[string, Entry]> {
			return [...entries].filter(([, entry]) => entry.source === slug(source));
		},

		/** Components previously announced on a config topic */
		components(topic: string): Record<string, string> {
			return entries.get(topic)?.components ?? {};
		},

		forget(topic: string): void {
			entries.delete(topic);
		},
	};
}
