import { randomUUID } from 'node:crypto';
import { context, realtime, redis } from '@devvit/web/server';
import { z } from 'zod';
import {
  TANK_COLORS,
  TANK_GAME_STATE_VERSION,
  TANK_ROTATE_DURATION_MS,
  TANK_STARTING_HEALTH,
  TANK_WORLD_HEIGHT,
  TANK_WORLD_MARGIN,
  TANK_WORLD_WIDTH,
  tankGameKey,
  type RealtimeTankGameMessage,
  type TankActionRejectionReason,
  type TankActionResult,
  type TankGameState,
  type TankJoinResult,
  type TankPlayerState,
  type TankPoint,
  type TankRematchResult,
  type TankResolvedAction,
  type TankSnapshot,
} from '../../shared/tankGame';
import {
  actionTravelDuration,
  actionTurnReadyAt,
  firstProjectileHit,
  movementPathIsBlocked,
  nextLivingPlayerId,
  tankDistance,
  tankFacing,
} from '../tankGameRules';
import { publicProcedure, router } from '../trpc';

const tankPointSchema = z.object({
  x: z
    .number()
    .min(TANK_WORLD_MARGIN)
    .max(TANK_WORLD_WIDTH - TANK_WORLD_MARGIN),
  y: z
    .number()
    .min(TANK_WORLD_MARGIN)
    .max(TANK_WORLD_HEIGHT - TANK_WORLD_MARGIN),
});

const tankTargetSchema = z.object({
  x: z.number().min(0).max(TANK_WORLD_WIDTH),
  y: z.number().min(0).max(TANK_WORLD_HEIGHT),
});

const tankPlayerSchema = z.object({
  playerId: z.string(),
  username: z.string(),
  color: z.string(),
  position: tankPointSchema,
  facing: z.number(),
  health: z.number().int().min(0).max(TANK_STARTING_HEALTH),
  joinedAt: z.number().int(),
});

const tankActionSchema = z.object({
  actionId: z.string(),
  kind: z.enum(['move', 'fire']),
  actorId: z.string(),
  from: tankPointSchema,
  target: tankPointSchema,
  end: tankPointSchema,
  fromFacing: z.number(),
  facing: z.number(),
  startedAt: z.number().int(),
  rotateDurationMs: z.number().int().min(0),
  travelDurationMs: z.number().int().min(0),
  hitPlayerId: z.string().nullable(),
  hitHealth: z.number().int().min(0).max(TANK_STARTING_HEALTH).nullable(),
});

const tankStateSchema = z.object({
  schemaVersion: z.literal(TANK_GAME_STATE_VERSION),
  version: z.number().int().min(0),
  phase: z.enum(['lobby', 'playing', 'finished']),
  players: z.array(tankPlayerSchema).max(2),
  turnOrder: z.array(z.string()).max(2),
  activePlayerId: z.string().nullable(),
  winnerPlayerId: z.string().nullable(),
  turnReadyAt: z.number().int(),
  lastAction: tankActionSchema.nullable(),
});

const actionInputSchema = z.object({
  action: z.enum(['move', 'fire']),
  target: tankTargetSchema,
});

const requirePostId = () => {
  if (!context.postId)
    throw new Error('postId is required but missing from context');
  return context.postId;
};

const requireUser = () => {
  if (!context.userId || !context.username)
    throw new Error('Must be logged in');
  return { playerId: context.userId, username: context.username };
};

const emptyState = (): TankGameState => ({
  schemaVersion: TANK_GAME_STATE_VERSION,
  version: 0,
  phase: 'lobby',
  players: [],
  turnOrder: [],
  activePlayerId: null,
  winnerPlayerId: null,
  turnReadyAt: 0,
  lastAction: null,
});

const parseState = (raw: string | undefined): TankGameState =>
  raw ? tankStateSchema.parse(JSON.parse(raw)) : emptyState();

const spawnPoint = (index: number): TankPoint => ({
  x: index === 0 ? 160 : TANK_WORLD_WIDTH - 160,
  y: TANK_WORLD_HEIGHT / 2,
});

const playerColor = (index: number): string => TANK_COLORS[index] ?? '#38bdf8';

const resetPlayer = (
  player: TankPlayerState,
  index: number
): TankPlayerState => ({
  ...player,
  color: playerColor(index),
  position: spawnPoint(index),
  facing: index === 0 ? 0 : Math.PI,
  health: TANK_STARTING_HEALTH,
});

const randomPlayerId = (players: TankPlayerState[]): string => {
  const index = Math.floor(Math.random() * players.length);
  const player = players[index];
  if (!player) throw new Error('Cannot choose a turn without players');
  return player.playerId;
};

type StateMutationDecision<T> = {
  changed: boolean;
  state: TankGameState;
  value: T;
};

