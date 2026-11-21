import type { Entity } from '../device.ts';
import { type Workflow, workflowEntities } from '../workflows.ts';
import type { Client } from './client.ts';

type GithubWorkflow = {
	id: number;
	name: string;
	path: string;
	state: string;
	html_url: string;
};

type GithubRun = {
	head_branch: string | null;
	event: string;
	status: string;
	conclusion: string | null;
	created_at: string;
	html_url: string;
};

function file(path: string): string {
	return path.split('/').at(-1) ?? path;
}

/**
 * A repository's workflows with their latest 20 runs each, judged as any
 * forge's (see `workflows.ts`).
 */
export async function githubWorkflowEntities(
	client: Client,
	repository: string,
	defaultBranch: string | null,
	options: { tests: Array<string>; branches: Array<string> },
): Promise<Array<Entity>> {
	const { workflows } = await client.rest<{ workflows: Array<GithubWorkflow> }>(
		`/repos/${repository}/actions/workflows?per_page=100`,
	);
	const described: Array<Workflow> = [];

	// dynamic workflows (e.g. Copilot) are GitHub's, not the repository's
	for (const workflow of workflows.filter(({ path }) => !path.startsWith('dynamic/'))) {
		const { workflow_runs: runs } = await client.rest<{ workflow_runs: Array<GithubRun> }>(
			`/repos/${repository}/actions/workflows/${workflow.id}/runs?per_page=20`,
		);

		described.push({
			name: workflow.name,
			file: file(workflow.path),
			state: workflow.state,
			url: workflow.html_url,
			runs: runs
				.filter((run) => run.status === 'completed')
				.map((run) => ({
					branch: run.head_branch,
					event: run.event,
					conclusion: run.conclusion,
					when: run.created_at,
					url: run.html_url,
				})),
		});
	}

	return workflowEntities(described, defaultBranch, options);
}
