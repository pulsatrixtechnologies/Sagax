// One conversation: the transcript, the approval cards, and the composer.
//
// The transcript is whatever the harness folded — settled text, tool chips,
// option cards, screenshots. This renders those and nothing else; it does
// not re-derive anything from provider events, because the server already
// did that and having two folds is how two clients start disagreeing.
//
// This file holds the screen's state and layout. Its parts live beside it in
// Features/Chat (header, "+" sheet, composer, attachment import, links,
// message rows and bubbles) and Cards (option and credential cards), so the
// iPhone and the iPad desktop layout can reuse them and feature packages do
// not collide in one file.
import SwiftUI
import CompanionCore
import PhotosUI
import UniformTypeIdentifiers
import ImageIO
// Unconditional, because the uses below are: `Color(uiColor:)` and
// `UIImage(data:)` are reached on every path through this file. A
// `canImport` guard around the import alone does not make the file portable
// — it only moves the failure from "no such module" to "no such type", and
// hides that this view is iOS-only behind something that looks like it
// isn't. The App target is iOS; CompanionCore is where the portable half
// lives.
import UIKit
import AVFoundation

struct ChatView: View {
    @Environment(\.themePalette) var themePalette
    let chat: Chat
    @State var selectedThreadId: String
    @EnvironmentObject var session: Session
    @Environment(\.dismiss) var dismiss
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @Environment(\.scenePhase) var scenePhase
    /// iPad desktop shell (Desktop/DesktopChat.swift): the desktop's header,
    /// composer and column; nil on the iPhone.
    @Environment(\.desktopChat) var desktopChat
    /// The desktop transcript's tokens (set with `desktopChat`).
    @Environment(\.desktopChatText) var desktopChatText
    @State var draft = ""
    @State var revealedMessageId: String?
    @State var showingTasks = false
    @State var showingComputer = false
    @State var showingPlus = false
    /// The bot panel, full screen, and the tab it opens on (`BotPanelDoor`).
    @State var showingPanel = false
    @State var panelTab: DesktopPanelTab = .details
    @State var showingWalkie = false
    /// WP11: the Room info sheet (RM6), opened by a room's header.
    @State var showingRoomInfo = false
    /// The Room info's Threads row: the threads sheet once it has gone.
    @State var roomInfoOpensThreads = false
    @AppStorage("walkie.target") var walkieTarget = ""
    /// WP3: failed sends, pasted chips, the busy choice, Steer and the "/" menu.
    @StateObject var power = ComposerModel()
    /// WP4: the find bar (MS11), the bottom follow and Jump to latest (MS14),
    /// citations waiting for the next send (CO8).
    @StateObject var finder = ChatFindModel()
    @StateObject var follow = BottomFollow()
    @StateObject var citations = CitationDrafts()
    @State var shareFile: ShareFile?
    @State var showingPhotoPicker = false
    @State var showingFileImporter = false
    @State var selectedPhotos: [PhotosPickerItem] = []
    @State var attachments: [PendingMessageAttachment] = []
    struct ComposerSnapshot {
        var text = ""
        var attachments: [PendingMessageAttachment] = []
        var error: String?
        /// The message a reply quotes, kept with its thread's draft.
        var replyTo: Message?
    }
    /// Reply (CO2): the message the next send quotes, drawn above the field.
    @State var replyTo: Message?
    @State var threadDrafts: [String: ComposerSnapshot] = [:]
    @State var preparingAttachments = false
    @State var sendingMessage = false
    @State var attachmentError: String?
    @State var openingFileName: String?
    @State var fileOpenError: String?
    @State var filePreview: FilePreviewItem?
    @State var fileDownloadTask: Task<Void, Never>?
    @State var fileDownloadRequestID: UUID?
    @State var threadOpenTask: Task<Void, Never>?
    @FocusState var composerFocused: Bool
    @StateObject var dictation = SpeechDictation()
    /// The opening beat: the island grows with the bot's face in it, then
    /// shrinks away as the face settles into the header. `facePhase` is 1
    /// with the face in the island, 0 with it home in the header.
    @State var islandExpanded = false
    @State var islandVisible = false
    @State var facePhase: CGFloat = 0

