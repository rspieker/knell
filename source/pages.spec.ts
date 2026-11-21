import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadPagesConfig } from './pages.ts';

function load(pages: unknown, env: NodeJS.ProcessEnv = {}) {
	return loadPagesConfig({ PAGES: 'pages.json', ...env }, { interval: 30 }, () =>
		typeof pages === 'string' ? pages : JSON.stringify(pages),
	);
}

describe('loadPagesConfig', () => {
	it('leaves the source out without a file', () => {
		assert.equal(loadPagesConfig({}, { interval: 30 }), undefined);
	});

	it('defaults to the global interval, half a minute to answer and any 2xx', () => {
		const [page] = load({ home: { url: 'https://example.com/' } })?.pages ?? [];

		assert.deepEqual(page, {
			id: 'home',
			name: 'home',
			url: 'https://example.com/',
			address: 'https://example.com/',
			headers: {},
			interval: 30,
			timeout: 30,
			status: [],
			text: false,
			checks: [],
		});
	});

	describe('refuses to start', () => {
		const url = 'https://example.com/';
		const cases: Array<[string, unknown, RegExp]> = [
			['with a file that is not JSON', '{ home: }', /cannot read pages\.json/],
			['with a file holding no pages', {}, /must hold an object of pages/],
			['with a list rather than pages by name', [{ url }], /must hold an object of pages/],
			['with a page name that cannot become an entity id', { '…': { url } }, /letters or digits/],
			['with two pages sharing an entity id', { 'a.b': { url }, a_b: { url } }, /same entity id/],
			['with a misspelled property', { home: { url, extracts: {} } }, /unknown properties extracts/],
			['without a url', { home: {} }, /needs a url/],
			['with a url that is not http(s)', { home: { url: 'ftp://example.com/' } }, /http\(s\) url/],
			['with a url referring to an unset variable', { home: { url: 'https://example.com/?k=${KEY}' } }, /\$\{KEY\}, which is not set/],
			['with a header referring to an unset variable', { home: { url, headers: { 'X-Key': '${KEY}' } } }, /header X-Key/],
			['with an interval that is not a number', { home: { url, interval: '5' } }, /interval must be a positive number/],
			['with a status that is no status', { home: { url, status: 'ok' } }, /status must be a status code/],
			['with a pattern that is not a regular expression', { home: { url, contains: { x: '(' } } }, /contains "x": Invalid regular expression/],
			['with flags that are not flags', { home: { url, contains: { x: { pattern: 'x', flags: 'q' } } } }, /Invalid flags/],
			['with a check without a pattern', { home: { url, extract: { x: { flags: 'i' } } } }, /needs a pattern/],
			['with a check named like one every page has', { home: { url, contains: { reachable: 'x' } } }, /is taken/],
			['with two checks sharing a name', { home: { url, contains: { x: 'x' }, count: { x: 'x' } } }, /count "x" is taken/],
		];

		for (const [description, pages, error] of cases) {
			it(description, () => assert.throws(() => load(pages), error));
		}
	});
});
