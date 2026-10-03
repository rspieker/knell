import type { Device, Entity, Source } from './device.ts';
import { log } from './log.ts';

export type GithubConfig = {
	token: string;
	owners: Array<string>;
	activeDays: number;
	exclude: Array<string>;
};

type Commit = {
	abbreviatedOid: string;
	messageHeadline: string;
	committedDate: string;
	url: string;
	author: { name: string | null; user: { login: string } | null } | null;
	statusCheckRollup: { state: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED' } | null;
};

type Branch = {
	name: string;
	target: { committedDate?: string };
};

export type Repository = {
	nameWithOwner: string;
	url: string;
	pushedAt: string;
	stargazerCount: number;
	forkCount: number;
	issues: { totalCount: number };
	pullRequests: { totalCount: number; nodes: Array<{ isDraft: boolean; createdAt: string }> };
	latestRelease: { tagName: string; publishedAt: string; url: string } | null;
	defaultBranchRef: { name: string; target: Commit } | null;
	refs: { totalCount: number; nodes: Array<Branch> } | null;
};

type SearchResponse = {
	search: {
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
		nodes: Array<Repository>;
	};
};

const endpoint = 'https://api.github.com/graphql';

export const query = `
query ($search: String!, $cursor: String) {
	search(type: REPOSITORY, query: $search, first: 50, after: $cursor) {
		pageInfo { hasNextPage endCursor }
		nodes {
			... on Repository {
				nameWithOwner
				url
				pushedAt
				stargazerCount
				forkCount
				issues(states: OPEN) { totalCount }
				pullRequests(states: OPEN, first: 100, orderBy: { field: CREATED_AT, direction: ASC }) {
					totalCount
					nodes { isDraft createdAt }
				}
				latestRelease { tagName publishedAt url }
				defaultBranchRef {
					name
					target {
						... on Commit {
							abbreviatedOid
							messageHeadline
							committedDate
							url
							author { name user { login } }
							statusCheckRollup { state }
						}
					}
				}
				refs(refPrefix: "refs/heads/", first: 100) {
					totalCount
					nodes { name target { ... on Commit { committedDate } } }
				}
			}
		}
	}
}`;

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

	if (!owners.length) {
		throw new Error('GITHUB_OWNERS is required with GITHUB_TOKEN, e.g. octocat,my-org');
	}
	if (!(activeDays > 0)) {
		throw new Error(`GITHUB_ACTIVE_DAYS must be a positive number, got "${env.GITHUB_ACTIVE_DAYS}"`);
	}

	return { token: env.GITHUB_TOKEN, owners, activeDays, exclude: list(env.GITHUB_EXCLUDE) };
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
 * Whether a repository matches any of the (case insensitive) globs, in which
 * `*` matches any run of characters.
 */
export function isExcluded(patterns: Array<string>, name: string): boolean {
	return patterns.some((pattern) => {
		const source = pattern
			.split('*')
			.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
			.join('.*');

		return new RegExp(`^${source}$`, 'i').test(name);
	});
}

function actions(commit: Commit | undefined): Entity {
	const state = commit?.statusCheckRollup?.state;

	return {
		key: 'actions',
		name: 'Actions',
		component: 'binary_sensor',
		value: state ? state === 'FAILURE' || state === 'ERROR' : null,
		attributes: { state: state?.toLowerCase() ?? null },
		config: { device_class: 'problem' },
	};
}

/**
 * The branch with the most recent commit; GitHub cannot order branches by
 * commit date (TAG_COMMIT_DATE only orders tags).
 */
function latest(branches: Array<Branch>): Branch | undefined {
	return branches.reduce<Branch | undefined>(
		(newest, branch) =>
			(branch.target.committedDate ?? '') > (newest?.target.committedDate ?? '') ? branch : newest,
		undefined,
	);
}

export function device(repository: Repository): Device {
	const commit = repository.defaultBranchRef?.target;
	const branch = latest(repository.refs?.nodes ?? []);
	const pulls = repository.pullRequests;
	const release = repository.latestRelease;

	return {
		id: repository.nameWithOwner,
		name: repository.nameWithOwner,
		url: repository.url,
		manufacturer: 'GitHub',
		model: 'Repository',
		version: release?.tagName,
		entities: [
			{
				key: 'last_commit',
				name: 'Last commit',
				component: 'sensor',
				value: commit?.committedDate ?? null,
				attributes: {
					branch: repository.defaultBranchRef?.name ?? null,
					sha: commit?.abbreviatedOid ?? null,
					message: commit?.messageHeadline ?? null,
					author: commit?.author?.user?.login ?? commit?.author?.name ?? null,
					url: commit?.url ?? null,
				},
				config: { device_class: 'timestamp', icon: 'mdi:source-commit' },
			},
			{
				key: 'last_push',
				name: 'Last push',
				component: 'sensor',
				value: repository.pushedAt,
				config: { device_class: 'timestamp', icon: 'mdi:upload' },
			},
			{
				key: 'latest_branch',
				name: 'Latest branch',
				component: 'sensor',
				value: branch?.name ?? null,
				attributes: {
					committed: branch?.target.committedDate ?? null,
					branches: repository.refs?.totalCount ?? 0,
				},
				config: { icon: 'mdi:source-branch' },
			},
			{
				key: 'pull_requests',
				name: 'Pull requests',
				component: 'sensor',
				value: pulls.totalCount,
				attributes: {
					drafts: pulls.nodes.filter((pull) => pull.isDraft).length,
					oldest: pulls.nodes[0]?.createdAt ?? null,
				},
				config: { state_class: 'measurement', icon: 'mdi:source-pull' },
			},
			{
				key: 'issues',
				name: 'Issues',
				component: 'sensor',
				value: repository.issues.totalCount,
				config: { state_class: 'measurement', icon: 'mdi:alert-circle-outline' },
			},
			actions(commit),
			{
				key: 'latest_release',
				name: 'Latest release',
				component: 'sensor',
				value: release?.tagName ?? null,
				attributes: { published: release?.publishedAt ?? null, url: release?.url ?? null },
				config: { icon: 'mdi:tag' },
			},
			{
				key: 'stars',
				name: 'Stars',
				component: 'sensor',
				value: repository.stargazerCount,
				config: { state_class: 'total', icon: 'mdi:star' },
			},
			{
				key: 'forks',
				name: 'Forks',
				component: 'sensor',
				value: repository.forkCount,
				config: { state_class: 'total', icon: 'mdi:source-fork' },
			},
		],
	};
}

type GraphqlResponse<T> = {
	data?: T | null;
	errors?: Array<{ message: string }>;
};

async function graphql<T>(
	request: typeof fetch,
	token: string,
	query: string,
	variables: Record<string, unknown>,
): Promise<T> {
	const response = await request(endpoint, {
		method: 'POST',
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'knell' },
		body: JSON.stringify({ query, variables }),
	});

	if (!response.ok) {
		throw new Error(`GitHub responded ${response.status} ${response.statusText}`);
	}

	const { data, errors } = (await response.json()) as GraphqlResponse<T>;

	if (errors?.length || !data) {
		throw new Error(`GitHub: ${errors?.map(({ message }) => message).join('; ') ?? 'no data'}`);
	}

	return data;
}

