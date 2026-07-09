export type LogLevel = 'debug' | 'log' | 'info' | 'warn' | 'error';

export type LogEntry = {
  id: string;
  level: LogLevel;
  message: string;
  source: 'client' | 'server';
  timestamp: number;
};
