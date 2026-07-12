# Devvit Multiplayer/Redis Libraries: Survey & Recommendation

Follow-up research to `DEVVIT_GAME_CAPABILITIES.md`, focused on whether existing open-source libraries can shortcut multiplayer state-sync work on Devvit, or whether to hand-roll it.

## 1. Community Libraries Built On Devvit

| Library                                                          | What it does                                                                                                                                   | Verdict                                                                                                                                                                                                              |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[`devvit-state`](https://github.com/foreverest/devvit-state)** | Zod-typed, versioned JSON state with Redis transactions (`watch`/`multi`/`exec`) and Realtime broadcast + patch-log replay for missed messages | Solves a real gap (Realtime is lossy — can drop/dedupe/reorder), but pinned to a narrow `@devvit/web` version range (`>=0.12.0-0 <0.13.0`), single maintainer, 0 stars, released May 2026. **Not adopted** — see §3. |
| **[`devvit-phaser`](https://github.com/fizx/devvit-phaser)**     | `SyncedDataManager`/`DataManagerServer` — Phaser `DataManager` subclass synced via Redis + broadcasts                                          | Targets `@devvit/public-api` (legacy Blocks model), not `@devvit/web`. Would need porting. Not usable as-is.                                                                                                         |
| **[`devvit-hub`](https://github.com/fizx/devvit-hub)**           | `BasicGameServer` — auto pub-sub per post, synced timers, less server boilerplate                                                              | Stale (last push Dec 2024), also pre-dates current `@devvit/web` API.                                                                                                                                                |
| **[`@devvit/kit`](https://github.com/reddit/devvit-kit)**        | Official Reddit helper: UI components (columns, pagination), dev toolbar                                                                       | UI-only, not multiplayer-related, mostly Blocks-era.                                                                                                                                                                 |

**Ecosystem read:** thin, unofficial, low-adoption. No "standard" library has emerged yet — every real project (including Reddit's own template repos) just hand-writes a small Redis service class.

## 2. Generic Node.js Multiplayer Frameworks Don't Apply

Colyseus, Rivalis, Nakama, Asobi, etc. are excellent for _traditional_ multiplayer servers but **cannot run inside Devvit's backend**:

- Devvit's server is stateless serverless functions — no long-lived process to hold open raw WebSocket connections
- Devvit's Realtime is a proprietary pub/sub layer (1 MB/msg, 100 msg/s), not a raw socket
- Using one of these frameworks means hosting it **externally** (own VPS/Fly.io) and connecting from the client directly or via Devvit's permission-gated `fetch()` allowlist — which reintroduces the hosting cost/ops burden Devvit exists to remove

Only worth it if you need true low-latency socket ticks that Devvit categorically can't provide.

## 3. Why Mature Redis Wrapper Libraries Don't Port Over

Checked `refs/devvit/packages/redis/src/types/redis.ts` directly: `@devvit/redis` is a **closed RPC-proxied command set**, not a raw protocol connection:

- No host/port/connection string — nothing to hand a client library
- **No `EVAL`/`EVALSHA`** (no Lua scripting)
- No pipelining, no raw command passthrough/escape hatch
- `watch`/`multi`/`exec` exist, but only across the fixed ~30-command set Devvit exposes

This rules out nearly every popular Redis wrapper:

| Library                                      | Blocker                                               |
| -------------------------------------------- | ----------------------------------------------------- |
| BullMQ                                       | Job atomicity relies on Lua scripts (`defineCommand`) |
| Redis OM (official Redis Inc. object mapper) | Needs `FT.SEARCH`/RediSearch module                   |
| cache-manager / keyv-redis                   | Expects a raw client instance to wrap                 |
| RateLimiterRedis (rate-limiter-flexible)     | Requires `EVAL`/`EVALSHA` permissions                 |

Partial exception: `RateLimiterRedisNonAtomic` avoids Lua (plain get/set/incr) but still expects an ioredis-shaped client — would need a thin manual adapter, not a drop-in.

**Conclusion:** the mature Redis-wrapper ecosystem assumes raw protocol access that Devvit deliberately doesn't grant. Nothing "just works."

## 4. Decision: Build Thin, Don't Add a Wrapper-on-Wrapper

Reasoning:

- `@devvit/redis` is already an abstraction (RPC proxy) over real Redis. Stacking a second abstraction (`devvit-state`) on top adds a dependency with its own versioning, bugs, and bus factor (1 maintainer, 0 stars, ~2 months old) for a problem that's only a few hundred lines to solve directly.
- Devvit itself is a young, actively-changing platform. Every extra layer between your code and the platform is another thing that can silently break on a Devvit update, with no guarantee the third-party library gets patched in time.
- Owning the sync code means Devvit version bumps are "read the changelog and fix my 60 lines," not "wait on an external maintainer."
- **Zod** is the one dependency worth keeping — it has zero coupling to Devvit's APIs (pure JS object validation), is mature and widely used, and de-risks nothing by removing it.

### Minimal pattern to hand-roll (borrowing devvit-state's good ideas, not the dependency)

```typescript
// src/server/state/roomState.ts
import { redis, realtime } from '@devvit/web/server';
import { z } from 'zod';

const roomStateSchema = z.object({
  version: z.number(),
  title: z.string(),
  users: z.array(z.string()),
});
type RoomState = z.infer<typeof roomStateSchema>;

export async function mutateRoomState(
  postId: string,
  mutate: (draft: RoomState) => RoomState
) {
  const key = `room:${postId}`;
  const tx = await redis.watch(key);
  const raw = await redis.get(key);
  const current = raw ? roomStateSchema.parse(JSON.parse(raw)) : defaultState();

  const next = { ...mutate(current), version: current.version + 1 };

  await tx.multi();
  await tx.set(key, JSON.stringify(next));
  await tx.exec();

  await realtime.send(postId, next); // broadcast full snapshot — simplest option
  return next;
}
```

Key simplifications vs. `devvit-state`:

- **Broadcast full snapshots, not JSON patches** — most game state is well under a few KB, so the bandwidth problem patch-diffing solves usually doesn't apply. Client just replaces its local copy per message.
- **`version` field only guards against out-of-order/duplicate messages** — client ignores a message with a version ≤ what it already has.
- On reconnect / missed messages, client re-fetches the current snapshot via a normal tRPC/Hono route (no separate "replay update log" mechanism needed at this scale).

If a specific game later proves it needs true patch-diffing (large state, high-frequency updates), add it then, scoped to that game — not preemptively across the whole project.
