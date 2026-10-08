# Sagax agent notes

Before claiming a server or conversation change works, follow
[`docs/verification/README.md`](docs/verification/README.md). Always launch an
isolated fixture; never verify mutations against the user's live app or data.

## Where work goes

All work stays in `pulsatrixtechnologies` repositories. Never open a pull
request, issue, or push against the original OpenMausBot project
(`milind-soni/OpenMausBot`) or any other upstream. Push branches only to
`origin` (`pulsatrixtechnologies/sagax`) and target PRs at it. Pass
`--repo pulsatrixtechnologies/sagax` to `gh` so it never picks a parent
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
- A member (not an admin) reads `GET /api/instances` (client scope on an
  organization server, `memberInstanceView`): the engines and their models
  without the server's account, sign-in, CLI paths or install details, so
  Settings > Model providers and the model picker draw for them. Their
  cards hold only their own access (`data-member-engine`); changing an
  engine stays admin. Before 2026-10-02 that route was admin-only and a
  member saw an empty Model providers page, hence no sign-in
  (`server/org-member-access.e2e.test.ts` MA-1, MA-2).
- Bot rights come from Perspicax (1.8.6, `sagax_bots` on each directory
  person, set by an admin on the person's sheet; default and absent mean
  `manage`). `use` makes the person read-only (`personBotsReadOnly`,
  `viewer.botsReadOnly`): `POST /api/bots` and `/api/org/import` answer 403
  `org_bots_read_only`, and so do `POST /api/internal/create-bot`, team
  setup and bot deletion (a Primary Bot must not create for a `use` owner).
  `create_bot` stores the Primary Bot's person as owner (`recordedBotOwner`),
  never the loopback caller (on an organization server that caller is a
  service and would leave the specialist to the operator). Every bot level
  they hold reads as `use` (`botLevel`, their own bots included), so no
  edit, delete, grant or routine. Full access (`PATCH` the bot or a thread
  with `{ approvalMode: "full", confirmFullAccess }`) and a thread
  `updateBotDefault` (it writes the bot's model) answer the same 403, and so
  do legacy `POST` and `DELETE /api/bots/:id/direct-grants` (MA-5, MA-6).
  A thread title stays allowed. They still talk to the bots shared with
  them (speaker pays). An organization admin is never narrowed. The UI hides
  New bot and says "Votre administrateur vous permet d'utiliser les robots
  partagés seulement" (`bots.readOnly.notice`; MA-3, MA-4,
  `server/authz.test.ts`).
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

## Default approval mode (2026-10-05)

