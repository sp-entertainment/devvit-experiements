import { randomUUID } from 'node:crypto';

import { redis } from '@devvit/web/server';
import { z } from 'zod';

import type { LogEntry, LogLevel } from '../../shared/logs';

const serverLogsKey = 'logs:server';
const serverLogLimitKey = 'logs:server-limit';
const defaultServerLogLimit = 500;
const minServerLogLimit = 1;
const maxServerLogLimit = 5000;
const serverLogsTtlSeconds = 24 * 60 * 60;

const logEntrySchema = z.object({
  id: z.string(),
  level: z.enum(['trace', 'debug', 'log', 'info', 'warn', 'error']),
  message: z.string(),
  source: z.literal('server'),
  timestamp: z.number(),
});

let installed = false;

const normalizeServerLogLimit = (value: number | string | undefined): number => {
  const limit = typeof value === 'number' ? value : Number(value);
  if (
    Number.isInteger(limit) &&
    limit >= minServerLogLimit &&
    limit <= maxServerLogLimit
  )
    return limit;
  return defaultServerLogLimit;
};

const formatPart = (part: unknown): string => {
  if (typeof part === 'string') return part;
  if (part instanceof Error) return part.stack ?? part.message;

  try {
    const json = JSON.stringify(part, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value
    );
    return json ?? String(part);
  } catch {
    return String(part);
  }
};

export const getServerLogLimit = async (): Promise<number> => {
  const stored = await redis.get(serverLogLimitKey);
  const limit = normalizeServerLogLimit(stored);
  if (stored !== String(limit)) await redis.set(serverLogLimitKey, String(limit));
  return limit;
};

const trimServerLogs = async (limit: number) => {
  const count = await redis.zCard(serverLogsKey);
  if (count > limit) await redis.zRemRangeByRank(serverLogsKey, 0, count - limit - 1);
  await redis.expire(serverLogsKey, serverLogsTtlSeconds);
};

export const setServerLogLimit = async (value: number): Promise<number> => {
  const limit = normalizeServerLogLimit(value);
  await redis.set(serverLogLimitKey, String(limit));
  await trimServerLogs(limit);
  return limit;
};

export const listServerLogs = async (): Promise<{
  limit: number;
  logs: LogEntry[];
}> => {
  const limit = await getServerLogLimit();
  const rows = await redis.zRange(serverLogsKey, 0, limit - 1, {
    by: 'rank',
    reverse: true,
  });
  const logs: LogEntry[] = [];

  for (const row of rows) {
    try {
      logs.push(logEntrySchema.parse(JSON.parse(row.member)));
    } catch {
      // Ignore malformed legacy/debug rows in this app-owned log key.
    }
  }

  return { limit, logs: logs.reverse() };
};

export const clearServerLogs = async (): Promise<void> => {
  await redis.del(serverLogsKey);
};

const writeServerLog = async (level: LogLevel, parts: unknown[]) => {
  const timestamp = Date.now();
  const entry: LogEntry = {
    id: randomUUID(),
    level,
    message: parts.map(formatPart).join(' '),
    source: 'server',
    timestamp,
  };
  const limit = await getServerLogLimit();
  await redis.zAdd(serverLogsKey, {
    member: JSON.stringify(entry),
    score: timestamp,
  });
  await trimServerLogs(limit);
};

const enqueueServerLog = (level: LogLevel, parts: unknown[]) => {
  void writeServerLog(level, parts).catch(() => undefined);
};

export const installServerLogCapture = () => {
  if (installed) return;
  installed = true;

  const debug = console.debug.bind(console);
  const log = console.log.bind(console);
  const info = console.info.bind(console);
  const warn = console.warn.bind(console);
  const error = console.error.bind(console);

  console.debug = (...args: unknown[]) => {
    debug(...args);
    enqueueServerLog('debug', args);
  };
  console.log = (...args: unknown[]) => {
    log(...args);
    enqueueServerLog('log', args);
  };
  console.info = (...args: unknown[]) => {
    info(...args);
    enqueueServerLog('info', args);
  };
  console.warn = (...args: unknown[]) => {
    warn(...args);
    enqueueServerLog('warn', args);
  };
  console.error = (...args: unknown[]) => {
    error(...args);
    enqueueServerLog('error', args);
  };
};