type StateMutationResult<T> = {
  state: TankGameState;
  value: T;
};

const broadcastState = async (postId: string, state: TankGameState) => {
  const message: RealtimeTankGameMessage = {
    type: 'tankGameState',
    state,
    sentAt: Date.now(),
  };
  await realtime
    .send<RealtimeTankGameMessage>(postId, message)
    .catch((error) => {
      console.error('Failed to broadcast tank game state:', error);
    });
};

const mutateState = async <T>(
  postId: string,
  mutate: (state: TankGameState) => StateMutationDecision<T>
): Promise<StateMutationResult<T>> => {
  const key = tankGameKey(postId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const transaction = await redis.watch(key);
    const current = parseState(await redis.get(key));
    let decision: StateMutationDecision<T>;

    try {
      decision = mutate(current);
    } catch (error) {
      await transaction.unwatch();
      throw error;
    }

    if (!decision.changed) {
      await transaction.unwatch();
      return { state: current, value: decision.value };
    }

    const next: TankGameState = {
      ...decision.state,
      version: current.version + 1,
    };
    await transaction.multi();
    await transaction.set(key, JSON.stringify(next));
    const result = await transaction.exec();
    if (result.length > 0) {
      await broadcastState(postId, next);
      return { state: next, value: decision.value };
    }
  }

  throw new Error('Tank game state conflicted; retry');
};

const readSnapshot = async (postId: string): Promise<TankSnapshot> => ({
  state: parseState(await redis.get(tankGameKey(postId))),
  selfPlayerId: context.userId ?? null,
  serverNow: Date.now(),
});

type ActionDecision =
  | { accepted: true; resolvedAction: TankResolvedAction }
  | { accepted: false; reason: TankActionRejectionReason };

const rejectAction = (
  state: TankGameState,
  reason: TankActionRejectionReason
): StateMutationDecision<ActionDecision> => ({
  changed: false,
  state,
  value: { accepted: false, reason },
});