    @AppStorage(PrefKey.islandIntro) var islandIntro = IslandIntro.oncePerBot.rawValue
    @AppStorage(PrefKey.islandSeen) var islandSeen = ""
    @AppStorage(PrefKey.activityDetail) var activityDetail = ActivityDetail.full.rawValue
    @AppStorage(PrefKey.quickReplies) var quickReplies = ""
    /// The run card above the composer (ST4, WP14 `RunCardView`).
    @AppStorage(RunCardPreference.key) var showRunCard = true
    @ObservedObject var runCardDismissals = RunCardDismissals.shared

    init(chat: Chat) {
        self.chat = chat
        _selectedThreadId = State(initialValue: chat.threadId)
    }

    /// The live bubble's scroll target. A constant because there is at most
    /// one per chat and it has no message id to borrow.
    static let liveBubbleId = "companion.live"
    static let bottomId = "companion.bottom"

    /// The live chat record, so busy/unread stay current as frames land.
    var current: Chat {
        switch chat {
        case let .bot(bot):
            if let view = session.state.bot(bot.id)?.projected(forThread: selectedThreadId) { return .bot(view) }
            // Keep the exact target until a removed thread dismisses. Never
            // briefly fall back to a sibling while the view is closing.
            var removed = bot
            removed.threadId = selectedThreadId
            removed.busy = false
            return .bot(removed)
        case let .room(room):
            return session.state.rooms.first { $0.id == room.id }.map(Chat.room) ?? chat
        }
    }

    /// Bot selection is local to this screen; another device's navigation
    /// must not move a draft, approval, or Stop action to a different thread.
    var threadId: String { current.threadId }

    var selectedThreadWasRemoved: Bool {
        guard case let .bot(bot) = chat else { return false }
        guard let live = session.state.bot(bot.id) else { return true }
        return live.tasks.map { !$0.contains { $0.threadId == selectedThreadId } } ?? false
    }

    /// A task changes a bot's thread, but it does not make it a new bot.
    /// Intro history follows the chat itself so switching tasks cannot replay
    /// a once-per-bot greeting.
    var islandIntroID: String {
        switch current {
        case let .bot(bot): "bot.\(bot.id)"
        case let .room(room): "room.\(room.id)"
        }
    }

    var messages: [Message] {
        session.state.visibleTranscript(forThread: threadId)
    }

    /// The transcript as the reader has asked to see it: every chip, folded
    /// runs, or none at all.
    var rows: [TranscriptRow] {
        transcriptRows(messages, detail: ActivityDetail(rawValue: activityDetail) ?? .full)
    }

    /// The composer's chip row, as edited in Settings.
    var storedChips: [ActionChipItem] {
        QuickReply.decode(quickReplies).map {
            ActionChipItem(id: $0.id, title: $0.title, icon: $0.icon, prompt: $0.prompt)
        }
    }

    /// Unread elsewhere — what the back pill's badge counts, like Messages.
    var unreadElsewhere: Int {
        let mine = current.unread ? 1 : 0
        return max(0, session.state.unreadCount - mine)
    }

