# Server environments (organization mode)

On an organization server (`SAGAX_IDENTITY=perspicax`), each **person** gets one
isolated Linux environment on the server: their "server environment"
(`user-sandbox`). Shell, file and browser tools run there whenever the turn
does not target the person's own computer (`user-desktop`). There is never
one environment per bot, and an organization server never runs a bot's tools
on the Sagax host or inside the Sagax container.

| Target | When | Where |
|---|---|---|
| `user-desktop` | the bot's Works on (or the conversation's pin) is Local VM or This computer | their own computer, through the desktop bridge (`sagax-desktop`, see AGENTS.md "Desktop bridge"), while their Sagax desktop app is connected |
| `user-sandbox` | organization mode, any other turn | one person's environment (below) |
| `host` | solo server | this machine, unchanged |
| `none` | organization mode without a provisioner | nothing is mounted |

The choice between the two is `resolveBotWorkplace` (`server/desktop-bridge.ts`),
from the bot's Works on: Auto and Cloud ("Cloud (server environment)") use the
server environment, the default; Local VM and This computer use the person's
own computer, and when their desktop app is not connected nothing runs there
and the bot and the composer say so. Routines use the server environment
unless the bot works on the owner's computer, it is connected and the owner
allowed routines on it; room follow-ups no person asked for use it too. Files
a person attaches in that turn are copied to `/workspace/attachments/`.

Whose environment (`sandboxPrincipalForTurn`, matching private threads and
"the speaker pays"):

| Turn | Environment |
|---|---|
| a conversation (1:1, private thread with a shared bot) | the **speaker**, the person talking; a bot hop keeps the person its source turn spoke for |
| a routine, and any thread or hop a routine starts | the bot **owner** (routines run as the owner) |
| a room turn answering a person | that person (the latest person who spoke in the room) |
| a room follow-up no person ever asked for | the room's **creator** (`group.createdBy`, else its first listed person) |
| nobody known | nothing is mounted (fail closed) |

A teammate's files and commands therefore never land in the bot owner's
environment, and a person's work follows them across every bot they use. A
bot's follow-up after a person's message keeps that person's environment
rather than the creator's: the work they asked for and its files stay
together, and nothing they wrote moves into someone else's environment.

Code: `server/user-sandbox-routing.ts` (targets, owner), `server/user-sandbox-tools.ts`
(`run_command`, `read_file`, `write_file`, `list_files`, `browse`,
`computer_list_tools`, `computer_use`, mounted as the MCP server
`sagax-environment`), `server/user-sandbox-manager.ts` (lifecycle on
the Sagax side), `server/sandboxd*.ts` (the provisioner), `server/user-sandbox-spec.ts`
(the exact container, network and egress policy).

## Lifecycle

- **Lazy:** mounting the tools creates nothing; the first tool call creates the
  network, the `/workspace` volume and the container, then starts it.
- **One per person:** the capability a turn's tools carry names the person
  (fixed at mount, never read from the request). The provisioner is
  addressed by an opaque key,
  `sha256(instance, principal id)`; its API has no bot parameter. Objects are
  named `sagax-user-<key>` and labelled `com.pulsatrix.sagax.sandbox.user=<key>`
  and `sagax-user=<key>`.
- **Idle stop:** after `SAGAX_SANDBOX_IDLE_MINUTES` without a command (default
  15). The next call starts it again; `/workspace` persists.
- **New image:** a stopped environment created from another image than
  `SAGAX_SANDBOX_IMAGE` (an earlier deploy) is recreated from the current one
  when it starts again, keeping `/workspace` and its network. A running one
  is never replaced behind its owner's back, except when the owner opens the
  desktop and it has none (`sagax-desktop` missing, exit 127) and no command
  runs there; otherwise the view says to stop it and open the desktop again.
- **Capacity:** at most `SAGAX_SANDBOX_MAX_RUNNING` run at once (default 2; a
  paused one counts, it keeps its memory). A
  new one stops the least recently used idle one, or the call is refused with a
  clear message when every running environment is in use.
