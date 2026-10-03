export type Config = {
	mqtt: {
		url: string;
		username?: string;
		password?: string;
	};
	/** Poll interval in minutes */
	interval: number;
};

export function loadConfig(env: NodeJS.ProcessEnv): Config {
	const url = env.MQTT_URL;
	const interval = Number(env.INTERVAL || 30);

	if (!url) {
		throw new Error('MQTT_URL is required, e.g. mqtt://homeassistant.local:1883');
	}
	if (!(interval > 0)) {
		throw new Error(`INTERVAL must be a positive number of minutes, got "${env.INTERVAL}"`);
	}

	return {
		mqtt: { url, username: env.MQTT_USER || undefined, password: env.MQTT_PASS || undefined },
		interval,
	};
}