    var body: some View {
        // Type-erased at two seams (layout, lifecycle, presentations): the
        // whole chain as one opaque type made the optimizer abort ("Possible
        // non-terminating type substitution") when archiving Release.
        AnyView(screen)
        .sheet(isPresented: $showingTasks) {
            if current.supportsTasks {
                TaskManagerView(chat: current) { selectedThreadId = $0 }
            }
        }
        .fullScreenCover(isPresented: $showingPanel) {
            if case let .bot(bot) = current {
                ChatProfileRoute.destination(for: bot, tab: panelTab)
                    .environmentObject(session)
            }
        }
        .sheet(isPresented: $showingRoomInfo, onDismiss: {
            if roomInfoOpensThreads {
                roomInfoOpensThreads = false
                showingTasks = true
            }
        }) {
            if case let .room(room) = current {
                RoomInfoSheet(roomId: room.id, openThreads: {
                    roomInfoOpensThreads = true
                    showingRoomInfo = false
                }, onDeleted: {
                    showingRoomInfo = false
                    dismiss()
                })
                .environmentObject(session)
            }
        }
        .fullScreenCover(isPresented: $showingWalkie) {
            WalkieView { chat in
                showingWalkie = false
                // Walkie hands back the chat it wants open: this one stays,
                // another one is pushed from the home the way a deep link is.
                if chat.threadId != threadId { session.openChat(threadId: chat.threadId) }
            }
            .environmentObject(session)
        }
        .sheet(item: $shareFile) { file in
            ActivityShareSheet(items: [file.url])
        }
        .photosPicker(
            isPresented: $showingPhotoPicker,
            selection: $selectedPhotos,
            maxSelectionCount: max(1, AttachmentPolicy.maximumItems - attachments.count),
            matching: .images,
            preferredItemEncoding: .current
        )
        .onValueChange(of: selectedPhotos) { items in
            guard !items.isEmpty else { return }
            Task { await importPhotos(items) }
        }
        .fileImporter(
            isPresented: $showingFileImporter,
            allowedContentTypes: [.content],
            allowsMultipleSelection: true,
            onCompletion: importFiles
        )
        .fullScreenCover(item: $filePreview) { preview in
            FilePreviewView(item: preview) {
                filePreview = nil
            }
        }
    }

