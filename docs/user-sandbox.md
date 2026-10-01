# Server environments (organization mode)

On an organization server (`OMB_IDENTITY=perspicax`), each **person** gets one
isolated Linux environment on the server: their "server environment"
(`user-sandbox`). Every bot that person owns, in every conversation, and the
routines of those bots, run their shell, file and browser tools there whenever
the turn does not target the person's own computer (`user-desktop`). There is
never one environment per bot, and an organization server never runs a bot's
tools on the Sagax host or inside the Sagax container.

| Target | When | Where |
|---|---|---|
| `user-desktop` | the turn's place is the person's computer | their desktop (desktop routing) |
| `user-sandbox` | organization mode, any other turn | the bot owner's environment |
| `host` | solo server | this machine, unchanged |
| `none` | organization mode without a provisioner | nothing is mounted |

Code: `server/user-sandbox-routing.ts` (targets, owner), `server/user-sandbox-tools.ts`
(`run_command`, `read_file`, `write_file`, `list_files`, `browse`, mounted as the
MCP server `sagax-environment`), `server/user-sandbox-manager.ts` (lifecycle on
the Sagax side), `server/sandboxd*.ts` (the provisioner), `server/user-sandbox-spec.ts`
(the exact container, network and egress policy).

## Lifecycle

- **Lazy:** mounting the tools creates nothing; the first tool call creates the
  network, the `/workspace` volume and the container, then starts it.
- **One per person:** the provisioner is addressed by an opaque key,
  `sha256(instance, principal id)`; its API has no bot parameter. Objects are
  named `sagax-user-<key>` and labelled `com.pulsatrix.sagax.sandbox.user=<key>`
  and `sagax-user=<key>`.
- **Idle stop:** after `SAGAX_SANDBOX_IDLE_MINUTES` without a command (default
  15). The next call starts it again; `/workspace` persists.
- **Capacity:** at most `SAGAX_SANDBOX_MAX_RUNNING` run at once (default 3). A
  new one stops the least recently used idle one, or the call is refused with a
  clear message when every running environment is in use.
- **Sign-out:** when Perspicax signs a person out (back-channel logout,
  disabled or removed), their environment is stopped at once and deleted
  (container, network and volume) after `SAGAX_SANDBOX_DELETE_GRACE_HOURS`
  (default 72). A person back in before then keeps it. Pending deletions are in
  `user-sandbox-deletions.json` in the data folder and survive restarts.
- **Reset:** Settings > Organization > Your server environment > Reset deletes
  it, `/workspace` included, and creates a fresh one, after a confirmation.

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

## Resource defaults (8 GiB host)

| Variable | Default | Meaning |
|---|---|---|
| `SAGAX_SANDBOX_MEMORY_MB` | 1024 | per environment, no swap |
| `SAGAX_SANDBOX_CPUS` | 1 | per environment |
| `SAGAX_SANDBOX_PIDS` | 256 | per environment |
| `SAGAX_SANDBOX_TMP_MB` | 256 | tmpfs `/tmp` |
| `SAGAX_SANDBOX_DISK_MB` | 2048 | soft quota on `/workspace` |
| `SAGAX_SANDBOX_MAX_FILE_MB` | 512 | largest single file |
| `SAGAX_SANDBOX_MAX_RUNNING` | 3 | running at once (about 3 GiB at most) |
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

Settings > Local VM no longer offers a VM per bot on an organization server,
and a bot's cloud backend cannot be a per-bot VPS there (409 `org_user_sandbox`).
