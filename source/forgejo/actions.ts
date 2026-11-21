import type { Entity } from '../device.ts';
import { type Run, type Workflow, workflowEntities } from '../workflows.ts';
import type { Client } from './client.ts';

type ForgejoRun = {
	workflow_id: string;
	prettyref: string;
	event: string;
	/** `success`, `failure`, `cancelled`, `skipped`, or still going: `waiting`, `running`, `blocked` */
	status: string;
	created: string;
	html_url: string;
};

const completed = ['success', 'failure', 'cancelled', 'skipped'];

/**
 * A repository's workflows, judged as any forge's (see `workflows.ts`).
 * Forgejo cannot list workflows, so they are what its latest 50 runs name,
 * each known by its file only.
 */
export async function forgejoWorkflowEntities(
	client: Client,
	repository: string,
	defaultBranch: string,
	options: { tests: Array<string>; branches: Array<string> },
): Promise<Array<Entity>> {
	const answer = await client.get<{ workflow_runs: Array<ForgejoRun> | null }>(
		`/repos/${repository}/actions/runs?limit=50`,
	);
	const workflows = new Map<string, Workflow>();

	// runs come most recent first, and so they stay per workflow
	for (const run of answer?.workflow_runs ?? []) {
		const workflow = workflows.get(run.workflow_id) ?? {
			name: run.workflow_id.replace(/\.ya?ml$/, ''),
			file: run.workflow_id,
			state: 'active',
			url: `${run.html_url.replace(/\/runs\/\d+$/, '')}?workflow=${encodeURIComponent(run.workflow_id)}`,
			runs: [] as Array<Run>,
		};

		workflows.set(run.workflow_id, workflow);

		if (completed.includes(run.status)) {
			workflow.runs.push({
				branch: run.prettyref || null,
				event: run.event,
				conclusion: run.status,
				when: new Date(run.created).toISOString(),
				url: run.html_url,
			});
		}
	}

	return workflowEntities([...workflows.values()], defaultBranch, options);
}
