import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { slug } from './discovery.ts';

describe('slug', () => {
	describe('produces topic and id safe names for', () => {
		const cases: Array<[string, string, string]> = [
			['owner/repo names', 'konfirm/geojson', 'konfirm_geojson'],
			['dots and dashes', 'Rogier/dot.files-old', 'rogier_dot_files_old'],
			['leading and trailing punctuation', '.github', 'github'],
		];

		for (const [description, value, expected] of cases) {
			it(description, () => assert.equal(slug(value), expected));
		}
	});
});
