import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { status } from '../source/discovery.ts';
import { createGithubSource, type GithubConfig } from '../source/github.ts';
import { createKnell } from '../source/knell.ts';
import { createBroker } from './broker.ts';

/** Responses recorded from the GitHub GraphQL API */
function fixture(name: string): Record<string, unknown> {
	return JSON.parse(readFileSync(new URL(`fixtures/github-${name}.json`, import.meta.url), 'utf8'));
}

const search = fixture('search') as { data: { search: { nodes: Array<{ nameWithOwner: string }> } } };
const repositories = search.data.search.nodes.map(({ nameWithOwner }) => nameWithOwner);
const config: GithubConfig = { token: 'secret', owners: ['rspieker'], activeDays: 365, exclude: [] };
const now = () => new Date('2026-10-03T12:00:00Z');
const owners = ['rspieker', 'konfirm'];
const both = { data: { o0: { login: 'rspieker' }, o1: { login: 'konfirm' } } };

type Body = { query: string; variables: { search?: string; cursor?: string | null } };

function github(...pages: Array<Record<string, unknown>>) {
	return github.answering(fixture('owners'), ...pages);
}

github.answering = (owners: Record<string, unknown>, ...pages: Array<Record<string, unknown>>) => {
	const remaining = pages.length ? [...pages] : [search];

	return mock.fn(async (_url: string | URL | Request, init?: RequestInit) => {
		const { query } = JSON.parse(String(init?.body)) as Body;
		const body = query.includes('search(') ? remaining.shift() : owners;

		return Response.json(body);
	});
};