Approve for me (`approvalMode: "auto"`) is the mode a bot starts on. Keep
these rules, covered by `server/independent-task-store.test.ts` ("moves Ask
bots and threads to Approve for me once"):

- `createBot` writes `auto` on the bot and its first thread. `POST /api/bots`
  keeps a level the request names. This computer (`computer: "local"`) stays
  Ask until its own warning. The New bot dialog shows Approve for me when the
  saved template names no mode.
- The first start of a data directory moves bots and threads still on Ask, or
  with no mode, onto Approve for me, then writes `approval-default-auto.v1`.
  A later choice of Ask stays. Edits, Full and Custom stay. A grant revoked
  at that start stays Ask, threads included. Import and team backup still
  force Ask.

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
  Perspicax fields everyone keeps their initials. The iPhone app shows it
  (home, Settings account card, Account, Switch Account) from that route
  only, with its own bearer (never Perspicax, never the `picture` URL), and
  keeps it per connection keyed by the versioned URL; it reads the session
  again at each foreground (`ios/UITests/OrgAvatarUITests.swift`,
  `PARITY_ORG=1 node ios/parity/fixture-server.mjs`).
- A personal computer whose desktop app is signed in to an organization
  server serves its owner's avatar the same way
  (`server/owner-identity.ts`, `electron/owner-identity.mjs`): main reads
  `<org>/api/auth/session` and the avatar it names with the app's own
  organization cookie (nothing new stored), and sends name, address, version
  and bytes over the private parent port (`openmausbot:owner-identity`; null
  when signed out or no organization server is saved; an unreachable server
  changes nothing). The server keeps them in `owner-identity.json`, adds them
  to `GET /api/auth/session` and serves `/api/people/<operator>/avatar?v=`;
  the companion sidecar lets that route through. Refreshed at server start,
  after a sign-in, when saved servers change and every 15 minutes. Tests:
  `server/owner-identity*.test.ts`, `electron/owner-identity.node-test.mjs`,
  `PARITY_OWNER=1` with `OrgAvatarUITests`.

## Settings layout: one card level, sub-pages for long settings

Settings draws one level of card: what sits inside a card is flat (no
bordered box in a bordered box; `ManagedProfileIdentity flat` in General).
A setting too long for a card gets a sub-page instead of a growing card
(`src/components/SettingsSubPage.tsx`): the section shows a
`SettingsSubPageRow` (title, one-line summary, Edit) and the page replaces
the section with a back arrow and the breadcrumb "General > About me".
Back, the breadcrumb and Escape return to the section (Escape is taken in
the capture phase, so it never closes Settings from a sub-page). The open
page is `appSettingsSubPage` in the store (`toggleAppSettings` with
`subPage`; any other navigation clears it); register a page in `SUB_PAGES`
in `SettingsModal.tsx`. About me is the first: a full-height editor that
saves as you type, a character count (24,000 max, `server/config.ts`), a
short guide with an outline, and the block bots read
(`userProfileSystemPrompt`). Tests: `src/components/SettingsSubPage.test.ts`,
`src/components/SettingsModal.serverMode.test.ts`.

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

A nudge (`POST /api/nudges`, `server/nudge.ts`) is organization only.
`{ principalId }` shakes that person and writes the line in the direct
conversation. `{ groupId }` shakes the other people of that group chat
(listed people, `team:` members who are not managers, and the shared
section's owner and members) and writes one line on the group, never a
new direct conversation. The sender, service accounts and people who are
out are skipped. Someone who cannot post is refused. The room shares one
5 minute clock (`group:<id>`), separate from a direct nudge. A refusal
writes nothing. The button is last in the composer when the room names
someone else (`src/lib/group-nudge.ts`). A bot uses `nudgePerson` or
`nudgeGroup`, both rewritten to that one POST. Tests:
`server/nudge.test.ts`, `server/routes/nudges.test.ts`,
`src/components/GroupView.test.ts`. The server image must be installed
before an organization server accepts `{ groupId }`.

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
`SAGAX_DEFAULT_SERVER`. The welcome tour and Settings > Organization no longer
offer the inherited managed-desktop Admin sign-in. Organization is Perspicax. See
`docs/self-hosting.md` ("At launch: No server or Server").

Server mode (the launch screen's Server) is exclusive: `serverModeId` in
`environments.json` (`electron/environments.cjs`) locks the app to that
organization server. While it is set nothing switches to Local or another
server (`withActive`, `switchEnvironment`, `requireNotServerMode`), the
packaged app starts no local server, and the only way out is `leaveServerMode`
in `electron/main.mjs` (Settings > General > Server > Sign out, Server > Change
server…), which asks in a native dialog ("Sign out of <name>?"), signs out
and returns to the launch screen. That Server card names the server's
address in bold, the organization and the signed-in person
(`ServerModeCard`, test `src/components/SettingsModal.serverMode.test.ts`). Tests:
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

## Composer: one bar in Simple and Advanced (2026-10-08)

JC's decision: the chat bar is the same in both modes, and it is the
Advanced one. `src/components/Composer.tsx` reads no interface mode. Keep
these rules, covered by `src/components/ChatView.controls.test.ts` ("renders
the same composer row in Simple and Advanced mode"),
`src/components/ApprovalModeSelector.simple.test.ts` and
`src/components/ModelPicker.simple.test.ts`:

- One row: paperclip, the approval icon and its full menu (a warning sign for
  Full access, the command allowlist for an owner or admin), the "where the
  bot works" chip, the message field, the model chip (effort included), voice
  and send. No approval chip or cards in Simple.
- The slash menu lists the same commands in both modes.
- Guards stay where they are, whatever the mode: the Full access and local
  Auto warnings, the packaged-desktop rule for Full and Custom, the
  organization's Full access switch.
- Simple still hides settings sections, bot panel sections and the model
  picker's engine controls (`src/lib/interface-visibility.ts`,
  `ModelPicker.tsx`). Bot settings in Simple keep the two stacked approval
  choices (`ApprovalModeSelector` with `wide`).

## Model picker

The model chip (composer and chat header, `src/components/ModelPicker.tsx`)
opens a modal like Settings, portalled to `<body>`: providers with their
status on the left, account, scope, models, effort and payers on the right,
a bottom sheet on a narrow window; focus stays inside and Escape closes it.
`contained` (the bot settings dialog) keeps the label and the pill and opens
the same modal. Thread scope and Effort stay out of that modal. Effort stays
on its own card. On an organization server it shows the speaker's payer order
(`src/lib/model-payers.ts`: subscription, key in Perspicax, organization
key, as `server/engine-credentials.ts` decides; the payer used now is the
server's `myTurns`, never recomputed; a routine thread shows the owner's
credentials) and signs in their own subscription through `/api/me/engines/<id>/login`
(`ModelPickerPayers.tsx`), never the server's engine login; the server's
local models are not offered. Tests: `ModelPicker.interaction.test.ts`,
`src/lib/model-payers.test.ts`; real Electron: `scripts/verify-server-mode.ts`
(org) and `pnpm exec electron scripts/smoke-approval-modes.cjs --model-ui-only`
(solo).

### Local models in the picker

Local rows (`host::model` inject ids, `local: true` on the option) show under
a Local group below the engine's own models, in Simple and Advanced
(`src/lib/local-models.ts`). Labels read "DwarfStar: Qwen3.8 Flash Next" from
the server's `/v1/models` `name` (the id is added when several ids share one
name) and `context_length` becomes `contextWindow`.

- Which engines run them: `shared/local-model-engines.ts`. pi, Codex, Grok
  CLI, Kimi, Qwen, Droid, Hermes and OpenCode take an OpenAI-compatible base
  URL. Claude Code runs a loopback row (solo: the server answers
  `/v1/messages`, as DwarfStar, Ollama, LM Studio and llama-server do) but not
  a desktop row: the bridge carries `/v1/models` and `/v1/chat/completions`
  only, and there is no protocol proxy. Any other engine keeps its own
  endpoint. The picker greys a row the engine cannot run, with one line
  saying why, and `DesktopLocalModels.assertAvailable` refuses it at turn time.
- Solo: `server/drivers/local-inject.ts` `LOCAL_HOSTS` probes the same ports
  as the desktop (`shared/desktop-local-models.ts` `SEED_ENDPOINTS`).
- Organization server: only the person's own computer counts
  (`isDesktopModelId`); the server's own loopback models are never offered.
  The desktop probes every 15 s and publishes ids, labels and details, never
  URLs (`electron/desktop-bridge.mjs`). Own bots may use them by default
  (`expose` defaults on when the person never chose); `share` stays off until
  turned on. A failed probe is not cached.
- Refresh on open: the picker calls `refreshLocalModelsOnOpen` (10 s fresh
  window). Solo re-reads the engine's catalog; server mode calls
  `ogb.serverMode.refreshLocalModels()` (IPC `server-mode:refresh-local-models`,
  5 s fresh window in the bridge), then reloads `/api/instances`.
- Tests: `src/lib/local-models.test.ts`, `server/desktop-local-models.test.ts`,
  `server/drivers/local-inject.test.ts`, `electron/local-models.node-test.mjs`.

## Bot actions

A bot calls the same function as the button or the route (`act` in the
agents catalog, `POST /api/internal/act`). The caller is the signed-in
person. `requiredScope` and the route's own checks decide. The comms token
is the harness and is never replayed as the person.

A person replay uses a 60-second memory-only copy of their live session
(`sessions.delegate`), with the same scopes. The desktop owner replays
through the loopback owner header. A routine, a webhook, a guest, an
unproven turn, and a shared server with nobody to act as do not become
the owner.

Reads and screen changes run now. A write waits for Allow on a card unless
this bot's approval mode is auto or full. The card stores the summary only:
no body and no query. An external runtime does not get `act`. A `bot-act`
frame reaches only that person's streams. iOS and Android ignore the kind.
The desktop dispatches it through the same path as the button.

Tests: `shared/bot-act.test.ts`, `server/bot-act.test.ts`.

## More engines on an organization server (2026-10-02)

Besides Claude Code and Codex, the server image can carry Grok Build, pi,
Gemini CLI and Kimi Code (Dockerfile: npm ones in `ENGINES`, pinned; Grok
Build through `NATIVE_ENGINES=grok`, the official x.ai release binary pinned
by version and SHA-256). Each person pays with their own credentials
(`server/engine-credentials.ts`, the order above), never the server's login:

- Grok Build (`grokAgent`): their own `grok login --device-auth`
  (`server/drivers/device-login.ts`, HOME `principals/<pid>/grok`), else
  their xAI key in Perspicax (authenticate `xai.api_key`), else the xAI key
  of Settings > Connections as the organization key.
- Kimi Code (`kimiAgent`): their own `kimi login` device code
  (KIMI_CODE_HOME `principals/<pid>/kimi`), else their Moonshot key
  (provider `moonshot`; the key home's config.toml names `api_key_env`,
  never the key).
- Gemini CLI (`geminiAgent`, listed only on an organization server): their
  Google key (provider `google`) as GEMINI_API_KEY.
- pi (`piAgent`): every key they keep (anthropic, openai, xai, google,
  moonshot) in their own PI_CODING_AGENT_DIR; the catalog is read with
  placeholders so members see every provider's models.

Personal sign-in runs that engine's own command (`loginCliFor`). A saved
`config.cli` wins, otherwise the driver's default (`claude`, `codex`,
`grok`, `kimi`, `gemini`, `pi`, `cursor-agent`, `droid`, `opencode`,
`hermes`, `qwen`, `agy`). Claude is never substituted for another engine.
An API engine has no command and no personal CLI sign-in. The sign-in
button itself stays on Claude, Codex, Grok Build and Kimi Code, the
engines whose login the server can finish (device code or their own
controller). Gemini and pi use a key. Cursor, Droid, OpenCode, Hermes,
Qwen and Antigravity are not given a borrowed login.

A key turn always runs in an empty home of the payer's
(`principals/<pid>/<driver>-key`), an org-key turn in `org/<driver>-key`
(`applyAccess` in `acp/core.ts`, `piAccessEnvironment`). Perspicax 1.8 lists
anthropic, openai and xai keys; google and moonshot are read as soon as its
directory lists them. Tests: `server/engine-credentials.test.ts`,
`server/drivers/acp/org-access.test.ts`, `server/drivers/device-login.test.ts`,
`server/principal-engine-logins.test.ts`.

## Voice mode (xAI)

The call button on a bot opens the voice call pill
(`src/components/voice-mode/`), a compact pill centered at the top of the
chat column under the name chip (`VoiceCallDock`, first in ChatView's banner
stack: collapsed it keeps its own 48px row, never covering a message;
Settings or Transcript expand it into a card over the thread that closes on
Escape or a click outside; hold lives in the settings card; states pinned
by `VoiceModeBar.layout.test.ts`; on the desktop this pill is the whole call
UI, no folded row and no full-column stage, restored from 0.4.8 on
2026-10-08 at JC's request; the iPhone keeps its own call screen and the
call card in the conversation, under `ios/`), when `GET /api/bots/<id>/voice/status` says
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
- Call turns carry `voiceCall` (Message.voiceCall); the server adds the
  hidden "Phone call" volatile section (`server/voice-call-prompt.ts`), never
  stored as the person's text. The call speaks only `spokenPart` of an answer,
  cleaned by `src/lib/voice-mode/spoken.ts`. Tests:
  `server/voice-call-prompt.test.ts`, `server/voice-call-prompt.e2e.test.ts`.
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

- Latency (`docs/voice-mode-xai.md`, "Latency"): every call turn is timed
  under its `utteranceId` on the page (`latency.ts`) and on the server
  (`server/voice-latency.ts`, `[voice-latency]` lines). A thread on a call
  passes `keepWarm` to the engine: the Claude driver keeps one process for
  the call, the per-turn comms token in a file (`SAGAX_COMMS_TOKEN_FILE`),
  never in the spawn contract. Claude starts that process when the call is
  accepted (`POST /voice/call`); the first spoken turn reuses it. A hangup
  before any turn closes the idle process. Codex and the API drivers are
  not warmed this way (a Codex warm is the ACP handshake and `session/new`
  before `session/prompt`, which is not done here, and no hidden prompt is
  sent). Do not put a per-turn value in a pooled
  process's contract: it relaunches the engine on every turn. Tests:
  `server/voice-call-latency.e2e.test.ts`, `server/voice-call-warmup.test.ts`,
  `call.test.ts` ("latency"), bench `scripts/voice-latency-bench.ts`.

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
  entry. The desktop owl is the flat one (`Owl25D.tsx`, owl-art's own SVG
  parts). A stored look `style` of `3d` still validates and is drawn flat.
  The modeled owl under `owl3d/` stays for its own checks; the editor and
  the floating window do not load it. `src/lib/floating-bots.test.ts` guards
  that.
- `fit.ts` sizes the stage for the widest pose; `pilot.ts` moves the window
  (flights, walks) through `floating-bots:geometry`, `move-to` and
  `autopilot`; main clamps every move and never saves spots flown to.
- The chat stays put (`window-frame.ts`): while the mascot is home the
  window already holds the quick chat's room (`chatHomeSize`,
  `FLOAT_HOME`), anchored on the character's bottom-right corner, so
  opening and closing the balloon does not resize or move the window. The
  balloon is drawn in that room, above the character, and scrolls. A grip
  resize or a drag away grows the window in one step, and closing fits
  back to that room rather than to the bare character. The away badge
  still fits the window to itself. Drags move the window once a frame
  (`setPosition`, one request in flight); main saves a spot once the window
  stands still and only calls `setIgnoreMouseEvents`, `setFocusable` and
  `focus` on a change. A focus that moved the window is put back on that
  same turn. With the balloon open the mascot stays home (no
  wander, no flight while its bot works), draws at 30 fps at most and the
  skin's loops rest. Measure with `node scripts/verify-mascot-chat.mjs`
  (isolated real Electron: open latency, window moves, clipped and dropped
  frames, mascot jumps, position writes, the balloon's gap to the
  character and click-through of the transparent parts, theme).
