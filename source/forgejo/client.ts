export type Client = {
	/** A path below `/api/v1`, answered as JSON; undefined when not found */
	get<T>(path: string): Promise<T | undefined>;
};

export function createClient(request: typeof fetch, url: string, token?: string): Client {
	const api = `${url}/api/v1`;

	return {
		async get<T>(path: string): Promise<T | undefined> {
			const response = await request(`${api}${path}`, {
				headers: { accept: 'application/json', ...(token ? { authorization: `token ${token}` } : {}) },
			});

			if (response.status === 404) {
				return undefined;
			}
			if (!response.ok) {
				throw new Error(`Forgejo responded ${response.status} ${response.statusText} for ${api}${path}`);
			}

			return (await response.json()) as T;
		},
	};
}
