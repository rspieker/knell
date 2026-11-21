import { readFileSync } from 'node:fs';
import { slug } from '../discovery.ts';

export const kinds = ['contains', 'extract', 'count'] as const;

export type Kind = (typeof kinds)[number];

export type Check = {
	kind: Kind;
	key: string;
	name: string;
	expression: RegExp;
	/** Discovery options for its entity, e.g. `unit_of_measurement` */
	config: Record<string, unknown>;
};

export type Page = {
	id: string;
	name: string;
	/** As configured, safe to publish: environment variables are not filled in */
	url: string;
	/** As requested, with environment variables filled in */
	address: string;
	headers: Record<string, string>;
	/** Minutes between visits */
	interval: number;
	/** Seconds to wait for the page */
	timeout: number;
	/** Expected status codes, any 2xx when empty */
	status: Array<number>;
	/** Whether to match against the text of an HTML page, rather than its source */
	text: boolean;
	checks: Array<Check>;
};

export type PagesConfig = {
	pages: Array<Page>;
};

/** Entity keys every page has, so no check may use them */
export const reserved = ['reachable', 'status', 'response_time'];

const properties = new Set(['name', 'url', 'interval', 'timeout', 'status', 'headers', 'text', ...kinds]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Fills in `${NAME}` from the environment, refusing names that are not set */
function fill(value: string, env: NodeJS.ProcessEnv, where: string): string {
	return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
		const found = env[name];

		if (!found) {
			throw new Error(`${where} refers to \${${name}}, which is not set`);
		}

		return found;
	});
}

