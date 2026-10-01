# Sagax agent notes

Before claiming a server or conversation change works, follow
[`docs/verification/README.md`](docs/verification/README.md). Always launch an
isolated fixture; never verify mutations against the user's live app or data.

## Where work goes

All work stays in `pulsatrixtechnologies` repositories. Never open a pull
request, issue, or push against the original OpenMausBot project
(`milind-soni/OpenMausBot`) or any other upstream. Push branches only to
`origin` (`pulsatrixtechnologies/pulsa-bot`) and target PRs at it. Pass
`--repo pulsatrixtechnologies/pulsa-bot` to `gh` so it never picks a parent
repository. Do not add an upstream remote with push access.

More specific `AGENTS.md` files override this note within their directories.

## Mail settings

Settings > Email (`src/components/MailSettings.tsx`, `server/mail-routes.ts`,
`server/mail-config.ts`, field ids in `shared/mail-settings.ts`) configures
the mail of a solo server. Keep these rules, each covered by a test in
`server/mail-routes.test.ts` or `server/mail-config.test.ts`:

- `GET /api/mail/settings` never returns a secret or any part of one: a
  password, API key or key secret is only `configured: true|false`.
- The routes are admin scope only (not in `CLIENT_ALLOW`) and answer 403
  `identity_perspicax` on an organization server.
- `POST /api/mail/test` takes no fields, sends only to the caller's own
  address and is rate limited.
- Saved values live in `config.json`'s `mail` block through `saveConfig`
  (never a generic `PUT /api/config` patch) and win over `OMB_MAIL_*`, which
  only provides defaults.
- A sender always has a name (default `Sagax`); Twilio refuses one without.
- Tests and fixtures use fake credentials only.

## Launch flow (desktop)

First run on the desktop app's own window opens the launch screen
(`src/components/onboarding/LaunchScreen.tsx`, rules in `src/lib/launch.ts`)
before the welcome tour: **No server** is the solo app, **Server**
probes the address (`orgJoin.probe`, Perspicax-linked servers only) then
`orgJoin.join` saves the server and starts the existing **Sign in with
Pulsatrix** (`electron/org-join.mjs`, `startPulsatrixSignIn` in
`electron/main.mjs`). Do not add another sign-in path. The choice lives in
`config.onboarding.launchMode`; the default address is
`DEFAULT_SERVER_ADDRESS`, overridable at build time with
`SAGAX_DEFAULT_SERVER`. The welcome tour no longer surfaces the inherited
managed-desktop Admin sign-in; Settings > Organization still does. See
`docs/self-hosting.md` ("At launch: No server or Server").

## Floating bots and the 3D mascot

A bot put "on the desktop" is a 3D owl in its own window
(`electron/floating-bot-window.mjs`). The main app page stays the brain
(`src/components/floating-bots/FloatingBots.tsx`, `brain.ts`): it sends each
window a validated snapshot (pose, balloon, `task`, `mood`, `flyAway`,
`hints`) and receives clicks, typed text, `play` and `pet` events. Keep it
that way: a floating window holds no session and calls no API.

- `behavior.ts` is the mascot's pure state machine (idle, look, spin, hop,
  wander, sleep, react, petted, drag, flyOut, working, return, celebrate,
  sad) and its per-frame motion. Test new behavior there, not in the view.
- `pilot.ts` moves the window for the mascot (fly to the screen edge, home,
  wander) through `floating-bots:geometry`, `move-to` and `autopilot`; main
  clamps every move to the work areas and does not save spots flown under
  autopilot.
- `owl3d/` is three.js, procedural only (no model files). It must stay
  behind `lazy(() => import("./owl3d/Mascot3D"))` so the main bundle never
  loads three; `src/lib/floating-bots.test.ts` guards this. Without WebGL the
  view falls back to the 2D `OwlAvatar`.
- `mood.ts` keeps a gentle per-bot mood in localStorage
  (`omb.floatingBots.mood.v1`); never add punishing mechanics.
- The "Fly away during tasks" setting lives in `src/lib/floating-bots.ts`
  (`omb.floatingBots.prefs.v1`), shown under Settings > Appearance and in the
  mascot's right-click menu. User docs: `apps/docs/content/docs/features/floating-bots.mdx`.
