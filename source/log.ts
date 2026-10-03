const levels = ['debug', 'info', 'warn', 'error'] as const;

type Level = (typeof levels)[number];

function isLevel(value: unknown): value is Level {
	return levels.includes(value as Level);
}

const threshold = levels.indexOf(isLevel(process.env.LOG_LEVEL) ? process.env.LOG_LEVEL : 'info');

function write(level: Level, message: string, ...details: Array<unknown>): void {
	if (levels.indexOf(level) >= threshold) {
		console[level](`${new Date().toISOString()} ${level.padEnd(5)} ${message}`, ...details);
	}
}

export const log = {
	debug: (message: string, ...details: Array<unknown>) => write('debug', message, ...details),
	info: (message: string, ...details: Array<unknown>) => write('info', message, ...details),
	warn: (message: string, ...details: Array<unknown>) => write('warn', message, ...details),
	error: (message: string, ...details: Array<unknown>) => write('error', message, ...details),
};