/** `hometown_mentions` reads as `Hometown mentions` */
function title(key: string): string {
	const words = key.replace(/[_-]+/g, ' ').trim();

	return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Patterns always match line by line (`m`), so `^ok$` means a line saying
 * ok. Counting needs every match (`g`), the others only the first.
 */
function expression(pattern: string, flags: string, kind: Kind): RegExp {
	const all = new Set([...flags.replace(/[gy]/g, ''), 'm']);

	if (kind === 'count') {
		all.add('g');
	}

	return new RegExp(pattern, [...all].join(''));
}

function check(kind: Kind, key: string, value: unknown, where: string): Check {
	const spec = typeof value === 'string' ? { pattern: value } : value;

	if (!isRecord(spec) || typeof spec.pattern !== 'string') {
		throw new Error(`${where} needs a pattern, as a string or { "pattern": "…" }`);
	}
	if (spec.flags !== undefined && typeof spec.flags !== 'string') {
		throw new Error(`${where} has flags that are not a string`);
	}
	if (spec.name !== undefined && typeof spec.name !== 'string') {
		throw new Error(`${where} has a name that is not a string`);
	}
	if (spec.config !== undefined && !isRecord(spec.config)) {
		throw new Error(`${where} has a config that is not an object`);
	}

	try {
		return {
			kind,
			key,
			name: spec.name ?? title(key),
			expression: expression(spec.pattern, spec.flags ?? '', kind),
			config: spec.config ?? {},
		};
	} catch (error) {
		throw new Error(`${where}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function positive(value: unknown, fallback: number, where: string): number {
	if (value === undefined) {
		return fallback;
	}
	if (typeof value !== 'number' || !(value > 0)) {
		throw new Error(`${where} must be a positive number, got ${JSON.stringify(value)}`);
	}

	return value;
}

function statuses(value: unknown, where: string): Array<number> {
	const list = value === undefined ? [] : Array.isArray(value) ? value : [value];

	if (!list.every((status) => Number.isInteger(status) && status >= 100 && status <= 599)) {
		throw new Error(`${where} must be a status code or a list of them, got ${JSON.stringify(value)}`);
	}

	return list;
}

function page(id: string, spec: unknown, env: NodeJS.ProcessEnv, defaults: { interval: number }): Page {
	const where = `PAGES: page "${id}"`;

	if (!slug(id)) {
		throw new Error(`${where} needs a name with letters or digits, as it becomes an entity id`);
	}
	if (!isRecord(spec)) {
		throw new Error(`${where} is not an object`);
	}

	const unknown = Object.keys(spec).filter((property) => !properties.has(property));

	if (unknown.length) {
		throw new Error(`${where} has unknown properties ${unknown.join(', ')}; known are ${[...properties].join(', ')}`);
	}
	if (typeof spec.url !== 'string') {
		throw new Error(`${where} needs a url`);
	}

	const address = fill(spec.url, env, `${where} url`);

	if (!/^https?:$/.test(URL.parse(address)?.protocol ?? '')) {
		throw new Error(`${where} needs an http(s) url, got "${spec.url}"`);
	}
	if (spec.name !== undefined && typeof spec.name !== 'string') {
		throw new Error(`${where} has a name that is not a string`);
	}
	if (spec.text !== undefined && typeof spec.text !== 'boolean') {
		throw new Error(`${where} has a text that is not true or false`);
	}
	if (spec.headers !== undefined && !(isRecord(spec.headers) && Object.values(spec.headers).every((v) => typeof v === 'string'))) {
		throw new Error(`${where} has headers that are not an object of strings`);
	}

	const headers = Object.fromEntries(
		Object.entries((spec.headers ?? {}) as Record<string, string>).map(([name, value]) => [
			name,
			fill(value, env, `${where} header ${name}`),
		]),
	);
	const checks: Array<Check> = [];
	const keys = new Set(reserved);

	for (const kind of kinds) {
		const group = spec[kind] ?? {};

		if (!isRecord(group)) {
			throw new Error(`${where} ${kind} must be an object of patterns by name`);
		}

		for (const [key, value] of Object.entries(group)) {
			const at = `${where} ${kind} "${key}"`;

			if (!slug(key)) {
				throw new Error(`${at} needs a name with letters or digits, as it becomes an entity id`);
			}
			if (keys.has(slug(key))) {
				throw new Error(`${at} is taken, by another check or one of ${reserved.join(', ')}`);
			}

			keys.add(slug(key));
			checks.push(check(kind, key, value, at));
		}
	}

	return {
		id,
		name: spec.name ?? id,
		url: spec.url,
		address,
		headers,
		interval: positive(spec.interval, defaults.interval, `${where} interval`),
		timeout: positive(spec.timeout, 30, `${where} timeout`),
		status: statuses(spec.status, `${where} status`),
		text: spec.text ?? false,
		checks,
	};
}

/**
 * Pages to visit, from the JSON file `PAGES` points to; undefined when it
 * points nowhere (the bell is then simply not rung). Refuses anything it does
 * not understand, as a typo would otherwise quietly check nothing.
 */
export function loadPagesConfig(
	env: NodeJS.ProcessEnv,
	defaults: { interval: number },
	read: (file: string) => string = (file) => readFileSync(file, 'utf8'),
): PagesConfig | undefined {
	if (!env.PAGES) {
		return undefined;
	}

	let parsed: unknown;

	try {
		parsed = JSON.parse(read(env.PAGES));
	} catch (error) {
		throw new Error(`PAGES: cannot read ${env.PAGES}: ${error instanceof Error ? error.message : String(error)}`);
	}

	if (!isRecord(parsed) || !Object.keys(parsed).length) {
		throw new Error(`PAGES: ${env.PAGES} must hold an object of pages by name, e.g. { "home": { "url": "…" } }`);
	}

	const pages = Object.entries(parsed).map(([id, spec]) => page(id, spec, env, defaults));
	const ids = pages.map(({ id }) => slug(id));
	const twin = pages.find(({ id }, index) => ids.indexOf(slug(id)) !== index);

	if (twin) {
		throw new Error(`PAGES: page "${twin.id}" has the same entity id as another page`);
	}

	return { pages };
}
