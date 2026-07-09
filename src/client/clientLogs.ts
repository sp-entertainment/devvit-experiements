import type { LogEntry, LogLevel } from '../shared/logs';

const maxClientLogs = 500;
const logs: LogEntry[] = [];
const listeners = new Set<() => void>();

let installed = false;
let nextId = 0;

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

const pushClientLog = (level: LogLevel, parts: unknown[]) => {
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
  });
  window.addEventListener('unhandledrejection', (event) => {
    pushClientLog('error', ['Unhandled promise rejection', event.reason]);
  });
};

installClientLogCapture();