/**
 * Search silently leaves out owners the token may not see (e.g. an org
 * rejecting the token's lifetime), which would remove all of their devices.
 * Asking for each owner directly turns that into an error instead.
 */
async function verify(request: typeof fetch, token: string, owners: Array<string>): Promise<void> {
	const aliases = owners.map((owner, index) => `o${index}: repositoryOwner(login: ${JSON.stringify(owner)}) { login }`);
	const data = await graphql<Record<string, { login: string } | null>>(
		request,
		token,
		`{ ${aliases.join(' ')} }`,
		{},
	);
	const missing = owners.filter((_, index) => !data[`o${index}`]);

	if (missing.length) {
		throw new Error(`GitHub: unknown owner(s) ${missing.join(', ')}`);
	}
}

async function search(request: typeof fetch, token: string, search: string): Promise<Array<Repository>> {
	const repositories: Array<Repository> = [];
	let cursor: string | null = null;

	do {
		const data: SearchResponse = await graphql(request, token, query, { search, cursor });

		// search results include non-repository nodes as empty objects
		repositories.push(...data.search.nodes.filter((node) => 'nameWithOwner' in node));
		cursor = data.search.pageInfo.hasNextPage ? data.search.pageInfo.endCursor : null;
	} while (cursor);

	return repositories;
}

export type GithubOptions = {
	request?: typeof fetch;
	now?: () => Date;
};

export function createGithubSource(
	{ token, owners, activeDays, exclude }: GithubConfig,
	{ request = fetch, now = () => new Date() }: GithubOptions = {},
): Source {
	return {
		id: 'github',
		async poll() {
			await verify(request, token, owners);

			const repositories = await search(request, token, searchQuery(owners, activeDays, now()));
			const announced = repositories.filter(({ nameWithOwner }) => !isExcluded(exclude, nameWithOwner));

			log.debug(`github: ${repositories.length} found, ${repositories.length - announced.length} excluded`);

			return announced.map(device);
		},
	};
}
