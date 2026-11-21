import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { status } from '../source/discovery.ts';
import { createForgejoSource, type ForgejoConfig } from '../source/forgejo.ts';
import type { Branch, Repository } from '../source/forgejo/repository.ts';
import { createKnell } from '../source/knell.ts';
import type { WorkflowFacts } from '../source/workflows.ts';
import { createBroker } from './broker.ts';

const url = 'http://forge.example:3000';
const config: ForgejoConfig = {
	url,
	token: 'secret',
	owners: ['alice', 'guild'],
	activeDays: 365,
	exclude: [],
	tests: ['test*'],
	branches: ['main', 'master', 'develop', 'release*'],
};
const now = () => new Date('2026-11-21T12:00:00Z');

/** A repository as Forgejo lists it, active and with nothing open */
function repository(full_name: string, overrides: Partial<Repository> = {}): Repository {
	return {
		full_name,
		html_url: `${url}/${full_name}`,
		default_branch: 'main',
		updated_at: '2026-11-19T06:52:23+01:00',
		archived: false,
		fork: false,
		mirror: false,
		empty: false,
		has_actions: true,
		stars_count: 3,
		forks_count: 1,
		open_issues_count: 2,
		open_pr_counter: 0,
		release_counter: 0,
		...overrides,
	};
}

function branch(name: string, timestamp: string, message = `work on ${name}`): Branch {
	return {
		name,
		commit: {
			id: `${name.length}1a2c694502e5572493acdec102f8323b367068c`,
			message: `${message}\n\nwith a body`,
			url: `${url}/commit/${name}`,
			timestamp,
			author: { name: 'Alice Example', username: 'alice' },
		},
	};
}

type Run = { workflow_id: string; prettyref: string; event?: string; status: string; created: string };

type Forge = {
	owners?: Record<string, Array<Repository>>;
	branches?: Record<string, Array<Branch>>;
	pulls?: Record<string, Array<{ draft: boolean; created_at: string }>>;
	releases?: Record<string, { tag_name: string; published_at: string; html_url: string }>;
	runs?: Record<string, Array<Run>>;
};

/** Just enough of Forgejo's API, answering 404 for anything it does not hold */
function forgejo({ owners = {}, branches = {}, pulls = {}, releases = {}, runs = {} }: Forge) {
	return mock.fn(async (input: string | URL | Request, _init?: RequestInit) => {
		const { pathname, searchParams } = new URL(String(input));
		const path = pathname.replace('/api/v1', '');
		const page = Number(searchParams.get('page') ?? 1);
		const owner = path.match(/^\/users\/([^/]+)\/repos$/)?.[1];
		const [, repo, rest] = path.match(/^\/repos\/([^/]+\/[^/]+)\/(.+)$/) ?? [];
		const body =
			owner !== undefined
				? owners[owner]?.slice((page - 1) * 50, page * 50)
				: rest === 'branches'
					? branches[repo ?? '']
					: rest === 'pulls'
						? pulls[repo ?? '']
						: rest === 'releases/latest'
							? releases[repo ?? '']
							: rest === 'actions/runs'
								? {
										total_count: runs[repo ?? '']?.length ?? 0,
										workflow_runs: (runs[repo ?? ''] ?? []).map((run, index) => ({
											event: 'push',
											...run,
											html_url: `${url}/${repo}/actions/runs/${index + 1}`,
										})),
									}
								: undefined;

		return body === undefined ? Response.json({ message: 'not found' }, { status: 404 }) : Response.json(body);
	});
}