- The balloon has no shield: dragged by its header it comes right up to
  the character from any side (over the stage's empty room, touching its
  box), never over its face (`clampBalloon` in `Balloon.tsx`). Only the part
  of its offset away from the mascot grows the window; the part toward it is
  a `translate` inside the window it has. It sits above the art (z-index 2),
  under the effects (z-index 3).
- Voice calls with the mascot reuse the app's call, never a second one: the
  engine (`LiveCallEngine`) runs once in the app page (`CallEngineHost` in
  App, for the bot `useOnCall()` names) and publishes the call
  (`src/lib/voice-mode/live-call-store.ts`); the app's pill (`LiveCall`) and
  the mascot only show and drive it. The mascot's call button (balloon header,
  `hints.call`, and the menu's "call") starts that same call for its bot
  (`mascot-call.ts`, `runMascotCallEvent`): one call at a time across app and
  mascots (`lib/call.ts`). The brain sends `snapshot.call` (`FloatingCall`)
  and the levels on their own channel (`floating-bots:level`, 20 Hz, rounded);
  the window draws `MascotCall.tsx` (the pill under the mascot's feet, inside
  the stage's room; the card where the balloon goes) and the mascot bounces
  (`--fb-voice`) and leans in (`data-call`), never under reduced motion. The
  microphone is the app page's (its permission), never the mascot window's.
  Main sanitizes `call`, its events and their settings patches. Measured in
  `verify-mascot-chat.mjs` (call leg); the app's call: `verify-voice-mode.ts`.
- The desktop mascot's menu (right click, long press, the menu key) is main's
  native menu, popped exactly at the pointer (`floating-bots:menu`,
  `menuPopupPoint`: the page's CSS pixels times its zoom, kept inside the work
  area of the display under it); the drawn `.fb-menu` stays for the in-app
  overlay and an older preload.
- The balloon wears the app's theme: the brain sends `theme` (the skin and
  the brand accent, `theme.ts`, followed live) and the window stamps it;
  Trombi keeps its Hibou 98 balloon whatever the theme.
- Main retries a page that fails to load, reloads a dead or silent one, keeps
  a state sent before its window exists, and logs the page's errors; the
  window falls back to the plain owl rather than drawing nothing.
