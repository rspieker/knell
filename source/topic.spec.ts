import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matches } from './topic.ts';

describe('matches', () => {
	describe('returns true for', () => {
		const cases: Array<[string, string, string]> = [
			['an exact topic', 'knell/status', 'knell/status'],
			['+ standing in for a single level', 'homeassistant/device/+/config', 'homeassistant/device/knell_x/config'],
			['# standing in for any number of levels', 'knell/#', 'knell/github/konfirm_geojson/state'],
			['# including its parent level', 'knell/#', 'knell'],
		];

		for (const [description, filter, topic] of cases) {
			it(description, () => assert.equal(matches(filter, topic), true));
		}
	});

	describe('returns false for', () => {
		const cases: Array<[string, string, string]> = [
			['a different level', 'knell/status', 'knell/statue'],
			['+ spanning multiple levels', 'homeassistant/+/config', 'homeassistant/device/x/config'],
			['a topic shorter than the filter', 'knell/+/state', 'knell/github'],
			['a topic longer than the filter', 'knell/+', 'knell/github/status'],
		];

		for (const [description, filter, topic] of cases) {
			it(description, () => assert.equal(matches(filter, topic), false));
		}
	});
});
