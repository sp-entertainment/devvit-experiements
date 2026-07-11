import { redis } from '@devvit/web/server';
import { z } from 'zod';
import { buildId } from '../../shared/buildInfo';

export type AgentCheck = {
  name: string;
  passed: boolean;
  detail?: string;
};

export type AgentCommandResult = {
  checks: AgentCheck[];
  artifacts?: Record<string, string>;
  cleanupKeys?: string[];
};

type AgentCommand = {
  id: string;
  category: string;
  description: string;
  browserSteps: string[];
  input: z.ZodType<unknown>;
  run: (input: unknown, runId: string) => Promise<AgentCommandResult>;
};

const smokeInput = z.object({}).strict();

const commands: AgentCommand[] = [
  {
    id: 'system.build-info',
    category: 'System',
    description:
      'Returns the server build identifier for deployment freshness checks.',
    browserSteps: [],
    input: smokeInput,
    run: async () => ({
      checks: [
        {
          name: 'server build available',
          passed: Boolean(buildId),
          detail: buildId,
        },
      ],
    }),
  },
  {
    id: 'system.smoke',
    category: 'System',
    description:
      'Writes and reads a run-scoped Redis key, then records it for cleanup.',
    browserSteps: [
      'Confirm the Agent Console reports matching client and server builds.',
    ],
    input: smokeInput,
    run: async (_input, runId) => {
      const key = `agent:${runId}:smoke`;
      const value = `ok:${buildId}`;
      await redis.set(key, value);
      const actual = await redis.get(key);
      return {
        checks: [
          {
            name: 'Redis round trip',
            passed: actual === value,
            detail: actual ?? 'missing',
          },
        ],
        cleanupKeys: [key],
      };
    },
  },
  {
    id: 'redis.round-trip',
    category: 'Redis',
    description:
      'Exercises a namespaced hash without changing Kitchen Sink example data.',
    browserSteps: [],
    input: smokeInput,
    run: async (_input, runId) => {
      const key = `agent:${runId}:hash`;
      await redis.hSet(key, { runId, buildId });
      const value = await redis.hGetAll(key);
      return {
        checks: [
          {
            name: 'Redis hash round trip',
            passed: value.runId === runId && value.buildId === buildId,
          },
        ],
        cleanupKeys: [key],
      };
    },
  },
  {
    id: 'browser.two-user-realtime',
    category: 'Browser',
    description:
      'Provides the two-browser steps required to verify live Realtime delivery.',
    browserSteps: [
      'Open the fixture post in both authenticated browser sessions.',
      'Open the Realtime tab in each session and wait for both connections.',
      'Broadcast from the primary session and verify the secondary session displays the message.',
    ],
    input: smokeInput,
    run: async () => ({
      checks: [
        {
          name: 'browser interaction required',
          passed: true,
          detail:
            'Follow the returned browserSteps and attach the visible result to the run notes.',
        },
      ],
    }),
  },
];

const commandById = new Map(commands.map((command) => [command.id, command]));

export const listAgentCommands = () =>
  commands.map(({ id, category, description, browserSteps }) => ({
    id,
    category,
    description,
    browserSteps,
  }));

export const executeAgentCommand = async (
  commandId: string,
  input: unknown,
  runId: string
) => {
  const command = commandById.get(commandId);
  if (!command) throw new Error(`Unknown agent command: ${commandId}`);
  return await command.run(command.input.parse(input), runId);
};
