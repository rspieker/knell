import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadGithubConfig } from './github.ts';

describe('loadGithubConfig', () => {
	it('leaves the source out without a token', () => {
		assert.equal(loadGithubConfig({ GITHUB_OWNERS: 'rspieker' }), undefined);
	});

	it('trims owners and exclusions, defaulting to a year of activity and common names', () => {
		assert.deepEqual(
			loadGithubConfig({ GITHUB_TOKEN: 't', GITHUB_OWNERS: ' rspieker , konfirm,', GITHUB_EXCLUDE: 'a/*, ' }),
			{
				token: 't',
				owners: ['rspieker', 'konfirm'],
				activeDays: 365,
				exclude: ['a/*'],
				tests: ['test*'],
				branches: ['main', 'master', 'develop', 'release*'],
			},
		);
	});

	it('replaces the defaults for tests and long-lived branches when given', () => {
		const config = loadGithubConfig({ GITHUB_TOKEN: 't', GITHUB_OWNERS: 'x', GITHUB_TESTS: 'ci', GITHUB_BRANCHES: 'trunk' });

		assert.deepEqual([config?.tests, config?.branches], [['ci'], ['trunk']]);
	});

	describe('refuses to start', () => {
		const cases: Array<[string, NodeJS.ProcessEnv, RegExp]> = [
			['without owners', { GITHUB_TOKEN: 't' }, /GITHUB_OWNERS is required/],
			['with active days that are not a number', { GITHUB_TOKEN: 't', GITHUB_OWNERS: 'x', GITHUB_ACTIVE_DAYS: 'some' }, /GITHUB_ACTIVE_DAYS/],
		];

		for (const [description, env, error] of cases) {
			it(description, () => assert.throws(() => loadGithubConfig(env), error));
		}
	});
});
