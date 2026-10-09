# TODO

Backlog of requests not started yet. One entry per item: the request, who asked, the date, and what is known. An item leaves this file when its pull request is merged.

## A desktop local model on an organization server needs no provider key (JC, 2026-10-08)

Request: a bot or thread whose model points at a local engine that only exists on the person's desktop (pi on a desktop local model, `desk...::model`, #189) must not refuse the turn on the organization server. It should run there through the desktop bridge when the desktop is connected, and fall back to the person's connected cloud engine or the Auto pick (#153) with a notice when it cannot.

Today (fix/routine-run-rpc-error): a thread whose own model has no credentials on the server for the payer gives way to its bot's model with a notice (`healOrgRefusedThreadModel` in `server/index.ts`), the way a model that is gone already did. On GOX this was Cryptic's "Team incidents" thread, pinned to `pi / desk8a1ada8002::qwen3.8-flash-next`, which refused every incident report with `no_access/no_credentials (pi)`.

Still open:

1. `resolveEngineAccess` (`server/engine-credentials.ts`) asks pi for a provider key (anthropic, openai, xai, google, moonshot) even when the picked model is a desktop local model that needs none. A desktop inject model on pi should get its own access (the desktop model grant) instead of `no_credentials`.
2. When the bot's own model is refused too, the turn is still refused with the access card. Falling back to the payer's connected cloud engine, or to the Auto pick for that payer, needs a rule for who pays and a notice in the thread.
3. Incident reports (`reportIncident`) could skip a Primary Bot whose engine cannot run for its owner on the server, and notify the person instead.

## Several accounts in the desktop app (JC, 2026-10-08)

Request: add more than one account to the desktop app and switch between them in one click, like the account menu of Claude Desktop (Switch account, Add account, Log out, the current account checked, name and email on each row).

Today: in server mode the app is locked to one organization server (`withServerMode` in `electron/main.mjs`). `switchEnvironment` returns early and `requireNotServerMode` blocks adding another server; the Server menu only offers "Change server...", which signs out, clears that server's data, forgets the server and returns to the launch screen. Switching between two organization servers means signing out of one and into the other every time. The desktop bridge follows the server-mode server only. A packaged app in server mode does not start the local server, so going back to local mode is a restart.

Design sketch (several days of work):

1. `electron/environments.cjs`: server mode holds several organization servers plus the current one, instead of one locked id. Idempotent migration from the single `serverModeId`, with node tests.
2. `electron/main.mjs`: switching loads the other server's page (its HttpOnly cookie is kept); an expired session opens `startPulsatrixSignIn` for that server. "Add account" opens the browser sign-in for a new server without signing the others out. "Log out" signs out of the current server only.
3. Rebind the desktop bridge, the tunnel, computer sharing, the floating windows and the retro assistant window on a switch. Nothing may keep calling the previous server.
4. `src/components/SidebarProfileMenu.tsx`: an account submenu (name and email from `state.config.viewer`), new preload calls in `electron/preload.cjs`, translations in en, fr and pt-BR.
5. Solo mode as a third account needs the local server running beside server mode: either a restart or a change to the boot sequence (the largest risk).

Bots, threads and sidebar state need no extra isolation: each server draws its own UI on its own address, so browser storage is already separate per server.

## Full ChatGPT Pets style mascot mode (JC, 2026-10-08)

Request: make the desktop mascot a full ChatGPT Pets style companion, with a voice call that starts from the character, live captions and task chips beside it, and a virtual pointer that shows the person where to click on their screen. JC wants the whole experience (Pets + Voice + pointer), not one piece.

Today: the mascot is a transparent always-on-top window per bot, and a mascot call runs the app's single voice call (`LiveCallEngine`). The call is a 36 px pill under the feet (timer, push-to-talk, mute, end); there is no caption or transcript beside the mascot, and no global hotkey in `electron/`. Computer use (CUA) can act on the screen but has no pointing or highlight tool, and the driver's agent cursor is not used for pointing.

Design sketch (about 18 days in total, in two slices after a small first step):

1. Slice 2, about 7 days: a call rail beside the character (status chip, live captions, task chips with Allow / Stop, compact transcript), per-phase animations for each character, and a global hotkey for the call. Single call engine, no new server piece for voice.
2. Slice 3, about 11 days: a click-through overlay per display (`electron/pointer-overlay.mjs`), tools `point_at`, `show_me` (guide or do), `clear_pointer`, consent to act from the rail, and an activity log entry for each point and act.

Open questions for JC (full text in the plan):

1. Must the pointer work over native fullscreen apps and games, or is "normal windows and fullscreen Spaces where macOS allows it" enough?
2. Should the mascot call coexist with the main window's call bar, or replace it while the mascot is on screen?
3. Click on the mascot when idle: open the call (ChatGPT behaviour) or keep the balloon (today)? Call on double-click?
4. Default hotkey: Control+Option+Space ok? Mute vs push-to-talk on the same key?
5. Should the pointer be visible in screen shares or hidden from the bot's own screenshots? The two exclude each other.
6. Consent for acting: per task, per app, or a timed "drive for 10 minutes"?
7. Server mode: may an organization bot point or act on a person's screen from a call, or solo only first?
8. Use CUA's agent cursor for real actions, or our overlay for both?
9. Captions on by default beside the mascot?
10. Linux Wayland: acceptable to ship without the pointer there?

Started first (easy, high value): mascot hover controls (quick chat, voice, activity), a global hotkey for the call, live captions beside the mascot during a call; the rest waits for JC's answers.

JC's answers (2026-10-08): a click on the idle mascot opens the call; the mascot call coexists with the main window's call bar (one engine, two surfaces); Control+Option+Space is the hotkey; captions on by default.

Slice 2 (`feat/mascot-desktop-2`):

- [x] Hover controls beside the character (quick chat, voice, activity tray with Allow / Stop), 150 ms in, 400 ms out (`hover-controls.ts`, `MascotControls.tsx`, `tray.ts`).
- [x] Click = chat balloon on the idle mascot (JC, 2026-10-08: a click must not call; the hover call button and the hotkey do); a drag stays a drag, a click on a call ends nothing (`mascotClick`).
- [x] Global hotkey Control+Option+Space: press to call, again to mute, hold to talk in push-to-talk mode (`electron/mascot-hotkey.mjs`, `hotkey.ts`, Settings > Appearance).
- [x] Captions and the phase's status chip beside the mascot during a call, on by default (`captions.ts`, Settings > Appearance; stored with the call settings).
- [ ] Still open from the design: the call rail's task chips inside the call, the compact transcript, per-phase clips for each character, the captions switch inside the call bar's settings panel (that panel is being reworked on `fix/call-bar-card-animation`), slice 3 (pointer).

Plan: `docs/plans/2026-10-08-mascot-full-mode.md` (research on ChatGPT Pets and Voice, Clicky, the current code, and the full design).

## Plugins: what the Connect apps redesign left out (JC, 2026-10-08)

Request: the Plugins panel works like the "Connect Apps" screens of Claude Desktop (main view, Manage plugins and skills, plugin detail). These parts of the reference screens are not done yet:

- Categories come from the catalog tags (Composio's toolkit categories, a marketplace plugin's category, `category` in `shared/plugin-catalog.json`), read by `categoryFromTags` in `src/lib/plugins-model.ts`; an untagged app is under Other. The tag rules are English words: a Composio category name in another language would land under Other.
- "Recommended for you" is the reviewed plugin catalog (`shared/plugin-catalog.json`), the same for everyone. Nothing is personalised yet.
- Several accounts per MCP server: an MCP server has one sign-in (one "default" account row). "+ Add another account" exists only for connected apps (Composio). Several OAuth profiles per server need `server/mcp-oauth.ts` to key tokens by server and profile.
- Per-tool switches for connected apps: the detail page of a Composio app has no Tools card; its tools are chosen per bot in Access settings (`connectorTools` grants). A workspace-wide switch would sit beside the per-bot grants.
- Publish a private skill to the organization library: a desktop has no path to publish (the organization's Admin publishes packages), so the skill page has no Publish button.
- Bot templates: the button beside the search opens the Templates library, or the new bot dialog when Templates is off. There is no template gallery filtered by the apps a template uses.
- Two marketplace systems: Connect apps > Manage > Advanced > Marketplaces installs a plugin's MCP servers and skills for every bot, while a bot's Library > Plugins (`server/bot-plugins.ts`, member scope) adds its own marketplaces and installs Claude Code plugins (agents, commands) on that one bot. Folding the per-bot one into Connect apps needs the per-bot store to read the panel's marketplaces.
- Admin oversight of a person's connections (person panel, `PersonConnectionsSection`) and the organization's allowed marketplaces (Settings > Organization) stay where they are: they govern other people, they do not add or set up anyone's own plugins.
- Marketplace tokens for private repositories: a marketplace clones with this computer's git credentials, or the acting person's GitHub connection for github.com. No per-marketplace token is stored (a token field per marketplace, kept like MCP header values, would cover GitLab and other hosts).
- Agents and commands of a marketplace plugin: "Add" in the Plugins panel installs its MCP servers and skills for every bot; its `agents/` and `commands/` load only through a bot's own Library > Plugins (`server/bot-plugins.ts`).
- Updating an installed marketplace plugin: refreshing a marketplace offers its new plugins; an installed plugin is updated by uninstalling and adding it again.
- A marketplace added by the address of its marketplace.json (not a repository) installs a plugin's MCP servers (`.mcp.json`, plugin.json) read over https, not its skills (a folder listing needs a repository).
- Providers other than Claude: Plugins > Manage > Providers lists every engine account, but only a Claude subscription brings its connectors to bots. ChatGPT connectors need Codex backend auth (see `server/harness-connectors.ts`); Grok and Gemini have no known path, and no "Manage on" address is shown for them until one is known.
