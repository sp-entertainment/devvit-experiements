import { redis } from '@devvit/web/server';

export const triggerKinds = [
  'CommentCreate',
  'PostSubmit',
  'CommentSubmit',
  'PostReport',
  'ModAction',
] as const;

export const menuKinds = ['post', 'comment'] as const;

export type TriggerKind = (typeof triggerKinds)[number];
export type MenuKind = (typeof menuKinds)[number];

type Summary = Record<string, string>;

const triggerCountKey = (kind: TriggerKind) => `devvit-events:trigger:${kind}`;
const triggerLastKey = (kind: TriggerKind) => `devvit-events:last-trigger:${kind}`;
const menuCountKey = (kind: MenuKind) => `devvit-events:menu:${kind}`;
const menuLastKey = (kind: MenuKind) => `devvit-events:last-menu:${kind}`;

const withTimestamp = (summary: Summary) => ({
  ...summary,
  seenAt: new Date().toISOString(),
});

const numberFromRedis = (value: string | null | undefined) =>
  value ? Number(value) : 0;

export const recordTrigger = async (kind: TriggerKind, summary: Summary) => {
  await Promise.all([
    redis.incrBy(triggerCountKey(kind), 1),
    redis.hSet(triggerLastKey(kind), withTimestamp(summary)),
  ]);
};

export const recordMenu = async (kind: MenuKind, summary: Summary) => {
  await Promise.all([
    redis.incrBy(menuCountKey(kind), 1),
    redis.hSet(menuLastKey(kind), withTimestamp(summary)),
  ]);
};

export const getDevvitEventSnapshot = async () => {
  const triggers = await Promise.all(
    triggerKinds.map(async (kind) => ({
      kind,
      count: numberFromRedis(await redis.get(triggerCountKey(kind))),
      last: await redis.hGetAll(triggerLastKey(kind)),
    }))
  );
  const menus = await Promise.all(
    menuKinds.map(async (kind) => ({
      kind,
      count: numberFromRedis(await redis.get(menuCountKey(kind))),
      last: await redis.hGetAll(menuLastKey(kind)),
    }))
  );

  return { triggers, menus };
};
