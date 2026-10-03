import { log } from './log.ts';

/**
 * Runs a task now and then every interval after it finished, so runs never
 * overlap. Resolves the returned stop function once a running task is done.
 */
export function schedule(task: () => Promise<void>, minutes: number): () => Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let running: Promise<void> = Promise.resolve();
	let stopped = false;

	const run = (): void => {
		running = task()
			.catch((error: unknown) => log.error('scheduled task failed', error))
			.finally(() => {
				if (!stopped) {
					timer = setTimeout(run, minutes * 60_000);
				}
			});
	};

	run();

	return async () => {
		stopped = true;
		clearTimeout(timer);
		await running;
	};
}
