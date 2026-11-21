/** Elements whose content is not text: scripts, styles and the like */
const hidden = /<(script|style|template|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** Elements starting a line of their own, so `^` and `$` find their edges */
const blocks =
	/<\/?(?:address|article|aside|blockquote|br|dd|div|dl|dt|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|td|th|tr|ul)\b[^>]*>/gi;

const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function entity(whole: string, name: string): string {
	if (name.startsWith('#')) {
		const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));

		return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
	}

	return named[name.toLowerCase()] ?? whole;
}

/**
 * The text of an HTML page, a line per block, so patterns match what a reader
 * sees: `Haar<b>lem</b>` reads as `Haarlem`, scripts and styles not at all.
 * Not a parser; good enough to look for words.
 */
export function text(html: string): string {
	return html
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(hidden, '')
		.replace(blocks, '\n')
		.replace(/<[^>]*>/g, '')
		.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, entity)
		.split('\n')
		.map((line) => line.replace(/\s+/g, ' ').trim())
		.filter(Boolean)
		.join('\n');
}