function sent(request: ReturnType<typeof github>): Array<Body & { authorization: string }> {
	return request.mock.calls.map(({ arguments: [, init] }) => ({
		...JSON.parse(String(init?.body)),
		authorization: new Headers(init?.headers).get('authorization') ?? '',
	}));
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('github', () => {
	let broker: ReturnType<typeof createBroker>;

	async function ring(request: typeof fetch, overrides: Partial<GithubConfig> = {}) {
		const source = createGithubSource({ ...config, ...overrides }, { request, now });
		const knell = createKnell({ transport: broker.connect({ status }), sources: [source], interval: 30 });

		await knell.start();
		await settle();
	}

	async function toll() {
		mock.timers.tick(30 * 60_000);
		await settle();
	}

	function devices(): Array<string> {
		return [...broker.retained.keys()]
			.filter((topic) => topic.startsWith('homeassistant/device/'))
			.map((topic) => topic.split('/')[2] ?? '');
	}

	beforeEach(() => {
		broker = createBroker();
		mock.timers.enable({ apis: ['setTimeout'] });
		mock.method(console, 'info', () => {});
		mock.method(console, 'error', () => {});
	});

	afterEach(() => {
		mock.timers.reset();
		mock.restoreAll();
	});

	describe('searches', () => {
		it('public, unarchived repositories of all owners pushed to within the active days', async () => {
			const request = github.answering(both);

			await ring(request, { owners, activeDays: 30 });

			assert.equal(
				sent(request)[1]?.variables.search,
				'user:rspieker user:konfirm is:public archived:false pushed:>=2026-09-03',
			);
		});

		it('using the token', async () => {
			const request = github();

			await ring(request);

			assert.deepEqual(
				sent(request).map(({ authorization }) => authorization),
				['Bearer secret', 'Bearer secret'],
			);
		});

		it('through all pages of results', async () => {
			const [first, second] = [repositories.slice(0, 4), repositories.slice(4)].map((names, page) => ({
				data: {
					search: {
						pageInfo: { hasNextPage: page === 0, endCursor: page === 0 ? 'page-2' : null },
						nodes: search.data.search.nodes.filter(({ nameWithOwner }) => names.includes(nameWithOwner)),
					},
				},
			}));
			const request = github(first ?? {}, second ?? {});

			await ring(request);

			assert.equal(sent(request)[2]?.variables.cursor, 'page-2');
			assert.equal(devices().length, repositories.length);
		});
	});

	describe('announces', () => {
		it('every repository found as a device', async () => {
			await ring(github());

			assert.deepEqual(
				devices().sort(),
				repositories.map((name) => `knell_github_${name.replace(/[^a-z0-9]+/g, '_')}`).sort(),
			);
		});

		it('a repository with its commits, branches, pull requests, actions and releases', async () => {
			await ring(github());

			assert.deepEqual(broker.read('knell/github/rspieker_template_literal_table/state'), {
				values: {
					last_commit: '2026-03-25T16:22:50Z',
					last_push: '2026-03-25T16:23:01Z',
					latest_branch: 'master',
					pull_requests: 0,
					issues: 0,
					actions: 'OFF',
					latest_release: 'v4.2.0',
					stars: 7,
					forks: 1,
				},
				attributes: {
					last_commit: {
						branch: 'master',
						sha: 'b0eb9ef',
						message: 'chore: automate release conform release-please docs',
						author: 'Rogier Spieker',
						url: 'https://github.com/rspieker/template-literal-table/commit/b0eb9ef658345e40e356f2d31b4a2b2f5d97c44b',
					},
					last_push: {},
					latest_branch: { committed: '2026-03-25T16:22:50Z', branches: 5 },
					pull_requests: { drafts: 0, oldest: null },
					issues: {},
					actions: { state: 'success' },
					latest_release: {
						published: '2026-03-25T13:42:43Z',
						url: 'https://github.com/rspieker/template-literal-table/releases/tag/v4.2.0',
					},
					stars: {},
					forks: {},
				},
			});
		});

		it('the latest release as the version of the device', async () => {
			await ring(github());

			const config = broker.read('homeassistant/device/knell_github_rspieker_template_literal_table/config');

			assert.deepEqual((config as { device: unknown }).device, {
				identifiers: ['knell_github_rspieker_template_literal_table'],
				name: 'rspieker/template-literal-table',
				manufacturer: 'GitHub',
				model: 'Repository',
				sw_version: 'v4.2.0',
				configuration_url: 'https://github.com/rspieker/template-literal-table',
			});
		});

		it('a freshly created repository without commits as mostly unknown', async () => {
			const empty = {
				nameWithOwner: 'rspieker/new',
				url: 'https://github.com/rspieker/new',
				pushedAt: '2026-10-03T10:00:00Z',
				stargazerCount: 0,
				forkCount: 0,
				issues: { totalCount: 0 },
				pullRequests: { totalCount: 0, nodes: [] },
				latestRelease: null,
				defaultBranchRef: null,
				refs: { totalCount: 0, nodes: [] },
			};
			const page = { data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [empty, {}] } } };

			await ring(github(page));

			assert.deepEqual(broker.read('knell/github/rspieker_new/state'), {
				values: {
					last_commit: null,
					last_push: '2026-10-03T10:00:00Z',
					latest_branch: null,
					pull_requests: 0,
					issues: 0,
					actions: null,
					latest_release: null,
					stars: 0,
					forks: 0,
				},
				attributes: {
					last_commit: { branch: null, sha: null, message: null, author: null, url: null },
					last_push: {},
					latest_branch: { committed: null, branches: 0 },
					pull_requests: { drafts: 0, oldest: null },
					issues: {},
					actions: { state: null },
					latest_release: { published: null, url: null },
					stars: {},
					forks: {},
				},
			});
			assert.deepEqual(devices(), ['knell_github_rspieker_new']);
		});

		it('actions as unknown for repositories without checks', async () => {
			await ring(github());

			const state = broker.read('knell/github/rspieker_tui/state') as { values: Record<string, unknown> };

			assert.equal(state.values.actions, null);
			assert.equal(state.values.latest_release, null);
		});
	});

	describe('does not announce', () => {
		it('repositories matching an exclusion', async () => {
			await ring(github(), { exclude: ['rspieker/depless*', 'RSPIEKER/TUI'] });

			assert.deepEqual(
				devices().filter((device) => /depless|tui/.test(device)),
				[],
			);
			assert.equal(devices().length, repositories.length - 4);
		});
	});

	describe('goes offline, keeping its devices,', () => {
		const cases: Array<[string, () => typeof fetch]> = [
			['when an owner is forbidden to the token', () => github.answering(fixture('owners-forbidden'))],
			['when an owner does not exist', () => github.answering(fixture('owners-unknown'))],
			['when GitHub responds with an error status', () => mock.fn(async () => new Response('', { status: 502 }))],
		];

		for (const [description, failing] of cases) {
			it(description, async () => {
				let request: typeof fetch = github.answering(both);

				await ring((...args) => request(...args), { owners });
				request = failing();
				await toll();

				assert.equal(broker.retained.get('knell/github/status'), 'offline');
				assert.equal(devices().length, repositories.length);
			});
		}

		it('reporting why', async () => {
			const error = mock.method(console, 'error', () => {});

			await ring(github.answering(fixture('owners-forbidden')), { owners });

			assert.match(String(error.mock.calls[0]?.arguments[1]), /forbids access .* lifetime is greater than 366 days/);
		});
	});
});
