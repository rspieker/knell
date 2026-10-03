import { loadConfig } from './config.ts';
import type { Source } from './device.ts';
import { status } from './discovery.ts';
import { createGithubSource, loadGithubConfig } from './github.ts';
import { createKnell } from './knell.ts';
import { log } from './log.ts';
import { connectMqtt } from './mqtt.ts';

const config = loadConfig(process.env);
const github = loadGithubConfig(process.env);
const sources: Array<Source> = [];

if (github) {
	sources.push(createGithubSource(github));
}

if (!sources.length) {
	log.warn('no sources configured, knell will only announce itself');
}

const transport = await connectMqtt({ ...config.mqtt, status });
const knell = createKnell({ transport, sources, interval: config.interval });

await knell.start();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.once(signal, async () => {
		log.info(`${signal} received, falling silent`);
		await knell.stop();
		process.exit(0);
	});
}
