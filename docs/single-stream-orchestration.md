# Single stream orchestration (thread mode off)

Status: server and data model shipped (this PR); desktop stream UI and the
default flip follow in the next PR (see "Plan" below). Requested by JC on
2026-10-17: with threads hidden, one conversation per bot like Grok Bot; the
person never has to look for where a chat went; the bot runs each topic in a
fresh context but still knows everything that happened before, cheaply. JC
then set it as the default mode.

## What exists today (investigation, 2026-10-17)

- **Thread mode** is Settings > Appearance > Show threads, the renderer key
  `omb-show-threads` (`src/lib/thread-preferences.ts`, `SHOW_THREADS_DEFAULT
  = true`; synced on an organization server through `/api/me/preferences`,
  `shared/user-preferences.ts`). Unset is on; the switch writes "1" or "0",
  so an explicit choice is distinguishable from the default. iOS keeps its
  own fallback (`ios/App/Features/Sidebar/HomeMenus.swift`,
  `SidebarHiddenViews.swift`).
- **Threads off today** hides every thread control: no picker in the header
  (`TaskPicker` returns null), no "new thread" in the sidebar row or bot menu,
  `ComposeToPicker` opens the existing chat. There is no "new chat" while
  threads are off; ⌘N opens the compose picker. Threads still get created
  behind the scenes (an older build, another device, a teammate, a bot's
  `start_thread`, a routine, an AI client's hidden conversation). The app
  opens the bot's main thread (`server/main-thread.ts`, the open thread the
  person last wrote in) and, when a deep link or notification lands on
  another one, shows "Back to conversation" (`ThreadsOffReturnLink`,
  `src/components/thread-home.ts`). That is the "where did it go" problem.
