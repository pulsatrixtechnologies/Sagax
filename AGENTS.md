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

## Tests

`pnpm test` runs every vitest file in one serial process (about 45 minutes),
then the broker, Electron and packaged-server checks. For day-to-day work use
the sharded runner `scripts/testing/vitest-shards.mjs`, which runs N vitest
processes at once (default: half the cores, at most 8), prints one summary
and exits 1 on any failure:

- `pnpm test:unit`: files that never boot the real server (about 2.5 minutes).
- `pnpm test:e2e`: `*.e2e.test.ts` plus any test that spawns
  `server/index.ts` or calls `launchVerificationServer(` (about 11 minutes).
- `pnpm test:shards`: both groups. Options: `--shards N`, `--logs DIR`,
  `--list`, and vitest flags after `--`.

The groups come from `scripts/testing/test-groups.mjs` (no hand-kept list;
covered by `test-groups.test.mjs`). The e2e files are slow because each test
boots its own server and drives fake engines through real turns; keep that
isolation rather than sharing a server between tests. Suites pick free ports
with `server/testing/ports.ts` and each vitest process gets its own Local VM
namespace, so shards do not collide.

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
  (never a generic `PUT /api/config` patch) and win over `SAGAX_MAIL_*`, which
  only provides defaults.
- A sender always has a name (default `Sagax`); Twilio refuses one without.
- Tests and fixtures use fake credentials only.

