/**
 * Whether an MQTT topic filter (with `+` and `#` wildcards) matches a topic.
 */
export function matches(filter: string, topic: string): boolean {
	const filterLevels = filter.split('/');
	const topicLevels = topic.split('/');

	for (const [index, level] of filterLevels.entries()) {
		if (level === '#') {
			return true;
		}
		if (index >= topicLevels.length || (level !== '+' && level !== topicLevels[index])) {
			return false;
		}
	}

	return filterLevels.length === topicLevels.length;
}