export const tankGameRouter = router({
  snapshot: publicProcedure.query(
    async (): Promise<TankSnapshot> => readSnapshot(requirePostId())
  ),

  join: publicProcedure.mutation(async (): Promise<TankJoinResult> => {
    const postId = requirePostId();
    const { playerId, username } = requireUser();
    const now = Date.now();
    const result = await mutateState<{ joined: boolean; started: boolean }>(
      postId,
      (state) => {
        const existing = state.players.find(
          (player) => player.playerId === playerId
        );
        if (existing) {
          if (existing.username === username) {
            return {
              changed: false,
              state,
              value: { joined: true, started: false },
            };
          }

          return {
            changed: true,
            state: {
              ...state,
              players: state.players.map((player) =>
                player.playerId === playerId ? { ...player, username } : player
              ),
            },
            value: { joined: true, started: false },
          };
        }

        if (state.phase !== 'lobby' || state.players.length >= 2) {
          return {
            changed: false,
            state,
            value: { joined: false, started: false },
          };
        }

        const index = state.players.length;
        const player: TankPlayerState = {
          playerId,
          username,
          color: playerColor(index),
          position: spawnPoint(index),
          facing: index === 0 ? 0 : Math.PI,
          health: TANK_STARTING_HEALTH,
          joinedAt: now,
        };
        const players = [...state.players, player];

        if (players.length < 2) {
          return {
            changed: true,
            state: {
              ...state,
              players,
              turnOrder: players.map((joinedPlayer) => joinedPlayer.playerId),
            },
            value: { joined: true, started: false },
          };
        }

        const resetPlayers = players.map(resetPlayer);
        const activePlayerId = randomPlayerId(resetPlayers);
        return {
          changed: true,
          state: {
            ...state,
            phase: 'playing',
            players: resetPlayers,
            turnOrder: resetPlayers.map(
              (joinedPlayer) => joinedPlayer.playerId
            ),
            activePlayerId,
            winnerPlayerId: null,
            turnReadyAt: now,
            lastAction: null,
          },
          value: { joined: true, started: true },
        };
      }
    );

    if (result.value.started) {
      console.info('Tank game started:', postId, result.state.activePlayerId);
    }

    return {
      state: result.state,
      selfPlayerId: playerId,
      serverNow: Date.now(),
      joined: result.value.joined,
    };
  }),

  act: publicProcedure
    .input(actionInputSchema)
    .mutation(async ({ input }): Promise<TankActionResult> => {
      const postId = requirePostId();
      const { playerId } = requireUser();
      const now = Date.now();
      const target = {
        x: Math.round(input.target.x),
        y: Math.round(input.target.y),
      };
      const result = await mutateState<ActionDecision>(postId, (state) => {
        if (state.phase !== 'playing')
          return rejectAction(state, 'not-playing');
        const actor = state.players.find(
          (player) => player.playerId === playerId
        );
        if (!actor || actor.health <= 0)
          return rejectAction(state, 'not-player');
        if (state.activePlayerId !== playerId)
          return rejectAction(state, 'not-your-turn');
        if (now < state.turnReadyAt)
          return rejectAction(state, 'action-resolving');
        if (
          target.x < TANK_WORLD_MARGIN ||
          target.x > TANK_WORLD_WIDTH - TANK_WORLD_MARGIN ||
          target.y < TANK_WORLD_MARGIN ||
          target.y > TANK_WORLD_HEIGHT - TANK_WORLD_MARGIN
        ) {
          return rejectAction(state, 'invalid-target');
        }
        if (tankDistance(actor.position, target) < 1)
          return rejectAction(state, 'invalid-target');

        const facing = tankFacing(actor.position, target);
        if (
          input.action === 'move' &&
          movementPathIsBlocked(
            actor.position,
            target,
            state.players,
            actor.playerId
          )
        ) {
          return rejectAction(state, 'path-blocked');
        }

        const hit =
          input.action === 'fire'
            ? firstProjectileHit(
                actor.position,
                target,
                state.players,
                actor.playerId
              )
            : undefined;
        const end = hit?.point ?? target;
        const travelDurationMs = actionTravelDuration(
          input.action,
          actor.position,
          end
        );
        const players = state.players.map((player) => {
          if (player.playerId === actor.playerId) {
            return {
              ...player,
              position: input.action === 'move' ? target : player.position,
              facing,
            };
          }
          if (player.playerId === hit?.playerId) {
            return { ...player, health: Math.max(0, player.health - 1) };
          }
          return player;
        });
        const hitPlayer = hit
          ? players.find((player) => player.playerId === hit.playerId)
          : undefined;
        const livingPlayers = players.filter((player) => player.health > 0);
        const finished = livingPlayers.length === 1;
        const winnerPlayerId = finished
          ? (livingPlayers[0]?.playerId ?? null)
          : null;
        const activePlayerId = finished
          ? null
          : (nextLivingPlayerId(state.turnOrder, players, actor.playerId) ??
            null);
        const resolvedAction: TankResolvedAction = {
          actionId: randomUUID(),
          kind: input.action,
          actorId: actor.playerId,
          from: actor.position,
          target,
          end,
          fromFacing: actor.facing,
          facing,
          startedAt: now,
          rotateDurationMs: TANK_ROTATE_DURATION_MS,
          travelDurationMs,
          hitPlayerId: hit?.playerId ?? null,
          hitHealth: hitPlayer?.health ?? null,
        };

        return {
          changed: true,
          state: {
            ...state,
            phase: finished ? 'finished' : 'playing',
            players,
            activePlayerId,
            winnerPlayerId,
            turnReadyAt: actionTurnReadyAt(now, travelDurationMs),
            lastAction: resolvedAction,
          },
          value: { accepted: true, resolvedAction },
        };
      });
      const serverNow = Date.now();

      if (!result.value.accepted) {
        console.debug('Tank action rejected:', result.value.reason, playerId);
        return {
          accepted: false,
          reason: result.value.reason,
          state: result.state,
          serverNow,
        };
      }

      if (result.state.winnerPlayerId) {
        console.info(
          'Tank game finished:',
          postId,
          result.state.winnerPlayerId
        );
      }

      return {
        accepted: true,
        state: result.state,
        resolvedAction: result.value.resolvedAction,
        serverNow,
      };
    }),

  rematch: publicProcedure.mutation(async (): Promise<TankRematchResult> => {
    const postId = requirePostId();
    const { playerId } = requireUser();
    const now = Date.now();
    const result = await mutateState<{ accepted: boolean }>(postId, (state) => {
      const isPlayer = state.players.some(
        (player) => player.playerId === playerId
      );
      if (!isPlayer || state.phase !== 'finished' || now < state.turnReadyAt) {
        return { changed: false, state, value: { accepted: false } };
      }

      const players = state.players.map(resetPlayer);
      const activePlayerId = randomPlayerId(players);
      return {
        changed: true,
        state: {
          ...state,
          phase: 'playing',
          players,
          turnOrder: players.map((player) => player.playerId),
          activePlayerId,
          winnerPlayerId: null,
          turnReadyAt: now,
          lastAction: null,
        },
        value: { accepted: true },
      };
    });

    if (result.value.accepted) {
      console.info(
        'Tank game rematch started:',
        postId,
        result.state.activePlayerId
      );
    }

    return {
      state: result.state,
      selfPlayerId: playerId,
      serverNow: Date.now(),
      accepted: result.value.accepted,
    };
  }),
});