type State = {
	values: Record<string, unknown>;
	attributes: Record<string, Record<string, unknown>> & {
		workflows: { workflows: Array<WorkflowFacts>; failing_branches: Array<Record<string, string>> };
	};
};

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('forgejo', () => {
	let broker: ReturnType<typeof createBroker>;

	async function ring(request: typeof fetch, overrides: Partial<ForgejoConfig> = {}) {
		const source = createForgejoSource({ ...config, ...overrides }, { request, now });
		const knell = createKnell({ transport: broker.connect({ status }), sources: [source], interval: 30 });

		await knell.start();
		await settle();
	}

	function devices(): Array<string> {
		return [...broker.retained.keys()]
			.filter((topic) => topic.startsWith('homeassistant/device/knell_forgejo_'))
			.map((topic) => topic.split('/')[2] ?? '')
			.sort();
	}

	function read(repository: string): State {
		return broker.read(`knell/forgejo/${repository.replace(/[^a-z0-9]+/g, '_')}/state`) as State;
	}

	function paths(request: ReturnType<typeof forgejo>): Array<string> {
		return request.mock.calls.map(({ arguments: [input] }) => String(input).replace(`${url}/api/v1`, ''));
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

	describe('lists repositories', () => {
		it('of every owner, users and organizations alike, through all pages', async () => {
			const many = Array.from({ length: 52 }, (_, index) => repository(`guild/r${index}`, { has_actions: false }));
			const request = forgejo({ owners: { alice: [repository('alice/tools')], guild: many } });

			await ring(request);

			assert.equal(devices().length, 1 + 52);
			assert.ok(paths(request).includes('/users/guild/repos?limit=50&page=2'));
		});

		it('with the token, when there is one', async () => {
			const request = forgejo({ owners: { alice: [], guild: [] } });

			await ring(request);

			const [, init] = request.mock.calls[0]?.arguments ?? [];

			assert.equal(new Headers(init?.headers).get('authorization'), 'token secret');
		});

		it('anonymously otherwise, as public repositories need no token', async () => {
			const request = forgejo({ owners: { alice: [], guild: [] } });

			await ring(request, { token: undefined });

			const [, init] = request.mock.calls[0]?.arguments ?? [];

			assert.equal(new Headers(init?.headers).get('authorization'), null);
		});
	});

	it('announces only repositories of its owners own, active and not excluded', async () => {
		await ring(
			forgejo({
				owners: {
					alice: [
						repository('alice/kept'),
						repository('alice/archived', { archived: true }),
						repository('alice/forked', { fork: true }),
						repository('alice/mirrored', { mirror: true }),
						repository('alice/empty', { empty: true }),
						repository('alice/stale', { updated_at: '2025-11-20T12:00:00Z' }),
						repository('alice/scratch-pad'),
					],
					guild: [],
				},
			}),
			{ exclude: ['*/scratch-*'] },
		);

		assert.deepEqual(devices(), ['knell_forgejo_alice_kept']);
	});

	it('goes unavailable for an unknown owner, rather than removing its repositories', async () => {
		await ring(forgejo({ owners: { alice: [repository('alice/kept', { has_actions: false })] } }));

		const bell = broker.read('knell/forgejo/state') as State;

		assert.equal(broker.retained.get('knell/forgejo/status'), 'offline');
		assert.equal(bell.attributes.poll?.error, 'Forgejo: unknown owner guild');
	});

	describe('announces a repository', () => {
		const tools = 'alice/tools';

		it('as GitHub repositories are announced, so cards and templates serve both', async () => {
			await ring(
				forgejo({
					owners: { alice: [repository(tools, { has_actions: false })], guild: [] },
					branches: {
						[tools]: [
							branch('main', '2026-11-19T06:52:19+01:00', 'feat: the latest on main'),
							branch('feat/map', '2026-11-20T20:15:19+01:00'),
						],
					},
				}),
			);

			const { values, attributes } = read(tools);

			assert.deepEqual(values, {
				last_commit: '2026-11-19T05:52:19.000Z',
				last_push: '2026-11-20T19:15:19.000Z',
				latest_branch: 'feat/map',
				pull_requests: 0,
				issues: 2,
				latest_release: null,
				stars: 3,
				forks: 1,
			});
			assert.deepEqual(attributes.last_commit, {
				repository: tools,
				url: `${url}/${tools}`,
				branch: 'main',
				sha: '41a2c69',
				message: 'feat: the latest on main',
				author: 'alice',
				commit: `${url}/commit/main`,
			});
			assert.deepEqual(attributes.latest_branch?.branches, 2);
		});

		it('asking for pull requests and releases only when it has them', async () => {
			const request = forgejo({ owners: { alice: [repository(tools, { has_actions: false })], guild: [] } });

			await ring(request);

			assert.deepEqual(
				paths(request).filter((path) => path.startsWith('/repos/')),
				[`/repos/${tools}/branches?limit=50`],
			);
		});

		it('with its open pull requests, drafts and the oldest', async () => {
			await ring(
				forgejo({
					owners: { alice: [repository(tools, { has_actions: false, open_pr_counter: 2 })], guild: [] },
					pulls: {
						[tools]: [
							{ draft: false, created_at: '2026-11-01T10:00:00+01:00' },
							{ draft: true, created_at: '2026-11-10T10:00:00+01:00' },
						],
					},
				}),
			);

			assert.equal(read(tools).values.pull_requests, 2);
			assert.deepEqual(read(tools).attributes.pull_requests, {
				repository: tools,
				url: `${url}/${tools}`,
				drafts: 1,
				oldest: '2026-11-01T09:00:00.000Z',
			});
		});

		it('with its latest release, as its version too', async () => {
			await ring(
				forgejo({
					owners: { alice: [repository(tools, { has_actions: false, release_counter: 1 })], guild: [] },
					releases: { [tools]: { tag_name: 'v0.1.0', published_at: '2026-11-14T15:49:31+01:00', html_url: `${url}/r` } },
				}),
			);

			const { device } = broker.read('homeassistant/device/knell_forgejo_alice_tools/config') as {
				device: Record<string, unknown>;
			};

			assert.equal(read(tools).values.latest_release, 'v0.1.0');
			assert.deepEqual([device.sw_version, device.manufacturer], ['v0.1.0', 'Forgejo']);
		});
	});

	describe('judges workflows by their runs, as Forgejo cannot list them', () => {
		const site = 'guild/site';

		async function judge(runs: Array<Run>) {
			await ring(forgejo({ owners: { alice: [], guild: [repository(site)] }, runs: { [site]: runs } }));

			return read(site);
		}

		it('fine when the latest completed run on a long-lived branch succeeded', async () => {
			const { values, attributes } = await judge([
				{ workflow_id: 'deploy.yml', prettyref: 'main', status: 'running', created: '2026-11-20T10:00:00+01:00' },
				{ workflow_id: 'deploy.yml', prettyref: 'main', status: 'success', created: '2026-11-19T10:00:00+01:00' },
				{ workflow_id: 'deploy.yml', prettyref: 'main', status: 'failure', created: '2026-11-18T10:00:00+01:00' },
			]);
			const [deploy] = attributes.workflows.workflows;

			assert.equal(values.workflows, 'OFF');
			assert.deepEqual([deploy?.name, deploy?.file, deploy?.conclusion, deploy?.when], [
				'deploy',
				'deploy.yml',
				'success',
				'2026-11-19T09:00:00.000Z',
			]);
		});

		it('a problem when it failed', async () => {
			const { values } = await judge([
				{ workflow_id: 'image.yml', prettyref: 'main', status: 'success', created: '2026-11-20T10:00:00+01:00' },
				{ workflow_id: 'deploy.yml', prettyref: 'main', status: 'failure', created: '2026-11-19T10:00:00+01:00' },
			]);

			assert.equal(values.workflows, 'ON');
		});

		it('reporting failures on other branches without judging them', async () => {
			const { values, attributes } = await judge([
				{ workflow_id: 'deploy.yml', prettyref: 'feat/map', status: 'failure', created: '2026-11-20T10:00:00+01:00' },
				{ workflow_id: 'deploy.yml', prettyref: 'main', status: 'success', created: '2026-11-19T10:00:00+01:00' },
			]);

			assert.equal(values.workflows, 'OFF');
			assert.deepEqual(
				attributes.workflows.failing_branches.map(({ branch, workflow }) => [branch, workflow]),
				[['feat/map', 'deploy']],
			);
		});

		it('telling tests apart by their file', async () => {
			const { values, attributes } = await judge([
				{ workflow_id: 'tests.yml', prettyref: 'main', status: 'failure', created: '2026-11-20T10:00:00+01:00' },
				{ workflow_id: 'deploy.yml', prettyref: 'main', status: 'success', created: '2026-11-19T10:00:00+01:00' },
			]);

			assert.deepEqual([values.tests, values.workflows], ['ON', 'ON']);
			assert.deepEqual(
				(attributes.tests?.workflows as Array<WorkflowFacts> | undefined)?.map(({ file }) => file),
				['tests.yml'],
			);
		});

		it('leaving both out without completed runs', async () => {
			const { values } = await judge([
				{ workflow_id: 'deploy.yml', prettyref: 'main', status: 'waiting', created: '2026-11-20T10:00:00+01:00' },
			]);

			assert.deepEqual([values.tests, values.workflows], [undefined, undefined]);
		});
	});
});
