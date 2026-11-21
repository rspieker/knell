import type { Source } from './device.ts';
import { forgejoWorkflowEntities } from './forgejo/actions.ts';
import { type Client, createClient } from './forgejo/client.ts';
import { details, device, type Repository } from './forgejo/repository.ts';
import { matchesGlob } from './glob.ts';
import { log } from './log.ts';

export type ForgejoConfig = {
	/** The instance, e.g. `https://codeberg.org`, without a trailing slash */
	url: string;
	token?: string;
	owners: Array<string>;
	activeDays: number;
	exclude: Array<string>;
	/** Globs recognising test workflows by file name */
	tests: Array<string>;
	/** Globs of long-lived branches, besides the default one */
	branches: Array<string>;
};

function list(value: string | undefined): Array<string> {
	return (value ?? '')
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
}

/**
 * Forgejo configuration from the environment, undefined when no instance is
 * set (the source is then simply not rung). A token is optional, as public
 * repositories need none.
 */
export function loadForgejoConfig(env: NodeJS.ProcessEnv): ForgejoConfig | undefined {
	if (!env.FORGEJO_URL) {
		return undefined;
	}

	const url = env.FORGEJO_URL.replace(/\/+$/, '');
	const owners = list(env.FORGEJO_OWNERS);
	const activeDays = Number(env.FORGEJO_ACTIVE_DAYS || 365);
	const tests = list(env.FORGEJO_TESTS);
	const branches = list(env.FORGEJO_BRANCHES);

	if (!/^https?:$/.test(URL.parse(url)?.protocol ?? '')) {
		throw new Error(`FORGEJO_URL must be an http(s) url, e.g. https://codeberg.org, got "${env.FORGEJO_URL}"`);
	}
	if (!owners.length) {
		throw new Error('FORGEJO_OWNERS is required with FORGEJO_URL, e.g. alice,my-org');
	}
	if (!(activeDays > 0)) {
		throw new Error(`FORGEJO_ACTIVE_DAYS must be a positive number, got "${env.FORGEJO_ACTIVE_DAYS}"`);
	}

	return {
		url,
		token: env.FORGEJO_TOKEN || undefined,
		owners,
		activeDays,
		exclude: list(env.FORGEJO_EXCLUDE),
		tests: tests.length ? tests : ['test*'],
		branches: branches.length ? branches : ['main', 'master', 'develop', 'release*'],
	};
}

/** Page size; Forgejo's default maximum */
const limit = 50;

/**
 * Every repository of an owner, user or organization alike. An owner Forgejo
 * does not know (or does not show this token) is an error rather than an
 * owner without repositories, which would remove all of its devices.
 */
async function owned(client: Client, owner: string): Promise<Array<Repository>> {
	const repositories: Array<Repository> = [];

	for (let page = 1; ; page++) {
		const found = await client.get<Array<Repository>>(`/users/${encodeURIComponent(owner)}/repos?limit=${limit}&page=${page}`);

		if (!found) {
			throw new Error(`Forgejo: unknown owner ${owner}`);
		}

		repositories.push(...found);

		if (found.length < limit) {
			return repositories;
		}
	}
}

/** Worth announcing: the owner's own (no forks or mirrors), not archived or empty, and recently active */
function isAnnounced(repository: Repository, since: number, exclude: Array<string>): boolean {
	return (
		!repository.archived &&
		!repository.fork &&
		!repository.mirror &&
		!repository.empty &&
		Date.parse(repository.updated_at) >= since &&
		!matchesGlob(exclude, repository.full_name)
	);
}

export type ForgejoOptions = {
	request?: typeof fetch;
	now?: () => Date;
};

export function createForgejoSource(
	{ url, token, owners, activeDays, exclude, tests, branches }: ForgejoConfig,
	{ request = fetch, now = () => new Date() }: ForgejoOptions = {},
): Source {
	const client = createClient(request, url, token);

	return {
		id: 'forgejo',
		name: 'Forgejo',
		async poll() {
			const since = now().getTime() - activeDays * 86_400_000;
			const repositories = (await Promise.all(owners.map((owner) => owned(client, owner)))).flat();
			const announced = repositories.filter((repository) => isAnnounced(repository, since, exclude));

			log.debug(`forgejo: ${repositories.length} found, ${announced.length} announced`);

			const devices = await Promise.all(
				announced.map(async (repository) =>
					device(
						repository,
						await details(client, repository),
						repository.has_actions
							? await forgejoWorkflowEntities(client, repository.full_name, repository.default_branch, {
									tests,
									branches,
								})
							: [],
					),
				),
			);

			return { devices };
		},
	};
}