On an organization server Settings leaves Email out (Perspicax manages the
organization's mail; `organizationHidesSection` in `SettingsModal.tsx`).

## Organization settings (2026-10-01)

Covered by `src/components/SettingsModal.orgCleanup.test.ts`,
`src/components/EnginesSettings.org.test.ts`,
`src/components/Sidebar.header.test.ts`,
`src/components/settings/MyRoutineDelegation.test.ts` and
`server/org-bot-force.test.ts`:

- Connected apps (Composio) is experimental (`features.connectedApps`, off):
  off hides the sidebar entry, the Settings > API keys card and the tour's
  apps steps. The claude.ai connectors status then shows in Settings > Model
  providers (`HarnessConnectorsSection placement="settings"`).
- A person's own access lives on each engine card of Settings > Model
  providers (organization server only, 2026-10-02): who pays for their
  turns, their own Claude/Codex subscription sign-in (`MyEngineAccess`), one
  "Manage my keys in Perspicax" link; no separate "My subscriptions and
  keys" card, no engine missing from the server, never the server's own
  account (it serves no one's turns there).
- Routines in my name is read-only: allowed by default, revoked in the
  Perspicax console (`manageUrl`, `/console/me/access#sagax`). Perspicax has no
  silent authorization, so `ensureRoutineDelegation` starts the consent once,
  after the person's first routine.
- An organization admin force-stops or force-deletes any bot
  (`POST /api/org/bots/<id>/force-stop|force-delete`, delete confirmed with
  the bot's name): admin scope, `orgAdminCaller`, audited
  (`bot.force_stop`, `bot.force_delete`), the owner notified (`admin-action`,
  `audience` the owner). A solo server answers 403 `identity_perspicax`.
- Sharing in the organization is one compact row per bot (avatar, owner,
  sharing count, running or idle from `/api/org/bots` `look`/`running`);
  the grants open inline, the force actions sit in an admin-only row menu
  and their result is a toast (`src/components/settings/OrgSharing.test.ts`).

## Full access (organization mode, 2026-10-01)

On a solo server Full access is granted only through the packaged desktop
app's private channel. On an organization server the bot's owner grants it
over HTTP (`server/org-full-access.ts`, client `src/lib/full-access.ts`).
Keep these rules, each covered by `server/org-full-access.test.ts`,
`server/org-full-access.e2e.test.ts`, `server/org-sharing.e2e.test.ts` (S3-7),
the driver tests or `src/components/ApprovalModeSelector.fullAccess.test.ts`:

- Only the bot's owner, signed in (a session principal), grants Full:
  `PATCH /api/bots/<id>/tasks/<thread>` (a thread) or `PATCH /api/bots/<id>`
  with `{ approvalMode: "full", confirmFullAccess }` alone (the default, for
  new threads and routines). The first grant needs `confirmFullAccess: true`;
  the server keeps `fullAccessConsent` on the bot so later grants skip it.
- Settings > Organization > Allow full access (`organization.allowFullAccess`,
  admin only, on by default, `PATCH /api/org/settings`). Off: grants answer
  403 `org_full_access_disabled`, a send to a Full thread is refused with the
  same code, and stored Full runs as Ask (`approvalModeForTurn`).
- A turn runs Full only while the policy is on and the consent is the bot's
  current owner's: a routine (run as the owner) gets Full only when that
  owner set it on that bot. Custom stays refused for members' bots.
- Full never lifts a hard limit: host tools stay withheld
  (`withholdHostTools`: Claude `bypassPermissions` with the host tools in
  `--disallowedTools`; Codex `never` with a read-only server sandbox),
  private threads, egress and payer rules are unchanged.
- Mode changes (`approval.mode`), Full turns (`approval.full_access_turn`)
  and the policy (`org.settings`) go to the admin activity log.

## Profile on an organization server

On an organization server (`SAGAX_IDENTITY=perspicax`) a signed-in person's
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

## Group memory and direct messages between people

A user-created group keeps one shared memory (`server/group-memory.ts`,
`DATA_DIR/group-memory/<groupId>/MEMORY.md`), separate from every bot's own
workspace. Keep these rules, each covered by `server/group-memory.test.ts`,
`server/group-memory.e2e.test.ts` or `server/people-dms.e2e.test.ts`:

- Every bot of the group reads it in each room turn there (the
  `group-memory` prompt section); a bot writes it only with
  `group_memory_update` (`/api/internal/group-memory`: a bot of that group,
  speaking in it, group memory on, the bot's own memory switch on). Nothing
  moves between a bot's private memory and the group's on its own.
- Entries, budget and expiry are the bot memory's (`applyMemoryUpdate`);
  secrets are redacted on every write; it goes away with its group.
- `GET/PUT /api/groups/<id>/memory`: the group's people read, its owner
  (`ownsGroup` in `server/group-ownership.ts`; on a solo server the
  operator or an admin session) edits it or switches it off (`memoryEnabled`). A removed member
  gets 404 at once (the channel gate).

On an organization server a person writes to another person through
`POST /api/people-dms` (`server/people-dms.ts`): a group record with
`peopleDm: true`, two `humanIds` and no bot. Only those two list, read,
stream, search, export or write it (not an admin, a section, nor loopback);
it stays people-only (no bot, task, rename, delete, folder or memory); a
message starts no turn and notifies the other person only (`notify` kind
`message` with `audience`). Backups and packages leave it out. The To:
picker offers the directory's active persons (never `service` accounts,
nor oneself).

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

On an organization server (`SAGAX_IDENTITY=perspicax`) bots never use the
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

## Voice mode (xAI)

The call button on a bot opens the floating voice bar
(`src/components/voice-mode/`) when `GET /api/bots/<id>/voice/status` says
xAI voice mode serves the person; otherwise a solo Mac keeps the older call
(macOS dictation helper). Keep these rules, each covered by
`server/voice-mode.test.ts`, `src/lib/voice-mode/voice-mode.test.ts`,
`src/components/voice-mode/VoiceModeSettingsPanel.test.ts` or
`electron/app-permissions.node-test.mjs`; real Electron in server mode with a
fake xAI: `scripts/verify-voice-mode.ts`. Details: `docs/voice-mode-xai.md`.

- The xAI key never reaches a client: the server proxies speech to text
  (`/voice/transcribe`) and text to speech (`/voice/speak`, `/voice/voices`);
  no route answers a key or a part of one.
- Who pays (`resolveVoiceKey`): on an organization server the speaker's own
  `xai` key in Perspicax, else the organization's (Settings > Connections),
  else an access card in that person's bar only (the audience rule of every
  access card, `accessCardAudience`: the speaker; the organization's key hint
  only for an admin; never stored in a thread or sent as a live frame); a
  disabled person is refused. Solo: the server's key. Each request is booked
  with its `access`.
- Every route names a bot the person may use (and a thread they may post
  to); the spoken text goes through the normal send route, never a voice
  route, so attribution and private threads stay those of a typed message.
- The microphone is the window's own (`getUserMedia`), never the macOS
  helper in voice mode, so Windows and server mode work. Electron grants the
  organization server's bundled origin the microphone only
  (`microphoneOrigins`). The bundled page has no dictation bridge: call
  `window.ogb?.speechStop?.()`, never assume it.
- Voice, Speed and Language live in `omb.voiceMode.v1` and travel with the
  person (`shared/user-preferences.ts`). The call's settings and the "Only my
  voice" voiceprint stay on the computer (`omb.voiceCall.v1`,
  `omb.voiceCall.voiceprint.v1`); never add them to the keys that travel.
- A call is a live, full-duplex call (`LiveCall.tsx`, `src/lib/voice-mode/call.ts`,
  states in `call-machine.ts`): Silero VAD and CAM++ speaker verification run
  on the computer (onnxruntime-web, models in `src/lib/voice-mode/models/`,
  served from the app's bundle, never a CDN); a turn streams over
  `GET /voice/listen` (WebSocket, same origin only, bridged to xAI streaming
  speech to text) and the answer is spoken sentence by sentence through
  `POST /voice/stream` (raw PCM). Barge-in ducks then cancels the bot's voice
  and interrupts its running turn. Tests: `call-logic.test.ts`, `call.test.ts`,
  `models.test.ts`, `server/voice-call.e2e.test.ts`.
- xAI is only ears and a voice: never its realtime agent, responses, chat or
  function calling. Every turn goes to the bot through the normal send route,
  and only the bot's text is synthesized. The e2e test and
  `scripts/verify-voice-mode.ts` fail on any other xAI path.
- On an organization server (the status says `organization: true`, or the
  viewer is managed by Perspicax) the call button is
  `VoiceModeCallButton`: the server decides (`/voice/status`, asked again at
  every click while unavailable), and the legacy call gate ("Choose This
  computer", macOS dictation) never shows. Unavailable shows the speaker's
  access card (admin: the organization's key hint and "Open Settings >
  Connections"), or the server's error with a retry; a room says voice mode
  talks with one bot at a time. Tests: `VoiceModeCallButton.test.ts`,
  `scripts/verify-voice-mode.ts` (no key, then the admin's key).

A change to `server/voice-mode.ts` needs the server image redeployed.

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
- The chat stays smooth (`window-frame.ts`): while the balloon is open the
  window holds the balloon's room and only grows, so streaming, resizing or
  moving the balloon never resizes the window per frame; it fits again when
  the balloon closes or a gesture ends. Drags move the window once a frame
  (`setPosition`, one request in flight); main saves a spot once the window
  stands still and only calls `setIgnoreMouseEvents`, `setFocusable` and
  `focus` on a change. With the balloon open the mascot stays home (no
  wander, no flight while its bot works), draws at 30 fps at most and the
  skin's loops rest. Measure with `node scripts/verify-mascot-chat.mjs`
  (isolated real Electron: open latency, window moves, clipped and dropped
  frames, mascot jumps, position writes, theme).
- The balloon wears the app's theme: the brain sends `theme` (the skin and
  the brand accent, `theme.ts`, followed live) and the window stamps it;
  Trombi keeps its Hibou 98 balloon whatever the theme.
- Main retries a page that fails to load, reloads a dead or silent one, keeps
  a state sent before its window exists, and logs the page's errors; the
  window falls back to the plain owl rather than drawing nothing.
- The character (owl, original shape, Trombi) and its look live with the bot
  (`bot.mascotLook`, `shared/mascot-look.ts`, validated by the server), chosen
  in the avatar popover (`MascotLookEditor.tsx`) and drawn by `BotAvatar` for
  every bot avatar in the app; never draw a bot's mascot outside `BotAvatar`.
- Bot colors live in `shared/mascot-colors.ts` (palettes Vivid, Pastel, Deep,
  Neon, Neutral; the original fifteen ids keep their values) and every skin,
  the owl's included (`OWL_SKIN_TIER`, `LEGACY_OWL_SKINS`), has a rarity. The
  popover shows one palette and one rarity at a time (`editor-tabs.ts`,
  covered by `editor-tabs.test.ts`); a renamed skin id goes in the legacy
  table, never removed.
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
Origin, ten-minute timeout, closed after use), then `sagax://auth` (or `openmausbot://auth`) only
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
- The environment's desktop (`deploy/sandbox/sagax-desktop`, Xvnc on
  127.0.0.1 inside the sandbox only) starts on demand: computer use
  (`computer_list_tools`, `computer_use`, fixed argv, never a shell line) or
  the owner's live view. The view (`/api/desktop-viewer/sandbox/me`) is built
  from the caller's own session principal, never an id; read-only by default
  (view-only VNC password), `?control=1` for control; its WebSocket starts
  nothing and reaches the VNC port only through the provisioner's signed
  upgrade (`/v1/sandboxes/<key>/desktop`). While a control view is open,
  the bots' `computer_use` there is refused with `SANDBOX_CONTROL_REFUSAL`
  (`server/sandbox-control.ts`, test `server/sandbox-control.test.ts`). The
  desktop starts openbox, a background and a tint2 launcher bar (Chromium,
  Terminal, Files); a change there needs the sandbox image rebuilt. The
  Computer tab's power and usage
  routes (`/api/me/server-environment/power|stats`) act on the caller's own
  environment only; shutdown and pause under a running turn need `confirm`.
  Tests: `server/user-sandbox-desktop.test.ts`, `server/sandboxd.test.ts`;
  Docker: `scripts/smoke-sandbox-desktop.ts`.

## Desktop bridge (organization mode)

In server mode the desktop app is the bridge between the organization server
and the person's PC (`electron/desktop-bridge.mjs`, `electron/desktop-tunnel.mjs`,
`server/desktop-bridge*.ts`, `server/desktop-egress.ts`). Bots working for a
person run the solo-mode tools on that person's own computer, as the MCP
server `sagax-desktop` (shell, files, search, fetch, offscreen browser,
computer use, Local VM), and the engine's own network traffic leaves through
it. Keep these rules, each covered by `server/desktop-bridge*.test.ts`,
`server/desktop-egress.test.ts`, `server/attachment-staging.test.ts`,
`electron/local-vm.node-test.mjs`, `electron/desktop-bridge.node-test.mjs` or
`scripts/verify-desktop-bridge.ts`:

- Where tools run is decided once per turn by `resolveBotWorkplace` from
  the bot's Works on (or the conversation's pin): Local VM or This computer,
  the speaker's desktop (when it is not connected, nothing runs there and
  the bot and the composer say so); Auto and Cloud, their server
  environment. The `place` of `sagax.botWorkplace.v1` no longer decides.
  Routines use the owner's desktop only when the bot works on it, it is
  connected AND the owner allowed it (off by default). Rooms: the person
  whose message triggered the turn; a follow-up nobody asked for never.
