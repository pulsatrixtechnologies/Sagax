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

## Profile on an organization server

On an organization server (`OMB_IDENTITY=perspicax`) a signed-in person's
name and email belong to Perspicax. Keep these rules, each covered by a test
in `server/member-identity.e2e.test.ts`, `server/org-identity.e2e.test.ts`,
`server/org-profile.e2e.test.ts`, `server/oidc-login.test.ts` or the
onboarding tests:

- `GET /api/auth/session` and the config's `viewer` carry
  `profileManagedBy: "perspicax"` and `profileManageUrl` (the issuer's
  `/console/me`) for every session; never on a solo server or for the
  operator at the server's own console (loopback).
- `PUT`/`PATCH /api/config` with `profile.name` or `profile.email` answers
  403 `identity_perspicax` for those sessions. About me and the rest of the
  config stay as they were.
- The name and email come from the id_token and the directory and are
  refreshed at each sign-in and token refresh (`PrincipalRegistry.forSubject`).
- The UI follows the server's answer (`src/lib/profile-management.ts`): the
  welcome greeting asks for nothing and Settings > General shows the identity
  read-only ("Géré par votre organisation (Pulsatrix Perspicax)", "Modifier
  dans Perspicax"). A change here needs the server image redeployed.
- A person reads as `personDisplayName` (`server/viewer-identity.ts`): the
  Perspicax display name, else the address's local part, else the login; a
  directory name equal to the login is not a display name.
- Avatar (`server/org-profile.e2e.test.ts`): Sagax keeps only a version
  (`Principal.avatar`) from the id_token `picture` claim (a URL on the
  issuer's origin with `?v=<version>`) or the directory's `avatar`
  (null removes it), reads the PNG or JPEG through the link
  (`GET /api/v1/pulsabot/people/<sub>/avatar`, Bearer link token) and serves
  it at `/api/people/<principalId>/avatar?v=<version>`. Without those
  Perspicax fields everyone keeps their initials.

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

Server mode (the launch screen's Server) is exclusive: `serverModeId` in
`environments.json` (`electron/environments.cjs`) locks the app to that
organization server. While it is set nothing switches to Local or another
server (`withActive`, `switchEnvironment`, `requireNotServerMode`), the
packaged app starts no local server, and the only way out is `leaveServerMode`
in `electron/main.mjs` (Settings > General > Server > Change, Server > Change
server…), which signs out and returns to the launch screen. Tests:
`electron/server-mode.node-test.mjs`, `electron/environments.node-test.mjs`.

An organization server (`org: true`, set by org-join after its probe) is
drawn with this app's own bundle (`electron/bundled-ui.cjs`): page requests
come from the bundle, `/api/`, `/.well-known/` and `/auth/` pass through.
Keep these rules: the session cookie rides only with the bundled page's own
requests (its referrer is the server's origin), never a widget's or another
origin's; main's own calls to a server pass `bypassCustomProtocolHandlers`;
the bundled page gets only `BUNDLED_EXTRA` in `electron/preload.cjs`, and
main checks those channels with `desktopUiOnly` (`electron/local-origin.cjs`);
anything touching this computer stays `localOnly`. Tests:
`electron/bundled-ui.node-test.mjs`; real Electron:
`scripts/verify-server-mode.ts`.

On an organization server (`OMB_IDENTITY=perspicax`) bots never use the
server's own machine: `ManagedDesktopPolicy` refuses `thisComputer` and
`localVm` there (`HOST_COMPUTER_REFUSAL`, every claim passes
`bindTurnComputer`), and the Local VM create/start routes refuse with
`hostComputerRefusal()`. A bot reaches the computer of the person who asks
through `server/user-computers.ts`: `speakingPerson` (a person's message or a
hop carrying it; never a routine), then a provider per target
(`user-desktop`: that person's desktop app via the owner-scoped `SharedComputers`
`list(person)` and `request`, for the person `sharedComputerPrincipal` proves; `user-sandbox`: plugs in as a second provider). Not connected, not
theirs, or no person: the tool answers why. `shared_computer` is never
pre-allowed for Claude (`agentsAllowedTools`), so the bot's approval mode
applies. Tests: `server/user-computers.test.ts`,
`electron/server-mode.node-test.mjs`.

A person's preferences on an organization server live per principal
(`shared/user-preferences.ts` lists the only keys that travel,
`server/user-preferences.ts`, `GET/PUT /api/me/preferences`). The renderer
syncs them before the app draws (`src/lib/user-preferences-sync.ts`); the
launch screen hands this computer's own values over once at join
(`orgJoin.join({ preferences })`, `takePreferences`). Device-only state
(drafts, sizes, floating list and positions, mood, voices) never travels.

## Model picker

The model chip (composer and chat header, `src/components/ModelPicker.tsx`)
opens a modal like Settings, portalled to `<body>`: providers with their
status on the left, account, scope, models, effort and payers on the right,
a bottom sheet on a narrow window; focus stays inside and Escape closes it.
Only `contained` (the bot settings dialog) keeps the inline panel. On an
organization server it shows the speaker's payer order
(`src/lib/model-payers.ts`: subscription, key in Perspicax, organization
key, as `server/engine-credentials.ts` decides; the payer used now is the
server's `myTurns`, never recomputed; a routine thread shows the owner's
credentials) and signs in their own subscription through `/api/me/engines/<id>/login`
(`ModelPickerPayers.tsx`), never the server's engine login; the server's
local models are not offered. Tests: `ModelPicker.interaction.test.ts`,
`src/lib/model-payers.test.ts`; real Electron: `scripts/verify-server-mode.ts`
(org) and `pnpm exec electron scripts/smoke-approval-modes.cjs --model-ui-only`
(solo).

## Floating bots and the desktop mascot

A bot put "on the desktop" stands in its own transparent window
(`electron/floating-bot-window.mjs`). The main app page stays the brain
(`src/components/floating-bots/FloatingBots.tsx`, `brain.ts`): it sends each
window a validated snapshot (pose, balloon, `task`, `mood`, `flyAway`,
`liveliness`, `context`, `mascot` (the bot's look), `hints`) and receives clicks,
typed text, `play`, `pet` and `mascot` events. Keep it that way: a floating
window holds no session and calls no API. Changes under `electron/` need an
Electron restart (no HMR); launch-test them before committing.

- `clips.ts` holds every animation clip as a pure function of time;
  `behavior.ts` is the state machine that picks them (scheduler.ts for idle
  actions, with cooldowns and the activity level) and cross-fades them.
  Nothing moves faster than about 4 Hz; reactions keep a minimum dwell.
  Test new behavior there, not in the view.
- Characters live in the registry `mascots.tsx` (id, label, thumbnail,
  renderer, capabilities, popover paint and moves); adding one is adding an
  entry. Flat renderers (`Owl25D.tsx` draws owl-art's own SVG parts) never
  turn in depth: only `depth` renderers spin, flip or turn in place.
- The 3D owl (`owl3d/Owl3D.tsx`, preview, off by default) is a modeled,
  rigged and animated glb (original work, see NOTICE) built headless in
  Blender by `tools/owl3d/build_owl.py` and compressed by `pnpm gen:owl3d`
  (`tools/owl3d/gen.mjs`; Blender from `brew install --cask blender` or
  `BLENDER=`). One material per palette region (named after the palette
  slot), shape keys for the lids and beak, 24 clips in place.
  `OWL_CLIP_FOR` maps every behavior activity to a clip; the gaze and blink
  are an overlay undone after each frame (never accumulated). Add
  `--render DIR` to the generator for Eevee preview sheets, and check it in
  real Electron with `node scripts/verify-owl3d.mjs [dir]` (isolated: own
  Vite port, temporary profile). Keep it lazy so the main bundle never loads
  three; `src/lib/floating-bots.test.ts` guards this.
- `fit.ts` sizes the stage for the widest pose; `pilot.ts` moves the window
  (flights, walks) through `floating-bots:geometry`, `move-to` and
  `autopilot`; main clamps every move and never saves spots flown to.
- Main retries a page that fails to load, reloads a dead or silent one, keeps
  a state sent before its window exists, and logs the page's errors; the
  window falls back to the plain owl rather than drawing nothing.
- The character (owl, original shape, Trombi) and its look live with the bot
  (`bot.mascotLook`, `shared/mascot-look.ts`, validated by the server), chosen
  in the avatar popover (`MascotLookEditor.tsx`) and drawn by `BotAvatar` for
  every bot avatar in the app; never draw a bot's mascot outside `BotAvatar`.
- Per device:, the mood (`omb.floatingBots.mood.v1`, never punishing),
  and the settings "Fly away during tasks" and "Activity level"
  (`omb.floatingBots.prefs.v1`, Settings > Appearance and the right-click
  menu). The bar under the mascot is the thread's context, from the chat
  header's own figures. User docs: `apps/docs/content/docs/features/floating-bots.mdx`.

## Sign in with Pulsatrix (desktop)

The desktop app always signs in through the system browser, never in a
window of its own (passkeys and password managers live in the browser).
`startPulsatrixSignIn` in `electron/main.mjs` and
`electron/oidc-system-sign-in.cjs` own it; there is no in-app sign-in
window, do not add one back. Return paths, in order: a one-shot loopback
listener on `127.0.0.1` (ephemeral port, random state path, exact Host and
Origin, ten-minute timeout, closed after use), then `openmausbot://auth` only
when this exact running copy owns the scheme and the server advertises
`nativeReturn`, else an error on `/pair`. The server side is
`validLoopbackReturn` in `server/oidc-login.ts` (loopback IP literals with a
port and a state only; the credential rides in the fragment) and the
descriptor's `identity.loopbackReturn`. Tests:
`electron/oidc-system-sign-in.node-test.mjs`, `server/oidc-login.test.ts`,
`server/oidc-session.e2e.test.ts` (S2-7b). The return lands in the main window as
`<origin>/pair?signin=<nonce>#code=...` (`authReturnTarget`): never a
fragment-only change of the `/pair` the window already shows, which would
not reload the page. `scripts/verify-desktop-sign-in.ts` proves it in a real
Electron window. A change to that server code needs the server image
redeployed.

## Server environments (organization mode)

On an organization server, bots run shell, file and browser tools in a
person's server environment (`user-sandbox`): the SPEAKER's for a
conversation, the bot OWNER's for routines, the asker's or else the room
creator's in a room (`sandboxPrincipalForTurn`). One isolated container per
person, never per bot, never on the Sagax host (`docs/user-sandbox.md`).
Keep these rules, each covered by `server/user-sandbox*.test.ts`,
`server/sandboxd*.test.ts` or `server/user-sandbox.e2e.test.ts`:

- Only `sagax-sandboxd` (`server/sandboxd.ts`) holds the Docker socket; the
  Sagax server calls it with signed requests (`server/sandboxd-auth.ts`).
- The provisioner API is keyed by person (`sandboxKeyForPrincipal`); never add
  a bot parameter. Every create body passes `assertSandboxIsolation()`.
- Engines get no shell, file or fetch tool of their own there
  (`withholdHostTools`, `server/drivers/host-tools.ts`); an engine that
  cannot withhold them is refused. `scripts/smoke-host-tools.ts` checks the
  real Claude Code CLI.
- Server code runs under `--experimental-strip-types`: no TypeScript
  parameter properties in these files.
- `scripts/smoke-user-sandbox.ts` proves isolation on a real Docker host and
  removes everything it creates.

## Connectors from the person's own Claude account

Sagax builds no GitHub, Outlook or Calendar integration of its own: a Claude
turn keeps the claude.ai connectors (Microsoft 365, GitHub, Gmail, ...) of
the account it runs on when that account is the speaker's own
(`server/harness-connectors.ts`, rules in `claudeAiConnectorsForTurn`). Keep
these rules, each covered by `server/harness-connectors.test.ts` or
`server/drivers/claude.test.ts`:

- Organization server: only an access `via: "subscription"` (the owner
  speaking, from their own login directory). Owner key, org key and server
  turns get none. Solo server: the operator and the operator's routines only.
- The Claude driver drops `--strict-mcp-config` for such a turn (it also
  drops claude.ai connectors, measured on CLI 2.1.287) and keeps
  `--setting-sources project`; every other isolated turn sets
  `ENABLE_CLAUDEAI_MCP_SERVERS=false`.
- Connector tools (`mcp__claude_ai_*`) are never pre-allowed: they ride the
  approval flow. An engine tool denial blocks host built-ins, never them.
- Connected apps shows them read-only (`GET /api/me/harness-connectors`, the
  caller's own account only, no email or URL) with a link to
  claude.ai/customize/connectors; an admin turns them off with
  `PUT /api/harness-connectors/settings` (`config.harnessConnectors.claudeAi`).
- Codex: ChatGPT connectors need Codex's own ChatGPT login, which Sagax's
  ChatGPT plan mode and API keys do not have, so Codex turns get none.

## Group settings

A group has no setup dialog and no pending setup state. Every group setting
lives in its side panel (`src/components/GroupPanel.tsx`, the bot panel
shell): Details holds the name, people and bots; Instructions holds the
group instructions (`bulletin`); Advanced holds the default responder (a
specific lead, Auto with Jev, everyone, or only when mentioned) and the
working folder (empty means each bot's own folder). Keep these rules:

- A new group is usable at once: `store.createGroup` stamps
  `setupCompletedAt` at creation and the composer is never locked.
- A group an older build left pending (`setupCompletedAt: null` and no
  `setupSkippedAt`) is migrated to set up when the store loads.
- There is no `PATCH /api/groups/:id/setup`; edits go through
  `PATCH /api/groups/:id`. `POST /api/groups` still takes an optional
  `setup` (`bulletin`, `defaultResponder`) to create a group in one call.
- A remote client sees no Advanced tab and the instructions read-only.

### Group owner (organization server)

On an organization server (`OMB_IDENTITY=perspicax`) only a group's owner
changes its settings (`server/group-ownership.ts`, client
`src/lib/group-owner.ts`; covered by `server/group-ownership.test.ts` and
PT-4 in `server/org-private-threads.e2e.test.ts`):

- The owner is `createdBy`, else the first person in `humanIds`, else
  nobody, and then the organization admins act as owner. The wire group
  carries it as `ownerId` (absent on a solo server, where nothing changes).
- Only the owner changes the name, instructions, working folder, default
  responder, bots and people (`PATCH /api/groups/:id` answers 403
  `not_group_owner`). Anyone listed may remove only themselves (leave).
  Marking read, pins and section moves are not settings.
- An admin has no override on content. `DELETE /api/groups/:id` is the
  owner's, or an admin's for moderation (`channel.moderate` on a room in
  `server/authz.ts`). A client-scope session may delete only there.
- The owner of a client-scope session also picks the default responder.
  The working folder keeps the admin scope (it touches the host or sandbox
  filesystem): a non-admin owner sees it read-only with a note.
- The panel shows the settings read-only to everyone else, with "Seul le
  propriétaire du groupe peut modifier ces réglages", and a Leave button.

## Upstream sync

Last sync: 2026-10-01, upstream `milind-soni/OpenMausBot` main at
`4ed952aa` (0.1.92) merged into Sagax; `baseVersion` follows it. To repeat:

- Keep the `upstream` remote fetch-only (`git remote set-url --push
  upstream no_push`). Never push, open a pull request or file an issue
  upstream.
- `git fetch upstream`, branch from `origin/main`, then `git merge
  upstream/main` (a real merge, never a rebase) so history stays traceable.
- On conflict our behavior wins and upstream improvements are layered in.
  Merge `src/locales/*.json` and `source-hashes.json` as a union of keys and
  run `pnpm i18n:check`.
- Run `pnpm install --frozen-lockfile`, typecheck, lint, the unit suites and
  `pnpm build`; compare failures with `origin/main` before pushing to
  `origin` only.
- MCP sign-in is ours (`server/mcp-oauth.ts`, vault `mcp-oauth.enc` and
  `mcp-oauth.key`, both left out of workspace backups). Upstream's own
  MCP sign-in manager and routes were not taken.
