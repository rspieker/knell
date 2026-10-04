import type { Entity, Source } from './device.ts';
import { workflowEntities } from './github/actions.ts';
import { type Client, createClient } from './github/client.ts';
import { device, query, type Repository } from './github/repository.ts';
import { matchesGlob } from './glob.ts';
import { log } from './log.ts';

export type GithubConfig = {
	token: string;
	owners: Array<string>;
	activeDays: number;
	exclude: Array<string>;
	/** Globs recognising test workflows by name or file name */
	tests: Array<string>;
	/** Globs of long-lived branches, besides the default one */
	branches: Array<string>;
};

type SearchResponse = {
	search: {
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
		nodes: Array<Repository>;
	};
};

function list(value: string | undefined): Array<string> {
	return (value ?? '')
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
}

/**
 * GitHub configuration from the environment, undefined when no token is set
 * (the source is then simply not rung).
 */
export function loadGithubConfig(env: NodeJS.ProcessEnv): GithubConfig | undefined {
	if (!env.GITHUB_TOKEN) {
		return undefined;
	}

	const owners = list(env.GITHUB_OWNERS);
	const activeDays = Number(env.GITHUB_ACTIVE_DAYS || 365);
	const tests = list(env.GITHUB_TESTS);
	const branches = list(env.GITHUB_BRANCHES);

	if (!owners.length) {
		throw new Error('GITHUB_OWNERS is required with GITHUB_TOKEN, e.g. octocat,my-org');
	}
	if (!(activeDays > 0)) {
		throw new Error(`GITHUB_ACTIVE_DAYS must be a positive number, got "${env.GITHUB_ACTIVE_DAYS}"`);
	}

	return {
		token: env.GITHUB_TOKEN,
		owners,
		activeDays,
		exclude: list(env.GITHUB_EXCLUDE),
		tests: tests.length ? tests : ['test*'],
		branches: branches.length ? branches : ['main', 'master', 'develop', 'release*'],
	};
}

/**
 * The search narrowing repositories down to the ones worth announcing: public,
 * not archived, not forked and pushed to recently. Forks are excluded by
 * GitHub search unless asked for.
 */
export function searchQuery(owners: Array<string>, activeDays: number, now: Date): string {
	const since = new Date(now.getTime() - activeDays * 86_400_000).toISOString().slice(0, 10);

	return [...owners.map((owner) => `user:${owner}`), 'is:public', 'archived:false', `pushed:>=${since}`].join(' ');
}

/**
 * Search silently leaves out owners the token may not see (e.g. an org
 * rejecting the token's lifetime), which would remove all of their devices.
 * Asking for each owner directly turns that into an error instead.
 */
async function verify(client: Client, owners: Array<string>): Promise<void> {
	const aliases = owners.map((owner, index) => `o${index}: repositoryOwner(login: ${JSON.stringify(owner)}) { login }`);
	const data = await client.graphql<Record<string, { login: string } | null>>(`{ ${aliases.join(' ')} }`);
	const missing = owners.filter((_, index) => !data[`o${index}`]);

	if (missing.length) {
		throw new Error(`GitHub: unknown owner(s) ${missing.join(', ')}`);
	}
}

async function search(client: Client, search: string): Promise<Array<Repository>> {
	const repositories: Array<Repository> = [];
	let cursor: string | null = null;

	do {
		const data: SearchResponse = await client.graphql(query, { search, cursor });

		// search results include non-repository nodes as empty objects
		repositories.push(...data.search.nodes.filter((node) => 'nameWithOwner' in node));
		cursor = data.search.pageInfo.hasNextPage ? data.search.pageInfo.endCursor : null;
	} while (cursor);

	return repositories;
}

function rateLimit(client: Client): Entity {
	return {
		key: 'rate_limit',
		name: 'Rate limit',
		component: 'sensor',
		value: client.limits.core?.remaining ?? null,
		attributes: { ...client.limits },
		config: { state_class: 'measurement', icon: 'mdi:speedometer', entity_category: 'diagnostic' },
	};
}

export type GithubOptions = {
	request?: typeof fetch;
	now?: () => Date;
};

export function createGithubSource(
	{ token, owners, activeDays, exclude, tests, branches }: GithubConfig,
	{ request = fetch, now = () => new Date() }: GithubOptions = {},
): Source {
	const client = createClient(request, token);

	return {
		id: 'github',
		name: 'GitHub',
		async poll() {
			await verify(client, owners);

			const repositories = await search(client, searchQuery(owners, activeDays, now()));
			const announced = repositories.filter(({ nameWithOwner }) => !matchesGlob(exclude, nameWithOwner));

			log.debug(`github: ${repositories.length} found, ${repositories.length - announced.length} excluded`);

			const devices = await Promise.all(
				announced.map(async (repository) =>
					device(
						repository,
						await workflowEntities(
							client,
							repository.nameWithOwner,
							repository.defaultBranchRef?.name ?? null,
							{ tests, branches },
						),
					),
				),
			);

			return { devices, entities: [rateLimit(client)] };
		},
	};
}
