# Terminal-capable resources

Sagax treats every shell endpoint through one abstraction. A **resource** is
something a signed-in person may open in the in-chat terminal after explicit
approval. Credentials and connection strings never reach the client.

## Model

- `shared/terminal-resources.ts` — provider kinds, `TerminalResource`,
  `TerminalSessionPublic`, `TerminalEmbed`.
- `server/terminal-resources/registry.ts` — `TerminalResourceRegistry` and
  `TerminalResourceAdapter` (`list`, `resolve`, `open`).
- `server/terminal-sessions.ts` — session lifecycle (idle timeout, per-person
  limit, audit).
- `server/terminal-requests.ts` — approval card (`Ouvrir un terminal` /
  `Refuser`) before `open`.

## Adapters

| Provider | Role today |
|----------|------------|
| `unraid` | SSH alias (first shipped adapter) |
| `ssh` | Generic SSH host from config / VPS alias |
| `test` | Vitest echo shell (`SAGAX_TERMINAL_TEST=1`) |

Planned kinds in the shared type (`sandbox`, `docker-exec`, `local-vm`,
`desktop`, `cloud-vm`, …) register the same way: implement
`TerminalResourceAdapter`, call `registry.register` in
`server/terminal-install.ts`.

## Security (all adapters)

- Approval card required; bot tools `list_terminal_resources` and
  `offer_shell_terminal` only stage the card.
- WebSocket attach uses the same authenticated upgrade path as voice mode and
  the desktop viewer.
- `terminal-sessions.jsonl` audit log; 15 minute idle close; bot input off
  until the person enables it on the session.

## Configuration

`config.json` → `terminalShell.hosts[]` with `{ id, label, alias, provider }`,
optional `unraidSshAlias`, or `SAGAX_UNRAID_SSH_ALIAS`. VPS `sshAlias` is
also offered as an `ssh` resource.
