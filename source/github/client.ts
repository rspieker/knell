const api = 'https://api.github.com';

export type Limit = {
	remaining: number;
	limit: number;
	reset: string;
};

type GraphqlResponse<T> = {
	data?: T | null;
	errors?: Array<{ message: string }>;
};

export type Client = {
	graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
	rest<T>(path: string): Promise<T>;
	/** The latest known rate limit per resource (`core`, `graphql`, …) */
	limits: Record<string, Limit>;
};

export function createClient(request: typeof fetch, token: string): Client {
	const limits: Record<string, Limit> = {};

	async function send(url: string, init: RequestInit): Promise<unknown> {
		const response = await request(url, {
			...init,
			headers: { authorization: `Bearer ${token}`, 'user-agent': 'knell', ...init.headers },
		});
		const resource = response.headers.get('x-ratelimit-resource');

		if (resource) {
			limits[resource] = {
				remaining: Number(response.headers.get('x-ratelimit-remaining')),
				limit: Number(response.headers.get('x-ratelimit-limit')),
				reset: new Date(Number(response.headers.get('x-ratelimit-reset')) * 1000).toISOString(),
			};
		}
		if (!response.ok) {
			throw new Error(`GitHub responded ${response.status} ${response.statusText} for ${url}`);
		}

		return response.json();
	}

	return {
		async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
			const { data, errors } = (await send(`${api}/graphql`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ query, variables }),
			})) as GraphqlResponse<T>;

			if (errors?.length || !data) {
				throw new Error(`GitHub: ${errors?.map(({ message }) => message).join('; ') ?? 'no data'}`);
			}

			return data;
		},

		async rest<T>(path: string): Promise<T> {
			return (await send(`${api}${path}`, {
				headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
			})) as T;
		},

		limits,
	};
}
