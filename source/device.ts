type EntityBase = {
	/** Unique within its device, e.g. `stars` */
	key: string;
	name: string;
	attributes?: Record<string, unknown>;
	/** Additional discovery options, e.g. `device_class`, `state_class`, `icon` */
	config?: Record<string, unknown>;
};

export type Sensor = EntityBase & {
	component: 'sensor';
	value: string | number | null;
};

export type BinarySensor = EntityBase & {
	component: 'binary_sensor';
	value: boolean | null;
};

export type Entity = Sensor | BinarySensor;

export type Device = {
	/** Unique within its source, e.g. `konfirm/geojson`; empty for the bell itself */
	id: string;
	name: string;
	url?: string;
	manufacturer?: string;
	model?: string;
	version?: string;
	entities: Array<Entity>;
};

export type Poll = {
	devices: Array<Device>;
	/** Entities of the bell itself, e.g. a remaining rate limit */
	entities?: Array<Entity>;
};

/**
 * A bell: something knell polls and announces. Returning a device makes it
 * exist in Home Assistant, no longer returning it removes it. Every bell is
 * a device of its own as well, through which its devices are connected.
 */
export type Source = {
	id: string;
	/** Display name, e.g. `GitHub`; defaults to the id */
	name?: string;
	/** Poll interval in minutes, overrides the global interval */
	interval?: number;
	poll(): Promise<Poll>;
};
