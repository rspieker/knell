/**
 * Whether a value matches any of the (case insensitive) globs, in which `*`
 * matches any run of characters.
 */
export function matchesGlob(patterns: Array<string>, value: string): boolean {
	return patterns.some((pattern) => {
		const source = pattern
			.split('*')
			.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
			.join('.*');

		return new RegExp(`^${source}$`, 'i').test(value);
	});
}
