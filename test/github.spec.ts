import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { status } from '../source/discovery.ts';
import type { FailingBranch, WorkflowFacts } from '../source/workflows.ts';
import { createGithubSource, type GithubConfig } from '../source/github.ts';
import { createKnell } from '../source/knell.ts';
import { createBroker } from './broker.ts';

/** Responses recorded from the GitHub GraphQL and REST APIs */
function fixture<T = Record<string, unknown>>(name: string): T {
	return JSON.parse(readFileSync(new URL(`fixtures/github-${name}.json`, import.meta.url), 'utf8'));
}

type Node = { nameWithOwner: string; defaultBranchRef: { name: string } | null };
type Run = { head_branch: string; event: string; conclusion: string };
type Workflows = { workflows: Array<{ id: number; name: string; state: string }> };

const search = fixture<{ data: { search: { nodes: Array<Node> } } }>('search');
const recorded = fixture('rest');
const repositories = search.data.search.nodes.map(({ nameWithOwner }) => nameWithOwner);
const config: GithubConfig = {
	token: 'secret',
	owners: ['rspieker', 'konfirm'],
	activeDays: 365,
	exclude: [],
	tests: ['test*'],
	branches: ['main', 'master', 'develop', 'release*'],
};
const now = () => new Date('2026-10-04T12:00:00Z');
const both = { data: { o0: { login: 'rspieker' }, o1: { login: 'konfirm' } } };

/** Recorded paths, for altering what GitHub would say */
function workflowsPath(repository: string): string {
	return `/repos/${repository}/actions/workflows?per_page=100`;
}

function runsPath(repository: string, workflow: string): string {
	const { workflows } = recorded[workflowsPath(repository)] as Workflows;
	const { id } = workflows.find(({ name }) => name === workflow) ?? { id: 0 };

	return `/repos/${repository}/actions/workflows/${id}/runs?per_page=20`;
}

type Answers = {
	owners?: Record<string, unknown>;
	pages?: Array<Record<string, unknown>>;
	rest?: Record<string, unknown>;
};

function github({ owners = both, pages = [search], rest = {} }: Answers = {}) {
	const remaining = [...pages];
	const answers: Record<string, unknown> = { ...recorded, ...rest };

	return mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(String(input));
		const resource = url.pathname === '/graphql' ? 'graphql' : 'core';
		const headers = {
			'x-ratelimit-resource': resource,
			'x-ratelimit-remaining': resource === 'core' ? '4321' : '4999',
			'x-ratelimit-limit': '5000',
			'x-ratelimit-reset': '1790000000',
		};

		if (resource === 'graphql') {
			return Response.json(String(init?.body).includes('search(') ? remaining.shift() : owners, { headers });
		}

		const body = answers[url.pathname + url.search];

		return body === undefined
			? Response.json({ message: 'Not Found' }, { status: 404, headers })
			: Response.json(body, { headers });
	});
}

type State = {
	values: Record<string, unknown>;
	attributes: Record<string, Record<string, unknown>> & {
		tests: { workflows: Array<WorkflowFacts> };
		workflows: { default_branch: string; workflows: Array<WorkflowFacts>; failing_branches: Array<FailingBranch> };
	};
};

type Sent = { url: string; body: { query?: string; variables?: { search?: string; cursor?: string | null } } };

