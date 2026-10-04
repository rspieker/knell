import type { Device, Entity } from './device.ts';

export const prefix = 'homeassistant';
export const base = 'knell';
export const status = `${base}/status`;
export const origin = 'knell';

export function slug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
}

/** Whether a device is the bell itself, rather than one of its devices */
export function isBell(device: Device): boolean {
	return device.id === '';
}

export function identifier(source: string, device: Device): string {
	return [base, slug(source), slug(device.id)].filter(Boolean).join('_');
}

export function availability(source: string): string {
	return `${base}/${slug(source)}/status`;
}

export function topics(source: string, device: Device): { config: string; state: string } {
	return {
		config: `${prefix}/device/${identifier(source, device)}/config`,
		state: [base, slug(source), slug(device.id), 'state'].filter(Boolean).join('/'),
	};
}

function component(source: string, device: Device, entity: Entity): Record<string, unknown> {
	const key = slug(entity.key);
	const id = `${identifier(source, device)}_${key}`;
	// the bell keeps reporting while its source fails, that is its purpose
	const required = isBell(device) ? [status] : [status, availability(source)];

	return {
		platform: entity.component,
		unique_id: id,
		default_entity_id: `${entity.component}.${id}`,
		name: entity.name,
		// brackets, as dot notation finds dict methods first (`values`, `items`, …)
		value_template: `{{ value_json['values']['${key}'] }}`,
		json_attributes_topic: topics(source, device).state,
		json_attributes_template: `{{ value_json['attributes']['${key}'] | tojson }}`,
		availability: required.map((topic) => ({ topic })),
		availability_mode: 'all',
		qos: 1,
		...entity.config,
	};
}

/**
 * Home Assistant device discovery payload, one per device, carrying all of
 * its entities as components sharing a single state topic. Only a few
 * options may be shared at device level (HA rejects the entire device for
 * e.g. `json_attributes_topic`), so all but the state topic go per component.
 *
 * Components announced before (`previous`, key → platform) but no longer
 * present are removed by announcing them with nothing but their platform.
 */
export function payload(
	source: string,
	device: Device,
	previous: Record<string, string> = {},
): Record<string, unknown> {
	const components: Record<string, Record<string, unknown>> = Object.fromEntries(
		device.entities.map((entity) => [slug(entity.key), component(source, device, entity)]),
	);

	for (const [key, platform] of Object.entries(previous)) {
		components[key] ??= { platform };
	}

	return {
		device: {
			identifiers: [identifier(source, device)],
			name: device.name,
			manufacturer: device.manufacturer,
			model: device.model,
			sw_version: device.version,
			configuration_url: device.url,
			via_device: isBell(device) ? undefined : `${base}_${slug(source)}`,
		},
		origin: { name: origin },
		state_topic: topics(source, device).state,
		components,
	};
}

function value(entity: Entity): string | number | null {
	if (entity.component === 'sensor') {
		return entity.value;
	}
	if (entity.value === null) {
		return null;
	}

	return entity.value ? 'ON' : 'OFF';
}

export function state(device: Device): Record<string, unknown> {
	return {
		values: Object.fromEntries(device.entities.map((entity) => [slug(entity.key), value(entity)])),
		attributes: Object.fromEntries(device.entities.map((entity) => [slug(entity.key), entity.attributes ?? {}])),
	};
}
