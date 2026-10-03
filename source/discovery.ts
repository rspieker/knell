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

export function identifier(source: string, device: Device): string {
	return `${base}_${slug(source)}_${slug(device.id)}`;
}

export function availability(source: string): string {
	return `${base}/${slug(source)}/status`;
}

export function topics(source: string, device: Device): { config: string; state: string } {
	return {
		config: `${prefix}/device/${identifier(source, device)}/config`,
		state: `${base}/${slug(source)}/${slug(device.id)}/state`,
	};
}

function component(id: string, entity: Entity): Record<string, unknown> {
	const key = slug(entity.key);

	return {
		platform: entity.component,
		unique_id: `${id}_${key}`,
		name: entity.name,
		value_template: `{{ value_json.values.${key} }}`,
		json_attributes_template: `{{ value_json.attributes.${key} | tojson }}`,
		...entity.config,
	};
}

/**
 * Home Assistant device discovery payload, one per device, carrying all of
 * its entities as components sharing a single state topic.
 */
export function payload(source: string, device: Device): Record<string, unknown> {
	const id = identifier(source, device);
	const { state } = topics(source, device);

	return {
		device: {
			identifiers: [id],
			name: device.name,
			manufacturer: device.manufacturer,
			model: device.model,
			sw_version: device.version,
			configuration_url: device.url,
		},
		origin: { name: origin },
		state_topic: state,
		json_attributes_topic: state,
		availability: [{ topic: status }, { topic: availability(source) }],
		availability_mode: 'all',
		qos: 1,
		components: Object.fromEntries(device.entities.map((entity) => [slug(entity.key), component(id, entity)])),
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
