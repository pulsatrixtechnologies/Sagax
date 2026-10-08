# Security Policy

## Supported versions

Only the latest Sagax release receives security fixes. Releases are tagged
`pulsa-vX.Y.Z` on
[pulsatrixtechnologies/sagax](https://github.com/pulsatrixtechnologies/sagax/releases),
and the desktop app updates from that feed only. If you can reproduce a problem
on the latest release, report it. If you can only reproduce it on an older
release, update first.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

- **Preferred:** open a private security advisory on this repository (Security
  tab, "Report a vulnerability"):
  <https://github.com/pulsatrixtechnologies/sagax/security/advisories/new>. The
  report stays visible only to you and the maintainers until a fix is published.
- **Or email** **security@pulsatrix.ca** with the details: version, platform,
  what you did, what happened, and what you expected.

What to expect:

- An acknowledgement within 3 business days.
- A first assessment (accepted, needs more information, or not a vulnerability)
  within 10 business days.
- Updates as the fix progresses. We aim to ship a fix for a confirmed
  vulnerability in the next release, sooner when it is severe.

## Coordinated disclosure

Give us a reasonable time to fix the problem before you publish anything. We
ask for up to 90 days from your report, and will tell you if we need more. When
a fix ships we publish an advisory, and we credit you unless you prefer to stay
anonymous. Test only against your own installation and your own data, never
against someone else's server or account.

## What counts

A vulnerability is a way to break one of these guarantees in the current
release.

- **Desktop app and local server.** The harness server binds **127.0.0.1
  only**. Packaged builds allow anonymous loopback reads, but public mutations
  require either the desktop's private per-launch capability or a paired
  session; built-in agent integrations use narrower per-turn capabilities.
  Anything that makes it reachable from off-machine without a paired session,
  lets one bot reuse another turn's capability, or lets a local unprivileged
  other user drive it is a vulnerability.
- **Hosted or shared workspaces.** On a hosted or shared workspace (service
  loopback trust, see `docs/self-hosting.md`) a session-less loopback caller,
  which includes every bot's shell, may use only the routes in `SERVICE_ALLOW`
  (`server/request-auth.ts`). Reaching an admin route or approving a card that
  way is a vulnerability. Known and documented, not yet closed: that caller
  keeps the Slack worker's guarded routes, so a bot's shell can post into an
  existing Full-access thread, or open one while shared Full access is on, and
  get Full-access work done without a card. A worker-only relay token is the
  planned fix.
- **Organization mode with Perspicax.** Sign-in, roles, and admin scope on an
  organization server; one person reading or acting on another person's bots,
  threads, credentials or private threads; a routine that does not act in its
  owner's name; any path around the organization's approval and Full access
  settings.
- **Desktop bridge.** The bridge that lets an organization server act on a
  person's own computer: pairing, per-bot "This computer" consent, and any way
  to drive a desktop without the person's opt-in and approval.
- **Engines and tool scopes.** The permission broker is the consent layer for
  risky actions in every engine (Claude Code, Codex, Grok, Cursor, OpenCode,
  ACP and OpenAI-compatible engines). Bypasses of the broker (approving without
  a user decision, spoofing the broker socket) are vulnerabilities unless that
  bot is explicitly set to **Full access**. Full access is a standing user
  decision to approve provider permission requests; it must never answer
  questions or silently broaden product-level confirmations such as
  credentials, routines, skills, or peer communication. A tool that reaches
  beyond the scope its bot was given is also in scope.
- **Webhooks.** Routine webhooks are authenticated with bearer tokens. A way to
  trigger a routine without a valid token, to read or guess a token, or to
  make a token work for another routine is a vulnerability.
- **Read receipts and presence.** Presence and read state are per-person
  settings. Showing them to people who should not see them, or ignoring a
  person's choice to hide them, is a privacy vulnerability.
- **Secrets.** API keys live in `~/.sagax/config.json` and are write-only
  through the API (`configured` booleans out, never values). Any path that
  echoes a stored secret back (API response, SSE event, log line, argv visible
  in `ps`) is a vulnerability.
- **Process spawning.** Spawning must never route user-influenced strings
  through a shell. Report any `shell: true` or `cmd.exe` string-building you
  find.

## Out of scope

- **The upstream project.** Sagax is based on OpenMausBot. Problems that exist
  only in the original project's code or its hosted services are not Sagax
  vulnerabilities; report them to that project separately. Sagax does not
  contact the original project's services. If you are not sure which side a
  problem is on, report it to us and we will route it.
- Third-party engines, providers and CLIs themselves (report to their vendors).
- Findings that need an already-compromised machine, an administrator who
  chooses to weaken a setting, or a bot explicitly set to Full access acting
  within what Full access allows.
- Denial of service by volume, and missing hardening headers with no
  demonstrated impact.

Never include real secrets or other people's data in a report.