- A bridge is bound to the person of the session that registered it and to
  a secret only the desktop's main process holds; every poll, result and the
  tunnel re-check that the session is live and still that person. A turn's
  capability names the person at mount; the hub reaches only that person's
  own desktop. The server host is never a target; engine host tools stay
  denied (`withholdHostTools`); `sagax-desktop` tools are never pre-allowed.
- Egress: an HTTP(S) proxy on 127.0.0.1 with a per-thread credential, valid
  only while that thread runs a turn for that person on their computer
  (`turnNetworkProxy`); the drivers set HTTP(S)_PROXY with NO_PROXY for the
  model hosts. The desktop opens each connection itself, through the OS proxy
  and VPN, refuses its own loopback and link-local, and applies "local network
  only". Destinations (host:port only) go to `desktop-bridge-audit.jsonl` and
  the desktop's own activity log.
- The OS proxy, per destination: `session.resolveProxy` (it evaluates a PAC
  file the system names) gives the routes, tried in order (`proxyChain`,
  `openConnection` in `electron/desktop-tunnel.mjs`): HTTP CONNECT, HTTPS
  proxy, SOCKS4a and SOCKS5. A SOCKS5 user name and password comes from the
  app's `ALL_PROXY`/`SOCKS_PROXY` (`socks5://user:password@host:port`), else
  from what the person typed once in the app's own window when the proxy
  asked (`electron/proxy-credentials.mjs`: kept per proxy host:port with
  `safeStorage` in `proxy-passwords.bin`, Cancel not asked again until a
  restart, a refused saved password forgotten). The OS's own proxy passwords
  (Keychain, Credential Manager) are not read. A proxy that fails never turns
  into a direct connection unless the answer lists DIRECT after it; a failed
  system proxy lookup (PAC out of reach, script error) is direct and logged
  as `direct (system proxy lookup failed)`. Behind a proxy, a name this
  computer cannot resolve is the proxy's to resolve (never with "local
  network only", never `localhost`). The activity log records the route
  (`via`) and the detailed error; the server, the bot and the audit get only
  a coarse reason (`coarseFailure`), never the proxy's address. Real
  Electron: `pnpm exec electron scripts/verify-desktop-proxy.electron.mjs`.
