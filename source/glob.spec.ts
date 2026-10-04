import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchesGlob } from './glob.ts';

describe('matchesGlob', () => {
	describe('returns true for', () => {
		const cases: Array<[string, string, string]> = [
			['a wildcard owner', '*/sandbox', 'konfirm/sandbox'],
			['a different case', 'Tests', 'tests'],
			['a wildcard spanning the separator', 'rspieker*box', 'rspieker/sandbox'],
		];

		for (const [description, pattern, name] of cases) {
			it(description, () => assert.equal(matchesGlob([pattern], name), true));
		}
	});

	describe('returns false for', () => {
		const cases: Array<[string, string, string]> = [
			['a partial name without wildcard', 'rspieker/tui', 'rspieker/tui-old'],
			['regular expression characters, taken literally', 'rspieker/t.i', 'rspieker/tui'],
		];

		for (const [description, pattern, name] of cases) {
			it(description, () => assert.equal(matchesGlob([pattern], name), false));
		}
	});
});
