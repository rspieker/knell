import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadForgejoConfig } from './forgejo.ts';

describe('loadForgejoConfig', () => {
	it('leaves the source out without an instance', () => {
		assert.equal(loadForgejoConfig({ FORGEJO_TOKEN: 't', FORGEJO_OWNERS: 'alice' }), undefined);
	});

	it('trims the url, owners and exclusions, defaulting as GitHub does', () => {
		assert.deepEqual(
			loadForgejoConfig({ FORGEJO_URL: 'https://codeberg.org/', FORGEJO_OWNERS: ' alice , guild,', FORGEJO_EXCLUDE: 'a/*, ' }),
			{
				url: 'https://codeberg.org',
				token: undefined,
				owners: ['alice', 'guild'],
				activeDays: 365,
				exclude: ['a/*'],
				tests: ['test*'],
				branches: ['main', 'master', 'develop', 'release*'],
			},
		);
	});

	describe('refuses to start', () => {
		const cases: Array<[string, NodeJS.ProcessEnv, RegExp]> = [
			['with an instance that is not an http(s) url', { FORGEJO_URL: 'codeberg.org', FORGEJO_OWNERS: 'x' }, /FORGEJO_URL must be/],
			['without owners', { FORGEJO_URL: 'https://codeberg.org' }, /FORGEJO_OWNERS is required/],
			[
				'with active days that are not a number',
				{ FORGEJO_URL: 'https://codeberg.org', FORGEJO_OWNERS: 'x', FORGEJO_ACTIVE_DAYS: 'some' },
				/FORGEJO_ACTIVE_DAYS/,
			],
		];

		for (const [description, env, error] of cases) {
			it(description, () => assert.throws(() => loadForgejoConfig(env), error));
		}
	});
});
