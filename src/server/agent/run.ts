import { z } from 'zod';

export const AGENT_RUN_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const AGENT_TRANSIENT_TTL_SECONDS = 60 * 60;

const agentCheckSchema = z
  .object({
    name: z.string().min(1),
    passed: z.boolean(),
    detail: z.string().optional(),
  })
  .strict();

export type AgentCheck = z.infer<typeof agentCheckSchema>;

export const agentRunSchema = z
  .object({
    runId: z.string().uuid(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().optional(),
    status: z.enum(['running', 'passed', 'failed']),
    checks: z.array(agentCheckSchema),
    artifacts: z.record(z.string()),
    cleanupKeys: z.array(z.string()),
    error: z.string().optional(),
  })
  .strict();

export type AgentRun = z.infer<typeof agentRunSchema>;

export const parseAgentRun = (raw: string): AgentRun =>
  agentRunSchema.parse(JSON.parse(raw));

export const finishAgentRun = (
  run: AgentRun,
  requestedPassed: boolean,
  finishedAt: string
): AgentRun => {
  if (run.status !== 'running') throw new Error(`Agent run is ${run.status}`);

  const failedChecks = run.checks.filter((check) => !check.passed);
  run.finishedAt = finishedAt;
  if (!requestedPassed) {
    run.status = 'failed';
    run.error = 'Browser validation was marked failed.';
  } else if (run.checks.length === 0) {
    run.status = 'failed';
    run.error = 'A run cannot pass without executing a check.';
  } else if (failedChecks.length > 0) {
    run.status = 'failed';
    run.error = `${failedChecks.length} check(s) failed.`;
  } else {
    run.status = 'passed';
    delete run.error;
  }
  return run;
};
