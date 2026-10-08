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