- Local VM creation (`local_vm` action `create`, operation `vm_create`):
  only after the person's yes in the desktop app's own prompt
  (`confirmBridgeLocalVm` in `electron/main.mjs`, the Local VM's
  `confirmCreate`), the same one-click setup as the Computer tab from the
  server's own recipe (`localVmDesktopSpec`, checked on the desktop by
  `validLocalVmSpec`) on this app's `vm-home`. An existing VM is reported,
  never recreated; a stale one is repaired from the Computer tab only. After
  the yes (never before), steps go
  to `/api/desktop-bridge/<id>/progress` (that desktop's live job only, 50
  at most); the first one shows the bot's computer being set up to whoever
  can see the bot (`computer` `provisioning`, then `ready`). The step text
  is not shown live: it comes back in the tool's result. A turn that ends
  does not stop a creation under way; the next `create` or `status` reports
  it.
- Attachments of the CURRENT message are the speaker's only when the first
  message naming them is theirs; small text ones are inlined, all are copied
  where the tools run at the first tool call, and the tag names that path.
- The desktop never reads or writes the app's own data, its cookies or the
  person's credential stores through the bridge.

A change under `server/` needs the server image redeployed; under `electron/`
a desktop rebuild.

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
- Connected apps (or Model providers while Connected apps is off) shows them read-only (`GET /api/me/harness-connectors`, the
  caller's own account only, no email or URL) with a link to
  claude.ai/customize/connectors; an admin turns them off with
  `PUT /api/harness-connectors/settings` (`config.harnessConnectors.claudeAi`).
- Codex: ChatGPT connectors need Codex's own ChatGPT login, which Sagax's
  ChatGPT plan mode and API keys do not have, so Codex turns get none.

## Engine slash commands in the chat

Typing "/" in a conversation or a group lists Sagax's own commands and
the bot engine's (`shared/harness-commands.ts`, `server/harness-commands.ts`,
`src/components/ComposerCommandMenu.tsx`). Keep these rules, each covered by
`shared/harness-commands.test.ts`, `server/harness-commands.test.ts`,
`server/harness-commands.e2e.test.ts` or the driver tests:

