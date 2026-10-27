# Install Sagax with an AI coding agent

Paste one of the prompts below into the coding agent you use on the target
machine (Claude Code, Codex, Grok, Cursor, ...). It installs the Sagax server
with [`install.sh`](install.sh) and hands you the sign-in link. The human
guide is [docs/install.md](docs/install.md).

## On this machine, private address

```text
Install the Sagax server on this machine with its official installer.

1. Check that Docker with Compose is installed and running (`docker info`,
   `docker compose version`). If it is not, tell me how to install or start it
   for this OS and stop.
2. Download https://raw.githubusercontent.com/pulsatrixtechnologies/Sagax/main/install.sh
   to a temporary file, read it, then run it once with `--dry-run` and show me
   the plan it prints.
3. Run it for real: `bash <file>`. Use the default folder (~/sagax) unless I
   named another one.
4. When it finishes, give me the address and the one-time sign-in link it
   printed, and tell me that `sagax pair` makes another link.

Rules:
- Never print, copy, summarize or commit the contents of ~/sagax/.env: it
  holds the vault key. Do not open it to "check" it.
- Never overwrite or delete an existing ~/sagax/.env or the `sagax_data`
  Docker volume. Running install.sh again is safe: it keeps both.
- Do not edit compose.yaml or the Caddyfile; put any change in
  ~/sagax/compose.override.yaml.
- Do not expose port 8799 or 8800 of the container, and do not change the
  bind address unless I ask.
- If a step fails, show me the error and the last lines of
  `docker compose -f ~/sagax/compose.yaml logs omb`, and stop.
```

## On a server, with my domain

```text
Install the Sagax server on this server, served at https://<DOMAIN>.

Before anything: check that <DOMAIN> resolves to this server's public address
and that ports 80 and 443 are free and reachable. Tell me what you found.

Then follow the same steps and rules as for a local install, running the
installer with `--domain <DOMAIN>`. At the end, give me https://<DOMAIN> and
the one-time sign-in link it printed.
```

## Update later

```text
Update my Sagax server: run `sagax update --dry-run`, show me the versions,
then `sagax update`. If the server does not answer after the restart, show me
`sagax logs` and the command it printed to go back, and stop. Never print
~/sagax/.env.
```
