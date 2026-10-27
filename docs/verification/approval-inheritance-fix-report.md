# Approval inheritance fix (#1169, #1170)

Verdict: the approval level is a property of the bot. Every thread reads that current level when a turn starts, including hidden MCP conversations and routine runs. Hidden agent threads stay separate conversations and are listed for the owner under a human label. The full unit suite still fails on this machine for reasons already present on `origin/main` or caused by Node 22. The tests written for this fix pass.

Branch: `fix/approval-full-access-hidden-threads`. Code commits end at `768f045d3`. This report is the following commit.

## Owner rule

JC, 26 Oct 2026, 7:23 PM ET: in thread mode the setting is for the bot, and every thread inherits it. The level is read live at turn start (`projectBotForTask`, `approvalModeForTurn`). A stored `task.approvalMode` is rewritten once to the bot's level (marker `approval-inheritance.v1`, hidden threads included) and again when the bot's level changes. It is not a lasting override.

The one stored exception is a read-only task a bot opens for itself (`approvalLock: "ask"`). That task stays on Ask. The open response carries `readOnly: true`. The lock is server-private and the thread list has no lasting "read only" label.

These are policy overlays, not per-thread copies: the organization's Full access switch (Full becomes Ask while it is off), a member Custom level, member auto-approval policy, a Cloud home guest turn, safety holds, an explicit Ask or Deny rule, and the owner's consent.

An explicit lower level on one thread, chosen on purpose, is not kept. The owner rule forbids a copy that outlives a bot change. There is no field that records "the person lowered this thread".

## Bug 2 choice

Hidden `send_prompt` and bot-to-bot threads stay their own conversations (`hidden: true`). They are not merged into the person's main chat. Merging would put another bot's prompts into the unified transcript and would change the agent API contract that each caller has its own conversation.

They are listed for the owner:

- Threads on: in the normal thread list, titled "AI client" or "@Name · agent".
- Threads off: in the header picker, only when at least one such conversation exists. No New thread button there. Archive is available. An archived one leaves that picker until threads are turned on.

Unread, sidebar dots, attention, and typing indicators still skip them. Messages stay out of the main chat. The API still marks `hidden: true`. `docs/agent-api.md` says the owner can open, rename, archive, and close them, and that the turn reads the bot's current level.

## Routine results

"Post results to" defaults to the bot's main thread. With threads hidden, the desktop and iPhone menus offer only that choice (an existing routine can keep its current destination). A run reads the bot's current level.

If the server has to create a fallback thread (a Cloud home guest, or a person with no conversation it can open), that thread is titled with the routine's name, is listed, and can be closed. It is no longer marked `routineResults`, so it is not hidden from the list. The title still ends in " · Results", so the next run moves to a real main thread once one exists. That create path was not executed on a live server.

## Per-fix table