- The engine lists them itself, without a model call, in the folder and
  isolation the bot's turns get (`ProviderInstance.listCommands`): Claude
  Code answers the stream-json `initialize` control request (built-ins,
  project commands and skills, plugin commands and skills, MCP prompts);
  Codex answers `skills/list`. `GET /api/bots/:id/harness-commands`
  (`?threadId`, `?refresh=1`) caches them per bot, engine and scope.
- A message whose first word is an engine command reaches the engine
  verbatim (no recall, reply or replay wrapper); Codex gets the skill's file
  with `$name`. Without a session to resume, the next turn still gets the
  replay. Peer hops and card continuations never run one.
- Sagax's commands (`goal`, `learn`, `setup`) win a name collision; the
  engine's is `/engine:<name>`. What the chat cannot run (terminal-only, or
  managed by Sagax: model, effort, sessions, approvals, MCP) is listed dimmed
  with its reason and refused at send (409).
- In a group (not a bot-to-bot channel, not a goal) a command is for ONE
  bot (`groupCommandTarget`): the bot the message starts by mentioning
  (`@Scout /compact ...`), else the lead when the group answers with one
  member. Only that bot answers (mentions in the arguments add nobody) and
  it gets the command verbatim, not the room context. Only a name that
  bot's engine lists narrows the responders: any other `/word` is an
  ordinary message, routed by its mentions. The "/" menu lists the
  commands under each bot's name (`?groupId=` on the route, which needs
  `channel.post` on the room: a read-only member is refused, since listing
  starts the engine); a group that names no single bot (everyone, Auto,
  mentions only) lists every active member, each with its share of the
  menu (`groupMenuLimitPerBot`), and a pick inserts `@Name /command`.
