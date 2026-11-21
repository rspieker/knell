import type { Device, Source } from './device.ts';
import { log } from './log.ts';
import type { PagesConfig } from './pages/config.ts';
import { device, visit } from './pages/page.ts';

export { loadPagesConfig, type PagesConfig } from './pages/config.ts';

export type PagesOptions = {
	request?: typeof fetch;
	/** Milliseconds since the epoch */
	now?: () => number;
};

/**
 * Every page becomes a device: whether it is reachable, its status and
 * response time, and an entity per check. The bell rings as often as its
 * most impatient page; the others answer from their last visit until due.
 */
export function createPagesSource({ pages }: PagesConfig, { request = fetch, now = Date.now }: PagesOptions = {}): Source {
	const interval = Math.min(...pages.map((page) => page.interval));
	const visited = new Map<string, { at: number; device: Device }>();

	return {
		id: 'pages',
		name: 'Pages',
		interval,
		async poll() {
			const moment = now();
			// half a ring of slack, as timers never fire exactly on time
			const slack = (interval * 60_000) / 2;
			const devices = await Promise.all(
				pages.map(async (page) => {
					const last = visited.get(page.id);

					if (last && moment - last.at + slack < page.interval * 60_000) {
						return last.device;
					}

					const result = await visit(page, request);

					log.debug(`pages: ${page.id} ${result.error ?? `${result.status} in ${result.elapsed}ms`}`);

					const announced = device(page, result);

					visited.set(page.id, { at: moment, device: announced });

					return announced;
				}),
			);

			return { devices };
		},
	};
}
