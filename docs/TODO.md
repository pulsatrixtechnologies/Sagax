# TODO

Backlog of requests not started yet. One entry per item: the request, who asked, the date, and what is known. An item leaves this file when its pull request is merged.

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

- Categories taxonomy: apps are placed in Productivity, Communication, Design, Code, Password managers or Other by a word list on the client (`src/lib/plugins-model.ts`, `CATEGORY_WORDS`). Composio's catalog carries categories of its own; reading them from `/api/connectors/catalog` would place the long tail correctly.
- "Recommended for you" is the reviewed plugin catalog (`shared/plugin-catalog.json`), the same for everyone. Nothing is personalised yet.
- Several accounts per MCP server: an MCP server has one sign-in (one "default" account row). "+ Add another account" exists only for connected apps (Composio). Several OAuth profiles per server need `server/mcp-oauth.ts` to key tokens by server and profile.
- Per-tool switches for connected apps: the detail page of a Composio app has no Tools card; its tools are chosen per bot in Access settings (`connectorTools` grants). A workspace-wide switch would sit beside the per-bot grants.
- Uninstall a private skill from the panel: the skills library has no delete endpoint (`/api/skills-library/:name` reads and switches only).
- Bot templates link from the Manage page (the reference has one); Sagax templates live in the bot creation flow.
- Marketplace tokens for private repositories: a marketplace clones with this computer's git credentials, or the acting person's GitHub connection for github.com. No per-marketplace token is stored (a token field per marketplace, kept like MCP header values, would cover GitLab and other hosts).
- Agents and commands of a marketplace plugin: "Add" in the Plugins panel installs its MCP servers and skills for every bot; its `agents/` and `commands/` load only through a bot's own Library > Plugins (`server/bot-plugins.ts`).
- Updating an installed marketplace plugin: refreshing a marketplace offers its new plugins; an installed plugin is updated by uninstalling and adding it again.
- A marketplace added by the address of its marketplace.json (not a repository) installs a plugin's MCP servers (`.mcp.json`, plugin.json) read over https, not its skills (a folder listing needs a repository).
- Providers other than Claude: Plugins > Manage > Providers lists every engine account, but only a Claude subscription brings its connectors to bots. ChatGPT connectors need Codex backend auth (see `server/harness-connectors.ts`); Grok and Gemini have no known path, and no "Manage on" address is shown for them until one is known.
