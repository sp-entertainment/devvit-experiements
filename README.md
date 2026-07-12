## devvit-experiments

Deployable "kitchen sink" that exercises nearly every Devvit Web capability (Reddit API, Redis, Realtime, Media, Notifications, Payments, Scheduler, Settings, Cache, Forms, Menu Items, Triggers, and client-side effects), organized behind a tRPC API and a categorized in-app menu, each example commented to explain what it demonstrates.

A practice project for building web applications on Reddit's developer platform.

- [Devvit](https://developers.reddit.com/): A way to build and deploy immersive games on Reddit
- [Vite](https://vite.dev/): For compiling the webView
- [Phaser](https://phaser.io/): 2D game engine
- [Hono](https://hono.dev/): For backend logic
- [TypeScript](https://www.typescriptlang.org/): For type safety

## Getting started

Prerequisites:

- Node.js 22.2.0 or newer
- A Reddit account with access to the Devvit app

From a clone of this repository:

1. Run `npm ci` to install the locked dependency versions.
2. Run `npm run agent:check` to verify formatting, linting, types, and unit tests.
3. Run `npm run login` if the Devvit CLI is not already authenticated.
4. Run `npm run dev` to upload a playtest build and open it on Reddit.

## Commands

- `npm run agent:check`: Runs the complete deterministic local quality gate.
- `npm run build`: Builds the client and server deployment artifacts.
- `npm run deploy`: Checks and uploads a new app version.
- `npm run dev`: Starts a live Devvit playtest.
- `npm run format:check`: Checks repository formatting without changing files.
- `npm run launch`: Checks, uploads, and submits the app for review.
- `npm run lint`: Checks first-party TypeScript with ESLint.
- `npm run login`: Authenticates the local Devvit CLI.
- `npm run prettier`: Formats first-party repository files.
- `npm run test:unit`: Type-checks and runs the server and tooling tests.
- `npm run type-check`: Type-checks the client, server, and shared code.

Live validation is intentionally separate because it uploads a playtest build and is
slower than the deterministic local gate. Use it for changes that affect runtime
behavior.

## Agent live validation

1. Create `.local/reddit-accounts.json` (it is gitignored) with distinct `primary`
   and `secondary` username/password JSON objects. Keep it mode `0600`; credentials
   are only used to restore a signed-out browser session and are never logged.
2. Run `npm run agent:doctor`, then `npm run agent:check`.
3. Start `npm run playtest:agent` and run `npm run agent:build-id` after each change.
4. Use **Ensure agent fixture** in the subreddit menu, then open that registered post
   in the primary signed-in Chrome session and the isolated secondary session. In each
   expanded Reddit app modal, switch the viewport menu from **Mobile** to
   **Desktop** before testing. Agent Console must show `FIXTURE READY`; it refuses to
   start a run from any other post.
5. In **Agent Console**, enter the expected build ID. Do not run checks until it
   reports `READY` for matching expected, client, and server builds. Refresh every
   15 seconds, reopen the post after two minutes, hard reload after four, and stop
   after five minutes. Do not clear Reddit cache.
   The console checks client/server freshness automatically; the optional expected ID
   additionally verifies that the browser has the build reported by the terminal.
   Browser tools may not expose Reddit iframe controls to DOM selectors, so use the
   desktop layout, visible status text, and screenshots as the automation contract.
6. Start a run, execute the registered checks, carry out any listed two-browser
   steps, and finish the run. Successful runs clean their namespaced state; a failed
   run is cleaned when the next run starts or by the reset control.

## Credits

Thanks to the Phaser team for [providing a great template](https://github.com/phaserjs/template-vite-ts)!
