# TypeScript in This Repository: a Go/C++ Developer's Guided Tour

This is not a general TypeScript course. Its purpose is to get you reading and
changing this Devvit application without being surprised by the language.

If you already know Go and C++, the important mental shift is this:

> TypeScript is JavaScript with a compile-time type checker. The types help you
> write the program, but JavaScript is what actually executes.

So a `type` declaration is neither a Go `struct` that exists at runtime nor a
C++ class definition. It is erased when the code is built. Runtime data from
Redis, HTTP, Reddit, and the browser must still be validated.

## 1. Orient yourself in the codebase

| Area         | Role                                                    | Good first file                                         |
| ------------ | ------------------------------------------------------- | ------------------------------------------------------- |
| `src/shared` | Data contracts and constants used by browser and server | [`tankGame.ts`](src/shared/tankGame.ts)                 |
| `src/server` | Node/Devvit handlers, Redis, validation, game rules     | [`routers/tankGame.ts`](src/server/routers/tankGame.ts) |
| `src/client` | Browser iframe, Phaser scenes, DOM UI, tRPC calls       | [`tankGameDemo.ts`](src/client/tankGameDemo.ts)         |
| `tools`      | Strict TypeScript configuration for each build target   | [`tsconfig.base.json`](tools/tsconfig.base.json)        |

The tank game is the clearest vertical slice:

```text
shared types/constants → server router + Redis → tRPC → browser/Phaser view
```

The server publishes `appRouter`; its type flows to the client so calls such as
`trpc.tankGame.snapshot.query()` are checked against the server router before
anything runs.

## 2. Shape types: the TypeScript equivalent of most structs

