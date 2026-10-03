# iOS feature parity matrix (iPhone and iPad vs the Electron renderer)

Date: 2026-10-03 · Status: inventory and plan, awaiting JC review · Scope: `ios/` (iPhone
and iPad), with the sidecar (`companion/src/routes.ts`) and server (`server/request-auth.ts`)
gates · Branch: `feat/ipad-desktop-parity`

## Why

JC (2026-10-02): "the iOS version lacks a lot of the features of the Electron version. Since
we are working on iPad, improve the iOS (iPhone) version too, as long as the look of the chat
and interaction doesn't change. We need to be on parity with the features."

Two constraints frame every row below:

1. **iPhone look stays.** The chat, bubbles, composer and header match the phone reference
   screenshots (`docs/superpowers/specs/2026-10-01-ios-visual-parity-design.md`). New features
   enter through existing doors only: the composer "+" sheet (`ChatView.swift` `plusSheet`),
   long-press menus (message bubble `.contextMenu` at `ChatView.swift:1512`, chat rows
   `ChatListView.swift` `chatMenu`, thread rows), swipe actions, the bot profile
   (`Profile/BotProfileView.swift` tabs and its Advanced sheet `AgentProfileView.swift`),
   Settings pages, and sheets pushed from those.
2. **The reference for a paired device is the desktop remote client** (spec
   `2026-10-02-ipad-desktop-parity-design.md`, "Rule for the iPad"; `docs/ios-companion.md`,
   "Same surface as the desktop remote client"). Paired through a sidecar, iOS shows what the
   remote-client renderer shows. Paired with a server, iOS shows what the served renderer shows
   for the session's scope (client: `CLIENT_ALLOW`; admin: everything).

These two pull against JC's "parity with the features": much of the Electron app is hidden
in remote-client mode (full bot panel, Inspector, approval mode, room setup, templates, most
Settings). The matrix therefore tags every feature with a **tier**, so the plan ships the
uncontroversial part first and isolates the policy decisions (see "Decisions for JC").

## How to read the tables

Columns:

- **Desktop**: renderer component(s), paths under `src/components/` unless stated.
- **Routes**: the `/api` calls; `local` means local storage or store only; `bridge:` means an
  Electron preload member.
- **RC**: does the desktop remote client (`window.ogb.remoteClient.active`) show it. Y, N, or
  partial.
- **SC**: does the sidecar `ALLOWED` list let the route through (Y, N, partial).
- **CS**: client session on a server (`CLIENT_ALLOW`): Y, or `admin` (admin scope needed),
  or `org` (organization server only).
- **iPhone**: DONE, PARTIAL (what is missing in brackets), MISSING, P (phone-only extra, no
  desktop equivalent), N/A (not applicable to iOS). Swift paths under `ios/App/` unless they
  start with `Core/` (`ios/Sources/CompanionCore/`).
- **iPhone placement**: where it goes without changing the chat look (only when not DONE).
- **iPad**: the target. **Today the iPad shows the phone UI for every row** (one
  `NavigationStack` with readable columns, `CompanionLayout.swift`), so the iPad state equals
  the iPhone state everywhere. The column gives the desktop surface the iPad must reproduce
  (surface ids from `ios/parity/desktop/surfaces.mjs`, e.g. `chat-message-hover`) or `=`
  (same as iPhone placement inside the desktop shell).
- **T** (tier):
  - **A**: RC shows it and both gates already pass. Pure iOS work.
  - **B**: RC shows it (or iOS needs it for an RC surface) but a route is missing on the
    sidecar or in `CLIENT_ALLOW`. Server work first (package S1/S2).
  - **C**: RC hides it. Reachable for an admin-scope server pairing or an organization
    server. Ship behind the scope gate (`session.canAdminister` / org), never drawn disabled.
  - **H**: host only (bridge, host filesystem, API keys, Local VM, backups). Never on iOS.
  - **P**: phone-only extra that already exists.
- **Work**: server or sidecar change needed (`none` otherwise).

## 1. Sidebar and fleet (home list)