    var screen: some View {
        AnyView(arrival)
        .onDisappear {
            dictation.stop()
            resetFilePreview()
            cancelThreadOpen()
        }
        .onValueChange(of: scenePhase) { phase in
            if phase != .active { dictation.stop() }
        }
        .onValueChange(of: showingComputer) { shown in
            if shown { dictation.stop() }
        }
        .onValueChange(of: showingTasks) { shown in
            if shown { dictation.stop() }
        }
        .onValueChange(of: showingRoomInfo) { shown in
            if shown { dictation.stop() }
        }
        .onValueChange(of: showingPanel) { shown in
            if shown { dictation.stop() }
        }
        .onValueChange(of: showingWalkie) { shown in
            if shown { dictation.stop() }
        }
        .onValueChange(of: showingPlus) { shown in
            if shown { dictation.stop() }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey]
            let value = (raw as? NSNumber)?.uintValue ?? (raw as? UInt)
            if value == AVAudioSession.InterruptionType.began.rawValue {
                dictation.stop()
            }
        }
        .onValueChange(of: dictation.transcript) { spoken in
            // Always join against the text frozen at capture start. A newer
            // partial then replaces the older partial instead of duplicating it.
            draft = Dictation.draft(base: dictation.base, transcript: spoken)
        }
        .onValueChange(of: dictation.isListening) { listening in
            if listening { composerFocused = false }
        }
    }

    var arrival: some View {
        AnyView(layout)
        .task(id: threadId) {
            if selectedThreadWasRemoved { dismiss(); return }
            let openedChat = current
            session.threadSelection.rememberThread(openedChat, connectionID: session.connection?.id)
            await session.loadThreadIfNeeded(openedChat.threadId)
            // opening a chat is what marks it read, exactly as on the desktop
            if openedChat.unread { await session.markRead(openedChat) }
#if DEBUG
            // `-open-plus`: the + sheet up, for the screenshot harness
            if ProcessInfo.processInfo.arguments.contains("-open-plus") { showingPlus = true }
            // Profile parity screenshots without automating a tap through the
            // animated island/header transition.
            if ProcessInfo.processInfo.arguments.contains("-open-profile") { openProfile() }
            if let screen = ParityLaunch.current?.screen {
                if screen.opensComputer { showingComputer = true }
                if screen.opensProfile {
                    // a push while the chat's own push still animates is
                    // dropped; 0.9 s was too tight once a busy Debug build
                    // settled the chat a little later
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    openProfile()
                }
            }
#endif
        }
        .onValueChange(of: selectedThreadWasRemoved) { removed in
            if removed { dismiss() }
        }
        .onValueChange(of: session.state.hasLoadedPage(forThread: threadId)) { loaded in
            let requestedThread = threadId
            if !loaded { Task { await session.loadThreadIfNeeded(requestedThread) } }
        }
        .onValueChange(of: current.unread) { unread in
            // A message can arrive while this chat is already on screen. The
            // initial task above will not run again, so clear that new unread
            // bit here rather than leaving a badge on an open conversation.
            let readChat = current
            if unread { Task { await session.markRead(readChat) } }
        }
        .onValueChangePair(of: threadId) { previous, next in
            dictation.stop()
            threadDrafts[previous] = ComposerSnapshot(text: draft, attachments: attachments, error: attachmentError, replyTo: replyTo)
            let restored = threadDrafts.removeValue(forKey: next) ?? ComposerSnapshot()
            // another thread's draft coming back is not a paste
            power.pasteCheckSuppressed = restored.text != draft
            draft = restored.text
            attachments = restored.attachments
            attachmentError = restored.error
            replyTo = restored.replyTo
            selectedPhotos = []
            power.commandMenuForced = false
            power.busyChoice = nil
            showingPlus = false
            finder.close()
            follow.resume()
            // The local task picker changed threads. A download
            // started in the previous task must not open a sheet (or surface
            // its error) in the new one when the network reply arrives late.
            resetFilePreview()
            cancelThreadOpen()
        }
        .onValueChange(of: session.connection?.id) { _ in
            cancelThreadOpen()
        }
    }

    @ViewBuilder
    var layout: some View {
        // Read the transcript once for this render. Pagination changes the
        // array as a unit; repeatedly reaching through ObservableObject for
        // every row only recomputes the same value.
        let transcript = rows
        // A VStack with the composer as a sibling, rather than a scroll view
        // with `.safeAreaInset`. The inset version sized itself to its
        // content, so a short transcript left the composer floating in the
        // middle of the screen with black beneath it. Here the scroll area is
        // explicitly told to take everything the composer does not.
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    // VStack, not LazyVStack. A lazy stack does not know how
                    // tall it is until its rows have been built, so
                    // `.defaultScrollAnchor(.bottom)` anchors against an
                    // estimate and the chat opens somewhere in the middle of
                    // the conversation. Building all of it up front makes the
                    // height exact and the anchor land on the newest message.
                    // A thread holds 50 messages until you ask for more, so
                    // there is nothing here worth being lazy about.
                    VStack(alignment: .leading, spacing: 0) {
                        if session.state.hasMore[threadId] == true {
                            Button("Load earlier messages") {
                                // keep the reader where they were: after older
                                // messages are prepended, sit back on the one
                                // that used to be at the top
                                let anchor = transcript.first?.id
                                Task {
                                    await session.loadOlder(threadId: threadId)
                                    if let anchor { proxy.scrollTo(anchor, anchor: .top) }
                                }
                            }
                            .font(.footnote)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                        }

                        ForEach(Array(transcript.enumerated()), id: \.element.id) { index, row in
                            VStack(alignment: .leading, spacing: 0) {
                                // a gap in time is worth marking; a timestamp
                                // on every message is just noise
                                if let desktop = desktopChatText {
                                    // ChatView.tsx DaySeparator: a new calendar
                                    // day, 13 pt ink-secondary, 12 above and below
                                    if desktopStartsANewDay(at: index, in: transcript) {
                                        Text(verbatim: DesktopChatMetrics.dayLabel(row.head.date))
                                            .font(desktop.font(13))
                                            .frame(minHeight: 19.5)
                                            .foregroundStyle(desktop.inkSecondary)
                                            .frame(maxWidth: .infinity)
                                            .padding(.vertical, 12)
                                            .padding(.top, index == 0 ? 0 : DesktopChatMetrics.rowGap)
                                            .padding(.bottom, DesktopChatMetrics.rowGap)
                                    } else if index > 0 {
                                        Color.clear.frame(height: DesktopChatMetrics.rowGap)
                                    }
                                } else if startsANewStretch(at: index, in: transcript) {
                                    // 11 pt #555557, centred: about 22.6 pt
                                    // under the previous bubble and 17.6 pt
                                    // above the next one (reference 02).
                                    Text(RelativeStamp.separator(row.head.date))
                                        .font(Theme.Font.timestamp)
                                        .foregroundStyle(Theme.chatTimestamp)
                                        .frame(maxWidth: .infinity)
                                        .padding(.top, index == 0 ? 8 : 22.6)
                                        .padding(.bottom, 17.6)
                                } else if index > 0 {
                                    Color.clear.frame(height: Self.rowGap)
                                }
                                // WP15 (RM21): another person's name over their run
                                if case let .person(_, name, initials, personId)? = roomPersonLabel(at: index, in: transcript) {
                                    RoomPersonLabel(name: name, initials: initials, personId: personId)
                                }
                                switch row {
                                case let .message(message):
                                    MessageRow(
                                        chat: current,
                                        message: message,
                                        endsRun: endsRun(at: index, in: transcript),
                                        openLink: openLink,
                                        openThread: openThread
                                    )
                                case let .activityRun(items):
                                    ActivityRunChip(items: items, openThread: openThread)
                                case let .assistantTurn(turn):
                                    AssistantTurnChip(
                                        turn: turn, chat: current, openLink: openLink, openThread: openThread,
                                        revealedMessageId: revealedMessageId,
                                        scrollToMessage: { proxy.scrollTo($0, anchor: .center) }
                                    )
                                }
                            }
                            .id(row.id)
#if DEBUG
                            .background { desktopParityRowProbe(row) }
#endif
                        }

                        // The reply as it is typed. It sits after the last
                        // settled message and disappears the moment the real
                        // one arrives — the store clears it on the same frame
                        // that appends the message, so there is never a beat
                        // where both are on screen.
                        if let live = session.state.streaming[threadId], !live.isEmpty {
                            StreamingBubble(text: live, reasoning: nil, color: current.color)
                                .padding(.top, Self.rowGap)
                                .id(Self.liveBubbleId)
                        } else if activityDetail != ActivityDetail.hidden.rawValue,
                                  let thinking = session.state.reasoning[threadId], !thinking.isEmpty {
                            // Only while there is no answer yet. Once tokens
                            // of the reply exist, the reasoning is behind us
                            // and showing both is just noise.
                            StreamingBubble(text: nil, reasoning: thinking, color: current.color)
                                .padding(.top, Self.rowGap)
                                .id(Self.liveBubbleId)
                        } else if current.busy {
                            TypingIndicatorView(tintColor: MausPalette.color(current.color))
                                .padding(.top, Self.rowGap)
                                .id(Self.liveBubbleId)
                                .accessibilityLabel("\(current.name) is working")
                        }

                        // The bottom of the conversation: 26.3 pt from the
                        // last bubble to the composer's top, less the
                        // composer's own top padding. Scrolling targets this,
                        // so the gap is always in view.
                        Color.clear
                            .frame(height: desktopChat == nil ? 26.3 - Self.composerTopPadding : DesktopChatMetrics.rowGap)
                            .id(Self.bottomId)
                    }
                    .padding(.horizontal, desktopChat == nil ? Theme.Chat.bubbleLeading : 20)
                    .padding(.top, desktopChat == nil ? 12 : 56 - Self.topBarHeight)
                    .frame(maxWidth: desktopChat == nil ? CompanionLayout.chatWidth : DesktopShellRules.chatColumn + 40, alignment: .leading)
                    .frame(maxWidth: .infinity)
                    .environment(\.messageActions, messageActionContext)
                    .environment(\.citeIntoComposer, citeIntoComposer)
                    .environment(\.conversationGallery, conversationGallery)
                    .background(BottomFollowProbe(model: follow))
                }
                // The transcript starts under the top bar and scrolls
                // beneath it: a clear inset the height of the bar, then the
                // fade and the glass controls float over the content.
                .safeAreaInset(edge: .top, spacing: 0) {
                    Color.clear.frame(height: Self.topBarHeight + (pinnedPreview == nil ? 0 : Self.pinnedBannerHeight))
                }
                .overlay(alignment: .top) {
                    // the desktop's header floats over the transcript, unfaded
                    if desktopChat == nil {
                        ChatTopEdgeFade()
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                            .ignoresSafeArea()
                    }
                }
                .overlay(alignment: .top) { pinnedBanner }
                .overlay(alignment: .top) { chatHeaderSlot }
                .overlay(alignment: .bottom) {
                    if !follow.following, !transcript.isEmpty {
                        JumpToLatestButton {
                            follow.resume()
                            withAnimation { proxy.scrollTo(Self.bottomId, anchor: .bottom) }
                        }
                        .padding(.bottom, 12)
                    }
                }
                .animation(.snappy(duration: 0.2), value: follow.following)
                .overlay(alignment: .top) { islandFace }
                .task {
                    // grow, hold a beat, shrink — the face rides along
                    guard CompanionLayout.supportsIslandPresentation, !reduceMotion else { return }
                    // The intro is a greeting, and a greeting repeated every
                    // time you open a chat stops being one.
                    let intro = IslandIntro(rawValue: islandIntro) ?? .oncePerBot
                    switch intro {
                    case .never:
                        return
                    case .oncePerBot:
                        guard !IslandSeen.contains(islandIntroID, in: islandSeen) else { return }
                        islandSeen = IslandSeen.adding(islandIntroID, to: islandSeen)
                    case .always:
                        break
                    }
                    islandVisible = true
                    try? await Task.sleep(for: .milliseconds(40))
                    withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) { islandExpanded = true; facePhase = 1 }
                    try? await Task.sleep(for: .milliseconds(1000))
                    withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) { islandExpanded = false; facePhase = 0 }
                    try? await Task.sleep(for: .milliseconds(600))
                    islandVisible = false
                }
                // A conversation grows from the bottom: a transcript shorter
                // than the screen rests at the bottom, and opening a chat
                // starts on the newest message rather than the oldest.
                .scrollAnchorCompat(.bottom)
                // Tapping the transcript puts the keyboard away. The composer
                // is a sibling of this scroll view rather than inside it, so
                // nothing else here drops its focus — until this, the only way
                // back to the whole conversation was to leave the chat.
                // Simultaneous, not `.onTapGesture`: a tap that lands on a
                // link, a card button or a selected word still reaches the row
                // that owns it, and only also closes the keyboard.
                .simultaneousGesture(TapGesture().onEnded {
                    if composerFocused { composerFocused = false }
                })
                // And a drag down over the transcript pushes it away, the way
                // it does in Mail and Messages.
                .scrollDismissesKeyboard(.interactively)
                // `initial: true` is what opens the chat on the newest
                // message where `scrollAnchorCompat` cannot (iOS 16). On 17 the
                // anchor has already put us there and this is a no-op.
                .onValueChange(of: transcript.last?.id, initial: true) { _ in
                    guard let last = transcript.last else { return }
                    // Reading scrollback is not interrupted (MS14); your own
                    // send takes you back to the end.
                    if last.role == .user { follow.resume() }
                    guard follow.following else { return }
                    withAnimation { proxy.scrollTo(Self.bottomId, anchor: .bottom) }
                }
                // Long markdown replies finish laying out after the first
                // pass; settle on the newest message once they have, unless a
                // deep link asked for a particular one.
                .task(id: threadId) {
                    for delay in [150, 450] {
                        try? await Task.sleep(nanoseconds: UInt64(delay) * 1_000_000)
                        guard !Task.isCancelled, session.focusedMessageId == nil, revealedMessageId == nil else { return }
                        proxy.scrollTo(Self.bottomId, anchor: .bottom)
                    }
                }
                // Follow the text as it arrives. Keyed on length rather than
                // the string so this fires once per delta batch, and without
                // animation — animating every token turns a smooth stream
                // into a stutter, because each scroll interrupts the last.
                .onValueChange(of: session.state.streaming[threadId]?.count ?? 0) { length in
                    guard length > 0, follow.following else { return }
                    proxy.scrollTo(Self.bottomId, anchor: .bottom)
                }