- On an organization server the list is the SPEAKER's
  (`harnessCommandAccount`): their own subscription's login directory
  (their user skills and plugins, Codex `CODEX_HOME`) and the claude.ai
  connectors their turn keeps. Cached per bot and person (the access
  identity) only where it changes the list; a key, the organization's or
  the server's access share the server's list (`commandListAccess` never
  carries a key). Live session additions are kept per bot and account.
  The client caches the lists per viewer (`src/lib/harness-commands.ts`):
  another person signing in to the same tab never sees the last one's.
  Covered end to end by `server/org-harness-commands.e2e.test.ts`.
- `scripts/smoke-harness-commands.ts` checks the real CLIs.

## Bot panel

The bot's side panel (`src/components/BotSettingsDialog.tsx`, tabs in
`bot-settings/panel-tabs.ts`) shows Details | Library | Computer | More. The
name and label are edited where they show (`InlineEditableText`), the
description behind the (i) beside the name (`DescriptionInfo`); there are no
Name, Label or Description fields. Details lists Coding first
(`ActivitySection`, `ActivityDetailModal`), then Routines. Coding reads
`GET /api/bots/:id/activity` and `/activity/item`
(`server/routes/bot-activity.ts`, types in `shared/bot-activity.ts`): every
thread passes `botThreadReadable`, every routine run `routineSeenBy`; a run
seen without its thread has no steps or thread link, and a sub-agent on
someone else's thread shows no request text. A failed routine run carries
its access card (`access`, `routineRunAccessCard`) for the card's audience
only: the bot's owner reads the card of a run refused on their credentials
in another person's private thread there, with its actions, and nothing else
of that thread. The owner's notification of such a run names no thread, only
`routineRunId` (`routineAccessNotifications`), and opens the run there
(`openBotActivity`); the run's person keeps the thread link. Tests:
`server/routes/bot-activity.test.ts`, `ActivitySection.test.ts`,
`InlineEditableText.test.ts`, `BotSettingsDialog.caption.test.ts`,
`server/org-routines.e2e.test.ts` (owner pays).

## Computer tab and Local VM on an organization server

The Computer tab (`src/components/computer/OrgComputerTab.tsx`) draws the
solo screen: one rounded screen (`ComputerScreen.tsx`) with Play / Pause /
Stop on it and "<Bot>'s screen" below, one line naming the computer the
bot's Works on uses with a link to change it (no selector there), and a
usage panel that keeps polling while the environment is off. States are
words (Off, Starting, Running, Paused, Error); never show the desktop's raw
answer. The server environment's live view is view-only with "Take control"
in the middle of the screen and a "Release control" chip while in control.

