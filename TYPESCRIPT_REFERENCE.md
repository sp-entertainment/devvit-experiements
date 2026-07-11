# TypeScript Reference for This Repository

Dense lookup for a Go/C++ developer. Types are checked at build time and
erased; JavaScript values are what run.

## Type syntax

| Syntax | Meaning | Go/C++ analogue |
| --- | --- | --- |
| `const n: number = 1` | annotated value | `const double n = 1` (one normal numeric type) |
| `type User = { id: string }` | named structural object shape; no runtime value | named `struct`, but erased and structural |
| `type ID = string` | alias, not a new runtime or nominal type | `using ID = std::string` / alias, but assignability is structural |
| `T[]` | mutable JavaScript array | `[]T` / `std::vector<T>` |
| `Array<T>` | same as `T[]` | `std::vector<T>` |
| `Record<string, T>` | object with string keys and `T` values | `map[string]T` / `unordered_map<string, T>` |
| `Map<K, V>` | runtime keyed collection | `map[K]V` / `std::unordered_map<K, V>` |
| `A \| B` | union: one of several types | tagged union / `std::variant` |
| `'move' \| 'fire'` | closed set of string literals | string enum / named constants |
| `T & U` | value must have both shapes | composition / intersection |
| `T \| null` | present field may be intentionally empty | pointer/optional that explicitly permits `null` |
| `field?: T` | field may be absent; read as `T \| undefined` | optional map/object field |
| `unknown` | value exists but cannot be used before narrowing | `any` payload that must be checked first |
| `any` | disables type checking | avoid; not used as an escape hatch here |
| `typeof value` in a type | type of a runtime value | compile-time reflection-like query |
| `(typeof values)[number]` | union of an array's element literals | derive enum-like type from constants |
| `as const` | retain exact literals and readonly tuple-ish shape | immutable constant table |

