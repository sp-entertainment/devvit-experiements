import { showToast } from '@devvit/web/client';
import type { LogEntry, LogLevel } from '../shared/logs';

const maxClientLogs = 500;
const clientErrorToastDedupMs = 3_000;
const logs: LogEntry[] = [];
const listeners = new Set<() => void>();
const nativeDebug = console.debug.bind(console);

let installed = false;
let nextId = 0;
let hasUnclearedClientErrors = false;
let lastClientErrorToast: { message: string; timestamp: number } | undefined;

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

const notifyClientError = (reason: unknown, fallbackMessage: string): void => {
  const message =
    reason instanceof Error ? reason.message : String(reason || fallbackMessage);
  const timestamp = Date.now();
  if (
    lastClientErrorToast?.message === message &&
    timestamp - lastClientErrorToast.timestamp < clientErrorToastDedupMs
  )
    return;

  lastClientErrorToast = { message, timestamp };
  showToast(`Client error: ${message}`);
};

const pushClientLog = (level: LogLevel, parts: unknown[]) => {
  if (level === 'error') hasUnclearedClientErrors = true;
  logs.push({
    id: String(nextId),
    level,
    message: parts.map(formatPart).join(' '),
    source: 'client',
    timestamp: Date.now(),
  });
  nextId += 1;

  if (logs.length > maxClientLogs) logs.splice(0, logs.length - maxClientLogs);
  for (const listener of listeners) listener();
};

export const getClientLogs = (): LogEntry[] => [...logs];

export const clearClientLogs = (): void => {
  logs.length = 0;
  hasUnclearedClientErrors = false;
  for (const listener of listeners) listener();
};

export const hasUnclearedErrors = (): boolean => hasUnclearedClientErrors;

export const traceClientLog = (...parts: unknown[]): void => {
  pushClientLog('trace', parts);
  nativeDebug(...parts);
};

export const subscribeClientLogs = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const installClientLogCapture = () => {
  if (installed) return;
  installed = true;

  const debug = console.debug.bind(console);
  const log = console.log.bind(console);
  const info = console.info.bind(console);
  const warn = console.warn.bind(console);
  const error = console.error.bind(console);

  console.debug = (...args: unknown[]) => {
    pushClientLog('debug', args);
    debug(...args);
  };
  console.log = (...args: unknown[]) => {
    pushClientLog('log', args);
    log(...args);
  };
  console.info = (...args: unknown[]) => {
    pushClientLog('info', args);
    info(...args);
  };
  console.warn = (...args: unknown[]) => {
    pushClientLog('warn', args);
    warn(...args);
  };
  console.error = (...args: unknown[]) => {
    pushClientLog('error', args);
    error(...args);
  };

  window.addEventListener('error', (event) => {
    pushClientLog('error', [
      event.message,
      event.filename,
      event.lineno,
      event.colno,
      event.error,
    ]);
    notifyClientError(event.error, event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    pushClientLog('error', ['Unhandled promise rejection', event.reason]);
    notifyClientError(event.reason, 'Unhandled promise rejection');
  });
};

installClientLogCapture();
