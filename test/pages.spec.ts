import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { status } from '../source/discovery.ts';
import { createKnell } from '../source/knell.ts';
import { createPagesSource, loadPagesConfig } from '../source/pages.ts';
import { createBroker } from './broker.ts';

type Answer = Response | Error;
type State = { values: Record<string, unknown>; attributes: Record<string, Record<string, unknown>> };

const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Answers per url, as the web would; anything else is a host that does not exist */
function web(answers: Record<string, () => Answer>) {
	return mock.fn(async (input: string | URL | Request, _init?: RequestInit) => {
		const answer = answers[String(input)]?.() ?? new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });

		if (answer instanceof Error) {
			throw answer;
		}

		return answer;
	});
}

function page(body: string, init?: ResponseInit) {
	return () => new Response(body, init);
}

describe('pages', () => {
	let broker: ReturnType<typeof createBroker>;
	let clock: number;

	async function ring(pages: Record<string, unknown>, request: typeof fetch, env: NodeJS.ProcessEnv = {}) {
		const config = loadPagesConfig({ ...env, PAGES: 'pages.json' }, { interval: 30 }, () => JSON.stringify(pages));

		assert.ok(config);

		const source = createPagesSource(config, { request, now: () => clock });
		const knell = createKnell({ transport: broker.connect({ status }), sources: [source], interval: 30 });

		await knell.start();
		await settle();
	}

	async function toll(minutes: number) {
		clock += minutes * 60_000;
		mock.timers.tick(minutes * 60_000);
		await settle();
	}

	function read(id: string): State {
		return broker.read(`knell/pages/${id}/state`) as State;
	}

	beforeEach(() => {
		broker = createBroker();
		clock = Date.parse('2026-11-21T12:00:00Z');
		mock.timers.enable({ apis: ['setTimeout'] });
		mock.method(console, 'info', () => {});
		mock.method(console, 'error', () => {});
	});

	afterEach(() => {
		mock.timers.reset();
		mock.restoreAll();
	});

	describe('announces every page as a device', () => {
		it('reachable, with its status and response time', async () => {
			await ring({ home: { url: 'https://example.com/' } }, web({ 'https://example.com/': page('hello') }));

			const { values, attributes } = read('home');

			assert.deepEqual([values.reachable, values.status, typeof values.response_time], ['ON', 200, 'number']);
			assert.deepEqual(attributes.reachable, { url: 'https://example.com/', error: null });
		});

		it('named as configured, linking to the page', async () => {
			await ring(
				{ 'kon.fm': { name: 'kon.fm (acc)', url: 'https://example.com/' } },
				web({ 'https://example.com/': page('') }),
			);

			const { device, components } = broker.read('homeassistant/device/knell_pages_kon_fm/config') as {
				device: Record<string, unknown>;
				components: Record<string, { default_entity_id: string }>;
			};

			assert.deepEqual([device.name, device.configuration_url, device.model], ['kon.fm (acc)', 'https://example.com/', 'Page']);
			assert.equal(components.reachable?.default_entity_id, 'binary_sensor.knell_pages_kon_fm_reachable');
		});
	});

	describe('is unreachable', () => {
		it('with an unexpected status, still reading what the page says', async () => {
			await ring(
				{ api: { url: 'https://example.com/', contains: { maintenance: 'maintenance' } } },
				web({ 'https://example.com/': page('down for maintenance', { status: 503, statusText: 'Service Unavailable' }) }),
			);

			const { values, attributes } = read('api');

			assert.deepEqual([values.reachable, values.status, values.maintenance], ['OFF', 503, 'ON']);
			assert.equal(attributes.reachable?.error, 'HTTP 503 Service Unavailable');
		});

		it('without a response, its checks unknown rather than false', async () => {
			await ring(
				{ gone: { url: 'https://gone.example/', contains: { ok: 'ok' }, count: { oks: 'ok' } } },
				web({}),
			);

			const { values, attributes } = read('gone');

			assert.deepEqual(values, { reachable: 'OFF', status: null, response_time: null, ok: null, oks: null });
			assert.equal(attributes.reachable?.error, 'fetch failed: ENOTFOUND');
		});

		it('while the bell itself stays online, as an unreachable page is news, not failure', async () => {
			await ring({ gone: { url: 'https://gone.example/' } }, web({}));

			assert.equal(broker.retained.get('knell/pages/status'), 'online');
			assert.equal((broker.read('knell/pages/state') as State).values.poll, 'OFF');
		});
	});

	it('is reachable with any of the expected statuses', async () => {
		await ring(
			{ teapot: { url: 'https://example.com/', status: [404, 418] } },
			web({ 'https://example.com/': page('short and stout', { status: 418 }) }),
		);

		assert.equal(read('teapot').values.reachable, 'ON');
	});

	describe('checks whether a page contains', () => {
		const health = { url: 'https://example.com/health.txt', contains: { healthy: '^ok$' } };

		it('a pattern, matching line by line', async () => {
			await ring({ health }, web({ 'https://example.com/health.txt': page('ok\ncommit 2b5ff85\n') }));

			assert.equal(read('health').values.healthy, 'ON');
			assert.equal(read('health').attributes.healthy?.match, 'ok');
		});

		it('or not', async () => {
			await ring({ health }, web({ 'https://example.com/health.txt': page('not ok\n') }));

			assert.equal(read('health').values.healthy, 'OFF');
			assert.equal(read('health').attributes.healthy?.match, null);
		});

		it('with flags, and the entity configured as Home Assistant should show it', async () => {
			await ring(
				{
					news: {
						url: 'https://example.com/',
						contains: {
							hometown: { pattern: 'haarlem', flags: 'i', name: 'Haarlem in the news', config: { icon: 'mdi:newspaper' } },
						},
					},
				},
				web({ 'https://example.com/': page('Storm over HAARLEM') }),
			);

			const { components } = broker.read('homeassistant/device/knell_pages_news/config') as {
				components: Record<string, Record<string, unknown>>;
			};

			assert.equal(read('news').values.hometown, 'ON');
			assert.deepEqual([components.hometown?.name, components.hometown?.icon], ['Haarlem in the news', 'mdi:newspaper']);
		});
	});

	describe('extracts', () => {
		it('the first capture group, with named groups as attributes', async () => {
			await ring(
				{ health: { url: 'https://example.com/health.txt', extract: { commit: '^commit (?<sha>[0-9a-f]{7})[0-9a-f]*$' } } },
				web({ 'https://example.com/health.txt': page('ok\ncommit 2b5ff85e0c1d\n') }),
			);

			assert.equal(read('health').values.commit, '2b5ff85');
			assert.deepEqual(read('health').attributes.commit, { url: 'https://example.com/health.txt', sha: '2b5ff85' });
		});

		it('the entire match from a pattern without groups', async () => {
			await ring(
				{ weather: { url: 'https://example.com/', extract: { temperature: '-?\\d+(?:\\.\\d+)? °C' } } },
				web({ 'https://example.com/': page('Today: 21.5 °C, dry') }),
			);

			assert.equal(read('weather').values.temperature, '21.5 °C');
		});

		it('nothing when the pattern does not match', async () => {
			await ring(
				{ health: { url: 'https://example.com/', extract: { commit: '^commit (\\S+)$' } } },
				web({ 'https://example.com/': page('ok\n') }),
			);

			assert.equal(read('health').values.commit, null);
		});

		it('no more than Home Assistant accepts as a state', async () => {
			await ring(
				{ long: { url: 'https://example.com/', extract: { all: '^.*$' } } },
				web({ 'https://example.com/': page('x'.repeat(300)) }),
			);

			assert.equal(String(read('long').values.all).length, 255);
		});
	});

	it('counts how often a pattern matches', async () => {
		await ring(
			{ news: { url: 'https://example.com/', count: { mentions: '\\bHaarlem\\b' } } },
			web({ 'https://example.com/': page('Haarlem, Haarlemmermeer and Haarlem again') }),
		);

		assert.equal(read('news').values.mentions, 2);
	});

	describe('reads the text of an HTML page when asked', () => {
		const html = [
			'<!doctype html><html><head><style>.haarlem { color: red }</style>',
			'<script>const city = "Haarlem";</script></head><body>',
			'<h1>Haar<b>lem</b> &amp; the <!-- Haarlem -->dunes</h1><p>Caf&eacute; &#8364;5</p><p>Done</p>',
			'</body></html>',
		].join('');
		const news = {
			url: 'https://example.com/',
			text: true,
			count: { mentions: 'Haarlem' },
			extract: { headline: '^Haarlem.*$', price: '€\\d+', last: '^Done$' },
		};

		it('as a reader would see it, without scripts, styles and comments', async () => {
			await ring({ news }, web({ 'https://example.com/': page(html) }));

			const { response_time, ...values } = read('news').values;

			assert.deepEqual(values, {
				reachable: 'ON',
				status: 200,
				mentions: 1,
				headline: 'Haarlem & the dunes',
				price: '€5',
				last: 'Done',
			});
		});

		it('but its source otherwise', async () => {
			await ring({ news: { ...news, text: false } }, web({ 'https://example.com/': page(html) }));

			// the script and the comment, while the headline's tags split it
			assert.equal(read('news').values.mentions, 2);
		});
	});

	describe('keeps secrets from the environment out of Home Assistant', () => {
		const secret = {
			url: 'https://example.com/status?key=${STATUS_KEY}',
			headers: { Authorization: 'Bearer ${STATUS_TOKEN}' },
		};

		it('using them for the request', async () => {
			const request = web({ 'https://example.com/status?key=k3y': page('ok') });

			await ring({ secret }, request, { STATUS_KEY: 'k3y', STATUS_TOKEN: 't0ken' });

			const [, init] = request.mock.calls[0]?.arguments ?? [];

			assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer t0ken');
			assert.equal(read('secret').values.reachable, 'ON');
		});

		it('but announcing the url as configured', async () => {
			await ring({ secret }, web({ 'https://example.com/status?key=k3y': page('ok') }), {
				STATUS_KEY: 'k3y',
				STATUS_TOKEN: 't0ken',
			});

			assert.doesNotMatch([...broker.retained.values()].join('\n'), /k3y|t0ken/);
			assert.equal(read('secret').attributes.reachable?.url, 'https://example.com/status?key=${STATUS_KEY}');
		});
	});

	describe('visits every page at its own interval', () => {
		const pages = {
			health: { url: 'https://example.com/health.txt', interval: 5 },
			news: { url: 'https://example.com/news', interval: 60 },
		};

		function visits(request: ReturnType<typeof web>): Record<string, number> {
			const tally: Record<string, number> = {};

			for (const { arguments: [input] } of request.mock.calls) {
				tally[String(input)] = (tally[String(input)] ?? 0) + 1;
			}

			return tally;
		}

		it('ringing as often as the most impatient one', async () => {
			const request = web({ 'https://example.com/health.txt': page('ok'), 'https://example.com/news': page('') });

			await ring(pages, request);
			await toll(5);
			await toll(5);

			assert.deepEqual(visits(request), { 'https://example.com/health.txt': 3, 'https://example.com/news': 1 });
		});

		it('announcing the others from their last visit until due', async () => {
			const request = web({ 'https://example.com/health.txt': page('ok'), 'https://example.com/news': page('') });

			await ring(pages, request);

			for (let ring = 0; ring < 12; ring++) {
				await toll(5);
			}

			assert.deepEqual(visits(request), { 'https://example.com/health.txt': 13, 'https://example.com/news': 2 });
			assert.equal(read('news').values.reachable, 'ON');
		});
	});
});
