import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isExcluded, loadGithubConfig } from './github.ts';

describe('loadGithubConfig', () => {
	it('leaves the source out without a token', () => {
		assert.equal(loadGithubConfig({ GITHUB_OWNERS: 'rspieker' }), undefined);
	});

	it('trims owners and exclusions, defaulting to a year of activity', () => {
		assert.deepEqual(
			loadGithubConfig({ GITHUB_TOKEN: 't', GITHUB_OWNERS: ' rspieker , konfirm,', GITHUB_EXCLUDE: 'a/*, ' }),
			{ token: 't', owners: ['rspieker', 'konfirm'], activeDays: 365, exclude: ['a/*'] },
		);
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

describe('isExcluded', () => {
	describe('returns true for', () => {
		const cases: Array<[string, string, string]> = [
			['a wildcard owner', '*/sandbox', 'konfirm/sandbox'],
			['a wildcard spanning the separator', 'rspieker*box', 'rspieker/sandbox'],
		];

		for (const [description, pattern, name] of cases) {
			it(description, () => assert.equal(isExcluded([pattern], name), true));
		}
	});

	describe('returns false for', () => {
		const cases: Array<[string, string, string]> = [
			['a partial name without wildcard', 'rspieker/tui', 'rspieker/tui-old'],
			['regular expression characters, taken literally', 'rspieker/t.i', 'rspieker/tui'],
		];

		for (const [description, pattern, name] of cases) {
			it(description, () => assert.equal(isExcluded([pattern], name), false));
		}
	});
});
