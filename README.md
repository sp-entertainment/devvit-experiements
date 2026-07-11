## devvit-experiments

Deployable "kitchen sink" that exercises nearly every Devvit Web capability (Reddit API, Redis, Realtime, Media, Notifications, Payments, Scheduler, Settings, Cache, Forms, Menu Items, Triggers, and client-side effects), organized behind a tRPC API and a categorized in-app menu, each example commented to explain what it demonstrates.

A starter to build web applications on Reddit's developer platform

- [Devvit](https://developers.reddit.com/): A way to build and deploy immersive games on Reddit
- [Vite](https://vite.dev/): For compiling the webView
- [Phaser](https://phaser.io/): 2D game engine
- [Hono](https://hono.dev/): For backend logic
- [TypeScript](https://www.typescriptlang.org/): For type safety

## Getting Started

> Make sure you have Node 22 downloaded on your machine before running!

1. Run `npm create devvit@latest --template=phaser`
2. Go through the installation wizard. You will need to create a Reddit account and connect it to Reddit developers
3. Copy the command on the success page into your terminal

## Commands

- `npm run dev`: Starts a development server where you can develop your application live on Reddit.
- `npm run build`: Builds your client and server projects
- `npm run deploy`: Uploads a new version of your app
- `npm run launch`: Publishes your app for review
- `npm run login`: Logs your CLI into Reddit
- `npm run type-check`: Type checks the client, server, and shared code

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
