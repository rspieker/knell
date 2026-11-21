import type { Device, Entity } from '../device.ts';
import type { Client } from './client.ts';

export type Repository = {
	full_name: string;
	html_url: string;
	default_branch: string;
	updated_at: string;
	archived: boolean;
	fork: boolean;
	mirror: boolean;
	empty: boolean;
	has_actions: boolean;
	stars_count: number;
	forks_count: number;
	open_issues_count: number;
	open_pr_counter: number;
	release_counter: number;
};

export type Branch = {
	name: string;
	commit: {
		id: string;
		message: string;
		url: string;
		timestamp: string;
		author: { name: string; username?: string };
	};
};

type Pull = { draft?: boolean; created_at: string };

type Release = { tag_name: string; published_at: string; html_url: string };

/** What a repository's own record leaves out, at most three requests */
export type Details = {
	branches: Array<Branch>;
	pulls: Array<Pull>;
	release: Release | undefined;
};

export async function details(client: Client, { full_name, open_pr_counter, release_counter }: Repository): Promise<Details> {
	const [branches, pulls, release] = await Promise.all([
		client.get<Array<Branch>>(`/repos/${full_name}/branches?limit=50`),
		open_pr_counter ? client.get<Array<Pull>>(`/repos/${full_name}/pulls?state=open&sort=oldest&limit=50`) : [],
		release_counter ? client.get<Release>(`/repos/${full_name}/releases/latest`) : undefined,
	]);

	return { branches: branches ?? [], pulls: pulls ?? [], release };
}

/** The branch with the most recent commit */
function latest(branches: Array<Branch>): Branch | undefined {
	return branches.reduce<Branch | undefined>(
		(newest, branch) =>
			!newest || Date.parse(branch.commit.timestamp) > Date.parse(newest.commit.timestamp) ? branch : newest,
		undefined,
	);
}

/** Forgejo answers in local time; HA would rather have one moment written one way */
function moment(value: string | undefined): string | null {
	return value ? new Date(value).toISOString() : null;
}

/**
 * A repository as device, with the very entities of a GitHub repository so
 * cards and templates serve both; `extra` entities (e.g. its workflows) are
 * added to its own. Every entity carries the repository and its url.
 */
export function device(repository: Repository, { branches, pulls, release }: Details, extra: Array<Entity> = []): Device {
	const defaultBranch = repository.default_branch;
	const commit = branches.find(({ name }) => name === defaultBranch)?.commit;
	const branch = latest(branches);
	const entities: Array<Entity> = [
		{
			key: 'last_commit',
			name: 'Last commit',
			component: 'sensor',
			value: moment(commit?.timestamp),
			attributes: {
				branch: defaultBranch,
				sha: commit?.id.slice(0, 7) ?? null,
				message: commit?.message.split('\n')[0] ?? null,
				author: commit?.author.username || commit?.author.name || null,
				commit: commit?.url ?? null,
			},
			config: { device_class: 'timestamp', icon: 'mdi:source-commit' },
		},
		{
			// Forgejo does not say when it was pushed to; the newest commit comes closest
			key: 'last_push',
			name: 'Last push',
			component: 'sensor',
			value: moment(branch?.commit.timestamp),
			config: { device_class: 'timestamp', icon: 'mdi:upload' },
		},
		{
			key: 'latest_branch',
			name: 'Latest branch',
			component: 'sensor',
			value: branch?.name ?? null,
			attributes: {
				committed: moment(branch?.commit.timestamp),
				default_branch: defaultBranch,
				branches: branches.length,
			},
			config: { icon: 'mdi:source-branch' },
		},
		{
			key: 'pull_requests',
			name: 'Pull requests',
			component: 'sensor',
			value: repository.open_pr_counter,
			attributes: {
				drafts: pulls.filter((pull) => pull.draft).length,
				oldest: moment(pulls[0]?.created_at),
			},
			config: { state_class: 'measurement', icon: 'mdi:source-pull' },
		},
		{
			key: 'issues',
			name: 'Issues',
			component: 'sensor',
			value: repository.open_issues_count,
			config: { state_class: 'measurement', icon: 'mdi:alert-circle-outline' },
		},
		{
			key: 'latest_release',
			name: 'Latest release',
			component: 'sensor',
			value: release?.tag_name ?? null,
			attributes: { published: moment(release?.published_at), release: release?.html_url ?? null },
			config: { icon: 'mdi:tag' },
		},
		{
			key: 'stars',
			name: 'Stars',
			component: 'sensor',
			value: repository.stars_count,
			config: { state_class: 'total', icon: 'mdi:star' },
		},
		{
			key: 'forks',
			name: 'Forks',
			component: 'sensor',
			value: repository.forks_count,
			config: { state_class: 'total', icon: 'mdi:source-fork' },
		},
		...extra,
	];

	return {
		id: repository.full_name,
		name: repository.full_name,
		url: repository.html_url,
		manufacturer: 'Forgejo',
		model: 'Repository',
		version: release?.tag_name,
		entities: entities.map((entity) => ({
			...entity,
			attributes: { repository: repository.full_name, url: repository.html_url, ...entity.attributes },
		})),
	};
}