- The character (owl, original shape, Trombi, Bunbu) and its look live with the bot
  (`bot.mascotLook`, `shared/mascot-look.ts`, validated by the server), chosen
  in the avatar popover (`MascotLookEditor.tsx`) and drawn by `BotAvatar` for
  every bot avatar in the app; never draw a bot's mascot outside `BotAvatar`.
  By default the popover offers only the owl and its Common skins. Shapes
  appears after a linked Grok account. Trombi appears only from its hidden
  command (an easter egg; do not write the command down). Bunbu and every
  skin above Common appear when their achievement unlocks them. A locked
  reward is left out of the editor and the app icon picker until then. What
  a bot already wears stays listed. The phone follows the same list from the
  server's reward keys and has no Grok detector of its own.
- Bunbu is an original character of ours (a collectible-vinyl little monster:
  long paddle ears, gumdrop body, five small teeth, a tummy heart). It is
  inspired by the designer-toy genre, never a copy of an existing one: keep
  its silhouette, name and palette our own (no Labubu or Pop Mart design,
  name, logo or packaging). Its parts are SVG paths in `bunbu-art.ts`
  (`BunbuMascot.tsx`), its skins in `skin-fx/bunbu-skins.tsx` (shared
  finishes from `shape-skins.tsx` plus Plush and Velvet); its signature ear
  flop is the `ruffle` clip (the registry's `moveLabels`). iOS shows the owl
  for it until ported (`ios/README.md`).
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
A cloud routine and a room stay on that environment. A team computer does
not open a shared machine. Keep these rules, each covered by `server/user-sandbox*.test.ts`,
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
`electron/local-vm.node-test.mjs`, `electron/desktop-bridge.node-test.mjs`,
`server/local-vm-computer.test.ts` or
`scripts/verify-desktop-bridge.ts`:

- Where tools run is decided once per turn by `resolveBotWorkplace` from
  the bot's Works on (or the conversation's pin): Local VM or This computer,
  the speaker's desktop (when it is not connected, nothing runs there and
  the bot and the composer say so); Auto and Cloud, their server
  environment. The `place` of `sagax.botWorkplace.v1` no longer decides.
  Routines use the owner's desktop only when the bot works on it, it is
  connected AND the owner allowed it (off by default). Rooms: the person
  whose message triggered the turn; a follow-up nobody asked for never.
- Auto picks per step (2026-10-02, `server/auto-computer.ts`): an Auto turn
  starts in the server environment as above, and also mounts
  `sagax-computer` (`computer_select`, target `cloud`, `this_computer` or
  `local_vm`, plus a reason) and, when the person's app is connected now (a
  routine: and the owner allowed routines on it), `sagax-desktop` beside
  `sagax-environment`. The selection (`TurnWorkplace.auto`) gates every
  later call of the turn (`autoComputerToolRefusal`: Local VM allows only the
  `local_vm` tool, and its `use` action sees and drives that VM's desktop,
  never the person's own screen) and resets with each message; the egress proxy still
  follows the turn's start. A fixed Works on gets the tool too and it
  answers that the setting is fixed. Each switch is `computer.switch` in the
  admin activity log (person, bot, from, to, reason); the transcript shows a
  "Working on" chip. Claude pre-allows only `mcp__sagax-computer`. Rooms are
  unchanged. Tests: `server/auto-computer.test.ts`,
  `server/desktop-bridge.e2e.test.ts`.
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
- Local VM screen (`local_vm` action `use`, operation `vm_computer_call`,
  capability `localVm`): the bot sees and drives that VM's own desktop
  (screenshot, get_screen_size, list_apps, click, move_cursor, drag,
  type_text, press_key, scroll). The desktop runs a fixed `cua-driver call`
  as user cua. The allow-list is `electron/local-vm-computer.mjs`, checked
  again from `server/local-vm-computer.ts` before the call leaves (the two
  builds cannot import each other; `server/local-vm-computer.test.ts` fails
  if they disagree). A tool or argument that is not listed is refused.
  Screenshots come back inline. A path, a shell line and the person's own
  screen are not reachable this way. `computer_use` stays the person's own
  screen and is still refused while Local VM is selected. action `tools`
  lists the screen tools on the server, with no desktop round trip. An older
  desktop answers Invalid request or Unsupported operation; the tool then
  says to update the Sagax app. The Computer tab stays a still image plus
  the power buttons.
- Attachments of the CURRENT message are the speaker's only when the first
  message naming them is theirs; small text ones are inlined, all are copied
  where the tools run at the first tool call, and the tag names that path.
- Archives (zip, tar, tar.gz, 7z; 90 MB per file): the server only LISTS
  them (`server/attachment-archives.ts`); they are unpacked where the bot
  works, next to the copy, at the first tool call (python3 in the server
  environment, `extract_archive` on the desktop, `electron/archive-extract.mjs`;
  solo: next to the upload). No links, nothing outside the folder, bomb limits
  (5000 files, 512 MB, ratio 200, depth 24), an encrypted zip kept as is. The
  message carries an `<attached-archive>` manifest. Tests:
  `electron/archive-extract.node-test.mjs`, `server/attachment-archives.test.ts`,
  `server/archive-attachments.e2e.test.ts`, `server/desktop-bridge.e2e.test.ts`.
- The desktop never reads or writes the app's own data, its cookies or the
  person's credential stores through the bridge.

A change under `server/` needs the server image redeployed; under `electron/`
a desktop rebuild.

## A person's own connections, plugins and skills (organization mode, 2026-10-02)

Owner report: on GOX nobody could add the GitHub MCP, log into GitHub or
install plugins. Why: the server-wide MCP list was admin-only, hidden with
Connected apps, shared one token by all and ran commands on the host;
`claude plugin ...` typed by a bot hit the host Bash denial whatever
`SAGAX_CLAUDE_ALLOW` said; skills routes were admin-only; the environment
had no gh. Keep these rules, each covered by `server/org-connections.e2e.test.ts`
(OC-1 to OC-9), `server/person-connections.test.ts`,
`server/org-person-connections.test.ts`,
`server/github-connect.test.ts`, `server/bot-plugins.test.ts`,
`server/plugin-turn.test.ts`, `server/bot-plugin-act.test.ts`,
`server/sandbox-stdio-mcp.test.ts`, `server/sandboxd.test.ts` or
`src/components/settings/MyConnectionsSettings.test.ts`:

- Settings > Mes connexions (organization server only,
  `organizationHidesSection`): `/api/me/connections`, `/api/me/github/*`,
  `/api/me/mcp/servers/*` (`server/routes/person-connections.ts`), the
  session's person only, member scope (CLIENT_ALLOW, `orgDirectory`).
- One encrypted file per person (`principals/<pid>/connections.enc`,
  AES-256-GCM with the mcp-oauth vault key; `server/person-connections.ts`)
  holds their own MCP servers and GitHub token; their OAuth sign-ins live in
  their own `principals/<pid>/mcp-oauth.enc` (one `McpOAuthManager` per
  person, `ownsState` routes `/api/mcp-oauth/callback` to it). No answer
  carries a token.
- A personal server mounts for the turn's person only (`mountPersonalMcp`:
  the speaker, the owner for a routine; the workplace decision's person),
  never under a name already taken, never while it needs a sign-in, a token
  or GitHub. A remote one must resolve to a public address (checked at add
  and, cached, at mount; `SAGAX_PERSONAL_MCP_ALLOW_PRIVATE=1` is for a lab or
  a test only). A command runs in the person's server environment through
  `sagax-stdio` (`server/sandbox-stdio-mcp.ts`, sandboxd's signed stdio
  stream), never on the host; without server environments it is refused.
- A server-wide MCP command is never added (403 `org_host_command`) nor
  mounted (`withoutHostCommands`) on an organization server.
- Connecter GitHub (`server/github-connect.ts`): the device flow of the
  organization's GitHub OAuth App (`SAGAX_GITHUB_CLIENT_ID`, or
  `organization.githubClientId` from Settings > Organization), else a pasted
  token. The token goes into the person's environment for gh and git
  (`githubSandboxArgv`, through `SAGAX_GH_TOKEN`, never the argv), into their
  personal servers with auth `github`, and into Sagax's own fetches for them
  (private skills, private marketplaces). One connection per person. It is
  not the organization's list of access tokens below.
