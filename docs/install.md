# Install the Sagax server in one line

For a server you run yourself (a VPS, a home server, a Mac or a Linux box
with Docker). One command checks Docker, writes a small install folder,
generates the server's secrets on that machine, starts the public image and
prints the address with a one-time sign-in link.

```sh
curl -fsSL https://raw.githubusercontent.com/pulsatrixtechnologies/Sagax/main/install.sh | bash
```

On your own domain, with an automatic HTTPS certificate (DNS pointing at the
machine, ports 80 and 443 open):

```sh
curl -fsSL https://raw.githubusercontent.com/pulsatrixtechnologies/Sagax/main/install.sh | bash -s -- --domain bots.example.com
```

Read the script first if you like: it is [`install.sh`](../install.sh) at the
root of this repository. `--dry-run` prints what it would do and touches
nothing.

The desktop app needs none of this: it runs its own server. This page is for
a server that stays on when your computer is off, or that several devices
share. The guides behind it are [Self-hosting](self-hosting.md) (reference)
and [Deploy Sagax on a VPS](deploy-vps.md) (step by step).

## What you need

- Docker with Compose (Docker Desktop on macOS and Windows, Docker Engine on
  Linux), running, usable by the user who runs the script.
- About 4 GB of disk for the image (it carries every engine CLI and the bots'
  browser), plus your data.
- amd64 or arm64. The same image tag serves both.

## What it does

1. Finds `docker compose` (or `docker-compose`) and checks that Docker answers.
2. Reads the latest release (`pulsa-vX.Y.Z`) from GitHub, unless you pass
   `--version X.Y.Z`. The install always runs one exact release, never a
   floating tag.
3. Writes the install folder (`~/sagax`, or `--dir DIR`, mode 0700):

   | File | What it is |
   |---|---|
   | `.env` | Your settings and the vault key. Created once, mode 0600, never overwritten. |
   | `compose.yaml` | The server and Caddy, from `ghcr.io/pulsatrixtechnologies/sagax:<version>`. Rewritten on each run. |
   | `Caddyfile` | The edge: plain HTTP on `localhost:8080` by default, HTTPS with `--domain`. Rewritten on each run. |
   | `sagax` | The helper (below). Linked into `/usr/local/bin` or `~/.local/bin` when one is writable and no other `sagax` is on your PATH. |

4. Generates the vault key (`SAGAX_MCP_OAUTH_KEY`, 32 random bytes from
   `openssl` or `/dev/urandom`) straight into `.env`. It is never printed. It
   encrypts the sign-ins and the credentials the server keeps for your bots.
   Because it sits outside the data volume, a copy of the volume alone does
   not open them. Back `.env` up apart from the volume. An existing data
   volume keeps the key it already has, and no new key is written for it.
5. Pulls the image, starts it, waits until `/api/health` answers, then prints
   the address and a one-time sign-in link (the same as `sagax pair`). The
   link works once and expires; it is not a stored password.

Run the script again at any time: it keeps `.env` and the data volume, moves
the install to the release you name (the latest by default) and refreshes the
generated files. Options you pass on a re-run (`--domain`, `--port`,
`--bind`, `--image`) are written to `.env`; the others stay as they were.

Your own changes to the stack go in `compose.override.yaml` next to
`compose.yaml`: Compose reads both, and the script never touches it.

## Options

| Option | Default | Meaning |
|---|---|---|
| `--dir DIR` | `$SAGAX_DIR` or `~/sagax` | The install folder. |
| `--domain HOST` | none | Serve `https://HOST` with an automatic certificate. |
| `--port N` | `8080` | Without `--domain`: the HTTP port on this machine. |
| `--bind ADDR` | `127.0.0.1` | Without `--domain`: the address that port listens on. `0.0.0.0` opens it to your network; a remote browser still signs in with a pairing link. |
| `--version X.Y.Z` | latest release | The release to run. |
| `--image REF` | `ghcr.io/pulsatrixtechnologies/sagax` | Another image repository (a mirror, your own build). |
| `--no-start` | | Write the files, do not pull or start. |
| `--no-link` | | Do not put `sagax` on the PATH. |
| `--dry-run` | | Print the plan; write and start nothing. |

For private access over Tailscale without a public domain, keep the default
`127.0.0.1:8080` and point Tailscale Serve at it, or use the
[local Compose setup](../deploy/local/README.md), which maps the Tailscale
host name for HTTPS.

## The `sagax` helper

| Command | What it does |
|---|---|
| `sagax update [X.Y.Z]` | Moves to that release (default: the latest): pulls the image, restarts, waits until the server answers. The server applies its data migrations itself when it starts, so there is nothing else to run. On a failed pull it stays on the current release; after a failed start it prints the command that goes back. `--dry-run` only prints. |
| `sagax pair` | A new one-time sign-in link for another browser, phone or the desktop app. |
| `sagax status` | The containers and what the server says about itself. |
| `sagax logs` | The last 200 lines (`sagax logs -f omb` follows the server). |
| `sagax start`, `stop`, `restart` | The stack. |
| `sagax version` | The release in `.env`. |
| `sagax <command>` | Any other command runs the server CLI inside the container: `sagax sessions`, `sagax access add you@example.com`, ... |

Going back is the same command with the older number: `sagax update 0.8.3`.

## After the install

- Open the link, then **Settings > Engines** to install and sign in the AI
  engines from the browser, with no terminal
  ([details](self-hosting.md#signing-the-engines-in-without-a-terminal)).
- Pair your other devices with `sagax pair` (or from **Settings** in a signed-in
  browser).
- Back up the `sagax_data` volume and `.env`. See
  [Back up](deploy-vps.md#back-up) for the scope; the volume holds the engine
  logins too.

## The image

`ghcr.io/pulsatrixtechnologies/sagax` is built by `release.yml` once per
published release (job `server-image`), from the tagged commit and this
repository's `Dockerfile`, with no deployment's configuration in it: no
domain, no keys, no organization. Tags: `X.Y.Z`, `X.Y`, `sha-<commit>` and
`latest` (the latest full release only). Each digest is scanned on both
platforms with zero critical and high findings required, signed keyless and
given a vulnerability attestation. To check a tag yourself:

```sh
cosign verify ghcr.io/pulsatrixtechnologies/sagax:X.Y.Z \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github\.com/pulsatrixtechnologies/Sagax/\.github/workflows/release\.yml@refs/(tags/pulsa-v.*|heads/main)$'
```

## Other ways in

Nothing here replaces the existing paths:

- From a checkout, building the image yourself:
  [Docker (with HTTPS on your own domain)](self-hosting.md#docker-with-https-on-your-own-domain),
  updated with `git pull && docker compose up -d --build`.
- Without Docker: [From source](self-hosting.md#from-source) or the npm CLI
  (`sagax service install`).
- Many client workspaces on one server: [`sagax fleet`](self-hosting.md#many-client-workspaces-on-one-server).

An AI coding agent can run the install for you: give it
[`SETUP_PROMPT.md`](../SETUP_PROMPT.md).
