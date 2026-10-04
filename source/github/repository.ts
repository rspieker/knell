import type { Device, Entity } from '../device.ts';

type Commit = {
	abbreviatedOid: string;
	messageHeadline: string;
	committedDate: string;
	url: string;
	author: { name: string | null; user: { login: string } | null } | null;
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

/**
 * A repository as device; `extra` entities (e.g. its workflows) are added to
 * its own. Every entity carries the repository and its url, so cards and
 * templates need nothing but the entity at hand.
 */
export function device(repository: Repository, extra: Array<Entity> = []): Device {
	const commit = repository.defaultBranchRef?.target;
	const defaultBranch = repository.defaultBranchRef?.name ?? null;
	const branch = latest(repository.refs?.nodes ?? []);
	const pulls = repository.pullRequests;
	const release = repository.latestRelease;
	const entities: Array<Entity> = [
		{
			key: 'last_commit',
			name: 'Last commit',
			component: 'sensor',
			value: commit?.committedDate ?? null,
			attributes: {
				branch: defaultBranch,
				sha: commit?.abbreviatedOid ?? null,
				message: commit?.messageHeadline ?? null,
				author: commit?.author?.user?.login ?? commit?.author?.name ?? null,
				commit: commit?.url ?? null,
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
				default_branch: defaultBranch,
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
		{
			key: 'latest_release',
			name: 'Latest release',
			component: 'sensor',
			value: release?.tagName ?? null,
			attributes: { published: release?.publishedAt ?? null, release: release?.url ?? null },
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
		...extra,
	];

	return {
		id: repository.nameWithOwner,
		name: repository.nameWithOwner,
		url: repository.url,
		manufacturer: 'GitHub',
		model: 'Repository',
		version: release?.tagName,
		entities: entities.map((entity) => ({
			...entity,
			attributes: { repository: repository.nameWithOwner, url: repository.url, ...entity.attributes },
		})),
	};
}