The repository prefers aliases, e.g.
[`TankGameState`](src/shared/tankGame.ts#L52-L62), rather than `interface`.

## Functions, generics, and modules

| Syntax | Meaning | Go/C++ analogue |
| --- | --- | --- |
| `(x: T): U => expr` | arrow function | lambda / function literal |
| `type F = (x: T) => U` | function type | function signature / `std::function<U(T)>` |
| `async (): Promise<T> =>` | asynchronous function returning eventual `T` | future-returning function |
| `await promise` | get resolved value; throws on rejection | await a future, without blocking JS event loop |
| `<T>` | generic parameter | `[T any]` / template parameter |
| `<T extends U>` | generic constrained to `U`'s shape | constrained generic / concept-like bound |
| `Promise<T> \| T` | callback can be sync or async | `T` or future-like `T` |
| `import { x } from 'pkg'` | import runtime named value | package/header member import |
| `import type { T } from 'pkg'` | compile-time-only import | type-only declaration dependency |
| `export const x` | publish runtime value | exported symbol |
| `export type T` | publish compile-time type | exported declaration only |

Example generic from
[`mutateState`](src/server/routers/tankGame.ts#L170-L173):

```ts
const mutateState = async <T>(/* ... */): Promise<StateMutationResult<T>> =>
  /* ... */;
```

Generics are checked then erased—unlike C++ template specialization, they do not
produce different runtime code.

## Narrowing and absence

| Expression | Result / rule | Why it matters here |
| --- | --- | --- |
| `if (value)` | excludes falsy values (`0`, `''`, `false`, `null`, `undefined`) | concise but too broad when zero/empty is valid |
| `if (value !== undefined)` | excludes only `undefined` | exact check for optional lookup |
| `typeof value === 'string'` | narrows `unknown`/union to `string` | safe parsing and error formatting |
| `value instanceof Error` | narrows to `Error` | catches are `unknown`; see [`errorMessage`](src/client/kitchenSink/ui.ts#L47-L48) |
| `if (result.accepted)` | picks a discriminated-union branch | permits `resolvedAction` vs `reason` safely |
| `obj?.field` | `undefined` if `obj` is nullish | optional chaining; does not catch other errors |
| `a ?? fallback` | fallback only for `null`/`undefined` | preserves `0`, `false`, `''` |
| `a \|\| fallback` | fallback for any falsy value | use only when that is intended |
| `array[i]` | `T \| undefined` in this repo | `noUncheckedIndexedAccess` is enabled |
| `array.find(...)` | `T \| undefined` | guard before accessing fields |

```ts
const getValue = (id: string) => inputEls[id]?.value ?? '';
```

This combines an uncertain record lookup, optional chaining, and a nullish
default. It is used in
[`src/client/kitchenSink/ui.ts`](src/client/kitchenSink/ui.ts#L62-L87).

## Objects, arrays, and classes

| Syntax | Meaning | Caveat |
| --- | --- | --- |
| `{ ...player, health: 3 }` | copy top-level properties, then replace `health` | shallow copy; nested objects are shared |
| `[...players, player]` | new array containing prior elements plus one | elements themselves are not copied |
| `const { count } = result` | destructure property | equivalent to `const count = result.count` |
| `for (const x of xs)` | iterate values | closest to Go `for _, x := range xs` |
| `xs.map(f)` / `.filter(f)` / `.find(f)` | transform/select/find with callbacks | `.find` can return `undefined` |
| `class X extends Y` | JavaScript inheritance with type checking | no header/source split |
| `field!: T` | tell compiler lifecycle initializes field | does nothing at runtime; use sparingly |
| `override method()` | explicitly override base member | required by this repo config |

The state-update form is used by
[`resetPlayer`](src/server/routers/tankGame.ts#L128-L137) and transaction code.

## Runtime versus compile time

| Tool | Exists at runtime? | Use it for |
| --- | --- | --- |
| `type`, generic parameter, `import type` | No | editor help, compilation, safe refactors |
| TypeScript annotation `value: T` | No | communicating and checking intended shape |
| `as T` assertion | No | tells compiler to trust you; avoid in this repo |
| `z.object(...)`, `z.enum(...)`, `.parse()` | Yes | validating JSON, request data, Redis data |
| `typeof`, `instanceof`, `Array.isArray` | Yes | narrowing/validating actual values |

`parseState` validates Redis JSON with Zod before returning a typed state:

```ts
const parseState = (raw: string | undefined): TankGameState =>
  raw ? tankStateSchema.parse(JSON.parse(raw)) : emptyState();
```

See [`src/server/routers/tankGame.ts`](src/server/routers/tankGame.ts#L118-L119).
Never mistake a type annotation for validation of external data.

## This repository: fast map

| Need | Start here |
| --- | --- |
| shared game state / message contract | [`src/shared/tankGame.ts`](src/shared/tankGame.ts) |
| authoritative game rules | [`src/server/tankGameRules.ts`](src/server/tankGameRules.ts) |
| server validation, Redis mutation, tRPC procedures | [`src/server/routers/tankGame.ts`](src/server/routers/tankGame.ts) |
| top-level tRPC route tree | [`src/server/routers/index.ts`](src/server/routers/index.ts) |
| type-only tRPC client setup | [`src/client/trpc.ts`](src/client/trpc.ts) |
| Phaser game lifecycle and view state | [`src/client/tankGameDemo.ts`](src/client/tankGameDemo.ts) |
| plain DOM patterns and safe errors | [`src/client/kitchenSink/ui.ts`](src/client/kitchenSink/ui.ts) |
| strict rules | [`tools/tsconfig.base.json`](tools/tsconfig.base.json) |

### tRPC pattern

```ts
// Server: routes are composed, then their type is derived.
export const appRouter = router({ tankGame: tankGameRouter });
export type AppRouter = typeof appRouter;

// Client: generic binds calls to the server's inferred contract.
const trpc = createTRPCClient<AppRouter>({ /* transport */ });
await trpc.tankGame.snapshot.query();
await trpc.tankGame.join.mutate();
```

The generic checks client route names and I/O at build time; it does not add a
runtime API schema. Validate untrusted input on the server with Zod.

### Strict-mode consequences

- `strict`: nullability and inference errors are errors; expect to narrow.
- `noUncheckedIndexedAccess`: `xs[i]` requires an existence check.
- `exactOptionalPropertyTypes` (client/shared): omitted property and explicit
  `undefined` are distinct when assigning. The server target overrides it.
- `noUnusedLocals` / `noUnusedParameters`: remove unused code or intentionally
  omit unused callback parameters.
- `noImplicitOverride`: write `override` when overriding a base-class member.
- Project rule: prefer `type` aliases and named exports; do not cast types.

## Commands

```sh
npm run type-check  # TypeScript project build/check
npm run lint        # ESLint for src TypeScript
npm run test        # Type check, then server tank-rule tests
```

## Avoid these translations from Go/C++

| Do not assume | Instead |
| --- | --- |
| `type` validates a value | validate at runtime with Zod or a type guard |
| objects copy on assignment | use spread when a shallow copy is needed |
| `null` is the only absence value | handle `undefined` too |
| `as T` performs a cast/conversion | it is a compile-time assertion only |
| `async` creates a new OS thread | it schedules promise continuations on the event loop |
| a union has a runtime tag automatically | include/check a literal discriminant, or validate runtime data |
