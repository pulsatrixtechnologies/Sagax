# Confidential threads (Fil confidentiel)

A confidential thread is a 1:1 conversation with a bot that stays with the
person who owns it. Nothing of it is remembered by the bot, exported, logged
or shown to anyone else through Sagax, including the bot's owner and the
organization's admins. It exists for the work a person would not want to
land in a shared bot's memory, an export or an admin console.

Code: `server/confidential-threads.ts` (the rules), with the enforcement in
`server/index.ts`, `server/bot-zip.ts`, `server/org-admin-files.ts`,
`server/decision-log.ts`, `server/workspace-backup.ts`,
`server/turn-log.ts`, `server/user-sandbox-routing.ts` and
`server/routes/perspicax-tool-internal.ts`. Clients:
`src/components/ConfidentialBanner.tsx`, `src/lib/confidential-thread.ts`,
`ios/Sources/CompanionCore/ConfidentialThread.swift`,
`ios/App/Features/Chat/ConfidentialBannerView.swift`.

## Turning it on

- **At creation**: New thread menu, « Nouveau fil confidentiel » / "New
  confidential thread" (`POST /api/bots/:id/tasks` with
  `confidential: true`).
- **Later**: « Rendre confidentiel » / "Make confidential" in the thread
  menu, after a confirmation that says it is permanent
  (`PATCH /api/bots/:id/tasks/:threadId` with
  `{ "confidential": true, "confirmConfidential": true }`; without the
  confirmation the server answers 400 `confirm_confidential`).
- **By default**: on an organization server an admin can make every new
  thread confidential (Settings > Organisation, « Nouveaux fils
  confidentiels par défaut »; `PATCH /api/org/settings`
  `{ "confidentialThreadsByDefault": true }`, audited as `org.settings`).
  The person can still open an ordinary thread explicitly
  (`confidential: false`).

**It is permanent.** The server refuses any change back
(`confidential: false` on a confidential thread is 409
`confidential_permanent`, confirmed or not). To work normally the person
opens a new thread; deleting the thread is the only way to end it.

The clients show it everywhere the thread appears: a classification banner
(solid band, « CONFIDENTIEL », lock icon, `role="note"`, read as « Fil
confidentiel : ce fil n'est ni mémorisé, ni exporté, ni partagé ») at the top
of the conversation and above the composer, not dismissible, with its height
reserved; a lock and « Confidentiel » on the sidebar row and in the window
title; a stamp on a Markdown export the person makes of their own thread.

## What the server does while a thread is confidential

| Path | Ordinary thread | Confidential thread |
|---|---|---|
| Automatic memory capture (upkeep) | queued after each turn | never queued; turns already waiting are dropped when the thread turns confidential |
| Daily log line (`memory/log/<day>.md`) | one per turn | none |
| `memory_update`, `memory_log`, group and team memory, rules, docs, skill staging | allowed | refused (403 `confidential_thread`) |
| Perspicax `memory_write` to a team or `org`, `memory_propose`, `memory_promote` | allowed | refused |
| Perspicax `memory_write` to the person's own tier (`me`) | allowed | waits for the owner's Allow on a card; on Allow the bot is asked to repeat that exact write, which a one-shot pass lets through |
| Recall: auto-recall, recent-work brief, `session_search`, `session_read`, `list_threads` from any other thread | narrowed per person | the thread never feeds another thread, its owner's included |
| Bot zip (owner route and console package) | included with conversations | left out: messages, files, task record, id |
| Console file browser (`tasks`, `attachments` roots) | listed | left out of listings, reads as 404 |
| Workspace backup (an admin export) | full | task record kept as an empty "Confidential thread" (id, dates, flag); messages, read marks and follow-ups removed from the message database snapshot (vacuumed), event and native logs, legacy transcript, work folder and its own attachments left out |
| Approval cards and their notifications | bot owner | the thread owner only; a card they could not answer (an organization admin card, another person's machine) is refused instead of shown to anyone else; never in the console's organization queue |
| Incidents | Primary Bot report with 300 characters of the request and reply | no text: the console's problem log and the owner's notification say only « un tour d'un fil confidentiel a échoué »; no Primary Bot report |
| `[omb-turn]` server log line | first 70 characters of the prompt | `text=(confidential)` |
| Perspicax work log row | metadata row per turn | none |
| Built-in browser | the bot's persistent profile (`bot-<id>`) or a shared one | a throwaway guest session of that thread (`conf-<thread>-<random>`), never saved, discarded at the end of each turn and when the thread is deleted |
| Where it works | the speaker's or, for a routine, the bot owner's environment; the bot's project folder | always the thread owner's environment, and the thread's own folder (`task-workspaces/<bot>/<thread>`); a new confidential thread may not take another working folder |
| Routines | can be proposed or created with results in the thread | refused (`propose_routine` and `POST /api/routines` with that `resultsThreadId`) |
| Artifacts (`save_artifact`, ...) | saved | refused: an artifact outlives the thread and an admin may open it |
| Decision log | rows with the call's summary | rows with ids, time, tool name, decision and who answered only; rows written before the thread turned confidential are stripped the same way |

## Deleting a confidential thread

`DELETE /api/bots/:id/tasks/:threadId` removes, beyond what any deleted
thread loses (messages, event and native logs):

- its work folder `task-workspaces/<bot>/<thread>`;
- the stored attachments its messages point at that no other thread points
  at;
- its waiting memory capture, its browser session, its pending memory
  passes;
- the summaries of its decision-log rows (ids, times, tool names and
  decisions stay, for the audit).

## Honest limits

Confidential means kept from the other people **using Sagax**. It is not
end-to-end encryption, and it does not hide the thread from:

- **The server operator, and anyone with administrator access to the VM or
  cluster and its disk.** Messages are stored on the server like any other
  thread until the thread is deleted; `bots.json` holds its task record.
- **Backups made outside Sagax.** Disk and cluster backups (for example
  Velero, kept 30 days) contain whatever was on disk when they ran, deleted
  threads included until those backups expire.
- **The model provider.** Every turn is sent to the engine the bot runs on,
  as any turn is.
- **The person's own environment and tools.** The bot's file tools run on
  the host or the person's environment, which is directory organization,
  not a sandbox between threads: the prompt tells a confidential turn to
  keep its files in its own folder, but an engine with host file access
  could still read or write elsewhere. Files staged into the person's server
  environment stay there.
- **What happened before it turned confidential.** A thread made
  confidential later keeps where it worked so far (its folder pin), and
  memory captured or daily log lines written from it before the change stay
  in the bot's memory until edited. Its decision rows are stripped at the
  change.
- **Its owner.** The person can still copy, export or forward what they
  wrote; push notifications of their own thread go to their own devices.

For the most sensitive work, use a local (solo) Sagax on your own computer:
nobody else has the disk, the backups or the server log.