#if DEBUG
                .task { await desktopParityLaunch(proxy) }
#endif
                .task(id: session.focusedMessageId) {
                    guard let messageId = session.focusedMessageId,
                          messages.contains(where: { $0.id == messageId })
                    else { return }
                    revealedMessageId = messageId
                    // A message picked by hand is read where it is.
                    follow.pause()
                    // Materialize the lazy folded row first. Its target bubble
                    // scrolls itself into view once expansion has laid it out.
                    let folded = transcript.first { row in
                        if case let .assistantTurn(turn) = row {
                            return turn.messages.contains { $0.id == messageId }
                        }
                        return false
                    }
                    proxy.scrollTo(folded?.id ?? messageId, anchor: .center)
                    // The expanded turn's bubbles (long markdown) finish laying
                    // out after the first pass and push the target down; land
                    // on it again once they have, as the newest-message settle
                    // above does. Focus is consumed after, since consuming it
                    // changes this task's id and would cancel the settle.
                    for delay in [150, 450] {
                        try? await Task.sleep(nanoseconds: UInt64(delay) * 1_000_000)
                        guard !Task.isCancelled else { return }
                        proxy.scrollTo(messageId, anchor: .center)
                    }
                    session.consumeFocus(messageId)
                }
            }
            .id(threadId)
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            composerSlot
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        // The composer sits 30 pt above the screen's bottom edge, inside the
        // home-indicator area, as in the reference; the keyboard still
        // pushes it up.
        .ignoresSafeArea(.container, edges: .bottom)
        .background(chatBackground)
        .overlay(alignment: .bottom) { plusSheet }
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden(true)
        // Hiding the bar above also disarms the system edge-swipe back
        // gesture, which is wired to the bar's navigation controller.
        // Re-arm it so a rightward swipe from the left edge pops back to
        // Home, the way the rest of iOS behaves.
        .background(SwipeBackBridge())
        .navigationDestination(isPresented: $showingComputer) {
            if case let .bot(bot) = current { ComputerView(bot: bot) }
        }
    }

    // MARK: - Header

    /// The top bar of reference 02: 44 pt glass circles 18 pt from the
    /// edges (back, computer) and the centred name capsule.
    static let topBarHeight: CGFloat = 56
    /// Space between two rows of the transcript.
    static let rowGap: CGFloat = 10
    static let composerTopPadding: CGFloat = 6

    /// True when this message opens a fresh stretch of conversation — the
    /// first one, or one that follows a gap of half an hour or more.
    /// The desktop marks a new calendar day only.
    func desktopStartsANewDay(at index: Int, in rows: [TranscriptRow]) -> Bool {
        guard index > 0 else { return true }
        return !Calendar.current.isDate(rows[index].head.date, inSameDayAs: rows[index - 1].head.date)
    }

    func startsANewStretch(at index: Int, in rows: [TranscriptRow]) -> Bool {
        guard index > 0 else { return true }
        return rows[index].at - rows[index - 1].endAt > 30 * 60 * 1000
    }

    /// True when the next message is from someone else (or there is none),
    /// which is where a run of bubbles gets its tail — one per run, like
    /// every messaging app, rather than one per bubble.
    func endsRun(at index: Int, in rows: [TranscriptRow]) -> Bool {
        guard index + 1 < rows.count else { return true }
        let this = rows[index], next = rows[index + 1]
        if this.role != next.role { return true }
        if this.senderName != next.senderName { return true }
        // two people's lines in a room are two runs (RM21)
        if this.head.sender?.id != next.head.sender?.id { return true }
        // a card or a tool chip between two texts breaks the run visually
        return next.kind != .text
    }

    var canSend: Bool {
        (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty
            || !power.pastes(threadId).isEmpty || !citations.citations(threadId).isEmpty)
            && !preparingAttachments && !sendingMessage
    }

    /// Messages the harness is holding for this thread. They sit above the
    /// composer rather than pretending to be part of the transcript: the
    /// turn that is still running owns the transcript's tail, and these
    /// words have not been said yet.
    var heldSends: [QueuedSend] {
        session.state.pendingQueued[threadId] ?? []
    }

    var hasPendingApproval: Bool {
        messages.contains { $0.card?.isPending == true }
    }
}
