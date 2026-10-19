# Single stream orchestration (thread mode off)

Status: the default mode since 2026-10-17. Server and data model in #719;
desktop stream UI and the default flip in the follow-up PR. iOS keeps thread
mode for now (see "Clients"). Requested by JC on 2026-10-17: with threads
hidden, one conversation per bot like Grok Bot; the person never has to look
for where a chat went; the bot runs each topic in a fresh context but still
knows everything that happened before, cheaply. JC then set it as the default
mode.

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

### Clients

Desktop, threads off (`src/lib/single-stream.ts`, `ChatView`):

- The bot opens at its newest segment (`botOpensTo`). The chat draws the
  segments as one transcript: the newest one is live, with its composer;
  once it is read back to its first message, the previous segment is drawn
  above it at once (a new topic never hides what came before) and older ones
  load on scroll-up or with "Show the previous topic", each under a divider
  "Nouveau sujet : <title>" / "New topic: <title>". An earlier segment keeps
  its own copy of the thread (`useSegmentTranscript`: the newest page, older
  pages on demand or, for a linked message, up to 10 pages back to it, live
  frames; a reload after missed frames replaces the copy), so a late
  answer shows where it belongs; a pill above the chat ("New activity in an
  earlier topic") brings an unread or waiting one on screen and reads it.
  Once drawn for a live topic, the earlier topics stay mounted (a new
  message or an older live page never drops them) until the person leaves
  that topic. The scroller has the browser's scroll anchoring off, so
  `useStreamAnchor` moves scrollTop by a topic's growth when the reader's
  view starts below it or within 120 px of its end; an older page loaded
  inside the topic being read appears where its button was.
  A link, a search hit or the pill into an earlier topic draws the earlier
  topics at once and stops bottom-follow (`stopFollowing`), so the jump
  holds.
- "New topic": the header button (`data-new-topic`, where the thread picker
  sits with threads on) and the bot row menu create the segment with
  `stream: true`. ⌘N still opens the compose picker; with threads off it
  opens the bot's conversation, never a hidden thread.
- Thread links and search hits in an earlier segment open the stream at its
  newest segment and load back to the message (`isEarlierSegment`,
  `focusMessage`), instead of switching threads: the earlier topics are drawn
  at once, above whatever of the live topic is loaded (the live topic's own
  top sentinel, under its divider, loads the rest). A notification about an
  earlier segment opens the stream at its newest segment; the activity pill
  then brings that topic on screen. ⌘F searches the live topic and the
  newest earlier ones (`STREAM_FIND_TOPICS`, 20: one request per topic). Threads outside the stream
  (confidential, bot-opened, hidden) open alone, with "Back to conversation"
  to the stream.
- Earlier segments are full rows: reactions, pins, attachments and cards act
  on their own thread ids. They are drawn as busy, so edit, regenerate and
  version switches stay with the live segment; Reply quotes the message into
  the live composer as a citation (a reply is per thread on the server).
- Default flip: `SHOW_THREADS_DEFAULT = false`. Unset (never chosen) moves to
  the single stream; a stored "1" (threads turned on) keeps threads. Settings
  > Appearance > Conversation threads offers "One conversation", "In the
  header", "In the sidebar": the one-click way back.

Release note text for the version that ships it (the release session adds it
to `docs/releases/<version>.md`):

- FR: « Une seule conversation par bot, par défaut. Quand les fils sont
  masqués (le nouveau réglage par défaut), « Nouveau sujet » démarre un
  contexte neuf sans rien cacher : les sujets précédents restent au-dessus,
  et le bot en garde un résumé compact. Pour revenir aux fils : Réglages >
  Apparence > Fils de conversation. »
- EN: "One conversation per bot, by default. With threads hidden (the new
  default), New topic starts a fresh context without hiding anything: earlier
  topics stay above, and the bot keeps a compact digest of them. To get
  threads back: Settings > Appearance > Conversation threads."

iOS: keeps thread mode as today (its own fallback, still on) and works
unchanged against the server: a send without `singleStream` changes nothing,
and a thread made a segment on the desktop shows as a thread there. Next
step: port `shared/single-stream.ts` to `CompanionCore`, send
`singleStream`, draw earlier segments with the same dividers.

## Fresh topic on return (2026-10-18)

JC's decision: coming back to a bot lands on a new, empty topic, with the
earlier ones folded behind one "Earlier topics" line, and the bot keeps all
of it (digest, `recall_topic`). The rule (`shared/fresh-topic.ts`, same
cases on iOS): a fresh topic when the topic the bot opens to is quiet past
the threshold (default 4 h, Settings > Appearance > Conversation) or the
person was away from the bot or the app longer than that; never over a
running turn, a waiting approval or question, an unread answer, teammates
working or queued messages; a person who left a moment ago stays where they
were. The topic is a client draft until its first message
(`POST .../tasks { stream: true }`, then the send). Notifications, links and
search hits open their own topic. Section "Fresh topic on return" in
`AGENTS.md` has the full rules and tests.

Release note text:

- FR : « Retour dans un chat : un sujet neuf. Après 4 h d'absence ou de
  silence (réglable dans Réglages > Apparence > Conversation), revenir à un
  bot ouvre un nouveau sujet vide ; le bot garde tout l'historique et les
  sujets précédents restent à un clic, sous « Sujets précédents ». »
- EN: "Coming back opens a fresh topic. After 4 h away or quiet (Settings >
  Appearance > Conversation), coming back to a bot opens a new, empty topic;
  the bot keeps the whole history and earlier topics stay one click away,
  under Earlier topics."

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
- `src/lib/single-stream.test.ts`, `src/lib/use-segment-transcript.test.ts`,
  `src/components/ChatView.stream.test.ts` (earlier topic above the live one,
  dividers, New topic, confidential alone, threads on unchanged, default),
  `src/state/notification-open.test.ts` (notification and search hit into an
  earlier topic), `src/lib/thread-preferences.test.ts` (default off, "1"
  kept).
