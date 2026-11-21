import type { Entity } from './device.ts';
import { matchesGlob } from './glob.ts';

/** A completed run, as any forge reports it */
export type Run = {
	branch: string | null;
	event: string;
	conclusion: string | null;
	/** When the run was created */
	when: string;
	url: string;
};

/** A workflow with its completed runs, most recent first */
export type Workflow = {
	name: string;
	file: string;
	/** `active`, or e.g. `disabled_inactivity` */
	state: string;
	url: string;
	runs: Array<Run>;
};

export type RunFacts = {
	conclusion: string | null;
	event: string;
	when: string;
	url: string;
};

/**
 * The facts of a workflow: the latest completed run on each long-lived
 * branch and, most recent of those, the latest overall.
 */
export type WorkflowFacts = {
	name: string;
	file: string;
	/** `active`, `disabled_inactivity`, `disabled_manually`, … */
	state: string;
	conclusion: string | null;
	event: string | null;
	branch: string | null;
	when: string | null;
	url: string;
	branches: Record<string, RunFacts>;
};

export type FailingBranch = {
	branch: string;
	workflow: string;
	when: string;
	url: string;
};

/** Conclusions that mean something is wrong; `cancelled` usually means superseded */
const problems = ['failure', 'timed_out', 'startup_failure'];

function isFailure(conclusion: string | null): boolean {
	return conclusion !== null && problems.includes(conclusion);
}

/** A problem when the latest run on any long-lived branch failed */
function isProblem(facts: WorkflowFacts): boolean {
	return Object.values(facts.branches).some(({ conclusion }) => isFailure(conclusion));
}

/** Scheduled workflows are disabled by GitHub after 60 days without activity */
function isSilenced(facts: WorkflowFacts): boolean {
	return facts.state === 'disabled_inactivity';
}

function runFacts({ conclusion, event, when, url }: Run): RunFacts {
	return { conclusion, event, when, url };
}

/** Latest run per branch, runs being ordered most recent first */
function latestPerBranch(runs: Array<Run>): Map<string, Run> {
	const latest = new Map<string, Run>();

	for (const run of runs) {
		if (run.branch && !latest.has(run.branch)) {
			latest.set(run.branch, run);
		}
	}

	return latest;
}

/**
 * The facts of a workflow, judged by the latest runs on long-lived branches
 * or, for workflows only running for pull requests, by the latest of those;
 * plus its failures on other branches, reported but not judged.
 */
function describe(
	workflow: Workflow,
	isLongLived: (branch: string) => boolean,
): { facts: WorkflowFacts; failing: Array<FailingBranch> } {
	const completed = workflow.runs;
	const pushed = completed.filter((run) => run.event !== 'pull_request');
	const decisive = pushed.filter((run) => run.branch && isLongLived(run.branch));
	const latest = latestPerBranch(
		decisive.length ? decisive : completed.filter((run) => run.event === 'pull_request').slice(0, 1),
	);
	const run = [...latest.values()][0];

	return {
		facts: {
			name: workflow.name,
			file: workflow.file,
			state: workflow.state,
			conclusion: run?.conclusion ?? null,
			event: run?.event ?? null,
			branch: run?.branch ?? null,
			when: run?.when ?? null,
			url: run?.url ?? workflow.url,
			branches: Object.fromEntries([...latest].map(([branch, each]) => [branch, runFacts(each)])),
		},
		failing: [...latestPerBranch(completed)]
			.filter(([branch, each]) => !isLongLived(branch) && isFailure(each.conclusion))
			.map(([branch, each]) => ({ branch, workflow: workflow.name, when: each.when, url: each.url })),
	};
}

/**
 * Tests and Workflows entities of a repository, each only when it has
 * something to report: workflows that ran (or were silenced), of which the
 * tests are those matching the `tests` globs by name or file name. Long-lived
 * branches are the default one and those matching the `branches` globs.
 */
export function workflowEntities(
	workflows: Array<Workflow>,
	defaultBranch: string | null,
	{ tests, branches }: { tests: Array<string>; branches: Array<string> },
): Array<Entity> {
	const isLongLived = (branch: string) => branch === defaultBranch || matchesGlob(branches, branch);
	const all: Array<WorkflowFacts> = [];
	const failing: Array<FailingBranch> = [];
	const testing: Array<WorkflowFacts> = [];

	for (const workflow of workflows) {
		if (!workflow.runs.length && workflow.state !== 'disabled_inactivity') {
			continue;
		}

		const described = describe(workflow, isLongLived);

		all.push(described.facts);
		failing.push(...described.failing);

		if (matchesGlob(tests, workflow.name) || matchesGlob(tests, workflow.file.replace(/\.ya?ml$/, ''))) {
			testing.push(described.facts);
		}
	}

	const entities: Array<Entity> = [];

	if (testing.length) {
		entities.push({
			key: 'tests',
			name: 'Tests',
			component: 'binary_sensor',
			value: testing.some(({ conclusion }) => conclusion !== null) ? testing.some(isProblem) : null,
			attributes: { default_branch: defaultBranch, workflows: testing },
			config: { device_class: 'problem' },
		});
	}
	if (all.length) {
		entities.push({
			key: 'workflows',
			name: 'Workflows',
			component: 'binary_sensor',
			value: all.some((each) => isProblem(each) || isSilenced(each)),
			attributes: { default_branch: defaultBranch, workflows: all, failing_branches: failing },
			config: { device_class: 'problem' },
		});
	}

	return entities;
}
