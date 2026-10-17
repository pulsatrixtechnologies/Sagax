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
  thread a person opens (the New thread menu, their first thread on a
  bot) confidential (Settings > Organisation, « Nouveaux fils
  confidentiels par défaut »; `PATCH /api/org/settings`
  `{ "confidentialThreadsByDefault": true }`, audited as `org.settings`).
  The person can still open an ordinary thread explicitly
  (`confidential: false`).

A thread that already works in a shared folder (the bot's project folder,
or one chosen when it was opened) is not converted (409
`confidential_shared_folder`): its files and checkpoints already live with
that folder. The person opens a new confidential thread instead. On an
OMB Cloud home only its owner opens confidential threads: the owner holds
the disk and every conversation on it, so a guest's could never be kept
from them.

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
| Perspicax `memory_write` to the person's own tier (`me`) | allowed | `scope: "me"` is written in (an omitted scope never falls to Perspicax's own default); then it waits for the owner's Allow on a card; on Allow the bot is asked to repeat that exact write (scope, topic, title, body, tags, directory title, searchable), which a one-shot pass lets through |
| Any other Perspicax call | allowed | fail closed: only known reads pass (`api_list`, `api_search`, `api_describe`, `api_lookup`, `identity`, `memory_recall`, `memory_search`, `work_search`, `claim_list`, Perspicax's own unprefixed `find_*`, `get_*`, `read_*`, `list_*`; of a profile's tools only `<profile>__query` and `read_action`; `api_plan` only when every step passes); every other call waits for the owner's card showing the server, the tool and every argument, whole (a call too long to show whole is refused); a JSON-RPC batch is refused. The file-style `memory` tool reads freely and changes only plain paths under `/memories/me/`, with the card |
| Other MCP servers (connected apps, personal servers, the workplace, the bot's data tools) | by approval mode | a read verb with something after it passes; a read verb followed by a write verb is refused; a bare verb and anything else waits for the owner's card, whatever the approval mode (Full and always-allow included); the one-time Allow is bound to the server, the tool and the arguments |
| A bot acting as its person (`act`) from an ordinary thread | the person's routes | a request naming a confidential thread is refused (any method, Full included); lists and search hits come back without confidential threads; screen commands never open one |
| Routine results, the bot's main thread, Retry thread, pages (`propose_page`) | allowed | never into or from a confidential thread |
| Peers, rooms and channels (`ask_bot`, `delegate_bot`, `coordinate_bots`, `post_to_room`, `create_room`, `manage_room`, `act`, `start_thread` on another bot, the agent API) | allowed | refused |
| Turns that name no thread (peer asks, asides, delegations, automation) | the bot's selected thread | never a confidential thread, even its owner's selected one: the bot owner's newest ordinary conversation, else a new one |
| Threads it opens (`start_thread` on itself, parallel tasks) | ordinary | confidential, same owner |
| The follow-up of a card its owner allowed in Sagax | posted as before | posted into exactly that thread, once (a one-shot token minted only for a confidential thread), never as an on-behalf request |
| AI clients (member API and agent API: `sagax_send`, `sagax_thread`, `sagax_approve`, `read_transcript`, `send_prompt`, ...) and a bot acting as the person (`act`) | the person's threads | never listed, read, streamed or written; a request naming one is 404; one without a thread never lands in one; a card in a confidential thread is answered only by its owner in Sagax, never on their behalf |
| Recall: auto-recall, recent-work brief, `session_search`, `session_read`, `list_threads` from any other thread | narrowed per person | the thread never feeds another thread, its owner's included |
| Bot zip (owner route and console package), team backup (`POST /api/teams/export` `backup`), organization copy (`POST /api/org/export`) | included with conversations | left out: messages, files, task record, id; an import that ever carries the flag restores it confidential |
| Console file browser (`tasks`, `attachments` roots) | listed | left out of listings, reads as 404 |
| Workspace backup (an admin export) | full | task record kept as an empty "Confidential thread" (id, dates, flag); messages, read marks and follow-ups removed from the message database snapshot (vacuumed), event and native logs, legacy transcript, work folder and its own attachments left out |
| Approval cards and their notifications | bot owner | the thread owner only; a card they could not answer (an organization admin card, another person's machine) is refused instead of shown to anyone else; never in the console's organization queue |
| Incidents and refused turns | Primary Bot report with 300 characters of the request and reply; problem log row with title and notice | no text: the console's problem log and the owner's notification say only « un tour d'un fil confidentiel a échoué »; no Primary Bot report |
| Notifications (in app, push relay, iOS banners, Live Activities, widgets, share sheet) | the reply's first words | « Fil confidentiel » only; widgets leave the thread out |
| MCP permission audit rows | tool, permission, decision, resource | no resource |
| `[omb-turn]` server log line | first 70 characters of the prompt | `text=(confidential)` |
| Perspicax work log row | metadata row per turn | none |
| Built-in browser | the bot's persistent profile (`bot-<id>`) or a shared one | a throwaway guest session of that thread (`conf-<thread>-<random>`), never saved, discarded at the end of each turn and when the thread is deleted |
| Where it works | the speaker's or, for a routine, the bot owner's environment; the bot's project folder | always the thread owner's environment, and the thread's own folder (`task-workspaces/<bot>/<thread>`); a new confidential thread may not take another working folder |
| Data (DuckDB tables and the Data tab's sheet) | the bot's database, or on an organization server the speaker's own on a shared bot | a database and sheet of that thread only (`<data>/data-scopes/<bot>/t-<hash>`, `server/data/scope.ts`), its owner's alone (the Data tab names it with `?thread=`); no other scope of the bot reaches the thread's folder or this database |
| Routines | can be proposed or created with results in the thread | refused (`propose_routine` and `POST /api/routines` with that `resultsThreadId`) |
| Artifacts (`save_artifact`, ...) | saved | refused: an artifact outlives the thread and an admin may open it |
| Decision log | rows with the call's summary | rows with ids, time, tool name, decision and who answered only; rows written before the thread turned confidential are stripped the same way, and so are rows that land after it was deleted |

## Deleting a confidential thread

`DELETE /api/bots/:id/tasks/:threadId` removes, beyond what any deleted
thread loses (messages, event and native logs):

- its work folder `task-workspaces/<bot>/<thread>` and its kept tool
  results `tool-results/<thread>`;
- its own Data database and sheet (`data-scopes/<bot>/t-<hash>`);
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
- **Perspicax.** A call the person allows (a card) or a read through a
  Perspicax profile is seen by Perspicax and the outside system behind it,
  and Perspicax keeps its own audit and journal of those calls.
- **Engines with host access.** On a solo server, a bot whose engine has
  a shell on the host can call this server's own loopback API directly,
  outside the tools the rules above judge. Confidential mode does not
  sandbox an engine that has host access.
- **Tools that read by sending.** A tool named like a read that sends its
  arguments to a third party (a web fetch or search, the built-in browser
  opening a page, a connected app's search) still works from a confidential
  thread, with whatever the bot puts in its arguments: the words of the
  thread can leave that way, in a URL or a query.
- **Automation threads.** The organization default does not make a
  routine's run, a webhook's thread or a teammate's work thread
  confidential: their results are delivered elsewhere by design. A
  confidential thread cannot start any of them.
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
