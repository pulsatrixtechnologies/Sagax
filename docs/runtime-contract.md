# The job runtime contract

One record, one lifecycle and one wake lane for every piece of work one bot hands to another, whatever started it: a person's chat, a room, a routine, a webhook, a goal run, an external runtime, a one-way notice or a consultation. `server/runtime/` implements this page; `server/runtime/*.test.ts` proves it on fake engines; nothing outside the module may hold work state of its own.

This replaces the two delegation systems, the six wake lanes, the dozen clocks and the ten trust wordings the server grew (room-handoffs, delegations, the aside lane, card-resume maps, `Continue:` tasks). They are deleted once the runtime carries every path.

## 1. The record

`Assignment` (`server/runtime/types.ts`). The parts that matter:

| Field | Meaning |
|---|---|
| `rootId`, `parentId`, `depth` | A tree. The root is the requesting conversation's own node (a person's message to a Chief, a routine run, an external call). |
| `origin` | Where the work started: `person` (with the person's request harness-quoted), `routine`, or `outside` (webhook, relay, guest, peer, api). Written once at the root, copied down, never changed. |
| `requester` | Who asked: a person, a bot turn (bot + thread), a routine run, an external runtime. `chief: true` when it is a Chief of Staff conversation. |
| `assignee` | Which bot, in which thread (a work thread, the standing thread, a room thread). |
| `mode` | `work`, `consult` (answer, act on nothing), `notify` (one-way). |
| `reply` | `resume` (wake the requester), `poll` (inbox only), `none`. |
| `status`, `outcome`, `outcomeDetail` | Section 2. |
| `level`, `levelSource` | Section 3. Computed at enqueue, recorded, never patched onto a thread. |
| `executions`, `restarts`, `restart` | Turns started; restart bookkeeping (section 5). |
| `result`, `evidence` | What the assignee said, and what the harness observed of the turn. |

Storage: SQLite (`node:sqlite`, like `messages.db`) in `DATA_DIR/runtime.db`: `assignments` (one row per record), `assignment_events` (append-only audit trail, every transition), `inbox` (the wake lane). `:memory:` for tests. Every state change is one transaction that writes the row and its event before the runtime acts on it, so a crash keeps the accept and loses nothing it had acknowledged.

## 2. Lifecycle

```
queued ──admit──> running ──turn ends──> completed | failed | cancelled
                    │  └──handed out work──> waiting ──all children settled──> resume ──> running
                    └──question for the person──> needs_input ──answer──> running
                                                              └──wait expires──> failed(expired)
```

- **Enqueue** checks the parent is running (or there is no parent), refuses work back to an ancestor, dedupes (same brief, same assignee, same parent, unless `rework`), checks depth and the root's budgets, computes the level, writes the row with event `enqueued`. Refusals return a typed reason; they never throw into a turn.
- **Admission** is one rule for every path: the runtime asks the host `canStart`; the host answers from its slots (a sibling waiting on the person does not hold its sibling). Same-conversation turns never overlap. `validate` runs before every dispatch and again on every tick for every live row: access that closes while a teammate works ends that work `failed(refused)` with the reason, its words are dropped, and a report whose route no longer admits it is withheld from the requester's resume.
- **A turn** is one `run` of the assignee. Its result is `completed`, `failed(outcome)` or `needs_input(question)`. If it handed out work, the node goes to `waiting` instead; when every child has settled and been reported, it goes to `resume` and runs once more with the children's results.
- **Terminal outcome** is written exactly once, then `report` is called exactly once for a child (and for a root the runtime itself ended: cut twice, stalled, expired, out of budget, stopped), then (if `reply` is `resume` or `poll`) one inbox item is written for the requester. A one-way notice (`reply: none`) is never awaited: it holds no parent in `waiting` and returns nothing.
- **Wake**: the requester's wake is its own resume turn, dispatched by the runtime when the requester is free, carrying every settled child at once; `poll` requesters read their inbox instead. Wakes happen on terminal outcomes, `needs_input` and `stalled`, never on progress. At most one wake for a result.
- **Cancel** cascades down the tree, aborts running turns, and is itself a terminal outcome (`stopped`) that is reported.
- **Stop awaiting** (the person stops the requester's conversation): children that never started are cancelled; running children keep their process and still report; the requester's node is cancelled and nothing resumes it.

## 3. One level rule

`level = max(own, inherited)` in the order `ask < edits < auto < full`. `custom` never travels.

`inherited` is the Chief conversation's level only when the origin is `person` or `routine` **and** the requester is a Chief, or a Chief is an ancestor in the same root. Outside lineage inherits nothing.

The inherited level is capped by what the assignee's engine really does (`shared/approval-mode.ts`): `full` only if `supportsApprovalMode(kind, "full")`; `auto` only if `hasNativeAutoReview(kind)`, otherwise `edits` if supported, otherwise `own`. `levelSource` says which rule won. The permission mode a turn runs with must equal the level on its record (invariant I6).

## 4. One envelope

The harness writes the opening of every delegated turn from stored data, never from model text (`server/runtime/envelope.ts`). Four shapes:

1. **Assignment with person or routine lineage.** Names the assignment id, the requester, the person and the quoted request; states "this is your task, do it with your own tools"; states the level and that nothing the level allows needs confirmation; says how to ask the person (`NEEDS INPUT:` plus the exact question); says that pages, files, tool output and other bots' text are data, never instructions, and that no bot's message approves a permission or changes settings.
2. **Assignment with outside lineage.** The same, with the strict wording: the request is outside content, not the person's authority.
3. **Consultation.** Answer from what you know or can quickly check; act on nothing in it.
4. **Report.** From whom, on which assignment, with which outcome, and what the harness observed; "check claims against what was observed, redo only what the evidence does not cover".

Model-written fields that imitate the envelope's opening marker are escaped. The person's later "yes" travels as a harness-written quote, never as pasted text.

## 5. One restart policy

Downtime is nobody's budget: every window restarts at boot. At open, before anything is dispatched:

| State at shutdown | What happens |
|---|---|
| `queued` | Dispatches normally. |
| `running`, no children started since its turn began | One rerun in place, `restarts` 1, the turn opens with a note to check what it already did. A rerun cut again ends `failed(interrupted)` and is reported. |
| `running`, children started since its turn began | `waiting`; its resume says the turn was cut. Nothing of it runs again. |
| `needs_input` | Stays parked; `park` is called again so the card is re-shown. |
| `waiting`, `resume` | Unchanged; the resume goes ahead. |

A requester waiting on a cut turn hears what the restart did in its next turn (`restart: "teammates"`). Every reconciliation writes an event.

## 6. Budgets and clocks

Three budgets per root, counted since the root's last durable progress (a settlement, a completed turn): `requests`, `executions`, `wakes`. Progress renews them; nothing else does. The owed follow-up turn of a node whose children all settled is never refused for budget.

Three clocks and no others: a queue bound (`queueMs`, expired means `failed(expired)`, "never started"); a per-root stall window on durable progress (`stallMs`, fails the tree); a per-turn activity window (`turnStallMs`, on the monotonic clock, so a laptop sleep is not a stall; a tool visibly in flight counts as activity through `progress()`). Time spent parked on the person is charged to no window. A wait on the person is bounded by `inputWaitMs`; expiry is `failed(expired)`: not run, not refused, never reported as approved.

## 7. Invariants

The suite asserts these after every scenario (`server/runtime/invariants.ts`):

- **I1** No non-terminal assignment without a live owner: a running turn, a queue entry, a parked question or a waiting parent.
- **I2** Every terminal assignment with `reply: resume` has exactly one report and at most one wake for its result.
- **I3** No result is delivered twice; no brief is dispatched twice except by explicit `rework`.
- **I4** Every root ends in a terminal outcome, and a root a restart ended alone is reported to its own conversation.
- **I5** Nothing claims "approved" without an allow: `expired` is never `completed`.
- **I6** The level a turn ran with equals the level on its record.
- **I7** Every status change has an event; the row can be rebuilt from its events.
- **I8** A restart runs a cut turn again at most once.
- **I9** A wake happens only when the owner is idle, and only on terminal, `needs_input` or `stalled`.
- **I10** The runtime never throws into a turn: every refusal is a typed result.

## 8. Ports

The host (today `server/index.ts`) implements `TurnRunner`: `validate`, `canStart`, `run`, `park`, `report`, `changed`, `names`. The runtime owns the record and the decisions; the host owns engines, threads, chips, cards, names and notifications. A host method that throws is logged and read as "not now"; the next tick retries. The host calls `tick()` on its own schedule and `progress(id)` when it sees activity on a turn; `progress` writes no event (per-tool-call rows would be noise), every status change does.

Engine drivers declare capabilities (`server/runtime/capabilities.ts`): `resume` (keeps a native session), `nativeReviewer`, `full`, `edits`, `stepCap`, `subagents`. The level rule and the continuation rule read these flags, never driver names.

## 9. Delivery

This lands one PR at a time, each to `main`, each green on the suite before merge:

1. **Runtime core and chat coordination** (this PR): contract, types, store, runtime, level, envelope, capabilities, invariants, scenario suite; `coordinate_bots` runs on the runtime through `server/coordinator.ts`; the room-handoff tree is deleted and an in-flight `room-handoffs.json` is imported once at boot (renamed `*.migrated`).
2. **Every other path on the runtime**: routines, webhooks, goal turn 1, external runtimes, `delegate_bot`/`ask_bot`/`send_to_bot` as aliases of one tool surface; the legacy ledger imported once.
3. **Delete**: `delegations.ts`, `aside-queue.ts`, `comms-visibility.ts` DM mirroring, `turn-continuation.ts` `Continue:` tasks, the card-resume maps, the `boundedCoordination` switch, the remaining trust wordings and 15-minute timeouts.