On an organization server the bot's Works on (or the conversation's pin)
decides where it runs, never a per-person switch (2026-10-02,
`resolveBotWorkplace`, `orgComputerFor` in `src/lib/place.ts`): Auto and
Cloud ("Cloud (server environment)") run in the person's server
environment, Local VM and This computer on their own computer through the
desktop app; no Boat, VPS or host computer is claimed there. Settings >
Computer says so and holds the Local VM card and the compact server
environment card (`settings/OrgComputerSettings.tsx`). VPS Computer and
Boat Computer are experimental flags (`features.vpsComputer`,
`features.boatComputer`, off): off hides their cards and backend choices
and, on a solo server only, the Cloud place; they never hide the
organization's Cloud nor the local places (`placeOffered(place, config,
organization)`). Tests: `OrgComputerTab.test.ts`,
`experimental-computers.test.ts`, `PlaceChip.test.ts`,
`AccessSection.test.ts`, `server/desktop-bridge.test.ts`.

The Local VM in server mode lives on the person's computer
(`electron/local-vm.mjs`, `POST /api/me/desktop-bridge/local-vm`):

- Runtime detection runs on the desktop (Docker Desktop, OrbStack, Colima,
  Rancher Desktop, Podman; bare PATH, sockets, `docker context`), never on
  the organization server.
- A container whose bind mount or `com.openmausbot.workspace-path` label
  names another folder, or one that no longer exists, is stale: never
  started, recreated by setup on `<data>/vm-home` (the old folder is kept).
- Setup (one click) uses the server's recipe (`localVmDesktopSpec`), which
  the desktop checks (`validLocalVmSpec`) before running it. Nothing is
  installed without the person's click and an OS dialog.
- Tests never create a container under the real name: vitest sets
  `OMB_LOCAL_VM_TEST_NAMESPACE` (`server/testing/global-setup.ts`), names
  become `openmausbot-test-<ns>-computer`, labeled and removed at the end;
  a real-named VM is refused in the temp folder (`localVmFolderRefusal`).
  Tests: `electron/local-vm.node-test.mjs`, `server/local-vm-hygiene.test.ts`,
  `server/desktop-bridge-local-vm.test.ts`.

## Group settings

A group has no setup dialog and no pending setup state. Every group setting
lives in its side panel (`src/components/GroupPanel.tsx`, the bot panel
shell): the name is edited in place at its top (its owner) and the (i)
beside it shows the instructions; Details holds the people and bots; Instructions holds the
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

On an organization server (`SAGAX_IDENTITY=perspicax`) only a group's owner
changes its settings (`server/group-ownership.ts`, client
`src/lib/group-owner.ts`; covered by `server/group-ownership.test.ts` and
PT-4 in `server/org-private-threads.e2e.test.ts`):

- The owner is `createdBy`, else the first person in `humanIds`, else
  nobody, and then the organization admins act as owner. The wire group
  carries it as `ownerId` (absent on a solo server, where nothing changes).
- Only the owner changes the name, instructions, working folder, default
  responder, bots and people (`PATCH /api/groups/:id` answers 403
  `not_group_owner`). Anyone listed may remove only themselves (leave),
  and add or remove their own bots (never another person's, never a
  reorder). The owner removes any bot or person.
  Marking read, pins and section moves are not settings.
- An admin has no override on content. `DELETE /api/groups/:id` is the
  owner's, or an admin's for moderation (`channel.moderate` on a room in
  `server/authz.ts`). A client-scope session may delete only there.
- The owner of a client-scope session also picks the default responder.
  The working folder keeps the admin scope (it touches the host or sandbox
  filesystem): a non-admin owner sees it read-only with a note.
- The panel shows the settings read-only to everyone else, with "Seul le
  propriétaire du groupe peut modifier ces réglages", a Leave button,
  "Ajouter mon robot" and a remove button on their own bots only.

## Primary Bot (formerly Chief of Staff)

A person's Primary Bot is their main contact among their bots: it gets the
coordination prompt (`server/chief-of-staff.ts`), team setup, retries and
peer proposals the Chief of Staff had. Stored and sent under the old field
name `chiefOfStaff` (`shared/wire.ts`); everything a person reads says
"Primary Bot" / "Robot principal". Keep these rules, covered by
`server/store.test.ts`, `server/team-setup-requests.test.ts`,
`server/team-backup.test.ts`, `src/lib/primary-bot.test.ts` and
`src/components/PrimaryBot.test.ts`:

- One per person (one on a solo server), never per section:
  `Store.setPrimaryBot` hands the role over among the bots of one owner
  (`Store.botOwnerKey`, set by index.ts to `effectiveBotOwner`). Sections
  never conflict over it.
- `POST /api/bots/:id/primary` is the owner's own (on a solo server also an
  admin session); an organization admin has no override. On an organization
  server a Primary Bot proposes, sets up or deletes only its own person's
  bots (`primaryBotSameOwner`).
- Boot runs `enforceOnePrimaryPerOwner` (idempotent): from one Chief per
  section, each person keeps the General one, else the oldest; the teams the
  others led join its `managedSections`.
- Imports are additive (`adoptImportedLeaders`): a person who has a Primary
  Bot keeps it unchanged; otherwise the first leader becomes it.
- UI: the orange star (`BotAvatar primary`, `PrimaryBotBadge`) on the
  viewer's own Primary Bot in lists (sidebar, pickers, team map, chat
  header), never the old crown chip. The sidebar menu offers "Replace with
  different Bot" (opens `PrimaryBotPicker`, "Choose a primary Bot") on it and
  "Make primary bot" on the viewer's other bots.

## Legacy names kept for compatibility

The product is Sagax and the code reads `SAGAX_*`. These old spellings stay
on purpose; `scripts/rebrand-upstream.mjs` (PROTECT, SKIP) knows them, so run
it after an upstream merge instead of renaming by hand.

- Environment: an old `OMB_*`, `OPENMAUSBOT_*` or `OPENMAUS_*` variable is
  moved onto `SAGAX_*` at start for one release (`bridgeLegacyEnv`; names
  saved as data go through `currentEnvName`/`readEnvName`). The fleet unit
  template and instance env files (`server/fleet.ts`), `cloud-home-start.ts`,
  the `Dockerfile`, the compose files, `.env.example` and `deploy/` still
  write `OMB_*`: installed units and operators' `.env` files use them.
- Data: `~/.sagax` (an old `~/.openmausbot` moves there once), but the lease
  `openmausbot-server.lease`, `.openmausbot-server-child`, the container path
  `/data/.openmausbot` and `~/.openmausbot-companion` keep their names.
- Identity: `appId` `com.openmausbot.app` and `desktopName` (auto-update
  signature, Windows install id), the package.json `name` and the
  `openmausbot` command (`server/openmausbot.ts`, `dist-server/openmausbot.js`,
  named by installed service units).
- Links: both schemes `sagax://` and `openmausbot://`, both
  `/.well-known/sagax/` and `/.well-known/openmausbot/`, and the health body's
  `app: "openmausbot"` beside `product: "sagax"`.