- Organization access tokens (`server/org-github-tokens.ts`,
  `DATA_DIR/org-github-tokens.enc`, the mcp-oauth vault key, left out of
  workspace backups): an admin keeps up to 20 labeled GitHub access tokens
  on Settings > Organization > Plugins and GitHub. They are access tokens,
  not extra OAuth App client ids. `PATCH /api/org/settings` applies one
  change (`add`, `remove`, `rename`, `replace`). A rename carries no secret
  and a replace is its own step. `GET /api/org` lists the label and a last-4
  hint, or the word saved, for an admin only. No answer, audit row or log
  contains the token. A bot uses the same route through `act` (the hold card
  is the route summary, with no body). Tests:
  `server/org-github-tokens.test.ts`, `server/perspicax-org-routes.test.ts`,
  `src/components/settings/OrgPluginPolicy.test.ts`.
- Plugins (`server/bot-plugins.ts`, `/api/bots/:id/plugins/*`): per bot, the
  owner or a person with manage changes them, use reads. Sagax clones the
  marketplace (git with the actor's GitHub token in an extra header, only the
  server's proxy, certificate and git config variables), copies a plugin
  without links, hooks, `.mcp.json`, `.lsp.json`, `bin/` or those manifest
  keys. Claude loads each enabled plugin with `--plugin-dir`. Every other
  harness of that bot gets the same enabled skills and commands in the skills
  section of the turn prompt. Hooks, MCP, LSP and bin stay stripped. A bot
  installs, updates, enables, disables and removes a plugin through `act`
  (plugins actions: list, add marketplace, install, set enabled, uninstall,
  remove marketplace), not an engine CLI. `organization.pluginMarketplaces`
  (any by default, or a list of owner/repo, owner/* or https URLs; PATCH
  `/api/org/settings`) applies to marketplaces and to a plugin's own repository.
- Skills routes (`/api/bots/:id/skills*`, `skill-template`) are member scope
  on an organization server: use reads, owner or manage changes; an import
  from a private repository reads with the person's GitHub connection.
- Library tab: Files | Skills | Plugins (`bot-settings/LibraryTab.tsx`).
- Who manages them comes from Perspicax (migration 0046,
  `sagax_integrations` on each directory person, set by an admin on the
  person's Sagax tab; default and absent mean `manage`;
  `server/person-integrations.ts`, `personIntegrationsOff`,
  `integrationsLocked`, `effectiveIntegrationRights`). `manage`: everything
  above, with no admin. `off`: the same change routes answer 403
  `org_integrations_admin_only`, even on their own bot; only a sign-in again
  to a server they already have passes (`oauth/start` does not mount it).
  Use stops at once and the saved credentials stay, so turning the cap back
  to `manage` mounts them on the next turn: `mountPersonalMcp` closes that
  person's stdio sessions and adds nothing, `syncGithubForTurn` and
  `usablePersonGithub` drop the token from the environment and from Sagax's
  own fetches, and `pluginDirsFor` passes no `--plugin-dir` and the turn
  prompt lists no plugin skill or command. Skills already on a bot still load.
  The directory callback `onIntegrationRights` fires
  only when the effective right changes (an organization admin stays
  `manage` even when the field is `off`; a disabled person is skipped; a 304
  does not re-fire) and closes stdio and clears or restores the GitHub
  sandbox token. The person's own screen still reads `managedByAdmin` on
  `/api/me/connections` and on the plugins listing (`canChange: false`),
  `viewer.integrationsManagedByAdmin`, edit controls hidden under "Votre
  administrateur gère les plugins et les serveurs MCP"
  (`integrations.managedByAdmin`). `run_command` in their environment and on
  their desktop refuses the engines' plugin, MCP and extension subcommands
  (`enginePluginCommandRefusal`). The tool result tells the bot to install
  through Sagax `act` plugin actions. When integrations are off, the
  administrator sentence stays. The check is a courtesy: a turn loads only
  what Sagax keeps. `/plugin` and `/mcp` are managed for everyone. An
  organization admin is never narrowed and changes a person's bot plugins
  and skills for them.
- An organization admin lists and removes another person's connections
  (`GET /api/org/people/<principalId>/connections` and
  `POST .../connections/revoke`, `server/org-person-connections.ts`): admin
  scope, `orgAdminCaller` (a service loopback is not an admin), not in
  `CLIENT_ALLOW`. A solo server answers 403 `identity_perspicax`. The list
  names MCP servers (hostname or command only), the GitHub connection
  (login, never a pending `userCode`) and plugins on bots that person owns,
  with kind, created date and last stdio use when a session is open. No
  token, env value, argument, header name or path. Remove deletes the
  stored credential, forgets that server's OAuth entry, stops the stdio
  child (`closePerson`) and writes `connections.revoke` (category `people`)
  only when something was removed. One target that is missing is 404 with
  no audit; remove-all of nothing is 200 and no audit.
  Tests: `server/person-integrations.test.ts`,
  `server/perspicax-link.test.ts`, `server/org-person-connections.test.ts`,
  OC-7, OC-8 and OC-9, `MyConnectionsSettings.test.ts`,
  `PersonConnectionsSection.test.ts`.

A change under `server/` needs the server image redeployed (sandboxd is the
same image); `deploy/sandbox/Dockerfile` (gh, node, npm) needs the sandbox
image rebuilt.

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
name and label are edited where they show (`InlineEditableText`). The
description is not a line under the label; `IdentitySection` still edits it.
There are no Name or Label fields in this panel. Details lists Coding,
Activity, then Routines (`ActivitySection`, `ActivityListModal`,
`ActivityDetailModal`).
Coding is code work only: the server marks an entry `coding` from its
tool calls and folder (`server/activity-coding.ts`: source edits, git
commit/push/worktree, pull requests, file changes inside a repository;
never the title, never the bot's own SOUL.md/MEMORY.md or its folder, never
a sub-agent's request or a heredoc's text quoting git; a sub-agent's own
calls count like any other). A coding entry carries `code`
(`server/activity-code-work.ts`): its folder's repository root, checked-out
branch and origin (read from `.git` on the server, credentials stripped;
a folder on the person's computer is not read), and the pull requests,
branches and commits its own successful git, gh and GitHub tool calls
produced, read off the calls and their output (`gh pr create` prints the
address, `git commit` prints `[branch sha]`, `git push` prints `To <remote>`).
There is no pull request record and nothing asks GitHub: a pull request
shows what the bot did to it (opened, merged, closed, updated), not its
live state. The section lists running coding jobs with their repository
and branch, then the pull requests, branches and commits of the window's
coding jobs (`codingWork`, 5 of each, newest first), each opening in the
system browser (`openExternalLink`). Activity is parallel work only
(`isParallelWork`): routine runs, work handed over, sub-agents, parallel
tasks and jobs the bot opened on itself; a conversation's own running turn
is the chat, never listed. Running entries show elapsed time, current step
and Stop when `canStop`; an entry seen running that settled reads Finished
for 5 s, fades and leaves (`LiveActivity`). A section with nothing to show
is not drawn, title included (`panelSections`); with both hidden, one quiet
History row takes their place and opens the history. A first list load that
failed is one quiet line ("Couldn't load this bot's activity."); a later
failed refresh keeps the last list. The section title opens the history
(`ActivityListModal`: coding or
other, newest first, running/finished/failed, search). A thread with no user turn is not
listed. Both read
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
`server/routes/bot-activity.test.ts`, `server/activity-coding.test.ts`,
`server/activity-code-work.test.ts`, `ActivitySection.test.ts`,
`InlineEditableText.test.ts`, `BotSettingsDialog.caption.test.ts`,
`server/org-routines.e2e.test.ts` (owner pays).

## Parallel tasks (sending while the bot works, 2026-10-02)

A message sent to a busy 1:1 conversation carries `busyMode`
(`shared/parallel-tasks.ts`): `steer` joins the running turn (the default,
live steer or the queue), `after` waits in the queue, `parallel` runs it as
its own task. The composer offers the three (`BusySendChooser`, suggested
choice by `suggestBusySendMode`, Enter picks) unless the person set a
default in Settings > Parallel threads (`sagax.busySend.v1`, synced per
person). Keep these rules, each covered by `server/parallel-tasks.test.ts`,
`server/parallel-tasks.e2e.test.ts` or `src/components/parallel-tasks.ui.test.ts`:

- A parallel task is a thread of the same bot (`TaskRecord.parallelOf`,
  never a TASK_PATCH_FIELD): its own engine session, the conversation's
  model, approval level and owner (private threads), the asker's payer
  (trigger and speaker of the send). Its first prompt is a brief
  (`parallelBrief`): who asked, recent lines of the conversation as context,
  never another parallel request.
- Working folder: a worktree of the conversation's git repository on
  `sagax/parallel-<id>` (`prepareParallelWorkspace`, under
  `DATA_DIR/parallel-worktrees`); otherwise its own private task folder,
  reading the conversation's project folder only. Two turns never share a
  folder (the workspace resource refuses the second).
- The conversation shows the request line (`parallelTask.role: request`),
  a live card (`card`: state from the task's busy/activity, Stop, Open) and,
  when the first turn settles, the answer as a reply to the request
  (`result`, `settleParallelTask`, once: `reportedAt`). Later turns in the
  task's own thread stay there. A done task closes (`closedBy`), a failed
  or stopped one stays.
- Limits: `threads.maxParallelPerPerson` (default 3) running per person per
  bot; more queue (`parallelTaskBlocked` in the drain), past twice the
  limit waiting a send answers 409 `parallel_limit`. The bot's thread limit
  still applies. A task of a task is refused (`parallel_nested`).
- Stop one: `POST /api/bots/:id/parallel/:threadId/stop` (client scope,
  thread.post), or Stop in its thread; either reads as stopped.
- Approvals stay in the task's thread and are answered there; the
  conversation's approval stepper lists them tagged with the task
  (`useParallelApprovals`, `Pending.threadId`), and its cancel stops that
  task only.
- The bot may fork itself: `start_thread` with `report_back: true` on itself.
- Org: `task.parallel_start` and `task.parallel_settle` in the admin
  activity log. Routines are unaffected (no busyMode).
- Activity lists a parallel task once (its own entry, `parallel: true`) and
  as a child of its conversation. The detail names steps in words
  (`src/lib/activity-steps.ts`, reusing the approval naming), keeps the raw
  id under Technical details, nests a Claude sub-agent's calls under its
  Agent step (`tool.parentItemId` from `parent_tool_use_id`) with its
  request and report, and a running task takes a message (steer). Claude's
  own sub-agents cannot be steered or stopped apart from their turn.

## Person panel and hidden sidebar entries

A person of the organization opens in the right panel like a bot
(`src/components/PersonPanel.tsx`, store `personPanelId`, action
`openPersonPanel`): from a direct conversation's header or context menu, a
group's person label, the group's People list and another person's name in
a bot chat. It shows the directory's fields (name, login, email,
avatar, role, teams), the groups the viewer shares with them, their bots the
viewer already sees, Message, Hide/Show, and for an admin "Manage in
Perspicax": `GET /api/org/directory` adds `manageUrl`
(`<issuer>/console/users/<sub>`) for admins only. An admin also sees
Connections for a person who is in the directory
(`PersonConnectionsSection`): each MCP server, the GitHub connection and
the plugins on that person's bots, with Remove and Remove all behind a
confirm dialog. A member does not see that section. Nothing from a private
thread. Hiding is per person and view-only (`src/lib/sidebar-hidden.ts`,
key `sagax.sidebarHidden.v1`, synced by `/api/me/preferences` on an
organization server): bots by id, groups by id, people by principal; still
reached by search, the palette and the To: picker; a "Hidden (N)" row and
Settings > Appearance show them back. A new unread message unhides people
and groups by default, bots only when the person turns it on. Archive stays
the bot-wide action. Tests: `src/lib/sidebar-hidden*.test.ts`,
`src/lib/person-panel.test.ts`, `PersonPanel.test.ts`,
`PersonConnectionsSection.test.ts`,
`src/state/person-panel.reducer.test.ts`.

## Presence: online, away, offline (organization server, 2026-10-08)

JC asked for an online / away / offline indicator on people. Keep these
rules, covered by `shared/presence.test.ts`, `server/presence.test.ts`,
`server/routes/presence.test.ts`, `server/presence.e2e.test.ts`,
`src/lib/presence.test.ts`, `src/components/PresenceDot.test.ts` and
`electron/system-idle.node-test.mjs`:

- The thresholds and the state machine are one module,
  `shared/presence.ts`: online (a client of the person is connected and
  they used it within 5 minutes, `PRESENCE_AWAY_AFTER_MS`), away (connected
  but idle longer, or the desktop says the computer is idle or the screen is
  locked), offline (no client: every event stream closed and the 20 s
  reconnect grace passed, or no sign of a client for 10 minutes,
  `PRESENCE_OFFLINE_AFTER_MS`). A person is as present as their most
  present client. Change a threshold there, nowhere else.
- Server (`server/presence.ts`, `PresenceTracker`, in memory only): one
  connection per signed-in session, from its `/api/events` streams
  (`connect` on open, `touch` on each keepalive, close on close) and its
  pages' heartbeats. `presenceViewer` in index.ts decides who counts: a
  session of this issuer whose person is in the directory, not disabled,
  not a `service` account. The loopback and a solo server never count. A
  sweep every 15 s turns crossed thresholds into news.
- Routes (`server/routes/presence.ts`, CLIENT_ALLOW with `orgDirectory`):
  `GET /api/org/presence` lists every active person of the directory with
  `state` and `lastSeenAt`; `POST /api/presence/heartbeat`
  `{ pageId, kind: "desktop" | "web", idleMs, systemIdle? }`. A solo server
  answers 404, a service account or another issuer 403, no session 401.
  An admin sees exactly what a member sees.
- Live: a change is broadcast as `presence.changed` (`shared/wire.ts`).
  `sseFrameFor` passes it only to streams of the organization's people
  (`presenceFrameAllowed`); the copy with `audience` (the person's own real
  state) reaches that person only. Presence is never written to a chat, the
  journal, a backup or a package.
- Privacy: Settings > Privacy > "Show when I am online" (on by default) is
  the synced preference `sagax.presenceVisible.v1` ("0" hides). A hidden
  person reads as offline with no last-seen time for everyone else; they
  still see their own state, "(hidden from others)". Saving the preference
  re-announces the person at once (the preferences route calls
  `presence.refresh`).
- Renderer (`src/lib/presence.ts`, started from `src/main.tsx` for a
  signed-in session): reads the list, applies the frames, re-reads every 5
  minutes and when the page comes back into view, and beats every 60 s with
  the page's idle time. The desktop app adds `window.ogb.systemIdle()`
  (`desktop:system-idle`, `electron/system-idle.mjs`,
  `powerMonitor.getSystemIdleState(300)` and the idle seconds; main window,
  top frame only, safe on an organization page); using the computer counts
  as being there. Coming back after an idle spell beats at once.
- The dot is `StatusDot` (`src/components/StatusDot.tsx`), the same
  component as a bot row's working / waiting / teammate / queued dots;
  `PresenceDot` and `WithPresence` (`src/components/PresenceDot.tsx`) give
  it the person's state, an accessible name and a tooltip ("Online",
  "Away", "Offline, last seen 2 h ago"). `PersonAvatar` takes
  `presenceId`. It shows on the sidebar's people rows, the direct
  conversation's header chip, the person panel, a room's people list
  (`ChannelMembers`), the To: picker, the sharing picker (`GrantEditor`),
  the room's people picker (`GroupPeoplePicker`) and your own account row.
  The Team map holds bots only and has no person to mark; there is no
  @mention of people and no run-as picker yet: give them the dot when they
  exist. Nothing shows where presence does not exist.
- The phone apps neither send heartbeats nor show the dot yet; a phone's
  open stream counts as connected (online for 5 minutes, then away).

## Thread mode is on by default

Thread mode (Settings > Appearance > Show threads: the thread picker in the
chat header, thread lists and "new thread" controls, and nothing under a bot
row when it is off) is ON for a person who never set it (JC, 2026-10-08).
The preference is the renderer's `omb-show-threads` in localStorage
(`src/lib/thread-preferences.ts`, `SHOW_THREADS_DEFAULT`, covered by
`src/lib/thread-preferences.test.ts`); on an organization server it travels
as a synced key (`shared/user-preferences.ts`, `/api/me/preferences`), where
an absent key means unset. The server holds no default of its own, so the
renderer fallback is the single source of truth. The switch writes "1" or "0";
unset (key missing, storage unreadable, no storage) is on, any stored value
other than "1" keeps reading as off, so nobody who turned it off is moved. Do
not seed the key at first run or in onboarding; leave it unset. The phone
apps keep their own fallback (`ios/`).

## Sidebar sections are personal

On an organization server a sidebar section is one person's folder and
shares nothing (JC, 2026-10-02). Keep these rules, covered by
`src/lib/personal-sections.test.ts`, `server/section-channels.test.ts` and
`src/components/bot-settings/SharingSection.test.ts`:

- The sections live in the person's preference `sagax.sidebarSections.v1`
  (`src/lib/personal-sections.ts`, synced per person through
  `/api/me/preferences`); the sidebar overlays them on `bot.section` and
  `group.section`, which it never writes in organization mode. A solo
  server keeps the server's sections (one person).
- The menu creates, renames, moves, folds and deletes; no members or
  sharing item. A bot is shared from its own panel; a group has its people.
- Unassigned (what is in none of my sections: my bots, bots shared with me,
  groups, conversations with people) is always shown, on top. Deleting a
  section puts its items back in Unassigned and never deletes anything.
- Server: bots take no access from a section. At boot each legacy shared
  section became bot grants once (`sectionShareGrants`, marker
  `botSharesMigratedAt` in `section-channels.json`); the records stay and
  rooms keep reading them. `PUT /api/org/sections/:id/members|bots` answers
  410 `sections_are_personal`.

## Which bots a bot reaches (organization server, 2026-10-06)

Owner report: a member's bots kept naming a bot ("Cryptic") the member
could not see. Why: once sections became personal, `bot.section` stayed
empty for everyone, so the section rule of `reachablePeers`
(`server/peer-roster.ts`) put every person's bots in one "General" team.
Each bot's roster, `list_bots`, @mentions, `ask_bot`, `delegate_bot` and
peer threads reached the whole organization. Keep these rules, covered by
`server/peer-scope.test.ts`, `server/incidents.test.ts` and S3-12 in
`server/org-sharing.e2e.test.ts`:

- On an organization server a bot reaches only its owner's bots and the
  bots shared with that owner (any level, `botLevel`), the bots the owner
  sees in the sidebar (`orgPeerInScope` in `server/peer-scope.ts`,
  installed by index.ts through `setPeerScope`). It is the owner's, not the
  speaker's, and it is not symmetric: sharing a bot with Bob opens it to
  Bob's bots, never Bob's bots to it.
- Every peer path checks it: `canReachPeer` (roster, `list_bots`, names,
  results withheld when access changed), the direct routes next to their
  `canAccessTeam` check, team setup's bot list and the delegation dispatch
  (`dropIfUnreachable`). A new peer route checks `peerInScope` too.
- Rooms keep their own rule (`roomHandoffProblem`): their members were
  added by people, so bots of different owners in one room still work
  together there. That holds only for a room the sender is a member of.
  `coordinate_bots` (what a chat turn uses, since it answers `ask_bot` and
  `delegate_bot` with 409) into another bot's direct thread or into a room
  the sender is not in needs every reader of the destination in scope, and
  `list_room_targets` lists such a room only on the same condition.
- A failure report goes to a Primary Bot of the failing bot's own owner
  (`chiefForBot` with `primaryBotSameOwner`), never the first Primary Bot
  of the organization.
- `orgPeerInScope` refuses an empty owner, but index.ts never passes one:
  `effectiveBotOwner` gives a bot with no recorded owner to the local
  operator, so such a bot is in the operator's scope, not shut out.
- A solo server sets no scope and is unchanged.

## Account menu

Team map and Automations open from the account row at the foot of the
sidebar (`SidebarProfileMenu`), in that order, with a hairline under the
pair. Archived bots, when there are any, sit above the pair. Connected
apps and Templates stay rows above that row when their experimental flags
are on (`SidebarPlaces`). Your phone and Help Center are not in the menu.
The phone stays in Settings and on the collapsed rail. Docs stay on About.
A failed automation still dots the closed account row. The guided tour's
`tools` anchor sits on the places stack, or on the foot when that stack is
empty. Tests: `SidebarProfileMenu.test.ts`, `Sidebar.header.test.ts`.

The guided tour (`GuidedTour.tsx`) never starts by itself: not after the
welcome flow, not on a new bot, not per version. It runs only when opened on
purpose (Settings > General > App tour sets `tourOpen`) or when a tour the
person had already begun is resumed after a reload (`tourInProgress`). The
first-conversation spotlights (`FirstConversationTour.tsx`) are not mounted
for the same reason. Tests: `GuidedTour.test.ts`, `guided-tour.test.ts`.

## Computer tab and Local VM on an organization server

The Computer tab (`src/components/computer/OrgComputerTab.tsx`) draws the
solo screen: one rounded screen (`ComputerScreen.tsx`) with Play / Pause /
Stop on it and "<Bot>'s screen" below, and a usage panel that keeps
polling while the environment is off. Works on is not on this tab. It is
its own section of More, labelled Computer, immediately after Access
(`worksOn` in `src/components/bot-settings/sections.ts`, `WorksOnSetting`).
States are words (Off, Starting, Running, Paused, Error); never show the desktop's raw
answer. The server environment's live view is view-only with "Take control"
in the middle of the screen and a "Release control" chip while in control.

On an organization server the bot's Works on (or the conversation's pin)
decides where it runs, never a per-person switch (2026-10-02,
`resolveBotWorkplace`, `orgComputerFor` in `src/lib/place.ts`): Auto and
Cloud ("Cloud (server environment)") run in the person's server
environment, including a cloud routine and a room. Local VM and This
computer run on their own computer through the desktop app. No Boat, VPS
or host computer is claimed there, and a team computer does not open a
shared machine. Settings >
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
- The bot sees and drives that VM's desktop with `local_vm` action `use`
  (operation `vm_computer_call`). The Computer tab itself stays a still
  image and the power buttons. See Desktop bridge above.
- iPhone and iPad show that same still and those power buttons when the
  phone is paired to the organization server and Works on is Local VM or
  This computer (`OrgLocalVmScreen` in
  `ios/Sources/CompanionCore/LocalVmComputer.swift`, drawn from
  `ios/App/ComputerView.swift` for both `ComputerView` and
  `BotPanelComputer`). Take control stays on the server environment. The
  bot still drives the VM with `local_vm` action `use`. The phone does
  not send `use`. A sidecar pairing is not an organization, so the
  companion allow-list is not widened for these routes: the app does not
  ask them there. Auto and Cloud keep the existing computer viewer.
  Tests: `ios/Tests/CompanionCoreTests/LocalVmComputerTests.swift`
  (`swift test` in `ios/`).

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

## Achievements (2026-10-02)

Catalog `shared/achievements-catalog.ts` (pure data, ids never renamed),
engine `shared/achievements.ts`, store `server/achievements.ts` (one
`achievements.json`, per person on an organization server, the local
operator on a solo server), routes `server/routes/achievements.ts`, app
`src/lib/achievements.ts` and `src/components/achievements/`. Keep these
rules, each covered by `shared/achievements-catalog.test.ts`,
`server/achievements.test.ts`, `src/lib/achievements.test.ts`,
`src/lib/achievement-toasts.test.ts` or `achievements-ui.test.ts`:

- Server events come from the server's own hooks only (a request's method
  and path in `achievementRequestEvents`, a send in `achievementSendEvents`,
  live frames in `observeAchievementFrame`); `POST /api/me/achievements/events`
  takes client events only. Events are rate limited, an event id counts
  once, an achievement unlocks once.
- By default only the owl and its Common skins are usable. Shapes unlocks
  when a Grok account is linked (the person's own sign-in or their own xAI
  key, reported as `grok.linked`). Trombi unlocks only from its hidden
  command (an easter egg; do not write the command down), or on a device
  that already found it. Every skin above Common, and Bunbu, is the reward
  of exactly one achievement. On first use a person keeps every character
  and skin their bots wear (`grandfatheredFromBots`); what a bot wears now
  stays in the editor. Locked rewards are hidden in the editor and the app
  icon picker until they unlock. The server never refuses a look.
- A server without the routes (404) locks nothing.
- The unlock frame (`kind: "achievements"`, `audience`) reaches that
  person's streams only (`achievementFrameAllowed`). Nobody reads another
  person's record; `/api/achievements/public` lists the points of people by
  default, and leaves out anyone who turned "Show my points to colleagues"
  off. Unlock percentages show only
  with five people or more.
- The toast never shows while the person types, one at a time, its chime
  follows Notification sounds, and reduced motion stills it.

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
  (`openmaus.*`, `.openmaus.json`, `.ombbackup` still imported, `OMB-WORKSPACE-1`), the
  `omb-ask` block, `com.openmausbot.*` container and launchd labels,
  `_openmausbot._tcp`, MCP server names, systemd units and host paths
  (`/etc/openmausbot`, `/var/lib/openmausbot`), the upstream's hosted
  domains (`*.openmausbot.com`). Workspace backups the app writes use
  `.sagaxbackup`. An older `.ombbackup` file still imports.
- Stored field names that predate a rename of their own, such as a bot's
  `chiefOfStaff` (the Primary Bot, see above).
- The native apps (`ios/`, `android/`): bundle ids, keychain services and
  package names change only with a store release of their own.
- Legal and history: `LICENSE-APACHE`, the OpenMausBot lines of `NOTICE`, the README attribution,
  About's "Based on OpenMausBot", "Where work goes" and "Upstream sync" below.

## Upstream sync

Last sync: 2026-10-03, upstream `milind-soni/OpenMausBot` main at
`04a8bef8` (0.1.95) merged into Sagax; `baseVersion` follows it. To repeat:

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
  electron-updater to `pulsatrixtechnologies/sagax` (channel latest,
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
