You are writing a Devvit web application that will be executed on Reddit.com.

## Tech Stack

- **Frontend**: Phaser, Vite
- **Backend**: Node.js v22 serverless environment (Devvit), Hono, TRPC
- **Communication**: tRPC v11 for end-to-end type safety

## Layout & Architecture

- `/src/server`: **Backend Code**. This runs in a secure, serverless environment.
  - `trpc.ts`: Defines the API router and procedures.
  - `index.ts`: Main server entry point (Hono app).
  - Access `redis`, `reddit`, and `context` here via `@devvit/web/server`.
- `/src/client`: **Frontend Code**. This is executed inside of an iFrame on reddit.com
  - To add an entrypoint, create a HTML file and add to the mapping inside of `devvit.json`
  - Entrypoints:
    - `game.html`: The main React entry point (Expanded View).
    - `splash.html`: The initial React entry point (Inline View). This will be shown in the reddit.com feed. Please keep it fast and keep heavy dependencies inside of `game.html`
- `/src/shared`: **Shared Code**. Code to share between the client and server

## Frontend

### Rules

- Instead of `window.location` or `window.assign`, use `navigateTo` from `@devvit/web/client`

### Limitations

- `window.alert`: Use `showToast` or `showForm` from `@devvit/web/client`
- File downloads: Use clipboard API with `showToast` to confirm
- Geolocation, camera, microphone, and notifications web APIs: No alternatives
- Inline script tags inside of `html` files: Use a script tag and separate js/ts file

## Commands

- `npm run type-check`: Check typescript types
- `npm run lint`: Check the linter
- `npm run test:unit`: Run the compiled server unit tests

## Agent Live Validation

- Run `npm run agent:doctor` before a live run. It validates the gitignored
  `.local/reddit-accounts.json` file without printing credentials.
- Run `npm run agent:check` before Playtest. It is the deterministic local gate.
- Start `npm run playtest:agent`, then get the expected deployment fingerprint with
  `npm run agent:build-id` after source changes.
- Use the subreddit **Ensure agent fixture** menu item to create or reopen the stable
  test post. Agent Console requires this exact registered post and displays `FIXTURE
READY` before it can start a run. Keep the primary and secondary Reddit accounts in
  separate browser sessions.
- In each expanded Reddit app modal, switch the viewport selector from **Mobile** to
  **Desktop** before inspecting or interacting with the app. Desktop mode is required
  for every browser-based validation and screenshot.
- Reddit may isolate the app in an iframe that browser DOM tools cannot address. Treat
  the desktop layout, large visible controls, and screenshot-readable status text as
  the automation contract; do not rely solely on `data-testid` selectors from outside
  the iframe.
- In Agent Console, client/server freshness is checked automatically on load. Entering
  the optional expected build ID also verifies the browser against the terminal build.
  Do not start E2E checks until visible status reports `READY`.
  Retry for at most five minutes; never clear Reddit cache or storage.
- Agent commands are source-registered and intentionally unauthenticated for this
  learning project. They must namespace transient state with their run ID and register
  cleanup data. Do not add payment functionality to the Agent Console or E2E suite.

## Code Style

- Prefer type aliases over interfaces when writing typescript
- Prefer named exports over default exports
- Never cast typescript types

## Global Rules

- You may find code that references blocks or `@devvit/public-api` while building a feature. Do NOT use this code as this project is configured to use Devvit web only.
- Whenever you add an endpoint for a new menu item action, ensure that you've added the corresponding mapping to `devvit.json` so that it is properly registered

## Logging

- Use `trace` for core execution-flow events, `debug` for troubleshooting detail, `info` for normal non-actionable events, `warn` for unexpected events that may delay work, and `error` for component failures that affect other operations. Reserve `fatal` for app-wide unrecoverable failures; add it to logger types before use.

Docs: https://developers.reddit.com/docs/llms.txt.
