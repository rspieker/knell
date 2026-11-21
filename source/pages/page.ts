import type { Device, Entity } from '../device.ts';
import type { Check, Page } from './config.ts';
import { text } from './text.ts';

export type Visit = {
	/** HTTP status, null when no response came */
	status: number | null;
	/** Milliseconds until the entire page arrived */
	elapsed: number | null;
	/** What the checks read: the page, or its text */
	body: string | null;
	/** Why the page is not reachable, null when it is */
	error: string | null;
};

/** Home Assistant refuses longer states */
const longest = 255;

function reason(error: unknown): string {
	if (!(error instanceof Error)) {
		return String(error);
	}

	// fetch hides the actual reason (refused, unknown host, …) in its cause
	const cause = error.cause as { message?: string; code?: string } | undefined;
	const detail = cause?.message || cause?.code;

	return detail ? `${error.message}: ${detail}` : error.message;
}

export async function visit(page: Page, request: typeof fetch): Promise<Visit> {
	const started = performance.now();

	try {
		const response = await request(page.address, {
			headers: page.headers,
			signal: AbortSignal.timeout(page.timeout * 1000),
		});
		const body = await response.text();
		const expected = page.status.length ? page.status.includes(response.status) : response.ok;

		return {
			status: response.status,
			elapsed: Math.round(performance.now() - started),
			body: page.text ? text(body) : body,
			error: expected ? null : `HTTP ${response.status} ${response.statusText}`.trim(),
		};
	} catch (error) {
		return { status: null, elapsed: null, body: null, error: reason(error) };
	}
}

/** A check's entity; unknown (null) when there was nothing to read */
function entity({ kind, key, name, expression, config }: Check, body: string | null): Entity {
	if (kind === 'contains') {
		const match = body === null ? null : expression.exec(body);

		return {
			key,
			name,
			component: 'binary_sensor',
			value: body === null ? null : match !== null,
			attributes: { match: match?.[0] ?? null },
			config: { icon: 'mdi:text-search', ...config },
		};
	}

	if (kind === 'count') {
		return {
			key,
			name,
			component: 'sensor',
			value: body === null ? null : [...body.matchAll(expression)].length,
			config: { state_class: 'measurement', icon: 'mdi:counter', ...config },
		};
	}

	const match = body === null ? null : expression.exec(body);
	// the first capture group, or the entire match for a pattern without one
	const found = match ? (match.length > 1 ? (match[1] ?? null) : match[0]) : null;

	return {
		key,
		name,
		component: 'sensor',
		value: found === null ? null : found.slice(0, longest),
		attributes: { ...match?.groups },
		config: { icon: 'mdi:text-box-search-outline', ...config },
	};
}

export function device(page: Page, { status, elapsed, body, error }: Visit): Device {
	const entities: Array<Entity> = [
		{
			key: 'reachable',
			name: 'Reachable',
			component: 'binary_sensor',
			value: error === null,
			attributes: { error },
			config: { device_class: 'connectivity' },
		},
		{
			key: 'status',
			name: 'Status',
			component: 'sensor',
			value: status,
			config: { icon: 'mdi:web' },
		},
		{
			key: 'response_time',
			name: 'Response time',
			component: 'sensor',
			value: elapsed,
			config: {
				device_class: 'duration',
				unit_of_measurement: 'ms',
				state_class: 'measurement',
				entity_category: 'diagnostic',
			},
		},
		...page.checks.map((check) => entity(check, body)),
	];

	return {
		id: page.id,
		name: page.name,
		url: page.url,
		manufacturer: 'knell',
		model: 'Page',
		entities: entities.map((entity) => ({ ...entity, attributes: { url: page.url, ...entity.attributes } })),
	};
}