iPhone home: `ChatListView.swift`, `HomeRoster.swift`, `CompactRoster.swift`,
`BotThreadTree.swift`, `BotThreadRow.swift`, `Core/AttentionInbox.swift`,
`Core/RosterDensity.swift`, `Core/SectionSelection.swift`.

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SB1 | Roster grouped by sections | Sidebar.tsx | GET /api/bots | Y | Y | Y | DONE (ChatListView, HomeRoster, CompactRoster) | | `main` | A | none |
| SB2 | Personal sections on an org server (#101) | Sidebar.tsx:1984-2032, OrgSectionMenu.tsx, lib/personal-sections.ts | synced pref `sagax.sidebarSections.v1` via GET/PUT /api/me/preferences | Y | Y | Y | MISSING (iOS reads only `bot.section`) | section header long-press > New, Rename, Delete; NewSectionSheet writes the pref on an org server | `sidebar-section-menu` (org items) | A | none |
| SB3 | New section (file bots) | TeamDialog.tsx | POST /api/sidebar-sections | partial | Y | admin | DONE (NewSectionSheet.swift, admin gated) | | `sidebar-new-menu` | A | none |
| SB4 | Rename, delete, edit bots of a section | TeamDialog, Sidebar.tsx:2615,2843 | PATCH/DELETE/PUT /api/sidebar-sections | N | N | admin | MISSING (NewSectionSheet can only add) | section header long-press > Rename, Edit bots, Delete (admin pairing) | `sidebar-section-menu` | C | none |
| SB5 | Share team | ShareTeamDialog.tsx | /api/teams/export | N | N | admin | N/A | | hidden | H | none |
| SB6 | Move bot to section | Sidebar MoveToSectionItem | POST /api/sidebar-sections | Y | Y | admin | DONE (chatMenu "Move to section") | | `sidebar-bot-menu` | A | none |
| SB7 | Collapse sections (synced) | Sidebar, pref `sidebarCollapsedSections.v1` | synced pref | Y | Y | Y | PARTIAL (device-local CollapsedSections in HomeRoster) | read/write the synced key | = | A | none |
| SB8 | Section order (drag, ⌥↑/⌥↓) | Sidebar, pref `sidebarSectionOrder.v1` | synced pref | Y | Y | Y | MISSING | section header long-press > Move up / Move down | drag + ⌥↑/⌥↓ | A | none |
| SB9 | Density comfortable / compact / icons rail | SettingsModal density row | local | Y | n/a | n/a | DONE (RosterDensity, Settings > Advanced > List density) | | `main`, `main-compact`, `main-collapsed` | A | none |
| SB10 | Show threads under each bot (global switch) | SettingsModal.tsx:596, lib/thread-preferences.ts | local `omb-show-threads` | Y | n/a | n/a | PARTIAL (per-bot disclosure in BotThreadTree, no global switch) | Settings > Appearance > Show threads | `main-threads` | A | none |
| SB11 | Pin / unpin bot, pinned tiles | Sidebar bot menu | PATCH /api/bots/:id {pinned} | N | Y | Y | DONE (chatMenu, Session.setPinned, Pinned row) | | pinned tiles in `main` | A (beyond RC) | none |
| SB12 | Pin room on home | (iOS extra) | PATCH /api/groups/:id {pinned} | n/a | Y | Y | P (Core/ClientHome.swift) | | = | P | none |
| SB13 | Unread dot, mark read on open | store.tsx:3560 | POST /api/bots/:id/read, /api/groups/:id/read | Y | Y | Y | DONE (BotThreadRow, Session.markRead) | | = | A | none |
| SB14 | Mark as unread | Sidebar bot menu | PATCH /api/bots/:id {unread} | N | Y | Y | MISSING | chat row long-press > Mark as unread; leading swipe | `sidebar-bot-menu` | A | none |
| SB15 | Needs-you attention list, answer approvals inline | SidebarAttentionPanel.tsx, PendingApproval | POST /api/bots/:id/respond | Y | Y | Y | DONE (ChatListView "Needs attention", UpdatesSheet, Island) | | attention panel | A | none |
| SB16 | Name search in the sidebar | Sidebar search | local | Y | n/a | n/a | DONE (ChatListView query) | | `main` search field | A | none |
| SB17 | Command palette with message hits (⌘K) | CommandPalette.tsx | GET /api/search | Y | Y | Y | PARTIAL (SearchSheet, no ⌘K) | | `search-palette`, `search-palette-query` | A | none |
| SB18 | Folders under a bot (view) | Sidebar | GET /api/bots (projects) | Y | Y | Y | DONE (CompactRoster, BotThreadTree, TaskManagerView) | | `main-threads` | A | none |
| SB19 | New folder, rename, emoji, delete | Sidebar folder row | POST/PATCH/DELETE /api/bots/:id/projects[/:p] | Y | Y | admin | MISSING | chat row long-press > New folder; folder header long-press > Rename, Emoji, Delete (TaskManagerView, CompactRoster) | folder row menu | A | none |
| SB20 | Reorder folders | Sidebar.tsx:1260-1306 | PATCH /api/bots/:id/projects/order | Y | Y | admin | MISSING | TaskManagerView edit mode `.onMove` | drag | A | none |
| SB21 | Bot menu: New thread | Sidebar | POST /api/bots/:id/tasks | Y | Y | Y | DONE (chatMenu, BotThreadTree) | | `sidebar-bot-menu` | A | none |
| SB22 | Bot menu: Edit profile / rename | Sidebar.tsx:1489 | PATCH /api/bots/:id/profile | Y | Y | Y | DONE (BotProfileView) | | = | A | none |
| SB23 | Copy conversation ID | Sidebar | local | Y | n/a | n/a | PARTIAL (BotProfileView.swift:536 copies `bot.id`, desktop copies the thread id) | chat row long-press > Copy conversation ID (thread id) | `sidebar-bot-menu` | A | none |
| SB24 | Put on the desktop (floating mascot) | Sidebar floatItem, floating-bots/ | local | Y | n/a | n/a | N/A (Island/LiveActivities are the phone analog) | | hidden (spec exception) | H | none |
| SB25 | Hide from sidebar, Hidden items list | Sidebar, SidebarHiddenSettings | synced pref `sagax.sidebarHidden.v1` | N for bots, Y for rooms and the list | Y | Y | MISSING (pref ignored) | row long-press > Hide; Settings > Appearance > Hidden from list | `sidebar-bot-menu`, settings-appearance | A | none |
| SB26 | Archive bot, Archived bots, restore | Sidebar.tsx:2153, ArchivedBotsPanel | PATCH /api/bots/:id {hidden} | N | N (field refused) | admin | MISSING | Profile "..." > Archive; Settings > Archived bots (admin pairing) | as desktop | C | none (sidecar refuses by design) |
| SB27 | Delete bot | BotDeleteMenuItem | DELETE /api/bots/:id | N | Y | Y | DONE (BotProfileView "..." > Delete Bot) | | `sidebar-bot-menu` | A (beyond RC) | none |
| SB28 | Make primary bot | Sidebar.tsx:2178, PrimaryBotPicker | POST /api/bots/:id/primary | N | **N** | Y | MISSING | Profile "..." > Make primary; Settings > Primary bot | bot menu | B | S1: sidecar allow (owner check in handler) |
| SB29 | Footer places: Team map, Automations, Connected apps, Templates | Sidebar.tsx:2388-2420 | various | partial (no Templates) | | | PARTIAL (Automations and Plugins under Settings, no Team map) | see TM1, AU1, PL1 | sidebar footer | A | none |
| SB30 | Account menu (Your phone, Settings, Achievements, Shortcuts, About, Help) | SidebarProfileMenu.tsx:241-284 | various | partial | | | PARTIAL (Settings, Help, Terms) | Settings > About page (app, build, host versions) | `sidebar-profile-menu` | A | none |
| SB31 | Compose-to: new bot | ComposeToPicker, CompanionNewBotDialog | POST /api/bots | Y | Y | Y | PARTIAL (CreateBotSheet gated on `canAdminister`, CS allows it) | ungate for client sessions | `sidebar-new-menu` | A | none |
| SB32 | Compose-to: new room | ComposeToPicker | POST /api/groups | Y | Y | Y | DONE (NewGroupSheet) | | `new-group` | A | none |
| SB33 | Compose-to ⌘1-9, ⌘N | ComposeToPicker.tsx:166 | local | Y | n/a | n/a | MISSING | n/a (no hardware keys) | ⌘N, ⌘1-9 | A | none |

## 2. Chat: composer

iPhone composer: `ChatView.swift` (composer, `plusSheet` at :709, `QueuedSendList` at :2567),
`Composer/CommandSkillHUDView.swift`, `Composer/PredictiveActionChipsView.swift`,
`SpeechDictation.swift`, `Core/Client.swift` (`send` posts only `{text, threadId, sendId}`).

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| CO1 | Send text, Return sends | Composer.tsx:688 | POST /api/bots/:id/messages | Y | Y | Y | DONE | | `chat-composer-draft` | A | none |
| CO2 | Reply to a message (quote strip above the composer) | ReplyQuote.tsx, Composer `replyTo` | POST messages {replyToId} | Y | Y | Y | MISSING (no `replyToId`) | bubble long-press > Reply; quote strip above the composer | hover row > Reply | A | none |
| CO3 | Attach image | ComposerAttachments.tsx | POST /api/attachments | Y | Y | Y | DONE ("+" > Photo Library) | | = | A | none |
| CO4 | Attach document | Composer.tsx:1066 | POST /api/files | Y | Y | Y | DONE ("+" > Choose File) | | = | A | none |
| CO5 | Paste image, long paste becomes a chip | Composer.tsx:764, composer-attachments.ts:434 | POST /api/attachments | Y | Y | Y | MISSING | paste handler on the field; "+" > Paste | = | A | none |
| CO6 | Drop files on the chat | ComposerAttachments.tsx:77 | /api/files, /api/attachments | Y | Y | Y | MISSING | n/a | `.dropDestination` on the chat column | A | none |
| CO7 | Folder / archive attach | composer-attachments.ts:16 | host path | partial | n/a | n/a | N/A | | | H | none |
| CO8 | Quote selected text as a citation | CitationUI.tsx, ChatView:1623 | local | Y | n/a | n/a | MISSING | SelectableTextSheet > Quote in reply | selection toolbar | A | none |
| CO9 | Slash menu: engine commands | ComposerCommandMenu.tsx, lib/harness-commands.ts | GET /api/bots/:id/harness-commands | Y | **N** | Y | PARTIAL (HUD hard-codes /computer, /threads and sends prose for diff, retry, steer) | "+" > Slash commands HUD filled from the route | `chat-composer-slash` | B | S1: sidecar allow GET harness-commands |
| CO10 | Sagax commands `/learn`, `/setup` | Composer.tsx:356-397 | send | Y | Y | Y | MISSING | same HUD | `chat-composer-slash` | A | none |
| CO11 | @mention autocomplete | MentionTextarea.tsx | local | Y | n/a | n/a | MISSING | suggestion strip while "@" is typed (PredictiveActionChipsView slot) | popup | A | none |
| CO12 | `#thread` reference autocomplete | ThreadRefs.tsx | local | Y | n/a | n/a | MISSING (rendering DONE) | same strip on "#" | popup | A | none |
| CO13 | Queue: edit, delete queued | ComposerQueuedMessages.tsx | DELETE /api/bots/:id/queue/:q | Y | Y | Y | DONE (QueuedSendList) | | queued chips | A | none |
| CO14 | Steer a queued message | ComposerQueuedMessages.tsx, store.tsx:3252 | POST /api/bots/:id/queue/:q/steer | Y | Y | Y | MISSING | queued row long-press / swipe > Steer now | Return on a queued chip | A | none |
| CO15 | Busy-send chooser (after, steer, parallel) | BusySendChooser.tsx | POST messages {busyMode} | Y | Y | Y | MISSING | confirmationDialog on send while busy | as desktop | A | none |
| CO16 | Interrupt the turn | Composer.tsx:1268 | POST /api/bots/:id/interrupt | Y | Y | Y | DONE ("+" > Interrupt) | | stop button | A | none |
| CO17 | Failed send: Retry | Composer.tsx:904 | resend | Y | Y | Y | PARTIAL (Dismiss only) | Retry on the banner | = | A | none |
| CO18 | ↑ edits the last message | Composer.tsx:1203 | edit route | Y | Y | Y | MISSING | n/a | ↑ in an empty composer | A | none |
| CO19 | Dictation | Composer mic (bridge) | bridge | Y | n/a | n/a | DONE (SpeechDictation) | | = | A | none |
| CO20 | Approval-mode menu, Full access warning | ApprovalModeSelector.tsx, FullAccessWarning.tsx | PATCH tasks {approvalMode} | **N** (Composer.tsx:1106) | Y | Y | MISSING | none (policy: phone never changes approval mode) | hidden when paired (`chat-approval-mode` only for admin) | C | none |
| CO21 | "Where this conversation works" menu (auto routing #86) | PlaceChip.tsx, WorkplaceNotice.tsx, LocalComputerAutoWarning.tsx | PATCH tasks {surface} | **N** (Composer.tsx:1119) | Y | Y | MISSING | read-only "Works on" line in the "+" sheet | `chat-where-menu` (admin only) | C | none |
| CO22 | Model picker | ModelPicker.tsx | PATCH /api/bots/:id/model | **N** in the composer | Y | Y | DONE in the profile (AgentProfileView:510) | | `chat-model-picker` (admin only) | C | none |
| CO23 | Quick replies, predictive chips | none | local | n/a | n/a | n/a | P (PredictiveActionChipsView, QuickRepliesEditor) | | = | P | none |
| CO24 | Compact the conversation | engine `/compact` | POST /api/bots/:id/compact | Y | Y | Y | MISSING | "+" > Compact conversation | slash menu | A | none |
| CO25 | Save a run as a skill (VerifyCard) | VerifyCard.tsx | local (fills draft) | Y | n/a | n/a | MISSING | strip above the composer | = | A | none |

## 3. Chat: transcript and message actions

iPhone: `ChatView.swift` (`MessageRow` :1433, bubble `.contextMenu` :1512 with reactions,
Copy, Select Text, Edit and retry; branch switcher :1495), `SelectableTextSheet.swift`,
`ActivityRunChip.swift`, `AssistantTurnChip.swift`, `Composer/TypingIndicatorView.swift`.

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| MS1 | Copy message | MessageActions.tsx | local | Y | n/a | n/a | DONE | | `chat-message-hover` | A | none |
| MS2 | Select text | browser | local | Y | n/a | n/a | DONE (SelectableTextSheet) | | native selection | A | none |
| MS3 | Raw markdown toggle | RawMarkdownToggle.tsx | local | Y | n/a | n/a | PARTIAL (Select Text shows source, no toggle) | long-press > View source | hover row | A | none |
| MS4 | Speak a reply | SpeakButton, lib/tts | POST /api/tts/prepare, /api/tts/speak | Y | Y | Y | MISSING | long-press > Speak | hover row | A | none |
| MS5 | Regenerate last reply | ChatView:1167 | POST .../messages/:m/edit | Y | Y | Y | MISSING (HUD "retry" sends prose) | long-press on the last reply > Regenerate | hover row | A | none |
| MS6 | Edit a user message (new branch) | ChatView:410 | POST .../messages/:m/edit | Y | Y | Y | DONE (alert "Edit and retry") | | inline editor | A | none |
| MS7 | Branch switcher ‹ 2/3 › | ChatView:604 | POST /api/bots/:id/active-branch | Y | Y | Y | DONE | | = | A | none |
| MS8 | Reply quote in the bubble, tap to jump | ReplyQuote.tsx | local | Y | n/a | n/a | MISSING (no `replyToId` decoded) | quote inside the bubble | = | A | none |
| MS9 | Pin message, pinned banner | ChatView:433,577,1436 | PATCH tasks {pinnedMessageId} | **N** | Y | Y | MISSING | long-press > Pin; strip under the header (if JC lifts the RC rule, decision D2) | hover row (admin) | C | none |
| MS10 | Reactions | store only (no 1:1 UI) | POST /api/threads/:t/messages/:m/reactions | n/a | Y | Y | P (emoji row in the menu) | | keep | P | none |
| MS11 | Find in thread (⌘F) | ChatFindBar.tsx | GET /api/search?threadId= | Y | Y | Y | PARTIAL (global SearchSheet only) | "+" > Find in conversation (find bar over the header) | `chat-find` | A | none |
| MS12 | Export conversation | ExportTranscriptMenu.tsx | local | Y | n/a | n/a | DONE ("+" > Share transcript, GET /api/threads/:t/export) | | `chat-export-menu` | A | none |
| MS13 | Day separators | ChatView DaySeparator | local | Y | n/a | n/a | DONE | | = | A | none |
| MS14 | Jump to latest | ChatView jumpToLatest | local | Y | n/a | n/a | MISSING | glass arrow.down circle when scrolled up | = | A | none |
| MS15 | Load earlier | store | GET /api/threads/:t/messages?before | Y | Y | Y | DONE | | = | A | none |
| MS16 | Typing / working, live reasoning, activity runs, narration, tool chips | TurnPresence, ActivityRun, ActivitySection, TurnNarrationRun, ToolActivity | SSE | Y | Y | Y | DONE (TypingIndicatorView, AgentThoughtChamberView, ActivityRunChip, AssistantTurnChip, SkillExecutionReceiptView) | | = | A | none |
| MS17 | Bot-to-bot comm chip opens the room | ChatView ActivityChip | local | Y | n/a | n/a | PARTIAL (not tappable) | make the chip open the room | = | A | none |
| MS18 | Thread chip opens the thread | ThreadChip.tsx | local | Y | n/a | n/a | DONE | | = | A | none |
| MS19 | Collapse long user messages | ChatView:381 | local | Y | n/a | n/a | MISSING | lineLimit + Show more in the bubble | = | A | none |
| MS20 | "Sent mid-turn" marker | ChatView:496 | local | Y | n/a | n/a | MISSING | caption under the bubble | = | A | none |
| MS21 | Mention highlighting | MentionText.tsx | local | Y | n/a | n/a | MISSING | MarkdownText tints @names | = | A | none |
| MS22 | Routine execution banner (Logs, back) | ChatView:1411 | local | Y | n/a | n/a | MISSING | caption under the header | = | A | none |
| MS23 | Peer label on relayed lines | ChatView PeerLabel | local | Y | n/a | n/a | PARTIAL (rooms only) | small label above the bubble | = | A | none |
| MS24 | Inspector (Run log, Events, Raw) | InspectorPanel.tsx | GET /api/threads/:t/events | **N** | N | admin | MISSING | none (admin: "..." > Inspector sheet) | `inspector` (admin) | C | none |
| MS25 | Read receipts | none in the renderer (read state only) | POST .../read | n/a | Y | Y | N/A | | | | none |

## 4. Chat: threads (tasks) in a conversation

iPhone: `TaskManagerView.swift` (rename, pin, snooze, archive, bulk delete), `BotThreadTree.swift`,
`Core/ThreadNavigation.swift`, `Core/BotThreadSelection.swift`.

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TH1 | Thread picker: switch, new, search | TaskPicker.tsx | POST/PATCH /api/bots/:id/tasks | Y | Y | Y | DONE (TaskManagerView, "+" > New thread) | | `chat-threads` | A | none |
| TH2 | Rename thread | TaskPicker, RenameTitle.tsx | PATCH tasks {title} | Y | Y | Y | DONE (TaskManagerView; not in BotThreadTree menu) | also in BotThreadTree menu | thread row menu | A | none |
| TH3 | Regenerate thread title | Sidebar.tsx:1249, store:3725 | POST /api/bots/:id/tasks/:t/title | Y | Y | Y | MISSING | thread long-press > Regenerate title | thread row menu | A | none |
| TH4 | Pin, snooze, archive, delete (bulk) | TaskPicker, SidebarThreadRow.tsx | PATCH/DELETE tasks | Y | Y | Y | DONE | | thread row menu | A | none |
| TH5 | Move thread to a folder | SidebarThreadRow.tsx:354 | PATCH tasks {projectId} | Y | Y | Y | MISSING | thread long-press > Move to folder | drag or menu | A | none |
| TH6 | Copy thread link | SidebarThreadRow.tsx:351 | local | Y | n/a | n/a | MISSING | thread long-press > Copy link (Core/DeepLink.swift) | thread row menu | A | none |
| TH7 | Thread status (waiting, working, queued, unread, closed by) | SidebarThreadRow.tsx:261,339 | GET /api/bots | Y | Y | Y | DONE (BotThreadRow) | | = | A | none |
| TH8 | Parallel task card with Stop | ParallelTaskCard.tsx, store:3349 | POST /api/bots/:id/parallel/:t/stop | Y | **N** | Y | MISSING (not decoded) | card in the transcript, Open and Stop | = | B | S1: sidecar allow parallel stop |

## 5. Chat: cards and rich content

iPhone: `ChatView.swift` `CardView` :2302 and `CredentialRequestCardView` :1893,
`Cards/*.swift`, `MarkdownText.swift`, `Core/Markdown.swift`, `AttachmentViews.swift`,
`VoiceNoteBubble.swift`, `ClaudeUpdateCard.swift`, `WebhookMessageBody.swift`.

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| CA1 | Approval card: allow, deny | ApprovalCard.tsx, ApprovalParts.tsx | POST /api/threads/:t/respond | Y | Y | Y | DONE (CardView) | | `chat-approval` | A | none |
| CA2 | Always allow this tool | PendingApproval.tsx | POST /api/bots/:id/always-allow | Y | Y | Y | DONE | | dock | A | none |
| CA3 | Always allow for this session / this command | PendingApproval alwaysAllowSession, alwaysAllowCommand | respond, always-allow | Y | Y | Y | MISSING | extra buttons under the card | dock | A | none |
| CA4 | Allow all read-only, stepper over several pending asks | PendingApproval.tsx:441 | respond (many) | Y | Y | Y | MISSING | "Allow N read-only" and paging in the card | dock | A | none |
| CA5 | Cancel turn from the approval | PendingApproval.tsx:456 | POST interrupt | Y | Y | Y | PARTIAL ("+" > Interrupt only) | "Cancel turn" in the card | dock | A | none |
| CA6 | Skill request review (sha256) | SkillRequestPreview.tsx | respond {reviewedSha256} | Y | Y | Y | DONE | | = | A | none |
| CA7 | Question card (multi, Other) | QuestionCard.tsx | respond | Y | Y | Y | DONE (QuestionCardView) | | `chat-question` | A | none |
| CA8 | Option card: answer, dismiss | OptionCard.tsx | respond, PATCH /api/bots/:id/cards/:m | Y | Y | Y | PARTIAL (no dismiss) | card overflow > Dismiss | = | A | none |
| CA9 | Secret request: provide, already added, dismiss | SecretRequestCard.tsx | POST /api/bots/:id/secret-cards/:m/{provide,resume,dismiss} | Y | Y | Y | PARTIAL (provide only) | card buttons | = | A | none |
| CA10 | Connector card (connect an app in chat) | ConnectorCard.tsx | GET .../connector-cards/:m/status, POST authorize, resume, dismiss | Y | Y | partial (authorize admin) | MISSING (kind `connector` decodes as unknown) | card, Connect opens ASWebAuthenticationSession | = | B | S2: CLIENT_ALLOW connector-card authorize |
| CA11 | Access card (no engine or key) | AccessCard.tsx | local | Y | n/a | n/a | MISSING (kind `access` unknown) | card "Finish on your computer" | = | A | none |
| CA12 | Owner wait / settled | OwnerWait.tsx | SSE | Y | Y | Y | MISSING (`ownerName`, `state` not decoded) | inline status row | = | A | none |
| CA13 | Routine run card | RoutineRunCard.tsx | SSE | Y | Y | Y | DONE (RoutineRunCardView) | | = | A | none |
| CA14 | Goal run card (rooms) | GoalRunCard.tsx | message.goalRun | Y | Y | Y | MISSING | card in the room transcript | = | A | none |
| CA15 | Digest chip, compaction chip | DigestChip.tsx | local | Y | n/a | n/a | DONE (ReceiptChip, DigestSheet) | | = | A | none |
| CA16 | Turn access chip (which credentials paid) | DigestChip TurnAccessChip | local | Y | n/a | n/a | MISSING | line in DigestSheet | = | A | none |
| CA17 | Error row with Retry | ChatView ErrorRow | edit route | Y | Y | Y | PARTIAL (ClaudeUpdateCard only) | Retry on the error chip | = | A | none |
| CA18 | Claude update card | ClaudeUpdatePrompt.tsx | POST /api/instances/:id/claude-update | Y | Y | admin | DONE | | = | A | none |
| CA19 | Webhook message | ChatView webhookView | local | Y | n/a | n/a | DONE | | = | A | none |
| CA20 | Screen frame | ScreenFrame.tsx | GET .../messages/:m/image | Y | Y | Y | DONE | | = | A | none |
| CA21 | Code block: copy, save, wrap, highlight | ChatMarkdown CodeBlock | local | Y | n/a | n/a | PARTIAL (scroll and select only) | long-press on the block > Copy code, Share, Wrap | `chat-markdown` action row | A | none |
| CA22 | Diff rendering | ChatMarkdown | local | Y | n/a | n/a | DONE (GitPRDiffCardView) | | = | A | none |
| CA23 | Table: copy CSV / Markdown, sort | RichTable.tsx | local | Y | n/a | n/a | PARTIAL (grid only) | long-press on the table > Copy CSV, Copy Markdown | `chat-markdown` | A | none |
| CA24 | Chart block | ChartBlock.tsx | local | Y | n/a | n/a | MISSING | Swift Charts, table fallback | = | A | none |
| CA25 | Mermaid diagram | ChatMarkdown MermaidDiagram | local | Y | n/a | n/a | MISSING | source block + "Open on computer" | = | A | none |
| CA26 | Email draft card | EmailCard.tsx | local | Y | n/a | n/a | MISSING | card with Copy, Open in Mail | = | A | none |
| CA27 | Callouts, spoilers, footnotes, widget frame | ChatMarkdown | local | Y | n/a | n/a | MISSING (Markdown.swift: paragraph, list, task, heading, code, quote, table, rule) | new MarkdownText block kinds | = | A | none |
| CA28 | Inline markdown images | MarkdownImagePreview | /api/attachments/* | Y | Y | Y | MISSING | thumbnail via TranscriptAttachmentView | = | A | none |
| CA29 | Attachment tiles and file cards | AttachmentGallery.tsx | GET .../messages/:m/image, POST .../file | Y | Y | Y | DONE | | `chat-attachments` | A | none |
| CA30 | Preview: zoom, save, video, audio, PDF | AttachmentPreview.tsx | same | Y | Y | Y | DONE (QuickLook, ShareLink) | | = | A | none |
| CA31 | Conversation-wide lightbox (previous / next) | ConversationGallery.tsx | local | Y | n/a | n/a | MISSING | swipe paging in the preview | arrows | A | none |
| CA32 | Bot voice notes | VoiceNoteBubble.tsx | GET /api/attachments/*.mp3 | Y | Y | Y | DONE | | = | A | none |
| CA33 | Local file links | ChatMarkdown LocalFileLink | POST .../messages/:m/file | Y | Y | Y | DONE | | = | A | none |

## 6. Rooms (group chat)

iPhone rooms run in `ChatView.swift` (`.room`); creation `NewGroupSheet.swift`. The room header
opens Threads today (`ChatView.swift:645`), there is no room info surface. `Room` in
`Core/Models.swift:733-751` decodes `bulletin` but not `humanIds`, `routedBy` or `goalRun`.

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| RM1 | Room transcript and send | GroupView.tsx | GET /api/threads/:id/messages, POST /api/groups/:id/messages | Y | Y | Y | DONE | | `group-chat` | A | none |
| RM2 | Create room with `setup: {defaultResponder: mentions}` | ComposeToPicker | POST /api/groups | Y | Y | Y | PARTIAL (no setup sent, Client.swift:1419) | send the RC setup | `new-group` | A | none |
| RM3 | Room threads new, switch, rename, delete, pin | store.tsx:3737-3761 | /api/groups/:id/tasks* | Y | Y | Y | DONE | | = | A | none |
| RM4 | Stop the room turn | store.tsx:3766 | POST /api/groups/:id/interrupt | Y | Y | Y | MISSING (ChatView.swift:849 bots only) | "+" > Interrupt in rooms | = | A | none |
| RM5 | Queued in a room: cancel, steer | store.tsx:3270,3278 | DELETE/POST .../queue/:q[/steer] | Y | Y | Y | PARTIAL (cancel only) | queued row > Steer now | = | A | none |
| RM6 | Room info panel: details, members, avatar stack | GroupPanel.tsx | local | Y | n/a | n/a | MISSING | room header tap > Room info sheet (Threads moves to a row in it) | `group-panel` | A | none |
| RM7 | Bulletin / instructions (read) | GroupView.tsx:1107, GroupPanel.tsx:256 | room field | Y (read-only) | Y | Y | MISSING (decoded, never shown) | Room info > Instructions | `group-chat` bulletin | A | none |
| RM8 | Room memory tab | GroupMemoryTab.tsx | GET/PUT /api/groups/:id/memory | Y | **N** | Y | MISSING | Room info > Memory | `group-panel` | B | S1: sidecar allow GET/PUT (or hide in RC, decision D3) |
| RM9 | Composer responder hint, @mention suggestions, coloured mentions | Composer groupComposerHint, MentionTextarea, MentionText | local | Y | n/a | n/a | MISSING | placeholder text; strip on "@" (CO11) | = | A | none |
| RM10 | Routed-by line | GroupView.tsx:464,488 | message.routedBy | Y | Y | Y | MISSING | message long-press > Info | = | A | none |
| RM11 | Room goal `/goal` and goal card | Composer.tsx:330, GoalRunCard.tsx | POST /api/groups/:id/messages | Y | Y | Y | MISSING | "+" > Goal; CA14 | = | A | none |
| RM12 | Room call (members in their own voices) | GroupCallView.tsx | /api/tts/*, groups messages, interrupt | Y | Y | Y | MISSING (Walkie targets bots, ChatView.swift:660) | "+" > Voice mode in rooms | call pill | A | none (after VO package) |
| RM13 | Copy room conversation ID, hide room | Sidebar room menu | local, synced pref | Y | Y | Y | MISSING | room row long-press | room row menu | A | none |
| RM14 | Rename room | Sidebar.tsx:517 | PATCH /api/groups/:id {name} | N | Y | Y | MISSING | Room info > Name (owner) | `group-panel` | C | none |
| RM15 | Move room to section | Sidebar.tsx:569 | PATCH {section} | N | Y | Y | MISSING | room row long-press > Move to section | room row menu | C | none |
| RM16 | Delete room | Sidebar.tsx:602 | DELETE /api/groups/:id | N | N | Y | MISSING | Room info > Delete (server owner) | room row menu | C | none |
| RM17 | Edit bulletin, pin message in room | GroupPanel, GroupView.tsx:177,1115 | PATCH {bulletin, pinnedMessageId} | N | Y | Y | MISSING | Room info > Instructions > Edit; message long-press > Pin | as desktop | C | none |
| RM18 | Manage bot members, people, leave | ManageMembersPanel, ChannelMembers, GroupPeoplePicker | PATCH {memberIds, humanIds}, GET /api/org/directory | N (partial for people) | Y (directory N) | Y | MISSING | Room info > Bots, People, Leave | `group-panel` | C | none |
| RM19 | Default responder / turn-taking | GroupView.tsx:500-543 | PATCH {defaultResponder} | N | N (refused) | org owner | MISSING | Room info > Who answers (server owner) | `group-panel` Advanced | C | none |
| RM20 | Room setup, working folder, turn timeout | GroupView setupPending, :577 | PATCH /api/groups/:id/setup, {cwd}, PUT /api/config | N | N | admin | N/A | | | H | none |
| RM21 | Person author label, person sheet | GroupView.tsx:478, PersonPanel | GET /api/org/directory | Y (org) | N | Y | MISSING | tap author > person sheet (org server) | as desktop | C | none |
| RM22 | People DMs | store.tsx:3585 | POST /api/people-dms | Y (org) | N | Y | MISSING (dm rooms filtered, ChatListView.swift:1277) | home Messages section; "+" > Message a person | compose-to people | C | none |

## 7. Bot panel (profile)

iPhone: `Profile/BotProfileView.swift` (tabs Info, Links, Media, Files; Routines card; "..."
menu), `Profile/ProfileLibraryTabs.swift`, `Profile/RoutineDetailView.swift`,
`AgentProfileView.swift` (Advanced sheet: identity, model, voice, notifications, overview link),
`BotOverviewView.swift`, `Mascots/CharacterEditor.swift`, `ComputerView.swift`,
`ComputerInputViews.swift`, `CloudDesktopBrowser.swift`. The desktop remote client replaces
the whole tabbed panel with `RemoteAgentSettingsPanel.tsx` (avatar, name, title, description,
voice, notifications, the chat's files). The iPhone already exceeds that in several places.

### 7a. Identity, character, details

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BP1 | Name, title, description | BotSettingsDialog.tsx:478-496, RAS:112-118 | PATCH /api/bots/:id/profile | Y | Y | Y | DONE (AgentProfileView) | | `panel-details` | A | none |
| BP2 | Upload / remove picture, crop shape | BotProfileAvatarCard.tsx | POST /api/attachments, PATCH {avatarUrl, avatarCrop} | Y | Y | Y | DONE | | `panel-avatar-editor` | A | none |
| BP3 | Frame picture (zoom, focus) | AvatarFraming | PATCH {avatarZoom, avatarFocus*} | N | Y | Y | DONE (PictureFramingSheet) | | = | A (beyond RC) | none |
| BP4 | Generate a picture | AvatarImageGenerator.tsx | POST /api/bots/:id/avatar/generate | N | Y | Y | DONE | | `panel-avatar-editor` Generate | A (beyond RC) | none |
| BP5 | Character, shape, colour, reset | floating-bots/MascotLookEditor.tsx | PATCH {mascotLook, color} | N | Y | Y | DONE (CharacterEditor) | | `panel-avatar-editor` | A | none |
| BP6 | Skin with tier tabs and achievement locks | MascotLookEditor.tsx:456 | PATCH {mascotSkin} | N | Y | Y | PARTIAL (no locks or tiers) | lock badges in the skin row | = | A | none |
| BP7 | Style 2D / 3D | MascotLookEditor.tsx:460 | PATCH {mascotLook.style} | N | Y | Y | MISSING (`MascotLook.style` already modelled) | Character card > Style segmented row | = | A | none |
| BP8 | Play a move | MascotLookEditor.tsx:556 | local | N | n/a | n/a | PARTIAL (tap cycles owl moves) | long-press mascot > Moves | = | A | none |
| BP9 | Read-only notice (shared for use only), proposal status | BotSettingsDialog.tsx:470, ProposalStatus.tsx | GET /api/config | N | Y | Y | MISSING | banner on the Info tab | = | A | none |
| BP10 | Activity: what the bot is doing, history, detail, stop, steer, open thread | bot-settings/ActivitySection.tsx, ActivityListModal, ActivityDetailModal | GET /api/bots/:id/activity[/item], interrupt, messages | N | **N** | Y | MISSING | Info tab > Activity card > See all > detail | `panel-details` | B | S1: sidecar allow GET activity |
| BP11 | Routines list, create, edit, pause | RoutinesSection.tsx | /api/routines* | partial | Y | Y | DONE (Routines card, RoutineDetailView) | | `panel-routines` | A | none |
| BP12 | Delete a routine from the profile | RoutinesSection.tsx | DELETE /api/routines/:id | N | Y | Y | PARTIAL (only in TasksRoutinesView) | RoutineDetailView menu > Delete | = | A | none |
| BP13 | Package provenance | PackageProvenance.tsx | GET /api/org-library | N | N | admin | MISSING | Info tab footer line | = | C | none |
| BP14 | Per-bot usage | bot-settings/UsageSection.tsx | local (task usage) | N | n/a | n/a | MISSING (`BotTask.usage` not decoded) | Advanced > Usage | `panel-advanced-usage` | A | none |

### 7b. Library (files), computer

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BF1 | Files of the open chat | FilesSection.tsx, RAS:145 | GET /api/threads/:id/files[/:f] | Y | Y | Y | PARTIAL (bot-wide Media/Files tabs via GET /api/bots/:id/files; ClientParity.threadFiles unused) | Files tab > "This thread" filter | `panel-files` | A | none |
| BF2 | Links library | none | GET /api/bots/:id/links | n/a | Y | Y | P (LinksTab) | | keep | P | none |
| BF3 | Search, filter, sort files | FilesSection.tsx | local | Y | n/a | n/a | PARTIAL (kind split only) | `.searchable`, Sort menu | `panel-files` | A | none |
| BF4 | Copy path, show in chat | FilesSection.tsx | local | Y | n/a | n/a | MISSING | file row long-press | = | A | none |
| BC1 | Live screen preview | remote-desktop-panel.tsx, CloudScreenPreview | POST /api/bots/:id/computer/screenshot | Y | Y | admin | DONE (ComputerView) | | `panel-computer` | A | none |
| BC2 | Open the live desktop, take / give back control | remote-desktop-panel.tsx, DesktopViewer | POST computer/{control,join,viewer-close} | Y | Y | admin | DONE (CloudDesktopBrowser, ComputerView menu) | | = | A | none |
| BC3 | Native input, clipboard | none | POST computer/input, GET/PUT computer/clipboard | n/a | Y | admin | P (ComputerInputViews) | | keep | P | none |
| BC4 | Computer status and phase | ComputerPanel.tsx:356 | GET /api/bots/:id/computer | N | N | admin | PARTIAL ("no computer", "Offline") | empty state with the phase | = | C | S1 optional: sidecar allow GET (read-only) |
| BC5 | Where the bot works, VM create/remove, VPS start/sleep, this Mac preview, Android, browser panel | ComputerPanel, WorksOnSetting, LocalScreenPreview, AndroidDevicePanel, BrowserPanel | various | N | N | admin | N/A | | | H | none |
| BC6 | Org server environment: power, stats, sandbox desktop | computer/OrgComputerTab.tsx, SandboxDesktopView | GET/POST /api/me/server-environment*, /api/desktop-viewer/sandbox/me | N | partial | org | PARTIAL (Settings: GET and reset) | ComputerView card for an org bot, "..." > Start / Stop | = | C | none |

### 7c. Advanced sections (hidden in remote-client mode)

All of these are **N** in RC. On a sidecar pairing they stay hidden unless JC lifts the rule
(decision D1). On an admin-scope server pairing they ship behind `canAdminister`.

| ID | Feature | Desktop | Routes | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|
| BA1 | Overview (Does, Can reach, App tools, Won't, Recent changes) | OverviewSection.tsx | GET /api/bots/:id/overview | Y | admin | DONE but **not gated** (AgentProfileView.swift:253 fails for a client session) | gate on canAdminister for server pairings | `panel-advanced-overview` | C | none |
| BA2 | Prompt preview | PromptPreview.tsx | GET /api/bots/:id/system-prompt | N | admin | MISSING | BotOverviewView > Prompt preview | = | C | S1 if D1 |
| BA3 | Soul / instructions view and edit | SoulSection.tsx | GET /soul, PATCH {soul} | Y | owner | DONE (InstructionView) | | `panel-advanced-soul` | A (beyond RC) | none |
| BA4 | Skills: list, review, enable, remove, import, org library | SkillsSection.tsx, OrgSkillsCard.tsx | /api/bots/:id/skills*, /api/org-library/skills | N | admin | MISSING | Advanced > Skills list (toggle, swipe delete, "+" import admin) | `panel-advanced-skills` | C | S1 if D1 |
| BA5 | Memory: on/off, MEMORY.md and topics, daily logs, journal and revert, upkeep | MemorySection.tsx, lib/memory.ts | /api/bots/:id/memory*, PATCH {memoryEnabled, memoryUpkeep} | N | admin | MISSING | Advanced > Memory > list > editor (InstructionView pattern) | `panel-advanced-memory` | C | S1 if D1 |
| BA6 | Access: folder, browser, connected apps and tool grants, MCP servers, always-allowed list, webhooks, VPS auto start | AccessSection.tsx | PATCH bot fields, GET /api/connectors/tools, /api/mcp/servers, /api/webhooks | N (fields refused) | admin | PARTIAL (read-only App tools in BotOverviewView) | Advanced > Access, read-only lists (admin: toggles) | `panel-advanced-access` | C | none |
| BA7 | Model and effort, reasoning variants | ModelSection.tsx | PATCH /api/bots/:id/model | Y | admin | PARTIAL (no variants) | Model > Variant picker | `panel-advanced-model` | C | none |
| BA8 | Approval level, peer-contact approval, managed teams | PermissionsSection.tsx, ManagedTeamsSettings.tsx | PATCH {approvalMode, approvePeerComms, managedSections} | N | admin | MISSING | none by policy (admin only if D1) | `panel-advanced-permissions` | C | none |
| BA9 | Command allowlist: view, remove, add | CommandAllowlistDialog.tsx | GET/DELETE/POST /api/bots/:id/command-allowlist | Y (GET, DELETE) | admin | PARTIAL (`commandAllowlist()` in ClientParity, no UI) | Advanced > Allowed commands (swipe delete) | as desktop | C | S2 optional: owner GET/DELETE in CLIENT_ALLOW |
| BA10 | Voice per bot, speak replies, preview | VoiceSection.tsx, VoiceSettings.tsx | GET /api/tts/voices, PATCH /profile, POST /api/tts/speak | Y | Y | DONE | | `panel-advanced-voice` | A | none |
| BA11 | Voice notes allowed | VoiceSettings.tsx:483 | PATCH /profile {voiceNotes} | Y | Y | MISSING | Advanced > Voice toggle | = | A | verify profile PATCH field |
| BA12 | Voice engine switch | VoiceSettings.tsx:270 | PUT /api/config | N | admin | DONE but **not gated** (AgentProfileView.swift:268 always fails on a sidecar) | hide unless server admin | = | C | none |
| BA13 | Notifications per bot | VoiceSection.tsx, RAS:125 | PATCH /profile {notifications} | Y | Y | DONE | | = | A | none |
| BA14 | Visibility | VisibilitySection.tsx | PATCH {visibility} | N | admin | MISSING | Advanced (admin server) | `panel-advanced-visibility` | C | none |
| BA15 | Sharing grants | SharingSection.tsx, GrantEditor.tsx | GET/PUT/DELETE /api/bots/:id/grants | N | org | MISSING | Advanced > Shared with | `panel-advanced-sharing` | C | none |
| BA16 | Perspicax MCP profiles | PerspicaxSection.tsx | GET/PUT /api/bots/:id/perspicax | N | org | MISSING | Advanced > Perspicax toggles | `panel-advanced-perspicax` | C | none |
| BA17 | Slack link | SlackSection.tsx | GET /api/bots/:id/slack-management | N | org | MISSING | Advanced > Slack (opens Safari) | `panel-advanced-slack` | C | none |
| BA18 | History of changes, restore instructions | HistorySection.tsx | GET /api/bots/:id/history, POST history/rollback | N | admin | PARTIAL (Recent changes in BotOverviewView) | Overview > See all, swipe > Restore | `panel-advanced-history` | C | S1 if D1 |
| BA19 | Duplicate bot | store.tsx:3495 | POST /api/bots + PATCH | N (PATCH refused) | admin | MISSING | Profile "..." > Duplicate (member fields only) | bot menu | C | none |
| BA20 | Share as template / export | ShareTeamDialog, SharePresetDialog | POST /api/bots/:id/export | Y | Y | P (Share as Template) | | | P | none |

## 8. New bot, templates

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| NB1 | Quick create, name and look | CompanionNewBotDialog | POST /api/bots | Y | Y | Y | DONE (CreateBotSheet + CharacterEditor) | | `new-bot` (RC: one Create) | A | none |
| NB2 | Starting role (preset) | NewBotDialog.tsx:240, lib/bot-presets.ts | GET /api/bot-presets, POST /api/bots {preset} | N | GET **N**, POST Y | admin | MISSING | CreateBotSheet > Starting role row | `new-bot` | C | S1 if D1: sidecar allow GET /api/bot-presets |
| NB3 | Team at creation | NewBotDialog.tsx:168 | POST {section} | partial | Y | admin | MISSING | section header long-press > New bot here | `new-bot` | A | none |
| NB4 | Title, description, instructions at creation | IdentitySection, SoulSection | POST /api/bots | N | Y | Y | MISSING | optional rows in CreateBotSheet | `new-bot` | A | none |
| NB5 | Skills, memory, routines, access, model, permissions, voice, visibility at creation; defaults editor; picture defaults | NewBotDialog SECTIONS, lib/create-configured-bot.ts | /api/bot-defaults*, PATCH | N | partial | admin | MISSING | set on the profile afterwards | `new-bot` (admin) | C | none |
| NB6 | Read-only person sees a notice | BotsReadOnlyDialog | GET /api/config | Y | Y | Y | PARTIAL (create fails with an error) | notice instead of the sheet | = | A | none |
| NB7 | Templates library, project scout, org library, share team, org import | TeamLibraryPanel.tsx, OrgImportDialog | /api/team-library/*, /api/teams/*, /api/org-library* | N | N | admin | N/A on sidecar | long-press "+" > Templates (admin server, later) | `templates` (admin) | C/H | none |

## 9. Automations (routines, calendar, webhooks)

iPhone: `TasksRoutinesView.swift` (Settings > Advanced > Threads & Routines: list, recent runs,
`RoutineEditorView`), `Profile/RoutineDetailView.swift`, `Core/RoutineRunCard.swift`.

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AU1 | Automations page: Schedule / Logs | RoutineCalendarPage.tsx:1783 | GET /api/routines | partial (no Webhooks) | Y | Y | PARTIAL (one list + recent runs, buried in Settings > Advanced) | home "+" long-press > Automations, segmented Schedule / Logs | `routines-list`, `routines-logs` | A | none |
| AU2 | Week / 3-day / day calendar, mini month, bots to drag | RoutineCalendarPage.tsx:1243, routines/CalendarSidebar.tsx | GET /api/routines | Y | Y | Y | MISSING | Calendar toggle: day agenda + graphical DatePicker | `routines-calendar` | A | none |
| AU3 | Create from the grid (drag bot, click-drag slot) | CalendarGrid | POST /api/routines | Y | Y | Y | MISSING | tap an empty agenda hour > editor prefilled | drag | A | none |
| AU4 | Move, resize an event | :1744-1764 | PATCH /api/routines/:id {schedule, durationMinutes} | Y | Y | Y | MISSING | row swipe > Reschedule; editor Duration | drag | A | none |
| AU5 | List (incl. paused, finished), detail | RoutineList.tsx, :1372-1560 | GET /api/routines | Y | Y | Y | DONE (RoutineRow, RoutineDetailView) | | = | A | none |
| AU6 | Bot filter, problems badge | :1630, :1842 | local | Y | n/a | n/a | MISSING | toolbar Menu > Filter by bot | = | A | none |
| AU7 | Run now, pause/resume, delete | :1534-1543 | POST .../run, PATCH {enabled}, DELETE | Y | Y | Y | DONE | | = | A | none |
| AU8 | Cancel a running run | store.tsx:3235 | POST /api/routine-runs/:id/cancel | Y | Y | Y | MISSING | run row / run card long-press > Cancel run | = | A | none |
| AU9 | Mark seen, mark all read, unseen-failure badge | :1790-1870 | POST /api/routine-runs/:id/seen, /seen-all | Y | Y | Y | MISSING | auto-seen on open; "..." > Mark all read; badge on the row | = | A | none |
| AU10 | Run logs: status filter, search | routines/RoutineLogs.tsx | GET /api/routines | Y | Y | Y | PARTIAL | Logs segment + Menu + `.searchable` | `routines-logs` | A | none |
| AU11 | Editor: name, prompt, bot, once / selected days / interval, run location, timeout | EventEditor :548 | POST/PATCH /api/routines | Y | Y | Y | DONE (RoutineEditorView) | | = | A | none |
| AU12 | Editor: weekly / monthly / yearly / custom cron | CronScheduleFields.tsx | same | Y | Y | Y | PARTIAL (cron shown raw, Models.swift:1197) | Repeats picker adds them; Custom cron field | = | A | none |
| AU13 | Editor: interval days, run-between window, end date | :418-445 | same | Y | Y | Y | MISSING; **risk**: iOS resends `schedule` without them | Editor > Advanced | = | A | S3: check PATCH merge (data loss) |
| AU14 | Editor: overlap skip / queue, attachments, results thread, team goal | :872, :318, ResultsDestination.tsx, :484-500 | same | Y | Y | Y | MISSING (not sent) | Editor > Advanced rows | = | A | none |
| AU15 | Open run thread, results thread, room goal | :1532-1537 | local | Y | n/a | n/a | PARTIAL (run thread only) | RoutineDetailView > Results thread | = | A | none |
| AU16 | Scheduled calls (calendar calls) | :567, :1465 | /api/calendar-calls* | N | N | admin | MISSING | admin server only, later | `routines-calendar` (admin) | C | none |
| AU17 | Webhooks: list, create, rotate, deliveries, test | WebhooksPanel.tsx | /api/webhooks* | N | N (explained) | GET Y, writes admin | PARTIAL ("Computer only" note) | none | hidden | H | none |
| AU18 | Keep the computer awake for routines | RoutineWakeBar | bridge | N | n/a | n/a | N/A | | | H | none |
| AU19 | Org routine delegation (act in my name) | settings/MyRoutineDelegation.tsx | /api/org/routine-delegation | Y (org) | N | org | MISSING | Settings > Organization > Routines act as me | settings | C | none |

## 10. Plugins, MCP, connectors

iPhone: `PluginsView.swift` (search, install, sign-in), `ConnectedAppsView.swift` (gated on
`canAdminister`, `SettingsView.swift:565`), `PluginIconTile.swift`, `Core/ClientSettings.swift`.

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| PL1 | Connected apps marketplace | PluginsPanel.tsx:402 | GET /api/connectors/catalog | Y | Y | admin | PARTIAL (hidden on sidecar pairings by the `canAdminister` gate; no pagination) | ungate for sidecar pairings | `plugins-apps` | A | none |
| PL2 | Marketplace / Connected toggle | PluginsPanel.tsx:645 | GET /api/connectors/connected | Y | Y | admin | MISSING | segmented All / Connected | `plugins-apps` | A | none |
| PL3 | Search apps, connect (OAuth, alias), add account, refresh | PluginsPanel.tsx | POST /api/connectors/:slug/authorize | Y | Y | admin | DONE | | = | A | none |
| PL4 | Disconnect an account | PluginsPanel.tsx:551 | DELETE /api/connectors/:slug/accounts/:id | Y | Y | admin | MISSING | account row swipe > Disconnect | = | A | none |
| PL5 | Workspace Composio key | ConnectedAppsSetup.tsx | PUT /api/config | N | N | admin | DONE as a notice | | | H | none |
| PL6 | Per-bot "allow apps" prompt | PluginsPanel.tsx:692 | PATCH /api/bots/:id | Y | Y (owner) | Y | MISSING | profile > Connected apps row | = | A | none |
| PL7 | Claude.ai harness connectors (read) | HarnessConnectorsSection.tsx | GET /api/me/harness-connectors | Y | **N** | Y | MISSING | Plugins > From Claude.ai | = | B | S1: sidecar allow GET |
| PL8 | MCP servers list, status | McpServersPanel.tsx:239 | GET /api/mcp/servers | Y | Y | admin | MISSING (`mcpServers()` in ClientParity, no UI) | Plugins > MCP servers, read-only rows | `plugins-mcp` | A | none |
| PL9 | MCP sign-in and status | McpServersPanel.tsx:300,341 | POST .../oauth/start, GET .../oauth/status | Y | Y | admin | PARTIAL (after install only, no status) | MCP row > Sign in | = | A | none |
| PL10 | MCP add, edit, toggle, test, import, delete, sign out | McpServersPanel.tsx | POST/PATCH/DELETE /api/mcp/servers*, oauth/disconnect | Y drawn, refused | N | admin | MISSING (intentional) | admin server only | hidden on sidecar | C | none |
| PL11 | Plugin search and install (registry) | none in src/ | GET /api/plugins/search, /installed, POST /install | n/a | Y | install admin | P (PluginsView) | | keep | P | S2 optional: install for owners |
| PL12 | Browser profiles | BrowserProfilesManager.tsx | PUT /api/config | N | N | admin | N/A | | | H | none |

## 11. Settings

Desktop: `SettingsModal.tsx` sections (`:82-98`); remote client keeps only Pair devices,
Appearance and Organization (`:953`). iPhone: `SettingsView.swift`, `SettingsPages.swift`,
`AppearanceSettingsView.swift`, `PairingView.swift`, `PulsatrixSignIn.swift`.

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ST1 | Skin, font, same as my computer | SkinPicker.tsx, FontRow | local + /api/me/appearance or /preferences | Y | Y | Y | DONE (AppearanceSettingsView, ThemeStore) | | `settings-appearance` | A | none |
| ST2 | App icon | settings/AppIconPicker.tsx | bridge | Y | n/a | n/a | MISSING | Appearance > App Icon (`setAlternateIconName`) | = | A | none |
| ST3 | Notification sounds | NotificationSoundsRow | local | Y | n/a | n/a | PARTIAL (always default sound) | Settings > Haptics > Sounds | = | A | none |
| ST4 | Run card, tool calls display | SettingsModal :635, :689 | local, PUT /api/config | Y / N | | | PARTIAL (Activity detail picker is local) | Advanced > Chat > Run card | = | A | none |
| ST5 | Language | LanguageRow | local | N | n/a | n/a | DONE (LanguageSettingsView) | | = | A | none |
| ST6 | Pair devices | ServerPairingCard, CompanionSection | /api/auth/sessions, /pairing | Y (sidecar refuses) | N | admin | DONE equivalent (PairingView, ConnectedComputersView) | | `settings-companion` (own pairing) | A | none |
| ST7 | Organization: remote-computer card, sign-in | OrganizationSettings.tsx:222 | bridge | Y | n/a | n/a | DONE equivalent (ConnectionSecurityView, PulsatrixSignIn) | | `settings-organization` | A | none |
| ST8 | Organization (Perspicax server): approvals, people, sharing, full-access policy, directory | PerspicaxOrgSettings.tsx, OrgDirectory | /api/org/* | Y on org | N | org | MISSING | Settings > Organization page (org pairings) | `settings-organization` (org) | C | none |
| ST9 | Achievements / trophies (#106), gamertag, toasts, unlocks | achievements/* | GET /api/me/achievements, POST events, PUT settings | N | **N** | Y | MISSING (ThemeStore knows only the retro unlock) | Settings > Achievements (server pairings); top banner toasts | as desktop (server) | C | S1 if D1 for sidecar |
| ST10 | Usage history (by bot, CSV) | UsageSection.tsx | GET /api/usage | N | Y | admin | PARTIAL (month % only) | Usage page: by bot | `settings-usage` (admin) | C | none |
| ST11 | Settings search | SettingsModal query | local | Y | n/a | n/a | MISSING | `.searchable` on the Settings root | nav search | A | none |
| ST12 | About (version, build, host version) | AboutDialog | local | Y | n/a | n/a | PARTIAL (feedback footer) | Settings > About | `sidebar-profile-menu` | A | none |
| ST13 | Profile name, email, photo, About me | SettingsModal :167 | PUT /api/config | N | N | admin | PARTIAL (read-only card) | admin: edit on the Account page | `settings-general` | C | none |
| ST14 | General: new-bot effort and defaults, room turn timeout, thread concurrency, automatic recovery, thread cleanup, experimental | various *Settings.tsx | PUT /api/config | N | N | admin | MISSING | admin server only, later | `settings-general`, `settings-experimental` | C | none |
| ST15 | API keys, decision model, engines setup | ApiKeys.tsx, DecisionModelSettings, EnginesSettings | PUT /api/config, /api/instances* | N | N | admin | N/A (MyEngines on an org server: MISSING) | org: Settings > My engines | `settings-connections`, `settings-engines` | H (C for org MyEngines) | none |
| ST16 | Local VM, backups, mail, people, activity, workspaces, custom domain, cloud account | LocalComputerSection, *Backup*, MailSettings, PeopleSection, ActivitySection, WorkspacesSection | host or admin routes | N | N | admin | N/A (BotComputerSettingsView covers `/api/computer/*`) | | `settings-computer`, etc. (admin) | H | none |
| ST17 | Updates, prerelease, diagnostics, replay tour | SettingsModal :273-885 | bridge | N | n/a | n/a | N/A (App Store), Send Feedback exists | | | H | none |

## 12. Voice

The desktop voice mode (live call, call pill) is being ported on **`feat/ios-live-call`**
(worktree `sagax-ios-call`, not merged: "live call like the desktop's voice mode, replacing
Walkie", plus "companion: let a paired phone reach the live call's voice routes"). On this
branch the sidecar still has no `/api/bots/:id/voice/*` route. Rows below give the state on
this branch.

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| VO1 | Call button with availability | CallView.tsx:58-230, voice-mode/VoiceModeCallButton.tsx | GET /api/bots/:id/voice/status | partial | N here (Y on feat/ios-live-call) | Y | MISSING here | profile header Call; "+" > Voice mode | header call button | B | merge feat/ios-live-call |
| VO2 | Live call (streaming STT / TTS), call pill, mute, interrupt, transcript | voice-mode/LiveCall.tsx, VoiceModeBar.tsx | /voice/{listen,stream,transcribe,call,prepare,speak} | as VO1 | N here | Y | PARTIAL (Walkie: hold to talk, spoken reply) | full-screen call sheet + Live Activity | call pill | B | same |
| VO3 | Native half-duplex call with spoken approvals | CallView.tsx:323 | /api/tts/* | Y | Y | Y | PARTIAL (no spoken approvals, no narration) | Walkie: speak approvals, yes / no | = | A | none |
| VO4 | Push-to-talk, hang up | VoiceModeBar.tsx:312, CallView.tsx:670 | local | Y | n/a | n/a | DONE (Walkie) | | = | A | none |
| VO5 | Voice settings: input mode, pause, only my voice, isolation, earcons, speed, language | VoiceModeSettingsPanel.tsx | local, /voice/voices | as VO1 | N here | Y | PARTIAL (voice picker, sample) | Walkie voice sheet sections | = | B | same |
| VO6 | Group call | GroupCallView.tsx | /api/tts/*, POST .../voice/call | Y | Y (tts) | Y | MISSING | see RM12 | = | A | none |
| VO7 | Voice output on the device | lib/local-voice.ts | local | Y | n/a | n/a | DONE equivalent (ElevenLabs.swift, system voices) | | = | A | none |
| VO8 | Phone-side ElevenLabs key | none | direct | n/a | n/a | n/a | P (WalkieVoiceSettings) | | keep | P | none |

## 13. Team map, shortcuts, notices, misc

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TM1 | Team map (read-only canvas) | TeamMapPage.tsx:285 | GET /api/team-map | Y (canManage false) | Y | Y | MISSING | home "+" long-press > Team map (team list with mascots, pinch canvas later) | `team-map` | A | none |
| TM2 | Move a bot within its own team | TeamMapPage.tsx:303 | POST /api/sidebar-sections | Y | Y | admin | MISSING | team map row long-press > Move | drag | A | none |
| TM3 | Team menu, instructions, rename, delete, team computers | TeamMapPage.tsx:131-398, CanvasComputers | /api/section-context, sidebar-sections | N | N | admin | N/A on sidecar | admin later | admin | C | none |
| KB1 | Keyboard shortcuts (⌘K, ⌘N, ⌘1-9, ⌘⇧[ ], ⌘F, ↑ edit, Esc, ⌘Return, ⌥↑↓, ⌘,) | lib/keyboard-shortcuts.ts | local | Y | n/a | n/a | MISSING (no `.keyboardShortcut` in ios/App) | hardware keyboard on iPhone too (same commands) | `.keyboardShortcut` / UIKeyCommand, ⌘ overlay | A | none |
| KB2 | Shortcuts sheet (? or ⌘/) | KeyboardShortcutsModal.tsx | local | Y | n/a | n/a | MISSING | n/a | `keyboard-shortcuts` | A | none |
| DD1 | Drag and drop (sections, folders, calendar, team map, files) | Sidebar, RoutineCalendarPage, TeamMapPage | as features | Y | | | MISSING | menus replace drags on iPhone (SB8, SB20, AU4, TM2) | `.draggable` / `.dropDestination` | A | none |
| CM1 | Context menus (bot, thread, room, section, folder rows) | Sidebar, SidebarThreadRow | as features | partial | | | PARTIAL (chat row, thread manager) | items per rows above | `sidebar-bot-context-menu` | A | none |
| NT1 | Unread badge on the app icon | App.tsx:186 bridge setUnreadCount | local | Y | n/a | n/a | DONE (Session.swift:965,1008,2507 `setBadge(state.unreadCount)`) | | = | A | none |
| NT2 | OS notifications (needs you, finished) | desktop notifications | /api/events | Y | Y | Y | DONE (Notifications.swift, while connected) | | = | A | none |
| NT3 | In-app notice banner ("thread no longer here") | notice banner | local | Y | n/a | n/a | PARTIAL (error banners) | keep phone banner | `notice-thread-gone` | A | none |
| NT4 | Update banner, licence expiry, engine update notice | UpdateBanner, LicenseExpiryBanner, EngineUpdateNotice | bridge, /api/config | N | | | N/A | | | H | none |
| OB1 | Welcome flow, guided tour | onboarding/* | /api/config | N | | | DONE native (PairingView, SagaxWelcomeView, OrgSignInView) | | own onboarding | A | none |
| FM1 | Floating mascots, Hibou 98 assistant | FloatingBotsHost, floating-bots/* | local | Y | | | N/A (Island, LiveActivities) | | hidden (spec exception) | H | none |

## Counts

Rows per state, iPhone (a row may cover several closely related controls):

| State | Rows |
|---|---|
| DONE (incl. "DONE equivalent" and "DONE but not gated") | 77 |
| PARTIAL | 50 |
| MISSING | 116 |
| P (phone-only extras) | 8 |
| N/A on iOS (host only or not applicable) | 15 |
| **Total rows** | **266** |

By tier, for the 166 PARTIAL or MISSING rows: **A 115** (RC shows it, routes already open:
pure iOS work), **B 10** (needs a sidecar or client-session route first), **C 40** (hidden in
RC: admin or organization pairings, or a policy decision), **H 1** (webhooks note, stays).

iPad: every row is today in the iPhone state (phone UI). The desktop look for the iPad is the
separate shell work of the 2026-10-02 spec; this document adds the feature work both share.

## Top 10 iPhone gaps (by daily value for JC)

1. **Message actions**: Reply (with quote), Regenerate, Speak, View source (CO2, MS8, MS5,
   MS4, MS3). All routes open.
2. **Steer and busy-send**: steer a queued message, the after / steer / parallel chooser, room
   interrupt (CO14, CO15, RM4, RM5).
3. **Approval dock completeness**: always allow for the session or command, allow all
   read-only, stepper, cancel turn from the card (CA3, CA4, CA5).
4. **Real slash commands and compact**: engine commands from `harness-commands`, `/learn`,
   `/setup`, Compact (CO9, CO10, CO24); today the HUD sends prose.
5. **Threads and folders**: regenerate title, move to folder, copy link, folder create /
   rename / reorder, mark unread (TH3, TH5, TH6, SB19, SB20, SB14).
6. **Routine runs and editor safety**: cancel run, mark seen / all read, and the editor fields
   that today can be wiped on save (AU8, AU9, AU13, AU14).
7. **Bot activity**: what the bot is doing, history, detail, stop and steer from the profile
   (BP10).
8. **Connected apps and MCP for sidecar pairings**: ungate Connected apps, disconnect, MCP
   servers list and sign-in (PL1, PL2, PL4, PL8, PL9).
9. **Find in conversation and jump to latest** (MS11, MS14), plus @mention suggestions (CO11).
10. **Interactive cards that decode as unknown**: connector, access, parallel task, owner wait,
    goal run (CA10, CA11, TH8, CA12, CA14).

## Bugs found while inventorying (fix in WP0b)

- `AgentProfileView.swift:268`: the voice engine picker calls `PUT /api/config`, which the
  sidecar always refuses and a client session may not use (BA12). Hide it unless the pairing is
  a server admin.
- `AgentProfileView.swift:253`: the "What this bot does" link reaches `GET /overview`, admin
  only for a client session (BA1). Gate it.
- `BotProfileView.swift:536`: "Copy ID" copies the bot id, the desktop copies the conversation
  (thread) id (SB23).
- `TasksRoutinesView.swift` editor: resends `schedule` without the interval window or end date
  and never sends overlap, attachments, results thread or target (AU13, AU14). Check the
  server's PATCH merge (S3) before anyone edits a desktop routine from the phone.
- `NewGroupSheet` / `Client.swift:1419`: rooms created without `setup: {defaultResponder:
  mentions}`, unlike the remote client (RM2).
- `ConnectedAppsView` is gated on `canAdminister` although the sidecar allows connectors and
  the remote client shows them (PL1); `CreateBotSheet` likewise although `CLIENT_ALLOW` permits
  `POST /api/bots` (SB31).
- The remote client draws the room Memory tab, but the sidecar has no `/api/groups/:id/memory`
  route (RM8): a renderer bug on the desktop side too.

## Decisions for JC

- **D1. Advanced bot panel on a sidecar pairing.** RC hides skills, memory, history, prompt
  preview, presets, achievements (BA2, BA4, BA5, BA18, NB2, ST9). Parity "with the features"
  means opening read routes (and some writes) on the sidecar. Proposed: open the reads (skills
  list, memory read, history, system prompt, bot presets, achievements) and memory file edits
  for the owner; keep approval mode, folder, computer, MCP and access writes refused.
- **D2. Message pin** (MS9, RM17): route open on both gates, hidden by RC. Proposed: allow
  (owner only), and also unhide on the desktop remote client.
- **D3. Room memory** (RM8): open the sidecar route (proposed) or hide the tab in RC.
- **D4. Beyond-RC features the iPhone already has** (bot pin, delete bot, framing, generate
  picture, export bot): keep (proposed); the spec rule would remove them.


**JC's answers (2026-10-03):** D1 yes: open the advanced panel on the sidecar for the owner (reads and edits, tested routes). D2 yes: message pin on iPhone and iPad. D3 open the room memory route (GET/PUT) on the sidecar. D4 keep the iPhone extras (pin bot, delete bot, framing), owner or admin only.

## Build plan

### Principles

- **One feature module, two presentations.** Each package puts its state and actions in
  `ios/Sources/CompanionCore/` (models, `Client+<Area>.swift`, pure logic with unit tests in
  `ios/Tests`) and its views in a new `ios/App/Features/<Area>/` folder. Views take a
  `presentation: .phone | .desktop` (or are split into a small core view plus two thin
  wrappers). The phone wrapper mounts into the existing doors (menu, "+" sheet, profile,
  Settings). The desktop wrapper is mounted by the iPad shell packages (I1-I8) at the
  desktop surface ids in the iPad column. Feature packages ship the phone wrapper; the
  desktop wrapper is a stub until the matching iPad shell package lands.
- **No package edits another package's files.** Today `ChatView.swift` (2627 lines) and
  `Session.swift` (2585 lines) would make every chat package collide, so WP0b first extracts
  seams: `Features/Chat/MessageMenu.swift` (bubble menu items), `Features/Chat/PlusActions.swift`
  (the "+" sheet's action list as a registry), `Features/Chat/ChatHeaderMenu.swift`,
  `Features/Chat/ComposerAccessories.swift` (strips above the composer: reply quote, find bar,
  suggestion strip). Session gains extensions in their own files (`Session+Threads.swift`,
  `Session+Routines.swift`, ...), one per package.
- **Gates in one place.** WP0a adds `Core/SurfaceGate.swift`: `allowed(_ feature)` from the
  pairing kind (sidecar, server client, server admin, org), the RC rule and JC's decisions D1-D4.
  Every new row goes through it; nothing is drawn disabled.
- **Tests:** CompanionCore logic and decoding get unit tests (`swift test` on the package, no
  simulator). UI rows get phone parity screens only when they change a captured surface (they
  should not: new items live behind menus and sheets).
- Size: each package is about half a day for one agent.

### Packages, in order of value

| # | Package | Rows | Main files (owned) | Depends on | Server |
|---|---|---|---|---|---|
| WP0a | Core models and gates: decode `replyToId`, `pinnedMessageId`, `steered`, `ownerName`/`state`, `parallelTask`, `connector`, `access`, `goalRun`, `routedBy`, `BotTask.usage`, `Room.humanIds`; `Client.send` options (`replyToId`, `busyMode`); `SurfaceGate` | foundations | Core/Models.swift, Core/Chat.swift, Core/Client.swift (send), new Core/SurfaceGate.swift | none | none |
| WP0b | ChatView seams and the gate bugs above (the routine editor goes to WP8 + S3, the room Memory tab to S1) | foundations, BA1, BA12, SB23, RM2, PL1, SB31 | ChatView.swift (extraction only), new Features/Chat/*, AgentProfileView.swift, BotProfileView.swift:536, Client.swift (groups) | none (parallel with WP0a) | none |
| S1 | Sidecar routes batch with tests: GET harness-commands, POST parallel/:t/stop, GET bots/:id/activity[/item], GET/PUT groups/:id/memory, POST bots/:id/primary, GET /api/me/harness-connectors; plus D1 reads if approved | CO9, TH8, BP10, RM8, SB28, PL7 | companion/src/routes.ts, companion/test/routes.test.ts, proxy.test.ts | none (parallel with all) | yes |
| S2 | Client-session routes: connector-card authorize; owner GET/DELETE command allowlist; plugin install for owners (if wanted) | CA10, BA9, PL11 | server/request-auth.ts and tests | none | yes |
| S3 | Routine PATCH merge check (keep window, endsAt, overlap, attachments, results, target when absent) and a test | AU13 | server/routes (routines), tests | none | yes |
| WP1 | Message actions: Reply (send + quote strip + quote in bubble), Regenerate, Speak, View source, collapse long messages, steered marker, routed-by info, mention tint | CO2, MS3-MS5, MS8, MS19-MS21, RM10 | Features/Chat/MessageMenu.swift, Features/Chat/ReplyQuote.swift, MarkdownText.swift (tint) | WP0a, WP0b | none |
| WP2 | Approval dock and interactive cards: session / command always-allow, allow read-only N, stepper, cancel turn, option dismiss, secret resume / dismiss, connector card, access card, owner wait, parallel task card, error Retry | CA3-CA5, CA8-CA12, CA17, TH8 | Cards/* (new ApprovalDock, ConnectorCardView, AccessCardView, ParallelTaskCardView), CardView extracted from ChatView in WP0b | WP0a, WP0b; S1 (parallel stop), S2 (authorize) for the last steps | via S1/S2 |
| WP3 | Composer power: steer queued, busy-send chooser, failed-send Retry, paste image and paste chip, @ and # suggestion strip, real slash commands (`/learn`, `/setup`, engine list), Compact, room interrupt and steer | CO5, CO9-CO12, CO14, CO15, CO17, CO24, RM4, RM5, RM9 | Composer/*, Features/Chat/PlusActions.swift, Features/Chat/ComposerAccessories.swift, QueuedSendList (moved) | WP0a, WP0b; S1 for CO9 | via S1 |
| WP4 | Find in conversation and jump to latest; citation quote; lightbox paging | MS11, MS14, CO8, CA31 | Features/Chat/FindBar.swift, SelectableTextSheet.swift, AttachmentViews.swift | WP0b | none |
| WP5 | Threads and folders: thread menu shared by BotThreadTree and TaskManagerView (regenerate title, move to folder, copy link, rename), folder CRUD and reorder, mark unread, copy conversation id | TH2, TH3, TH5, TH6, SB14, SB19, SB20, SB23 | new Features/Threads/ThreadMenu.swift, TaskManagerView.swift, BotThreadTree.swift, Session+Threads.swift | WP0a | none |
| WP6 | Synced sidebar preferences: personal sections (#101), collapse, order, hidden items and Hidden list, show threads switch; section admin menu | SB2, SB4, SB7, SB8, SB10, SB25 | ChatListView.swift (section header, row menu), HomeRoster.swift, CompactRoster.swift, new Core/SidebarPrefs.swift | WP0a | none |
| WP7 | Bot panel details: Activity card, list, detail (stop, steer, open); routine delete on profile; thread files filter, search, sort, copy path, show in chat; Style 2D/3D, skin locks, moves; read-only notice; per-bot usage; voice notes toggle; make primary | BP6-BP10, BP12, BP14, BF1, BF3, BF4, BA11, SB28 | Profile/*, Features/BotActivity/*, Mascots/CharacterEditor.swift | WP0a; S1 (activity, primary) | via S1 |
| WP8 | Routine runs and editor: cancel run, seen, seen-all, badge, filter; editor Advanced (window, end, overlap, attachments, results thread, team goal, weekly / monthly / yearly / custom cron, duration); results thread link | AU6, AU8-AU10, AU12-AU15 | TasksRoutinesView.swift, Profile/RoutineDetailView.swift, Core/Models.swift (RoutineSchedule; coordinate with WP0a by landing after it) | WP0a; S3 before shipping editor saves | via S3 |
| WP9 | Plugins: Connected apps on sidecar pairings, All / Connected, disconnect, per-bot allow apps; MCP servers read-only list, sign-in and status; Claude.ai connectors | PL1, PL2, PL4, PL6-PL9 | PluginsView.swift, ConnectedAppsView.swift, Features/Plugins/McpServersList.swift | WP0b (gate); S1 for PL7 | via S1 |
| WP10 | Automations page and calendar: promote Automations to the home "+" long-press, Schedule / Logs segments, day agenda calendar, tap-to-create, reschedule | AU1-AU4 | new Features/Automations/*, ChatListView.swift (one menu item; after WP6) | WP8 | none |
| WP11 | Rooms: Room info sheet (details, members, instructions read, memory, threads row), goal `/goal` and goal card; owner items behind gates (rename, move, delete, bulletin edit, pin, members, leave, who answers) | RM6-RM8, RM11, RM13-RM19, CA14 | new Features/Room/*, Cards/GoalRunCardView.swift, ChatView header hook (from WP0b) | WP0a, WP0b; S1 for memory | via S1 |
| WP12 | Settings and appearance: app icon, sounds, run card, Settings search, About, achievements (server pairings), org page and routine delegation, usage by bot | ST2-ST4, ST8-ST12, AU19 | SettingsView.swift, SettingsPages.swift, AppearanceSettingsView.swift, Features/Achievements/* | WP0a | S1 if D1 for achievements on a sidecar |
| WP13 | New bot: team at creation, title, description, instructions, read-only notice; starting role if D1 | NB2-NB4, NB6 | CreateBotSheet.swift | WP0b | S1 if D1 |
| WP14 | Rich content: code block actions, table CSV / Markdown, chart (Swift Charts), mermaid fallback, email card, callouts, spoilers, footnotes, inline images, turn access line | CA16, CA21, CA23-CA28 | MarkdownText.swift, Core/Markdown.swift, Features/Chat/RichBlocks/* | WP1 (MarkdownText shared: land after) | none |
| WP15 | Team map (read-only list, then canvas) and move within team; people DMs and person sheet on org servers | TM1, TM2, RM21, RM22 | new Features/TeamMap/*, Features/People/* | WP0a | none |
| WP16 | Advanced bot panel for admin / approved pairings: skills, memory, history and restore, prompt preview, access read-only, model variants, command allowlist, visibility, sharing, Perspicax, Slack, duplicate | BA2, BA4-BA7, BA9, BA14-BA19 | Features/BotAdvanced/* (one file per section), AgentProfileView.swift (row list) | D1; WP7; S1/S2 | via S1/S2 |
| WP17 | Voice: merge `feat/ios-live-call`, then spoken approvals, voice settings sections, room call | VO1-VO6, RM12 | WalkieView/Controller (or their replacement on that branch) | merge of feat/ios-live-call | on that branch |

iPad shell packages (from the 2026-10-02 spec, consuming the modules above):
**I1** `DesktopTheme` (tokens per skin, Geist) and `DesktopShell` (sidebar / content / docked
or overlay panel, size rules); **I2** `DesktopSidebar` (densities, pinned tiles, section and
row menus from WP5/WP6, ⌘ keys KB1/KB2, drag DD1); **I3** desktop chat (bubble metrics, hover
action row from WP1, composer pill with WP3 popups, find bar WP4, approval dock WP2, rich blocks
WP14); **I4** `BotPanel` docked (tabs Details, Routines, Files, Computer, Advanced from WP7 and
WP16); **I5** Settings modal and Plugins modal (WP9, WP12); **I6** Automations calendar week
grid with drag (WP10); **I7** room panel (WP11) and Team map canvas (WP15); **I8** palette,
compose-to, New Bot dialog, keyboard shortcuts sheet, notice banner. I1 has no dependency and
can start now; I2-I8 each follow I1 and their feature package.

### Order and parallel lanes

Wave 1 (start together, no shared files): **WP0a**, **WP0b**, **S1**, **S2**, **S3**, **I1**.

Wave 2 (after WP0a and WP0b): **WP1** (message menu), **WP2** (cards), **WP5** (threads),
**WP7** (profile), **WP9** (plugins). These own disjoint files: Features/Chat/MessageMenu +
ReplyQuote; Cards/*; Features/Threads + TaskManagerView + BotThreadTree; Profile/*;
PluginsView + ConnectedAppsView. **WP3** waits for WP1 only if both touch MarkdownText (they do
not: WP3 owns Composer/* and PlusActions), so WP3 can join wave 2 too.

Wave 3: **WP4**, **WP6** (ChatListView), **WP8** (routines), **WP11** (rooms), **WP12**
(settings). WP6 and WP10 both touch ChatListView: WP10 goes after WP6.

Wave 4: **WP10**, **WP13**, **WP14** (after WP1), **WP15**, then **WP16** (after D1) and
**WP17** (after the live-call merge). iPad I2-I8 run alongside from wave 2, each after its
feature package.

Daily-value order if only one lane runs: WP0a, WP0b, S1, WP1, WP2, WP3, WP5, WP7, WP8 (+S3),
WP9, WP12, WP6, WP4, WP11, WP10, WP13, WP16, WP14, WP15, WP17.
