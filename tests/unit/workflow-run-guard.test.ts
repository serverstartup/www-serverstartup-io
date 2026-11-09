/**
 * A workflow started by `workflow_run` runs in this repository's context, with its
 * secrets, even when the run that triggered it came from a fork's pull request.
 * Its `branches:` filter compares the branch name only, and a fork can name its
 * branch `main` (#715). So every job that checks out the triggering commit
 * (`workflow_run.head_sha`) and runs its code must also require
 * `workflow_run.event == 'push'`, which a fork's pull request never produces.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "..", "..", ".github", "workflows");
const GUARD = "github.event.workflow_run.event == 'push'";

/** Each job's text, keyed by name: the lines between one two-space key under `jobs:` and the next. */
const jobs = (yaml: string): Map<string, string> => {
	const body = yaml.split(/^jobs:\s*$/m)[1] ?? "";
	const out = new Map<string, string>();
	for (const m of body.matchAll(/^ {2}([\w-]+):\s*$([\s\S]*?)(?=^ {2}[\w-]+:\s*$|(?![\s\S]))/gm)) out.set(m[1], m[2]);
	return out;
};

const runsTriggeringCommit = (job: string) => /workflow_run\.head_sha/.test(job);
const jobIf = (job: string) => job.match(/^ {4}if:\s*(.+)$/m)?.[1] ?? "";

const workflowRunFiles = readdirSync(DIR)
	.filter((f) => /\.ya?ml$/.test(f))
	.map((f) => ({ file: f, yaml: readFileSync(join(DIR, f), "utf8") }))
	.filter(({ yaml }) => /^\s{2}workflow_run:\s*$/m.test(yaml));

describe("workflow_run jobs that run the triggering commit", () => {
	it("are found — the reader is not blind", () => {
		// deploy-preview and badges today; a rename must not turn this test vacuous.
		const exposed = workflowRunFiles.flatMap(({ yaml }) => [...jobs(yaml).values()].filter(runsTriggeringCommit));
		expect(exposed.length).toBeGreaterThanOrEqual(2);
	});

	it("the reader catches a job without the guard", () => {
		const planted = "jobs:\n  deploy:\n    if: github.event.workflow_run.conclusion == 'success'\n    steps:\n      - with:\n          ref: ${{ github.event.workflow_run.head_sha }}\n";
		const job = jobs(planted).get("deploy") ?? "";
		expect(runsTriggeringCommit(job)).toBe(true);
		expect(jobIf(job)).not.toContain(GUARD);
	});

	for (const { file, yaml } of workflowRunFiles) {
		for (const [name, job] of jobs(yaml)) {
			if (!runsTriggeringCommit(job)) continue;
			it(`${file} → ${name} runs only for a push to this repository`, () => {
				// Joined by AND inside the workflow_run branch: `|| GUARD` would read the same
				// as a substring and protect nothing.
				expect(jobIf(job)).toContain(`&& ${GUARD})`);
				expect(jobIf(job).split("||").length).toBeLessThanOrEqual(2);
			});
		}
	}
});