| Id | What | Files | Tests | Status |
| --- | --- | --- | --- | --- |
| a | "Apply to every existing thread" is not a control. The level is the bot's, so the control, its help text, and the phone alert are removed. Locales, the self-knowledge guide, and `docs/approval-levels.md` say every conversation uses the current level. | `src/components/bot-settings/PermissionsSection.tsx`, `src/locales/*.json`, `ios/App/Profile/BotPanelPhonePages.swift`, `ios/App/Desktop/BotPanelSettings.swift`, `docs/approval-levels.md`, `scripts/self-knowledge/guides.ts` | Copy is covered by the locale and guide generation already in the tree. No new UI test for a removed control. | Done by the owner rule. `applyToAllThreads` was not added. |
| b | A hidden or new `send_prompt` thread runs at the bot's current level. A later Full change is what the next turn reads. A stale stored copy is migrated and rewritten on the next bot change. A person cannot keep one thread lower on purpose. | `server/store.ts`, `server/index.ts` | `server/independent-task-store.test.ts` (hidden thread follows a later Full change; migration includes hidden threads; a read-only thread stays on Ask) | Done. Raise-before-post of a stored copy was not used. |
| c | At Full, reads of the bot's own `workspaces/<bot>` (including `inbox/`) and `task-workspaces/<bot>` do not raise an admin card, including MCP `read_file`, `list_files`, and `search_files`, and including MCP-started and delegated turns. Confidential thread folders of that bot stay excluded. | `server/engine-access.ts`, `server/index.ts`, `server/drivers/permission-command.ts` | `server/engine-access.test.ts`, `server/auto-approve.test.ts` (Ask every time and Deny stay ahead of Full) | Done. Ask still asks. A path outside those roots, a dot folder, a write, a shell command, and a missing path still get a card. |
| d | `send_prompt` file text points at `workspace_read` and a path relative to `workspaces/<bot>/inbox/<sender>/`. It does not tell the bot to use withheld host file tools. | `server/agent-api.ts`, `server/index.ts`, `docs/agent-api.md` | `server/agent-api.test.ts` ("names workspace_read and the relative inbox path") | Done. |
| e | Always allow on an agent folder root covers later reads under that folder for that bot and that server. It does not follow `..`, a dot path, a credential path, or `/proc`. A command stays exact. An owner or organization Ask or Deny rule still wins. | `server/owner-approval.ts`, `shared/wire.ts`, `src/state/store.tsx` | `server/owner-approval.test.ts` | Done. |
| f | Negative cases live in the tests named above: Ask still asks, an Ask-every-time rule beats Full, a member-owned bot reading outside its roots still gets the admin card. | same as c and e | same | Done. |
| g | Hidden agent threads are visible and closable. See Bug 2 choice. | `server/index.ts` (`listedTasks`), `src/components/TaskPicker.tsx`, `src/components/Sidebar.tsx`, `src/state/store.tsx`, iOS `Models.swift`, `Store.swift`, `AttentionInbox.swift`, `ChatView.swift`, `DesktopChat.swift`, `DesktopChatThreads.swift`, `TaskManagerView.swift`, `docs/agent-api.md` | `src/components/TaskPicker.visibility.test.ts`, `server/thread-privacy.test.ts`, `server/agent-threads.test.ts`. iOS `DeliveredNotificationsTests.swift` was edited and not compiled. | Done. |
| h | Routine runs and the "New thread" fallback follow the live level. With threads hidden the menu says only the main thread. | `server/index.ts` (`resolveResultsThread`), `src/components/routines/ResultsDestination.tsx`, `ios/App/Features/Routines/RoutineEditorView.swift`, `docs/verification/routines.md` | `src/components/routines/ResultsDestination.test.ts` | Done. Fallback creation was not run on a live server. |

## Commands and results

Targeted unit tests, isolated vitest, no live data. Exit 0.

```
pnpm exec vitest run src/components/TaskPicker.visibility.test.ts src/components/routines/ResultsDestination.test.ts src/components/Sidebar.grok-parity.test.ts src/components/SidebarBotActivity.test.ts src/components/Sidebar.threads-location.layout.test.ts src/lib/bot-unread.interbot.test.ts src/lib/routine-quiet.test.ts src/lib/bot-suggestions.test.ts server/owner-approval.test.ts server/agent-api.test.ts server/auto-approve.test.ts server/drivers/permission-command.test.ts server/engine-access.test.ts server/independent-task-store.test.ts server/member-auto-approval.test.ts server/store.test.ts server/thread-model.test.ts server/workspace-auto-only.test.ts server/agent-threads.test.ts server/thread-privacy.test.ts server/computer-engine-removal.test.ts
```

```
 Test Files  21 passed (21)
      Tests  530 passed (530)
   Start at  03:24:14
   Duration  14.75s
```

Type check and lint, from the pre-push hook on `768f045d3` (range `fead6ce8f..768f045d3`). Both exited 0. The hook also ran `pnpm i18n:check` (locale catalogs valid, 10 languages) and `pnpm check:terms` (source term scan clean).

```
pnpm typecheck
```

`package.json`: `tsc -b && tsc -p tsconfig.server.json`. No error output. Exit 0.

```
pnpm lint
```

`package.json`: `oxlint --deny-warnings .`. Exit 0.

Full unit group. Exit 1. This is not a pass.

```
pnpm test:unit
```

Node on this machine is v22.23.4. `package.json` wants Node >= 24. The runner printed that warning and continued.