- **Grok Bot** keeps one continuous conversation per bot; sub-agent work
  (Sagax: hidden AI-client conversations, #291; parallel tasks) stays out of
  the chat and reports back into it.
- **Context today**: Sagax folds a long thread itself
  (`compactConversation`, `server/context-budget.ts`,
  `server/compaction-summary.ts`): two latest exchanges verbatim, the rest
  summarized by the engine's tool-free `generateText` with a deterministic,
  extractive fallback, stored on the task (`contextSummaries`, server-private).
  Every 1:1 turn also carries automatic recall (`server/recall.ts`, FTS
  passages from memory and the person's other conversations, 6,000 chars),
  a recent-work brief (`server/recent-work.ts`, one line per other
  conversation over 48 h, 1,400 chars) and `session_search` /
  `session_read` on demand. All of them are narrowed by
  `privateRecallFilter` (confidential threads feed nothing; on an
  organization server, the same person's threads only).
- **Sub-agents and side work**: parallel tasks (`parallelOf`, a card and a
  reply in the asking conversation), `start_thread` (bot-opened jobs,
  `openedBy`), the side thread column ("Ouvrir à côté",
  `src/lib/side-thread.ts`), hidden AI-client conversations.

## Design

### Data model: segments are threads

A bot's stream is its threads that a person had with it, oldest first
(`shared/single-stream.ts`, `isStreamSegment`, `streamSegments`): never a
routine run, a hidden AI-client conversation, a confidential thread, a
bot-opened thread or a parallel task. Nothing is copied or moved. Turning
threads back on shows the same segments as threads; turning them off again
merges them. That is the migration: existing threads of a bot appear in the
stream in chronological order with no data written, fully reversible.

"New topic" creates a thread (`POST /api/bots/:id/tasks { stream: true }`):
a fresh engine context. The person sees a divider ("Nouveau sujet" / "New
topic") in the same stream, never a new place.

### Server orchestration (`server/single-stream.ts`)

- **Marker.** A send from a client with threads off carries `singleStream:
  true` (`singleStreamTurnField`); the server marks the thread
  `streamSegment: true` (server-private, never on the wire). A send with
  `false` clears it, so thread mode on is unchanged. A send that says
  nothing (older build, phone, relay) leaves it as it is. A confidential,
  hidden, routine, parallel or bot-opened thread is never marked;
  `makeTaskConfidential` drops the mark and the digest.
- **Digest.** A person's turn in a marked segment (no teammate, routine,
  webhook, peer ask or call) gets an "Earlier topics" block in the volatile
  half of its system prompt: one entry per other segment of the same
  person's stream, newest first, with a digest (summary, decisions, open
  items, files and links) for the newest 8 and a one-line index (title,
  date, id) for the next 40, then a count. Those topics leave the
  recent-work brief of that turn, so nothing is said twice.
- **Cost.** Per segment digest at most 900 chars; whole block at most 6,000
  chars (about 1,500 tokens), logged on every stream turn
  (`[stream] ... chars (~N tokens)`). A digest is extractive by default
  (first ask, latest ask and answer, quoted facts and identifiers from
  `keyFacts`, files and links: free, never invents) and cached in memory
  per segment change. The bot's own engine writes a model digest (the
  compaction path's `generateText`, 20 s bound, fallback to extractive) at
  most once per stream turn, in the background, for the newest stale
  segment, and right when a new topic closes the previous one. It is stored
  on that segment (`segmentDigest`, server-private, anchored to its newest
  message).
- **Recall on demand.** `recall_topic` (agents MCP, read-only,
  `topics:recall` permission) lists the stream's topics or returns one
  topic's transcript in 12,000-char pages, newest page first, paging back
  with `before`. It is offered only in a stream turn
  (`SAGAX_SINGLE_STREAM`), so a thread-mode catalog is unchanged, and its
  route (`/api/internal/recall-topic`) re-checks: depth 0, the calling
  thread is a marked segment, the topic is one of `streamCandidates`.
  Anything else reads as missing.

### Privacy boundaries

- Confidential threads (#683): never a segment, never digested, never
  listed or read by `recall_topic`; a thread made confidential later loses
  its digest at once. A confidential thread draws on no stream either.
- Per-person streams: `streamCandidates` applies `privateRecallFilter`, so on
  a shared or organization bot each person's digest and recall hold only
  their own threads (covered by PT-5 in `server/org-private-threads.e2e.test.ts`).
  On a Cloud home, `cloudOwnerOnlyThread` applies as for recall.
- AI-client hidden conversations: never a segment, never in the digest or
  `recall_topic`. (They keep their existing line in the recent-work brief,
  which predates this work.)
- Digest text goes through `redactSecretsInText` before it is stored or sent.

### Clients (next PR)

Desktop, threads off:

- The chat draws the bot's segments as one transcript: the current (newest)
  segment is the live one with its composer; scrolling back past its first
  message loads the previous segment (`GET /api/threads/:id/messages`, the
  route scrollback and the side thread use) above a divider "Nouveau sujet ·
  <title> · <date>", and so on to the first.
- "New topic" (header button where the thread picker sits with threads on,
  ⌘N while a bot chat is focused, and the bot's row menu) creates the
  segment with `stream: true`.
- Search hits, notifications and deep links to a segment open the stream at
  that segment's message (`focusMessage` after loading the segment) instead
  of switching threads; `ThreadsOffReturnLink` goes away. Threads that are
  not segments (confidential, bot-opened, hidden) open alone, as today.
- Older segments are full rows: reactions, attachments and approvals act on
  their own thread ids; Reply on an older message quotes it into the
  current composer as a citation (cross-thread replies are not a thing on the
  server), edit and regenerate stay with the live segment.
- Default flip: `SHOW_THREADS_DEFAULT = false`. Unset (never chosen) moves to
  the single stream; an explicit "1" keeps threads. Settings > Appearance
  keeps the one-click switch back, and the release notes of that version say
  so.

iOS: keeps thread mode as today (its own fallback) and works unchanged
against the server (a send without `singleStream` changes nothing). The
same data model applies when its UI follows (`shared/single-stream.ts`
rules ported to `CompanionCore`).

## Tests

- `shared/single-stream.test.ts`: segment rule and order, exclusions.
- `server/single-stream.test.ts`: digest extraction and caps, model digest
  fallback and timeout, composed block budget, recall pages, candidates.
- `server/drivers/agents-catalog-single-stream.test.ts`: the tool appears
  only in a stream turn and is a read.
- `server/single-stream.e2e.test.ts`: marker, new topic, digest in the
  prompt, background model digest, `recall_topic` list and read, refusal of
  a confidential topic, hidden and confidential exclusions, thread mode on
  unchanged, a topic made confidential later.
- `server/org-private-threads.e2e.test.ts` PT-5: per-person streams on a
  shared bot.