This repository uses `type` aliases rather than `interface`. For example,
[`TankPlayerState`](src/shared/tankGame.ts#L26-L34) describes an object shape:

```ts
export type TankPlayerState = {
  playerId: string;
  username: string;
  position: TankPoint;
  health: number;
};
```

The closest Go sketch is:

```go
type TankPlayerState struct {
    PlayerID string
    Username string
    Position TankPoint
    Health   float64 // TS has one `number` type for normal numbers
}
```

Important differences:

- TypeScript is **structural**. A value is assignable when it has the required
  compatible properties; it does not need to explicitly declare that it
  implements `TankPlayerState`.
- `string`, `number`, and `boolean` are JavaScript primitives. There is no
  built-in `int`, `float64`, or unsigned integer distinction.
- Plain objects are reference values. Copying an object variable copies a
  reference, not the object, unless code explicitly clones it.
- This type produces no runtime constructor, reflection data, or validation.

### Optional and nullable are different

[`TankGameState`](src/shared/tankGame.ts#L52-L62) uses `string | null` for a
field that always exists but may deliberately have no value:

```ts
activePlayerId: string | null;
```

An optional property uses `?`, as in
[`InputSpec`](src/client/kitchenSink/ui.ts#L7-L12):

```ts
type InputSpec = {
  type?: 'text' | 'number';
};
```

Reading `spec.type` yields `'text' | 'number' | undefined`. Under this
project's client configuration, `exactOptionalPropertyTypes` also means that
`{ type: undefined }` is not the same as omitting `type`. Think of `?` as a
field that might not be present, and `| null` as a deliberately present empty
field. The server target relaxes the exact-optional rule, so prefer following
the type you are editing rather than assuming all targets behave identically.

## 3. Unions: checked alternatives, not C++ inheritance

TypeScript's `|` means “one of these types.” String-literal unions are common
and behave like a closed string enum:

```ts
export type TankActionKind = 'move' | 'fire';
export type TankGamePhase = 'lobby' | 'playing' | 'finished';
```

Those values are checked by the compiler, but the union does not become a
runtime enum. Use it much like a Go named string type plus documented valid
constants, except TypeScript can preserve each individual literal through
control flow.

The more powerful pattern is a **discriminated union**. The `accepted` field in
[`TankActionResult`](src/shared/tankGame.ts#L72-L86) selects the available
properties:

```ts
type TankActionResult =
  | { accepted: true; resolvedAction: TankResolvedAction }
  | { accepted: false; reason: TankActionRejectionReason };

if (result.accepted) {
  result.resolvedAction; // valid here
} else {
  result.reason; // valid here
}
```

This resembles a tagged union / `std::variant` or a Go result struct with a
tag, but TypeScript **narrows** the union automatically after the test. Do not
access the other branch's property before narrowing.

## 4. Values, types, imports, and `typeof`

TypeScript has separate compile-time _type_ and runtime _value_ namespaces.
For example, [`tankGame.ts`](src/shared/tankGame.ts#L1-L4) exports a numeric
constant, then derives a type from its value:

```ts
export const TANK_GAME_STATE_VERSION = 1;

export type TankGameState = {
  schemaVersion: typeof TANK_GAME_STATE_VERSION; // exactly type `1`
};
```

In a type position, `typeof name` asks for the type of a value. Here it ensures
`schemaVersion` is the literal `1`, not any `number`.

Use `import type` when an import is only a compile-time dependency:

```ts
import type { AppRouter } from '../server/trpc';
```

That is what the tRPC client does in
[`src/client/trpc.ts`](src/client/trpc.ts#L1-L9). The import disappears from
the emitted browser code; importing a server value there would be a real
runtime boundary violation.

`export` exposes a runtime value, a type, or both. The named imports used in
this repository are the ESM equivalent of importing specific package members;
there is no C++ header/source separation.

## 5. Functions are values; arrows are the normal spelling

These are equivalent in intent:

```ts
function playerColor(index: number): string {
  return TANK_COLORS[index] ?? '#38bdf8';
}

const playerColor = (index: number): string => TANK_COLORS[index] ?? '#38bdf8';
```

The repository normally uses the arrow form for helpers and callbacks. A
function type is written with its parameter and return types:

```ts
type GetInputValue = (id: string) => string;
type OnClick = (event: MouseEvent) => Promise<unknown> | unknown;
```

The latter is from [`ExampleRowOptions`](src/client/kitchenSink/ui.ts#L19-L26).
It says a callback may return either an immediate value or a promise. Functions
are first-class JavaScript values, so passing callbacks is far more routine
than creating an interface solely for one method.

### Generic functions use angle brackets

[`mutateState`](src/server/routers/tankGame.ts#L170-L206) keeps the type of the
caller-specific result while handling common Redis transaction mechanics:

```ts
const mutateState = async <T>(
  postId: string,
  mutate: (state: TankGameState) => StateMutationDecision<T>
): Promise<StateMutationResult<T>> => {
  /* ... */
};
```

Read `<T>` as Go's `[T any]` or a C++ template parameter. Unlike C++ templates,
TypeScript generics do not generate specialized runtime code; they are checked
and erased. The caller normally gets `T` inferred, so it need not spell a type
argument.

The DOM helper [`el`](src/client/kitchenSink/ui.ts#L28-L35) shows a useful
advanced generic: the chosen HTML tag controls its exact return type.

```ts
const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K
): HTMLElementTagNameMap[K] => document.createElement(tag);
```

You can read `K extends ...` as “`K` is constrained to the keys of this map.”

## 6. Collections and safe lookup

| TypeScript                         | Meaning                 | Go/C++ instinct                                                     |
| ---------------------------------- | ----------------------- | ------------------------------------------------------------------- |
| `TankPlayerState[]`                | array of players        | `[]TankPlayerState` / `std::vector<TankPlayerState>`                |
| `new Map<string, TankView>()`      | keyed collection        | `map[string]TankView` / `std::unordered_map<std::string, TankView>` |
| `Record<string, HTMLInputElement>` | object with string keys | `map[string]HTMLInputElement`                                       |

`for (const player of players)` is the ordinary iteration form. Array methods
such as `.map`, `.find`, `.filter`, and `.some` take callbacks and are used
heavily.

This repo enables `noUncheckedIndexedAccess`. Therefore an indexed lookup can
be `undefined` even when its declared element type is not:

```ts
const player = players[index]; // TankPlayerState | undefined
if (!player) throw new Error('Cannot choose a turn without players');
return player.playerId;
```

That is the real pattern in
[`randomPlayerId`](src/server/routers/tankGame.ts#L139-L144). Treat it like a
map lookup's `ok` result in Go: prove it exists before use.

## 7. Narrowing, `unknown`, and the two “missing” operators

JavaScript can throw any value. With strict TypeScript, a caught value is
`unknown`, meaning you cannot read properties until you establish its shape.
The kitchen-sink helper uses a runtime type guard:

```ts
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
```

`typeof`, `instanceof`, equality comparisons, property-presence checks, and
discriminant tests narrow types. A type assertion (`value as SomeType`) does
not narrow or validate anything; it merely tells the compiler to trust you.
This repository's style rules prohibit casts, so write a check or change the
data flow instead.

Two operators make nullable values concise:

```ts
input.type ?? 'text'; // default only for null or undefined
inputEls[id]?.value ?? ''; // stop safely if inputEls[id] is absent
```

- `a?.b` is optional chaining. It evaluates to `undefined` rather than
  throwing if `a` is nullish.
- `a ?? fallback` chooses `fallback` only when `a` is `null` or `undefined`.
  Unlike `||`, it preserves legitimate `0`, `false`, and empty strings.

See the real lookup in [`ui.ts`](src/client/kitchenSink/ui.ts#L62-L87).

## 8. Updating objects: spread is a shallow copy

The server generally builds a new state object instead of mutating the old
one. In [`resetPlayer`](src/server/routers/tankGame.ts#L128-L137):

```ts
const resetPlayer = (player: TankPlayerState): TankPlayerState => ({
  ...player,
  health: TANK_STARTING_HEALTH,
});
```

`...player` copies the top-level enumerable properties; properties after it
replace copies with the same name. `[...state.players, player]` similarly makes
a new array. These are **shallow** copies: nested objects still share identity
unless they too are copied. That is the main caveat if you expect Go value-copy
or a deliberate C++ copy constructor.

## 9. `async` / `await` means `Promise`

An `async` function returns a `Promise<T>`, analogous to a future that will
eventually resolve to `T` or reject. `await` suspends only that async function;
it does not block the Node event loop or browser UI thread.

```ts
const snapshot = await trpc.tankGame.snapshot.query();
const result: Promise<TankSnapshot> = readSnapshot(postId);
```

Handle rejected promises with `try`/`catch`, as the client does around tRPC
calls. The `void` in code such as `void this.loadSnapshot()` means “start this
promise intentionally and discard its result.” It makes a fire-and-forget call
explicit; it does **not** make errors disappear, so the called async function
must handle expected failures.

`Promise.all([...])` starts independent work concurrently. See
[`getDevvitEventSnapshot`](src/server/core/devvitEvents.ts#L39-L58) for the
common form.

## 10. Classes are JavaScript classes plus checked members

Phaser uses classes, e.g. `TankGameScene extends Phaser.Scene` in
[`tankGameDemo.ts`](src/client/tankGameDemo.ts#L87-L159). Fields are ordinary
JavaScript object properties; TypeScript adds their declarations and checks
overrides:

```ts
class TankGameScene extends Phaser.Scene {
  state: TankGameState | undefined;
  endTurnText!: Phaser.GameObjects.Text;

  override update() {
    /* ... */
  }
}
```

`!` after a property name is a **definite-assignment assertion**. It tells the
compiler that Phaser setup (`create()` here) initializes the property before
any use. It does not initialize the value at runtime. Use it only where that
lifecycle guarantee is genuinely true. `override` is required by this repo's
configuration when replacing an inherited method.

## 11. Compile-time contracts versus runtime validation

Types do not make data from Redis trustworthy. The tank game reads JSON and
validates it with Zod before treating it as `TankGameState`:

```ts
const parseState = (raw: string | undefined): TankGameState =>
  raw ? tankStateSchema.parse(JSON.parse(raw)) : emptyState();
```

This is from [`tankGame.ts`](src/server/routers/tankGame.ts#L118-L119). Zod
schemas are runtime objects: `.parse()` checks the actual values and throws on
invalid input. The nearby `z.enum`, `z.number`, `z.object`, and `.nullable()`
calls encode the server's storage/input rules. Keep the TypeScript shared type
and the Zod runtime schema aligned when altering persisted data.

## 12. tRPC: the typed server/client seam

The server combines feature routers and exports the inferred top-level type:

```ts
export const appRouter = router({ tankGame: tankGameRouter /* ... */ });
export type AppRouter = typeof appRouter;
```

See [`src/server/routers/index.ts`](src/server/routers/index.ts#L17-L32). The
browser creates a generic client with that type:

```ts
export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: '/api/trpc' })],
});
```

The generic does not send a type schema over the network. It lets the compiler
derive the valid route names, input shapes, and output shapes from the server
code. For example:

```ts
await trpc.tankGame.snapshot.query();
await trpc.tankGame.join.mutate();
```

When adding an endpoint, define it in its server router, add that router to
`appRouter` if needed, then call the generated-looking client path. Let tRPC
infer the types—do not duplicate request/response interfaces on the client.

## 13. What the strict configuration changes

[`tools/tsconfig.base.json`](tools/tsconfig.base.json) enables `strict`,
`noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, and
`noImplicitOverride`, among other checks. The practical consequences are:

- Handle `undefined` after indexing, `.find()`, optional properties, and
  optional chaining.
- Do not leave unused imports, locals, or callback parameters.
- Type your public/shared boundaries; let local expressions infer when obvious.
- Do not silence errors with `as`, `any`, or non-null `!` assertions. Narrow
  the value or improve the type instead.

## 14. A safe editing loop

1. Start with `src/shared` to understand a feature's data contract.
2. Follow server router procedures to learn validation, authorization, and
   persistence behavior.
3. Follow the matching tRPC call from `src/client` to the UI/Phaser state.
4. Use `?.` and `??` only when absence is genuinely acceptable; otherwise
   guard and report an error.
5. Add runtime validation for untrusted external data; a TypeScript annotation
   alone is never validation.
6. Run the checker before considering a change complete:

   ```sh
   npm run type-check
   ```

For a fast syntax lookup while reading, use
[`TYPESCRIPT_REFERENCE.md`](TYPESCRIPT_REFERENCE.md).
