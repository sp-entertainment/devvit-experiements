# Codebase Index

Use this file to find working examples and repository-specific guidance. Start
with the task-oriented table, follow links into first-party code, and consult
`refs/` only when the app does not already demonstrate what you need.

## Start here

| Need                                                       | Read first                                                                                                  | Working implementation                                                                                                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Understand the whole system                                | [Architecture reference](ARCHITECTURE_REFERENCE.md)                                                         | [Server composition root](src/server/index.ts), [router composition](src/server/routers/index.ts), [expanded client shell](src/client/kitchenSink.ts) |
| Follow repository rules                                    | [AGENTS.md](AGENTS.md)                                                                                      | [Devvit config](devvit.json), [package scripts](package.json)                                                                                         |
| Add a browser-to-server operation                          | [tRPC setup](src/server/trpc.ts)                                                                            | [client](src/client/trpc.ts), [routers](src/server/routers/index.ts), [UI calls](src/client/kitchenSink/categories.ts)                                |
| Add a Devvit menu, form, trigger, job, or payment callback | [Devvit config](devvit.json)                                                                                | [fixed Hono routes](src/server/routes/)                                                                                                               |
| Use Reddit APIs                                            | [Reddit router](src/server/routers/reddit.ts)                                                               | [Reddit API UI examples](src/client/kitchenSink/categories.ts)                                                                                        |
| Use Redis or handle concurrent writes                      | [Redis router](src/server/routers/redis.ts)                                                                 | [transaction retry](src/server/redisTransactionRetry.ts), [retry tests](src/server/redisTransactionRetry.test.ts)                                     |
| Build realtime multiplayer                                 | [Movement architecture](CHARACTER_MOVEMENT_ARCHITECTURE.md)                                                 | [shared channel](src/client/realtimeChannel.ts), [realtime router](src/server/routers/realtime.ts), [shared messages](src/shared/realtime.ts)         |
| Choose a multiplayer approach                              | [Platform capability study](DEVVIT_GAME_CAPABILITIES.md), [library survey](DEVVIT_MULTIPLAYER_LIBRARIES.md) | [smooth movement](src/client/smoothMovementDemo.ts), [tank game](src/client/tankGameDemo.ts), [Pong](src/client/pongGame.ts)                          |
| Render with Phaser                                         | [Phaser bootstrap](src/client/phaserGame.ts)                                                                | [scenes](src/client/scenes/), [lighting demo](src/client/lightingHallwayDemo.ts)                                                                      |
| Understand this TypeScript                                 | [Guided tour](TYPESCRIPT_FOR_GO_AND_CPP_DEVELOPERS.md)                                                      | [quick reference](TYPESCRIPT_REFERENCE.md)                                                                                                            |
| Run deterministic checks                                   | [README commands](README.md#commands)                                                                       | [TypeScript projects](tools/), [unit tests](src/server/)                                                                                              |
| Validate a deployed build on Reddit                        | [README live-validation flow](README.md#agent-live-validation)                                              | [Agent Console](src/client/kitchenSink/agentConsole.ts), [agent router](src/server/routers/agent.ts), [build ID](tools/build-id.mjs)                  |
| Look up upstream Devvit behavior                           | [vendored docs](refs/devvit-docs/), [vendored SDK source](refs/devvit/)                                     | Search narrowly with `rg` inside `refs/`                                                                                                              |

## Architecture in one minute

- Reddit first loads the lightweight [inline splash](src/client/splash.html).
  [splash.ts](src/client/splash.ts) uses `requestExpandedMode` to open the named
  `game` entrypoint; it uses Devvit client navigation instead of
  `window.location`.
- [game.html](src/client/game.html) loads the expanded kitchen sink.
  [kitchenSink.ts](src/client/kitchenSink.ts) owns tab lifecycle and destroys
  inactive Phaser demos; [categories.ts](src/client/kitchenSink/categories.ts)
  contains the capability UI and its client calls.
- Browser operations use the typed [tRPC client](src/client/trpc.ts) at
  `/api/trpc`. [server/index.ts](src/server/index.ts) mounts the matching
  [server router](src/server/routers/index.ts) on Hono.
- Devvit-initiated callbacks use plain `/internal/*` Hono routes. Every callback
  must also be registered in [devvit.json](devvit.json).
- Secure authority lives in `src/server`; browser rendering and input live in
  `src/client`; platform-neutral contracts and deterministic logic live in
  `src/shared`.
- Redis is durable authority for multiplayer. Realtime sends notifications to
  connected clients; snapshot reads repair missed or stale messages.
- Server code derives user, post, and subreddit identity from request-scoped
  Devvit `context`. It does not trust browser-supplied identity.
- TypeScript checks compile-time contracts. Zod validates untrusted inputs and
  persisted JSON at runtime.

For diagrams, request paths, dependency roles, extension instructions, and
invariants, read [ARCHITECTURE_REFERENCE.md](ARCHITECTURE_REFERENCE.md).

## Experiments and examples

All kitchen-sink tabs are registered at the bottom of
[categories.ts](src/client/kitchenSink/categories.ts). That file demonstrates
the client API call and visible result for most server routers.

### Devvit and web APIs

| Example                    | Client                                                                                               | Server or configuration                                                                                                                                                                                 | What it demonstrates                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reddit API                 | [categories](src/client/kitchenSink/categories.ts)                                                   | [reddit router](src/server/routers/reddit.ts)                                                                                                                                                           | Current user/subreddit, listings, posts, comments, users, custom posts, comments, user actions, flair, post data, share URLs, wiki pages, and moderation reads |
| Redis                      | [categories](src/client/kitchenSink/categories.ts)                                                   | [redis router](src/server/routers/redis.ts)                                                                                                                                                             | Strings, hashes, sorted sets/leaderboards, expiry, optimistic transactions, global scope, and cleanup                                                          |
| Realtime basics            | [categories](src/client/kitchenSink/categories.ts), [channel wrapper](src/client/realtimeChannel.ts) | [realtime router](src/server/routers/realtime.ts)                                                                                                                                                       | Server publish, client subscription, per-post channels, snapshots, and local subscriber fan-out                                                                |
| Realtime load test         | [stress UI](src/client/realtimeStress.ts)                                                            | [stress router](src/server/routers/realtimeStress.ts), [runner](src/server/realtimeStressRunner.ts), [tests](src/server/realtimeStress.test.ts)                                                         | Two-client lobby, moderator start/reset, phased message rates, delivery/ordering metrics, and shared results                                                   |
| Media                      | [categories](src/client/kitchenSink/categories.ts)                                                   | [media router](src/server/routers/media.ts)                                                                                                                                                             | Upload an image from a server-fetched URL                                                                                                                      |
| Notifications              | [categories](src/client/kitchenSink/categories.ts)                                                   | [notifications router](src/server/routers/notifications.ts)                                                                                                                                             | Opt in/out/status, push enqueue, and game badge lifecycle                                                                                                      |
| Payments                   | [categories](src/client/kitchenSink/categories.ts)                                                   | [payments router](src/server/routers/payments.ts), [callbacks](src/server/routes/payments.ts), [rules](src/server/paymentRules.ts), [tests](src/server/paymentRules.test.ts), [products](products.json) | Product/order reads, client purchase effect, fulfillment/refund validation, idempotent ledger updates, entitlements, and wallet balance                        |
| Scheduler                  | [categories](src/client/kitchenSink/categories.ts)                                                   | [scheduler router](src/server/routers/scheduler.ts), [task callbacks](src/server/routes/scheduler.ts)                                                                                                   | Schedule, list, cancel, one-off reminder, and configured cron task                                                                                             |
| Settings                   | [categories](src/client/kitchenSink/categories.ts)                                                   | [settings router](src/server/routers/settings.ts), [configuration](devvit.json)                                                                                                                         | Reading a moderator-configured subreddit setting                                                                                                               |
| Cache                      | [categories](src/client/kitchenSink/categories.ts)                                                   | [cache router](src/server/routers/cache.ts)                                                                                                                                                             | Devvit `cache(fn, { key, ttl })` around an expensive operation                                                                                                 |
| Client effects             | [categories](src/client/kitchenSink/categories.ts), [splash](src/client/splash.ts)                   | —                                                                                                                                                                                                       | Toast, form, login prompt, share sheet/data, navigation, expanded mode, and exit expanded mode                                                                 |
| Hono                       | [categories](src/client/kitchenSink/categories.ts)                                                   | [Hono lab](src/server/routes/honoLab.ts)                                                                                                                                                                | Route/query/header parameters, JSON body validation, 404 handling, and error handling without tRPC                                                             |
| Menus and forms            | —                                                                                                    | [menu routes](src/server/routes/menu.ts), [form routes](src/server/routes/forms.ts), [configuration](devvit.json)                                                                                       | Subreddit/post/comment menu context, creating posts, opening forms, field types, and form submission responses                                                 |
| Triggers and event metrics | [categories](src/client/kitchenSink/categories.ts)                                                   | [trigger routes](src/server/routes/triggers.ts), [event recorder](src/server/core/devvitEvents.ts), [event router](src/server/routers/devvitEvents.ts)                                                  | App install and Reddit content/moderation triggers, counters, and last-event summaries                                                                         |
| Client/server logs         | [client capture](src/client/clientLogs.ts), [categories](src/client/kitchenSink/categories.ts)       | [server capture](src/server/core/serverLogs.ts), [logs router](src/server/routers/logs.ts), [shared types](src/shared/logs.ts)                                                                          | Capturing, displaying, limiting, clearing, and surfacing error state                                                                                           |
| Dashboard                  | [categories](src/client/kitchenSink/categories.ts)                                                   | Several routers                                                                                                                                                                                         | Aggregating multiple capability calls with `Promise.allSettled`                                                                                                |

### Phaser, state, and multiplayer

| Example                   | Main files                                                                                                                                                                                                                                                                                              | Reusable lesson                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conventional Phaser game  | [bootstrap](src/client/phaserGame.ts), [Boot](src/client/scenes/Boot.ts), [Preloader](src/client/scenes/Preloader.ts), [MainMenu](src/client/scenes/MainMenu.ts), [Game](src/client/scenes/Game.ts), [GameOver](src/client/scenes/GameOver.ts)                                                          | Scene lifecycle, preload, animation, input, camera, collision, game-over, and clean destruction                                                     |
| Phaser 4 lighting hallway | [demo](src/client/lightingHallwayDemo.ts), [textures and normal maps](public/assets/lighting-hallway/)                                                                                                                                                                                                  | WebGL lighting, normal maps, self-shadowing, tile sprites, tweens, and responsive scaling                                                           |
| Smooth movement           | [client](src/client/smoothMovementDemo.ts), [server](src/server/routers/realtime.ts), [contracts/math](src/shared/realtime.ts), [design guide](CHARACTER_MOVEMENT_ARCHITECTURE.md)                                                                                                                      | Send a movement command once, reconstruct motion from timestamps, keep the server authoritative, and reconcile snapshots                            |
| Shared canvas             | [client](src/client/sharedCanvasDemo.ts), [server](src/server/routers/realtime.ts), [contracts](src/shared/realtime.ts)                                                                                                                                                                                 | Pixel batches, text items, erasing, cursor broadcasts, Redis revisions, realtime updates, and snapshot recovery                                     |
| Turn-based tank game      | [client](src/client/tankGameDemo.ts), [router/state machine](src/server/routers/tankGame.ts), [pure rules](src/server/tankGameRules.ts), [contracts](src/shared/tankGame.ts), [rule tests](src/server/tankGameRules.test.ts)                                                                            | Two-player join/rematch, turn authority, geometry, animation timing, optimistic Redis writes, versioned update logs, realtime, and polling recovery |
| Authoritative Pong        | [client](src/client/pongGame.ts), [server synchronization](src/server/routers/pong.ts), [state machine/rules](src/shared/pong.ts), [render interpolation](src/shared/pongInterpolation.ts), [rule tests](src/server/pongGameRules.test.ts), [interpolation tests](src/server/pongInterpolation.test.ts) | Fixed-step server simulation, input leases, reconnect/forfeit windows, state versions, client interpolation/damping, and snapshots                  |
| Realtime stress harness   | [client](src/client/realtimeStress.ts), [router/lobby](src/server/routers/realtimeStress.ts), [send runner](src/server/realtimeStressRunner.ts), [shared metrics](src/shared/realtimeStress.ts), [tests](src/server/realtimeStress.test.ts)                                                             | Measure actual delivery rather than assuming transport behavior; requires two browser sessions                                                      |

The architectural conclusion behind these examples is documented in
[DEVVIT_GAME_CAPABILITIES.md](DEVVIT_GAME_CAPABILITIES.md): Devvit is strongest
for Reddit-native, asynchronous, turn-based, or modest-frequency multiplayer.
[DEVVIT_MULTIPLAYER_LIBRARIES.md](DEVVIT_MULTIPLAYER_LIBRARIES.md) records why
this project uses thin native Redis/realtime patterns instead of adding a
multiplayer framework or Redis wrapper.

## Complete first-party file map

### Root configuration and written knowledge

- [README.md](README.md) — purpose, setup, commands, and deployed validation.
- [AGENTS.md](AGENTS.md) — mandatory architecture, platform, style, logging, and
  live-validation rules for coding agents.
- [ARCHITECTURE_REFERENCE.md](ARCHITECTURE_REFERENCE.md) — definitive
  repository architecture and dependency guide.
- [CHARACTER_MOVEMENT_ARCHITECTURE.md](CHARACTER_MOVEMENT_ARCHITECTURE.md) —
  networked motion/event design on Devvit Realtime.
- [DEVVIT_GAME_CAPABILITIES.md](DEVVIT_GAME_CAPABILITIES.md) — platform limits,
  strengths, multiplayer models, and suitable genres.
- [DEVVIT_MULTIPLAYER_LIBRARIES.md](DEVVIT_MULTIPLAYER_LIBRARIES.md) — evaluated
  library options and the thin-native-pattern decision.
- [TYPESCRIPT_FOR_GO_AND_CPP_DEVELOPERS.md](TYPESCRIPT_FOR_GO_AND_CPP_DEVELOPERS.md)
  — guided TypeScript tour using this repository's code.
- [TYPESCRIPT_REFERENCE.md](TYPESCRIPT_REFERENCE.md) — compact TypeScript syntax
  and repository map.
- [package.json](package.json) / [package-lock.json](package-lock.json) — direct
  dependency choices, exact dependency graph, Node requirement, and commands.
- [devvit.json](devvit.json) — entrypoints, permissions, menus, forms, triggers,
  scheduler, payments, settings, build scripts, and playtest subreddit.
- [vite.config.ts](vite.config.ts) — Devvit Vite plugin and deterministic build-ID
  virtual module.
- [tsconfig.json](tsconfig.json) — TypeScript project-reference root.
- [eslint.config.js](eslint.config.js), [.prettierrc](.prettierrc),
  [.prettierignore](.prettierignore) — lint and formatting policy.
- [.gitignore](.gitignore), [.gitmodules](.gitmodules) — ignored local state and
  the two vendored reference submodules.
- [products.json](products.json) — payment product definitions.
- [LICENSE](LICENSE) — repository license.

### Client (`src/client`)

- [game.html](src/client/game.html), [game.css](src/client/game.css),
  [kitchenSink.ts](src/client/kitchenSink.ts) — expanded-view document, styling,
  category switching, cleanup, and build display.
- [splash.html](src/client/splash.html), [splash.css](src/client/splash.css),
  [splash.ts](src/client/splash.ts) — lightweight inline feed view and expansion.
- [trpc.ts](src/client/trpc.ts) — typed batch client for `/api/trpc`.
- [clientLogs.ts](src/client/clientLogs.ts) — browser console interception and
  observable in-memory log buffer.
- [kitchenSink/categories.ts](src/client/kitchenSink/categories.ts) — all
  capability tabs, inputs, calls, and output rendering.
- [kitchenSink/ui.ts](src/client/kitchenSink/ui.ts) — small DOM helpers and
  consistent async example-row behavior.
- [kitchenSink/agentConsole.ts](src/client/kitchenSink/agentConsole.ts) — live
  build readiness, registered check execution, run persistence, and cleanup UI.
- [realtimeChannel.ts](src/client/realtimeChannel.ts) — singleton post-channel
  connection with typed local fan-out.
- [phaserGame.ts](src/client/phaserGame.ts) and [scenes/](src/client/scenes/) —
  standard Phaser scene example.
- [lightingHallwayDemo.ts](src/client/lightingHallwayDemo.ts) — Phaser 4 lighting
  and normal-map example.
- [smoothMovementDemo.ts](src/client/smoothMovementDemo.ts) — timestamped
  multiplayer motion.
- [sharedCanvasDemo.ts](src/client/sharedCanvasDemo.ts) — collaborative canvas.
- [tankGameDemo.ts](src/client/tankGameDemo.ts) — turn-based multiplayer client.
- [pongGame.ts](src/client/pongGame.ts) — realtime Pong renderer/input client.
- [realtimeStress.ts](src/client/realtimeStress.ts) — two-client transport test.

### Server composition, shared helpers, and tests (`src/server`)

- [index.ts](src/server/index.ts) — Hono/tRPC/Devvit server composition root.
- [trpc.ts](src/server/trpc.ts) — public, authenticated, and moderator procedures.
- [core/post.ts](src/server/core/post.ts) — shared custom-post creation.
- [core/devvitEvents.ts](src/server/core/devvitEvents.ts) — trigger/menu metrics.
- [core/serverLogs.ts](src/server/core/serverLogs.ts) — persistent server log
  capture and retention.
- [redisTransactionRetry.ts](src/server/redisTransactionRetry.ts) /
  [test](src/server/redisTransactionRetry.test.ts) — bounded exponential backoff
  with jitter for hosted Redis transaction conflicts.
- [paymentRules.ts](src/server/paymentRules.ts) /
  [test](src/server/paymentRules.test.ts) — pure payment schemas, coin grants,
  idempotency comparisons, refunds, and entitlement rules.
- [tankGameRules.ts](src/server/tankGameRules.ts) /
  [test](src/server/tankGameRules.test.ts) — pure tank geometry and turn timing.
- [pongGameRules.test.ts](src/server/pongGameRules.test.ts) — extensive Pong state
  machine, collision, pause, reconnect, scoring, and rematch checks.
- [pongInterpolation.test.ts](src/server/pongInterpolation.test.ts) — client render
  interpolation and damping checks.
- [realtimeStressRunner.ts](src/server/realtimeStressRunner.ts) /
  [test](src/server/realtimeStress.test.ts) — deterministic scheduled realtime
  sends and statistics.
- [agent/commands.ts](src/server/agent/commands.ts) — allowlisted live smoke checks
  with cleanup metadata.
- [agent/run.ts](src/server/agent/run.ts) /
  [test](src/server/agentRun.test.ts) — validated Agent Console run state.

### Browser-callable tRPC routers (`src/server/routers`)

- [index.ts](src/server/routers/index.ts) — complete `AppRouter` composition.
- [reddit.ts](src/server/routers/reddit.ts) — Reddit reads, writes, user actions,
  flair, post data, wiki, and moderation.
- [redis.ts](src/server/routers/redis.ts) — Redis data structures, transactions,
  global scope, leaderboard, expiry, and cleanup.
- [realtime.ts](src/server/routers/realtime.ts) — cursor, movement-ball, and shared
  canvas state plus broadcasts.
- [realtimeStress.ts](src/server/routers/realtimeStress.ts) — test lobby,
  orchestration, result collection, and reset.
- [tankGame.ts](src/server/routers/tankGame.ts) — authoritative tank state,
  actions, snapshots, updates, and rematches.
- [pong.ts](src/server/routers/pong.ts) — authoritative Pong join/input/simulation,
  snapshots, leave/reconnect, and rematches.
- [media.ts](src/server/routers/media.ts),
  [notifications.ts](src/server/routers/notifications.ts),
  [payments.ts](src/server/routers/payments.ts),
  [scheduler.ts](src/server/routers/scheduler.ts),
  [settings.ts](src/server/routers/settings.ts), and
  [cache.ts](src/server/routers/cache.ts) — focused platform-capability examples.
- [devvitEvents.ts](src/server/routers/devvitEvents.ts) and
  [logs.ts](src/server/routers/logs.ts) — event and diagnostic read/control APIs.
- [agent.ts](src/server/routers/agent.ts) — live fixture/build/run coordination.

### Devvit callback and plain HTTP routes (`src/server/routes`)

- [menu.ts](src/server/routes/menu.ts) — subreddit/post/comment menu endpoints.
- [forms.ts](src/server/routes/forms.ts) — example and all-field form submissions.
- [triggers.ts](src/server/routes/triggers.ts) — registered lifecycle, content,
  report, and moderation triggers.
- [scheduler.ts](src/server/routes/scheduler.ts) — reminder and daily-reset jobs.
- [payments.ts](src/server/routes/payments.ts) — fulfillment and refund callbacks.
- [honoLab.ts](src/server/routes/honoLab.ts) — deliberately plain Hono examples.

### Shared contracts and deterministic logic (`src/shared`)

- [realtime.ts](src/shared/realtime.ts) — movement/shared-canvas state, keys,
  messages, constants, and interpolation helpers.
- [tankGame.ts](src/shared/tankGame.ts) — tank state/action/snapshot contracts and
  versioned Redis keys.
- [pong.ts](src/shared/pong.ts) — complete deterministic Pong state machine,
  constants, contracts, and key builder.
- [pongInterpolation.ts](src/shared/pongInterpolation.ts) — render-position
  interpolation, damping, and discontinuity handling.
- [realtimeStress.ts](src/shared/realtimeStress.ts) — phase schedule, messages,
  lobby/result contracts, and delivery statistics.
- [logs.ts](src/shared/logs.ts) — shared structured log types.
- [buildInfo.ts](src/shared/buildInfo.ts) and
  [virtual-agent-build-info.d.ts](src/shared/virtual-agent-build-info.d.ts) —
  typed access to the build fingerprint generated by Vite.

### Tooling and assets

- [agent-doctor.mjs](tools/agent-doctor.mjs),
  [agent-doctor-rules.mjs](tools/agent-doctor-rules.mjs), and
  [agent-doctor.test.mjs](tools/agent-doctor.test.mjs) — credential-file and Node
  preflight without logging secrets.
- [build-id.mjs](tools/build-id.mjs), [build-id.d.mts](tools/build-id.d.mts), and
  [build-id.test.mjs](tools/build-id.test.mjs) — deterministic hashing of deployed
  source/assets for client/server freshness checks.
- [tsconfig.base.json](tools/tsconfig.base.json),
  [tsconfig.client.json](tools/tsconfig.client.json),
  [tsconfig.server.json](tools/tsconfig.server.json),
  [tsconfig.shared.json](tools/tsconfig.shared.json), and
  [tsconfig.vite.json](tools/tsconfig.vite.json) — strict environment-specific
  TypeScript projects.
- [public/](public/) — deployed static assets. The lighting demo's diffuse and
  normal maps are in [public/assets/lighting-hallway/](public/assets/lighting-hallway/).

## Upstream reference corpus (`refs`)

These are Git submodules, not first-party application code:

- [refs/devvit-docs/](refs/devvit-docs/) is a local snapshot of Reddit's Devvit
  documentation. Start at its [README](refs/devvit-docs/README.md) or search for
  an API name with `rg -n "API_NAME" refs/devvit-docs`.
- [refs/devvit/](refs/devvit/) is the Devvit SDK/CLI monorepo source. Start at
  its [README](refs/devvit/README.md); inspect packages under
  [refs/devvit/packages/](refs/devvit/packages/) when docs do not explain actual
  behavior or types.

Do not import application code from `refs/`, and do not copy examples using
blocks or `@devvit/public-api`; this app is Devvit Web-only.

## Safe change recipes

- **New tRPC capability:** add the smallest procedure to an existing router (or
  one new router if it is a genuinely new domain), compose it in
  [routers/index.ts](src/server/routers/index.ts), then call it through the
  existing [client](src/client/trpc.ts). Use an authenticated/moderator procedure
  where required and validate external input with Zod.
- **New platform callback:** add the Hono handler under `src/server/routes`,
  mount it in [server/index.ts](src/server/index.ts) if it is a new route group,
  and add the exact endpoint mapping to [devvit.json](devvit.json).
- **New multiplayer state:** define neutral contracts and versioned keys in
  `src/shared`, validate and mutate on the server, persist to Redis before
  broadcasting, and give clients both realtime updates and snapshot recovery.
- **New client tab:** add its builder and registration to
  [categories.ts](src/client/kitchenSink/categories.ts); return cleanup when it
  creates listeners, timers, or a Phaser instance.
- **Before local handoff:** run `npm run agent:check`.
- **Before browser Playtest:** follow [AGENTS.md](AGENTS.md): run
  `npm run agent:doctor`, then `npm run agent:check`; use Desktop viewport,
  verify the expected build ID and visible `READY`, and use two separate browser
  sessions when the scenario requires two accounts.