function sent(request: ReturnType<typeof github>): Array<Sent & { authorization: string }> {
	return request.mock.calls.map(({ arguments: [input, init] }) => ({
		url: String(input),
		body: init?.body ? JSON.parse(String(init.body)) : {},
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

	/** Repository devices announced, leaving out the bell itself */
	function devices(): Array<string> {
		return [...broker.retained.keys()]
			.filter((topic) => topic.startsWith('homeassistant/device/knell_github_'))
			.map((topic) => topic.split('/')[2] ?? '');
	}

	function read(repository: string): State {
		return broker.read(`knell/github/${repository.replace(/[^a-z0-9]+/g, '_')}/state`) as State;
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
			const request = github();

			await ring(request, { activeDays: 30 });

			assert.equal(
				sent(request)[1]?.body.variables?.search,
				'user:rspieker user:konfirm is:public archived:false pushed:>=2026-09-04',
			);
		});

		it('using the token for every request', async () => {
			const request = github();

			await ring(request);

			assert.deepEqual([...new Set(sent(request).map(({ authorization }) => authorization))], ['Bearer secret']);
		});

		it('through all pages of results', async () => {
			const nodes = search.data.search.nodes;
			const page = (part: Array<Node>, next: string | null) => ({
				data: { search: { pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes: part } },
			});
			const request = github({ pages: [page(nodes.slice(0, 4), 'page-2'), page(nodes.slice(4), null)] });

			await ring(request);

			assert.equal(sent(request)[2]?.body.variables?.cursor, 'page-2');
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

		it('a repository with its commits, branches, pull requests, workflows and releases', async () => {
			await ring(github());

			const { values, attributes } = read('rspieker/template-literal-table');

			assert.deepEqual(values, {
				last_commit: '2026-03-25T16:22:50Z',
				last_push: '2026-03-25T16:23:01Z',
				latest_branch: 'master',
				pull_requests: 0,
				issues: 0,
				latest_release: 'v4.2.0',
				stars: 7,
				forks: 1,
				tests: 'OFF',
				workflows: 'OFF',
			});
			assert.deepEqual(attributes.last_commit, {
				repository: 'rspieker/template-literal-table',
				url: 'https://github.com/rspieker/template-literal-table',
				branch: 'master',
				sha: 'b0eb9ef',
				message: 'chore: automate release conform release-please docs',
				author: 'Rogier Spieker',
				commit: 'https://github.com/rspieker/template-literal-table/commit/b0eb9ef658345e40e356f2d31b4a2b2f5d97c44b',
			});
			assert.deepEqual(attributes.latest_branch, {
				repository: 'rspieker/template-literal-table',
				url: 'https://github.com/rspieker/template-literal-table',
				committed: '2026-03-25T16:22:50Z',
				default_branch: 'master',
				branches: 5,
			});
		});

		it('the repository and its url with every entity, for cards and templates', async () => {
			await ring(github());

			const { attributes } = read('konfirm/geojson');

			for (const [key, each] of Object.entries(attributes as Record<string, Record<string, unknown>>)) {
				assert.equal(each.repository, 'konfirm/geojson', key);
				assert.equal(each.url, 'https://github.com/konfirm/geojson', key);
			}
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
				via_device: 'knell_github',
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

			await ring(
				github({ pages: [page], rest: { [workflowsPath('rspieker/new')]: { total_count: 0, workflows: [] } } }),
			);

			assert.deepEqual(read('rspieker/new').values, {
				last_commit: null,
				last_push: '2026-10-03T10:00:00Z',
				latest_branch: null,
				pull_requests: 0,
				issues: 0,
				latest_release: null,
				stars: 0,
				forks: 0,
			});
			assert.deepEqual(devices(), ['knell_github_rspieker_new']);
		});

		it('the remaining rate limit with the bell', async () => {
			await ring(github());

			const bell = broker.read('knell/github/state') as State;

			assert.equal(bell.values.rate_limit, 4321);
			assert.deepEqual(Object.keys(bell.attributes.rate_limit ?? {}), ['graphql', 'core']);
		});
	});

	describe('judges workflows', () => {
		it('by the latest run on each long-lived branch, the default one and those configured', async () => {
			await ring(github());

			const { workflows } = read('konfirm/geojson').attributes.workflows;
			const release = workflows.find(({ name }) => name === 'Release');

			assert.equal(read('konfirm/geojson').values.workflows, 'OFF');
			assert.equal(read('konfirm/geojson').attributes.workflows.default_branch, 'develop');
			assert.equal(release?.branch, 'main');
			assert.equal(release?.conclusion, 'success');
		});

		it('tests only running for pull requests by those', async () => {
			await ring(github());

			const [tests] = read('konfirm/node-iso13616').attributes.tests.workflows;

			assert.equal(read('konfirm/node-iso13616').values.tests, 'OFF');
			assert.equal(tests?.event, 'pull_request');
		});

		it('tests as unknown when they only ran on other branches, listing those that fail', async () => {
			await ring(github());

			const { values, attributes } = read('konfirm/monger');

			assert.equal(values.tests, null);
			assert.equal(values.workflows, 'OFF');
			assert.deepEqual(
				attributes.workflows.failing_branches.map(({ branch }) => branch).sort(),
				['feature/expressions', 'feature/mongo-catalog-as-test-source'],
			);
		});

		it('a failed run on a long-lived branch as a problem', async () => {
			const path = runsPath('konfirm/geojson', 'Tests');
			const { workflow_runs } = recorded[path] as { workflow_runs: Array<Run> };
			const index = workflow_runs.findIndex(({ head_branch, event }) => head_branch === 'main' && event === 'push');
			const failed = workflow_runs.map((run, at) => (at === index ? { ...run, conclusion: 'failure' } : run));

			await ring(github({ rest: { [path]: { workflow_runs: failed } } }));

			assert.equal(read('konfirm/geojson').values.tests, 'ON');
			assert.equal(read('konfirm/geojson').values.workflows, 'ON');
		});

		it('a workflow GitHub disabled for inactivity as a problem', async () => {
			const path = workflowsPath('rspieker/mongo-test-extractor');
			const { workflows } = recorded[path] as Workflows;

			await ring(
				github({
					rest: { [path]: { workflows: workflows.map((each) => ({ ...each, state: 'disabled_inactivity' })) } },
				}),
			);

			assert.equal(read('rspieker/mongo-test-extractor').values.workflows, 'ON');
		});

		it('neither tests nor workflows of repositories without them', async () => {
			await ring(github());

			assert.deepEqual(Object.keys(read('rspieker/tui').values).includes('tests'), false);
			assert.deepEqual(Object.keys(read('rspieker/tui').values).includes('workflows'), false);
			assert.deepEqual(Object.keys(read('konfirm/guards').values).includes('workflows'), false);
		});

		it('workflows without tests, when none match', async () => {
			await ring(github());

			assert.deepEqual(Object.keys(read('rspieker/mongo-catalog').values).includes('tests'), false);
			assert.equal(read('rspieker/mongo-catalog').values.workflows, 'OFF');
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
			['when an owner is forbidden to the token', () => github({ owners: fixture('owners-forbidden') })],
			['when an owner does not exist', () => github({ owners: fixture('owners-unknown') })],
			['when GitHub responds with an error status', () => mock.fn(async () => new Response('', { status: 502 }))],
		];

		for (const [description, failing] of cases) {
			it(description, async () => {
				let request: typeof fetch = github();

				await ring((...args) => request(...args));
				request = failing();
				await toll();

				assert.equal(broker.retained.get('knell/github/status'), 'offline');
				assert.equal(devices().length, repositories.length);
			});
		}

		it('reporting why', async () => {
			const error = mock.method(console, 'error', () => {});

			await ring(github({ owners: fixture('owners-forbidden') }));

			assert.match(String(error.mock.calls[0]?.arguments[1]), /forbids access .* lifetime is greater than 366 days/);
		});
	});
});