```
vitest: 2065 files (unit) in 2 shards; logs in /tmp/sagax-vitest-shards-L5uCd2
shard 1/2 FAILED 810s  files: 8 failed | 1022 passed | 2 skipped (1032)  tests: 10 failed | 12942 passed | 21 skipped (12973)
shard 2/2 FAILED 868s  files: 11 failed | 1021 passed | 1 skipped (1033)  tests: 30 failed | 12324 passed | 40 skipped (12394)
FAILED in 868s
ELIFECYCLE  Command failed with exit code 1.
```

Checked against `origin/main` before treating any of these as this branch:

- `server/self-knowledge.test.ts` wants section id `setting:credentials`. That id is absent from `knowledge.generated.json` on `origin/main` and on this branch. The guide text this branch regenerated does not add or remove that section.
- `scripts/testing/index-route-ratchet.test.ts`: `path.match(` appears 95 times in `server/index.ts` on both `origin/main` and this branch. The diff adds no `path.match` line. The ratchet baseline is 93.
- `shared/place-view.test.ts` and `src/components/FailedTurnRow.place.test.ts`: `place.askAdmin` is missing from `src/locales/en.json` on both `origin/main` and this branch. The English string still lives in `shared/place-view.ts`.
- `server/credential-fill.test.ts` and `server/login-fill.test.ts`: `SyntaxError` on `(?i:...)` inside `SecretRedactor`. Node 22 rejects that inline flag. Those files are not in this diff.
- `server/drivers/agents-catalog.ts`, `server/drivers/agents-catalog-wire.test.ts`, and `server/drivers/agents-catalog-goldens` are unchanged versus `origin/main`. The golden run omitted `publish_remote_session` and the non-chief budget was 71452 against a floor of 71619 (`ceil(73080 * 0.98)`). Same sources as main, so the mismatch is already in this checkout.
- The other failing files (`electron/updater-handoff.electron.test.mjs`, `scripts/packaged-native-modules.test.mjs`, `scripts/tool-policy/tool-policy-coverage.test.ts`, `server/org-permissions.experimental.test.ts`, `server/drivers/local-inject.test.ts`, ChatView data-result, ComposeToPicker, touch-actions, ios-mascot-export, popover-contrast, CodeBranchList, toggle-consumers) are not in this branch's diff. Tool-policy names routes in `server/routes/bot-memory.ts` and `server/routes/group-bot-payer.ts`, which this branch does not edit, plus a history route far from the edited handlers.

`swift` is not installed here (`command -v swift` finds no binary). iOS tests were not compiled.

## Not verified

- A live thread's level on a running server.
- A live Ask or Deny rule against a Full bot.
- A real organization server, consent, or the Full access policy switch.
- `resolveResultsThread` creating the fallback thread on a live server.
- End-to-end suites (`pnpm test:e2e`), including fresh-topic and single-stream.
- The iOS app in Xcode or `swift test`.
- The browser UI of the thread picker and the routine menu.

## Risks and rollback

Turns now ignore a stored per-thread approval level except the read-only lock. A thread that had been lowered by hand starts following the bot on the next turn. The migration rewrites stored copies once. Removing the code does not put the old copies back while `approval-inheritance.v1` is present. Delete that marker file only if a rollback must run the migration again. The marker content is the word bot and a newline, mode 0600, under the data directory. It is not a secret.

Listing hidden tasks changes `GET /api/bots` task arrays. Clients that assumed hidden tasks were omitted will now see them. Unread and activity dots still omit them. `shownBotActivity` still omits a hidden task unless it is the selected thread.

Full-level workspace reads are limited to the bot's own roots and skip confidential folders, dot folders, and writes. A bug in the root check would hide an admin card for a path that should still ask. The negative tests cover another bot's inbox, `.ssh`, a write, a command, and a missing path.

Rollback is `git revert` of the commits on this branch, in reverse order. Do not revert `origin/main`.

## Follow-ups

- No lasting per-thread approval override. If a person must lower one conversation, that needs a new visible field and a thread-list label. The owner rule currently forbids it.
- Merging MCP and bot-to-bot turns into the single chat was rejected. A later design would keep per-sender attribution on each message, keep the agent API's `thread_id` as a view of that slice, and stop creating a second engine session. That is a transcript and session change, larger than this fix.
- An archived agent thread disappears from the threads-off picker. Unarchive needs threads turned on.
- The read-only lock has no thread-list label. The open payload already says `readOnly: true`. A label would make that exception visible.
- The routine fallback thread was checked in unit code and the menu tests only.