- **Sign-out:** when Perspicax signs a person out (back-channel logout,
  disabled or removed), their environment is stopped at once and deleted
  (container, network and volume) after `SAGAX_SANDBOX_DELETE_GRACE_HOURS`
  (default 72). A person back in before then keeps it. Pending deletions are in
  `user-sandbox-deletions.json` in the data folder and survive restarts.
- **Reset:** Settings > Organization > Your server environment > Reset deletes
  it, `/workspace` included, and creates a fresh one, after a confirmation.

## Desktop

Each environment can show a small Linux desktop (1280x800): Xvnc (an X
server with its VNC server), openbox, a gradient background (hsetroot), a
launcher bar (tint2: Chromium, Terminal, Files, open windows, clock),
Chromium, xterm and pcmanfm, driven by `/usr/local/bin/sagax-desktop` in the
image. Without the background and the bar the screen was black with only a
cursor. Nothing of it runs until it is
needed: a plain shell turn starts no X server.

- **Computer use:** bots get the desktop bridge's shape, `computer_list_tools`
  then `computer_use` with `screenshot` (JPEG), `get_screen_size`, `click`,
  `move`, `drag`, `type_text`, `key_press`, `scroll` and `open_url` (the cloud
  computer's vocabulary). Each call is one exec of a fixed `sagax-desktop`
  argv (xdotool, scrot), never a shell line; text and addresses travel in
  `SAGAX_*` variables. The first call starts the desktop. Where it runs
  follows the bot's Works on and the routine rules above: the person's own
  computer when that is the target, else this desktop. A bot whose Computer
  setting is off gets no computer use here either.
- **VNC:** listens on `127.0.0.1:5901` inside the sandbox's own network
  namespace only and asks for a password (VncAuth only). Two passwords: the
  full one controls the screen, the view-only one only watches; both are
  replaced each time the owner opens the view, unless a view is still open
  or was opened in the last 30 s (then the same ones, so it keeps working).
  Opens are serialized per person, and `sagax-desktop start` takes a lock:
  two at once used to race on the password file and answer 502.
- **Live view:** `GET /api/desktop-viewer/sandbox/me` (and its
  `/websockify` WebSocket), the Computer tab and the full-window viewer. The
  target is built from the caller's own session principal: there is no id
  that names another person's desktop, an admin or the server's console has
  none, and a person signed out by Perspicax is refused. Opening the view
  starts the environment and its desktop and hands the view-only password;
  "Prendre le contrôle" (`?control=1`, a button in the middle of the Computer
  tab's screen) opens the desktop large (92vw by 88vh, letterboxed) and hands
  the full one there, while the tab's square stays view-only; while such a
  view is open, the bots' `computer_use` there is refused, never queued
  (`server/sandbox-control.ts`), and "Rendre le contrôle" or closing the
  window (Cmd/Ctrl+Shift+Esc, or Escape outside the screen) hands it back. The WebSocket never
  starts anything: the Sagax server frames the RFB bytes itself
  (`server/ws-bridge.ts`) and reaches the VNC port only through the
  provisioner, a signed HTTP upgrade (`/v1/sandboxes/<key>/desktop`) spliced
  to a `docker exec` relay inside that one sandbox. No port is published, no
  network path opens between Sagax and a sandbox. A view in control counts as
  use; a view that only watches does not keep the environment alive, and it
  closes when the environment idles out or is paused.

### Computer tab (organization server)

The bot panel's Computer tab (`src/components/computer/OrgComputerTab.tsx`)
shows where the person's bots do computer work right now:

- **Server environment:** its state (Off, Starting, Running, Paused), Start,
  Shut down (keeps `/workspace`), Pause (`docker pause`: bots and the live
  view are refused until Resume) and Resume; the live desktop; and a usage
  panel refreshed every 5 s while visible (disk used of the quota, CPU as a
  share of its own quota, memory used of the limit, OS and image tag).
  `POST /api/me/server-environment/power` and `GET
  /api/me/server-environment/stats`, the caller's own environment only.
  Shutting down or pausing while a bot works there answers
  `confirm_running` until the person confirms.
- **Their own computer** (desktop bridge): "Votre ordinateur", connected or
  not, and coarse facts the desktop app sends every 30 s (OS and version,
  architecture, CPU model, count and use rounded to 5 %, memory and disk
  rounded; `POST /api/desktop-bridge/<id>/system`). No shutdown or pause. Its
  Local VM, when it has one: status and start
  (`POST /api/me/desktop-bridge/local-vm`).

## Security model

- **No Docker socket in Sagax.** Only `sagax-sandboxd` (the provisioner, same
  image, `node dist-server/sandboxd.js`) mounts it. It is read-only, has no
  capabilities, no new privileges, 192 MB and 64 pids, and sits on an
  `internal` network shared with the Sagax server alone. It publishes no port.
- **Signed calls only.** The provisioner writes a 256-bit key to the
  `sandboxd-key` volume (mode 0440, read-only for the Sagax server). Each
  request carries an HMAC over method, path, timestamp, nonce and body digest;
  a 30 second window and a nonce cache refuse replays.
- **Narrow API.** `ensure`, `stop`, `DELETE`, `exec` and status for one 32-hex
  key. The provisioner can only create the fixed spec of
  `sandboxContainerSpec()`, checked by `assertSandboxIsolation()` before every
  create, and only touches objects carrying its labels and its instance; a
  same-named object it did not create is refused.
- **Each sandbox:** uid 1000, read-only root, no capabilities,
  `no-new-privileges`, Docker's default seccomp and AppArmor profiles, never
  privileged, no host mounts or devices (only its own volume on `/workspace`),
  tmpfs `/tmp`, memory without swap, CPU, pids, open files and file size
  limits, private IPC and cgroup namespaces, no published port. Optional
  stronger runtime: `SAGAX_SANDBOX_RUNTIME=runsc` (gVisor) or `sysbox-runc`
  when the host has it. The image has no setuid binary and no sudo.
- **Network:** one bridge network per sandbox, a /28 from
  `SAGAX_SANDBOX_SUBNET_POOL` (default `10.213.0.0/16`), no inter-container
  traffic, no IPv6. At start the provisioner runs a one-shot helper (host
  network, `NET_ADMIN`, fixed script) that adds, for the pool only: a
  `DOCKER-USER` jump to a chain dropping private, link-local and reserved
  destinations (`10/8`, `172.16/12`, `192.168/16`, `100.64/10`, `127/8`,
  `169.254/16` including cloud metadata, Azure WireServer `168.63.129.16`,
  multicast) and an `INPUT` drop for anything from the pool to the host itself.
  Public internet stays open. If the policy cannot be applied, the provisioner
  refuses to create environments (`SAGAX_SANDBOX_REQUIRE_EGRESS_POLICY=false`
  turns that off for a lab only).
- **Disk:** `/workspace` has a soft quota (`SAGAX_SANDBOX_DISK_MB`): over it,
  `write_file` is refused and Settings shows it; one file is capped by
  `SAGAX_SANDBOX_MAX_FILE_MB`. For a hard cap, put `/var/lib/docker` on xfs
  with project quotas.

## The engines' own tools

Running the engine CLI itself inside the person's environment was not
feasible safely now (it would need the CLIs, their credentials and a route
back to the Sagax loopback inside a sandbox whose egress policy forbids
exactly that). So on an organization server every turn sets
`withholdHostTools` (`server/drivers/host-tools.ts`):

- **Claude Code:** `--disallowedTools` adds `Bash`, `BashOutput`,
  `KillShell`, `Monitor`, `Read`, `Write`, `Edit`, `MultiEdit`,
  `NotebookEdit`, `Glob`, `Grep`, `LS`, `WebFetch`, `EnterWorktree`,
  `ExitWorktree`, `Workflow`, `DesignSync`. Deny rules, so subagents get them
  too. `WebSearch` (run by Anthropic) stays.
- **Codex:** `features.shell_tool=false`, `features.unified_exec=false`,
  `features.view_image=false`, a read-only sandbox asking for approval, and
  every command, patch or permission request is declined before any card or
  Full-access auto-accept.
- **Chat engines** (OpenAI-compatible) and the Boat agent never run anything
  on this machine.
- **Any other engine** (pi, ACP engines, ...) is refused on an organization
  server (409 `host_tools`) rather than run in the container.

Shell, files and pages then go through `sagax-environment`.
`scripts/smoke-host-tools.ts` starts the real Claude Code CLI with the
driver's flags (no model request) and checks its tool list has no `Bash`.

## Resource defaults (8 GiB host)

| Variable | Default | Meaning |
|---|---|---|
| `SAGAX_SANDBOX_MEMORY_MB` | 1536 | per environment, no swap (the desktop with Chromium measured about 260 MiB) |
| `SAGAX_SANDBOX_CPUS` | 1 | per environment |
| `SAGAX_SANDBOX_PIDS` | 512 | per environment (Chromium's processes and threads count) |
| `SAGAX_SANDBOX_TMP_MB` | 512 | tmpfs `/tmp` (counts against memory only when used) |
| `SAGAX_SANDBOX_DISK_MB` | 2048 | soft quota on `/workspace` |
| `SAGAX_SANDBOX_MAX_FILE_MB` | 512 | largest single file |
| `SAGAX_SANDBOX_MAX_RUNNING` | 2 | running or paused at once (3 GiB at most) |
| `SAGAX_SANDBOX_IDLE_MINUTES` | 15 | idle stop |
| `SAGAX_SANDBOX_DELETE_GRACE_HOURS` | 72 | delete after sign-out (Sagax side) |
| `SAGAX_SANDBOX_SUBNET_POOL` | `10.213.0.0/16` | must not overlap the VNet or other Docker networks |
| `SAGAX_SANDBOX_EGRESS_DENY` | empty | extra CIDRs to block |
| `SAGAX_SANDBOX_RUNTIME` | empty | `runsc`, `sysbox-runc` |
| `SAGAX_SANDBOX_IMAGE` | required | built from `deploy/sandbox/Dockerfile` |
| `SAGAX_SANDBOX_INSTANCE` | `default` | same value on both services |
| `SAGAX_SANDBOXD_URL` | empty | Sagax side; empty means no environments |
| `SAGAX_SANDBOXD_KEY_FILE` | `/run/sagax-sandboxd/key` | both services |
| `SAGAX_DOCKER_GID` | 999 | group of `/var/run/docker.sock` on the host |

## Deploy

`deploy/docker-compose.sandbox.yml` adds the provisioner, the pull-or-build
service for the sandbox image and the Sagax server's settings, all under the
`pulsabot` profile:

```bash
docker compose -f compose.yaml -f deploy/docker-compose.sandbox.yml --profile pulsabot up -d --build
```

Smoke test on a machine with Docker (creates one temporary environment and
deletes it, with its egress rules):

```bash
docker build -f deploy/sandbox/Dockerfile -t sagax-sandbox:smoke-userenv .
node --experimental-strip-types scripts/smoke-user-sandbox.ts
```

The desktop (computer use, Chromium, the live view through the real viewer
route, pause, resume and usage) has its own smoke test:

```bash
docker build -f deploy/sandbox/Dockerfile -t sagax-sandbox:smoke-desktop .
node --experimental-strip-types scripts/smoke-sandbox-desktop.ts [--shots <dir>]
```

The image with the desktop is about 397 MB (arm64), 38.5 MB more than
without it; `--build-arg WITH_DESKTOP=0` leaves it out.

Settings > Local VM no longer offers a VM per bot on an organization server,
and a bot's cloud backend cannot be a per-bot VPS there (409 `org_user_sandbox`).
