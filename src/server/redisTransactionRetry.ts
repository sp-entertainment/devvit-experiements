const HOSTED_TRANSACTION_FAILURE_MESSAGE = 'redis: transaction failed';

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 5;
const DEFAULT_MAX_DELAY_MS = 100;

type Sleep = (delayMs: number) => Promise<void>;
type Random = () => number;

export type RedisTransactionRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: Sleep;
  random?: Random;
};

export type RedisTransactionOperation<T> = (attempt: number) => Promise<T>;

class RedisTransactionConflictError extends Error {
  public constructor() {
    super('Redis transaction conflicted');
    this.name = 'RedisTransactionConflictError';
  }
}

const defaultSleep: Sleep = async (delayMs) => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
};

const validatePositiveInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError(`${name} must be a positive integer`);
};

const validateDelay = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`${name} must be a finite non-negative number`);
};

const randomUnit = (random: Random): number => {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new RangeError('random must return a number between 0 and 1');
  return value;
};

const retryDelayMs = (
  retryIndex: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: Random
): number => {
  const exponentialLimit = Math.min(maxDelayMs, baseDelayMs * 2 ** retryIndex);
  if (exponentialLimit === 0) return 0;
  return Math.max(1, Math.ceil(exponentialLimit * randomUnit(random)));
};

export const redisTransactionConflictError = (): Error =>
  new RedisTransactionConflictError();

export const isRedisTransactionConflict = (error: unknown): boolean => {
  if (error instanceof RedisTransactionConflictError) return true;
  if (typeof error !== 'object' || error === null || !('message' in error))
    return false;
  return (
    typeof error.message === 'string' &&
    error.message.endsWith(HOSTED_TRANSACTION_FAILURE_MESSAGE)
  );
};

export const retryRedisTransaction = async <T>(
  operation: RedisTransactionOperation<T>,
  options: RedisTransactionRetryOptions = {}
): Promise<T> => {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  validatePositiveInteger(maxAttempts, 'maxAttempts');
  validateDelay(baseDelayMs, 'baseDelayMs');
  validateDelay(maxDelayMs, 'maxDelayMs');

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (!isRedisTransactionConflict(error) || attempt === maxAttempts)
        throw error;

      await sleep(retryDelayMs(attempt - 1, baseDelayMs, maxDelayMs, random));
    }
  }

  throw new Error('Redis transaction retry loop ended unexpectedly');
};