- Tokens: `sgx_` is issued and `omb_` still accepted; pairing codes stay
  `omb_pair_` (released phone apps check it); other `omb_*` prefixes (cookies,
  relay tokens) are wire values.
- Wire and stored names: `x-openmausbot-*`/`x-omb-*` headers, storage keys and
  IPC channels (`openmausbot:`, `openmausbot.`, `omb.`, `omb-`), file formats
  (`openmaus.*`, `.openmaus.json`, `.ombbackup`, `OMB-WORKSPACE-1`), the
  `omb-ask` block, `com.openmausbot.*` container and launchd labels,
  `_openmausbot._tcp`, MCP server names, systemd units and host paths
  (`/etc/openmausbot`, `/var/lib/openmausbot`), the upstream's hosted
  domains (`*.openmausbot.com`).
- Stored field names that predate a rename of their own, such as a bot's
  `chiefOfStaff` (the Primary Bot, see above).
- The native apps (`ios/`, `android/`): bundle ids, keychain services and
  package names change only with a store release of their own.
- Legal and history: `LICENSE-APACHE`, the OpenMausBot lines of `NOTICE`, the README attribution,
  About's "Based on OpenMausBot", "Where work goes" and "Upstream sync" below.

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
- Run `node scripts/rebrand-upstream.mjs` (a report), then `--write`, and
  review the diff: upstream code comes back with the old names.
- Run `pnpm install --frozen-lockfile`, typecheck, lint, the unit suites and
  `pnpm build`; compare failures with `origin/main` before pushing to
  `origin` only.
- MCP sign-in is ours (`server/mcp-oauth.ts`, vault `mcp-oauth.enc` and
  `mcp-oauth.key`, both left out of workspace backups). Upstream's own
  MCP sign-in manager and routes were not taken.

## No phone-home

Sagax contacts no service of the original OpenMausBot project and sends no
telemetry. Keep these rules, each covered by a test:

- Updates come only from our GitHub releases: `electron/update-feed.mjs` pins
  electron-updater to `pulsatrixtechnologies/pulsa-bot` (channel latest,
  pre-releases opt-in in Settings > General). Tests:
  `electron/update-feed.node-test.mjs`, `electron/updater.test.mjs`.
- No analytics: `src/lib/analytics.ts` is a no-op and `posthog-js` is gone.
- `electron/upstream-hosts.mjs` is the block list (every `openmausbot.*`
  domain, `posthog.com`, the upstream author's GitHub). Main guards its fetch
  and every Electron session; the server imports `server/network-guard.ts`
  first. Upstream defaults stay empty: Cloud (`CLOUD_ORIGIN`, bridges behind
  `--sagax-cloud`), control plane (`SAGAX_CONTROL_PLANE_URL` of ours only),
  Admin portal, Pro link, team catalog (`SAGAX_TEAM_LIBRARY_URL`).
- `pnpm check:no-phone-home` (run by `package:prepare` and
  `electron/no-phone-home.node-test.mjs`) fails when a bundle names a blocked
  host outside its reviewed allowlist; `server/no-phone-home.e2e.test.ts`
  audits a server start and a chat turn.
