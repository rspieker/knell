import type { Entity } from '../device.ts';
import { matchesGlob } from '../glob.ts';
import type { Client } from './client.ts';

type Workflow = {
	id: number;
	name: string;
	path: string;
	state: string;
	html_url: string;
};

type Run = {
	head_branch: string | null;
	event: string;
	status: string;
	conclusion: string | null;
	created_at: string;
	html_url: string;
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

function file(path: string): string {
	return path.split('/').at(-1) ?? path;
}

function runFacts(run: Run): RunFacts {
	return { conclusion: run.conclusion, event: run.event, when: run.created_at, url: run.html_url };
}

/** Latest run per branch, runs being ordered most recent first */
function latestPerBranch(runs: Array<Run>): Map<string, Run> {
	const latest = new Map<string, Run>();

	for (const run of runs) {
		if (run.head_branch && !latest.has(run.head_branch)) {
			latest.set(run.head_branch, run);
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
	completed: Array<Run>,
	isLongLived: (branch: string) => boolean,
): { facts: WorkflowFacts; failing: Array<FailingBranch> } {
	const pushed = completed.filter((run) => run.event !== 'pull_request');
	const decisive = pushed.filter((run) => run.head_branch && isLongLived(run.head_branch));
	const latest = latestPerBranch(
		decisive.length ? decisive : completed.filter((run) => run.event === 'pull_request').slice(0, 1),
	);
	const run = [...latest.values()][0];

	return {
		facts: {
			name: workflow.name,
			file: file(workflow.path),
			state: workflow.state,
			conclusion: run?.conclusion ?? null,
			event: run?.event ?? null,
			branch: run?.head_branch ?? null,
			when: run?.created_at ?? null,
			url: run?.html_url ?? workflow.html_url,
			branches: Object.fromEntries([...latest].map(([branch, each]) => [branch, runFacts(each)])),
		},
		failing: [...latestPerBranch(completed)]
			.filter(([branch, each]) => !isLongLived(branch) && isFailure(each.conclusion))
			.map(([branch, each]) => ({ branch, workflow: workflow.name, when: each.created_at, url: each.html_url })),
	};
}

/**
 * Tests and Workflows entities of a repository, each only when it has
 * something to report: workflows that ran (or were silenced), of which the
 * tests are those matching the `tests` globs by name or file name. Long-lived
 * branches are the default one and those matching the `branches` globs.
 */
export async function workflowEntities(
	client: Client,
	repository: string,
	defaultBranch: string | null,
	{ tests, branches }: { tests: Array<string>; branches: Array<string> },
): Promise<Array<Entity>> {
	const isLongLived = (branch: string) => branch === defaultBranch || matchesGlob(branches, branch);
	const { workflows } = await client.rest<{ workflows: Array<Workflow> }>(
		`/repos/${repository}/actions/workflows?per_page=100`,
	);
	const all: Array<WorkflowFacts> = [];
	const failing: Array<FailingBranch> = [];
	const testing: Array<WorkflowFacts> = [];

	// dynamic workflows (e.g. Copilot) are GitHub's, not the repository's
	for (const workflow of workflows.filter(({ path }) => !path.startsWith('dynamic/'))) {
		const { workflow_runs: runs } = await client.rest<{ workflow_runs: Array<Run> }>(
			`/repos/${repository}/actions/workflows/${workflow.id}/runs?per_page=20`,
		);
		const completed = runs.filter((run) => run.status === 'completed');

		if (!completed.length && workflow.state !== 'disabled_inactivity') {
			continue;
		}

		const described = describe(workflow, completed, isLongLived);

		all.push(described.facts);
		failing.push(...described.failing);

		if (matchesGlob(tests, workflow.name) || matchesGlob(tests, described.facts.file.replace(/\.ya?ml$/, ''))) {
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
