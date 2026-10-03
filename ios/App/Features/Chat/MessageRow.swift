// One transcript row: the message's content by kind, its reactions, the
// branch switcher, and the long-press menu (MessageMenu).
import SwiftUI
import CompanionCore
import UIKit

struct MessageRow: View {
    @Environment(\.themePalette) var themePalette
    let chat: Chat
    let message: Message
    /// Last bubble of a run from the same side: the one that gets the tail.
    var endsRun = true
    let openLink: (URL, Message) -> OpenURLAction.Result
    /// Where an "Opened thread" chip goes; nil leaves the chip a receipt.
    var openThread: ((ThreadRef) -> Void)? = nil
    @EnvironmentObject private var session: Session
    @State private var editingText = ""
    @State private var showingEdit = false
    /// The text being selected, and the sheet's presentation in one value.
    @State private var selecting: SelectableText?
    /// A digest chip's parts, and its sheet's presentation.
    @State private var digest: DigestSummary?
    /// View Source: this bot reply drawn as its markdown source.
    @State private var showingSource = false
    @Environment(\.messageActions) private var context
    @ObservedObject private var speaker = MessageSpeaker.shared

    private var versions: [Message] {
        session.state.versions(of: message, inThread: chat.threadId)
    }

    /// The stand-in for an edit the computer has not answered yet. It has no
    /// server identity, so nothing may react to it or edit it again.
    private var isPendingEdit: Bool {
        session.state.pendingEdits[chat.threadId]?.placeholderId == message.id
    }

    /// Transport tags contain paths on the paired computer. They belong in
    /// attachment cards, never on the clipboard or in the text-selection UI.
    private var attachedContent: AttachedMessageContent {
        AttachedMessageContent.parse(message.text ?? "")
    }

    var body: some View {
        VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 6) {
            content

            if let comm = message.comm {
                // the chip already says what happened ("Posted in Standup");
                // a linked chip is not always a message sent to someone
                Label(message.tool?.name ?? "Messaged \(comm.withName)", systemImage: "arrow.up.right.bubble")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
            }

            if let reactions = message.reactions, !reactions.isEmpty {
                HStack(spacing: 6) {
                    ForEach(reactionGroups(reactions), id: \.emoji) { group in
                        Button("\(group.emoji) \(group.count)") {
                            Haptics.selection()
                            Task { await session.react(to: message, in: chat.threadId, emoji: group.emoji) }
                        }
                        .font(.system(size: 13))
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.capsule)
                        .tint(group.mine ? Theme.accent : Theme.textSecondary)
                    }
                }
            }

            if versions.count > 1, let index = versions.firstIndex(where: { $0.id == message.id }),
               case let .bot(bot) = chat {
                HStack(spacing: 8) {
                    Button {
                        Task { await session.switchVersion(to: versions[index - 1], for: bot) }
                    } label: { Image(systemName: "chevron.left") }
                    .disabled(index == 0 || bot.busy == true)
                    Text("\(index + 1) of \(versions.count)")
                    Button {
                        Task { await session.switchVersion(to: versions[index + 1], for: bot) }
                    } label: { Image(systemName: "chevron.right") }
                    .disabled(index + 1 >= versions.count || bot.busy == true)
                }
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
            }
        }
        .contextMenu {
            MessageMenu(
                message: message,
                chat: chat,
                visibleText: message.webhookContent?.task ?? attachedContent.text,
                canReact: !isPendingEdit,
                canEdit: message.role == .user
                    && message.kind == .text
                    && message.webhookContent == nil
                    && attachedContent.attachments.isEmpty
                    && !isPendingEdit,
                editDisabled: session.state.pendingEdits[chat.threadId] != nil,
                actions: actionSet,
                selectText: { selecting = SelectableText(text: $0) },
                edit: {
                    editingText = message.text ?? ""
                    showingEdit = true
                }
            )
        }
        .alert("Edit and retry", isPresented: $showingEdit) {
            TextField("Message", text: $editingText)
            Button("Cancel", role: .cancel) {}
            if case let .bot(bot) = chat {
                Button("Send") {
                    let text = editingText.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !text.isEmpty else { return }
                    Task { await session.edit(message, for: bot, text: text) }
                }
            }
        } message: {
            Text("This creates a new version and continues from there.")
        }
        .sheet(item: $selecting) { SelectableTextSheet(text: $0.text) }
        .sheet(item: $digest) { DigestSheet(summary: $0) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("message-\(message.id)")
    }

    /// The desktop's message actions for this row (ChatView.tsx `Bubble`,
    /// GroupView.tsx), each behind its gate and rule.
    private var actionSet: MessageActionSet {
        let gate = session.surfaceGate
        var set = MessageActionSet()
        guard !isPendingEdit else { return set }
        let quotable = MessageActionRules.canQuote(message)
        if quotable, gate.allows(.replyQuote), let reply = context.reply {
            set.reply = { reply(message) }
        }
        // Rooms offer Reply and Pin only (GroupView.tsx); View Source, Read
        // Aloud and Regenerate belong to a bot's own conversation.
        if case let .bot(bot) = chat {
            if MessageActionRules.canViewSource(message), message.kind == .text {
                set.showingSource = showingSource
                set.toggleSource = { showingSource.toggle() }
            }
            if MessageActionRules.canSpeak(message), gate.allows(.speakReply) {
                let text = message.text ?? ""
                let speaking = speaker.isSpeaking(message.id)
                set.speaking = speaking
                set.speak = speaking
                    ? { speaker.stop() }
                    : { speaker.speak(text, messageId: message.id, voiceId: bot.voice, session: session) }
            }
        }
        if case let .bot(bot) = chat, gate.allows(.regenerate), context.regenerableMessageId == message.id {
            set.regenerate = { Task { await session.regenerate(for: bot) } }
        }
        if quotable, gate.allows(.messagePin) {
            let pinned = context.pinnedMessageId == message.id
            set.pinned = pinned
            let target = chat
            set.togglePin = { Task { await session.setPinnedMessage(pinned ? nil : message.id, in: target) } }
        }
        if message.role == .bot, case .room = chat { set.routedBy = message.routedBy }
        return set
    }

    @ViewBuilder
    private var content: some View {
        // A card projected for someone who is not its approval audience
        // (OwnerWait.tsx): who it waits on, or who settled it. No controls.
        if message.ownerWait != nil {
            OwnerWaitView(message: message)
        } else {
            kindContent
        }
    }

    @ViewBuilder
    private var kindContent: some View {
        switch message.kind {
        case .text:
            if let ref = message.parallelTask, ref.part == .result {
                ParallelResultLabel(ref: ref)
            }
            TextBubble(message: message, chat: chat, tailed: endsRun, showingSource: showingSource, openLink: openLink)
        case .options:
            // A structured ask draws its own card: its answers are the
            // model's questions, not an allow/deny a tap could stand for.
            if message.card?.questions.isEmpty == false {
                QuestionCardView(chat: chat, message: message)
            } else {
                CardView(chat: chat, message: message)
            }
        case .secret:
            if let secret = message.secret {
                // A decline that resumed leaves nothing to show (SecretRequestCard.tsx).
                if !SecretCardRules.isHidden(secret) {
                    CredentialRequestCardView(chat: chat, message: message, secret: secret)
                }
            } else if let text = message.text, !text.isEmpty {
                TextBubble(message: message, chat: chat, tailed: endsRun, openLink: openLink)
            }
        case .activity:
            if let ref = message.parallelTask, ref.isCard {
                ParallelTaskCardView(chat: chat, message: message, ref: ref, openThread: openThread)
            } else {
                ActivityChip(
                    tool: message.tool, threadRef: message.threadRef, openThread: openThread,
                    outputIsProse: message.isTeammateReport
                )
            }
            // A failed turn on the conversation's last row: Retry sends the
            // last user line again (ChatView.tsx ErrorRow).
            if retryable, case let .bot(bot) = chat {
                ErrorRetryButton { await session.regenerate(for: bot) }
                    .accessibilityIdentifier("error-retry-\(message.id)")
            }
            // A turn that failed because Claude Code is too old for the
            // model: offer to run the updater for the engine this thread uses.
            if message.tool?.claudeUpdate == true, case let .bot(bot) = chat {
                ClaudeUpdateCard(
                    instanceId: bot.currentTaskModelSelection.instanceId,
                    tint: MausPalette.color(chat.color)
                )
            }
        case .compaction:
            ReceiptChip(icon: "square.3.layers.3d", label: message.compaction?.chipText ?? message.text ?? "") {
                selecting = SelectableText(text: message.compaction?.summary ?? message.text ?? "")
            }
        case .screen:
            ScreenShot(threadId: chat.threadId, message: message)
        case .digest:
            // Not a bubble: a chip saying the turn did something, opening
            // onto what. `transcriptRows` already dropped the ones with
            // nothing to say, and all of them when activity is hidden.
            let summary = DigestSummary(text: message.text ?? "")
            if !summary.isEmpty {
                ReceiptChip(icon: "checklist", label: summary.chipLabel, hint: "Shows what this turn did") {
                    digest = summary
                }
            }
        case .routineRun:
            if let card = message.routineRun {
                RoutineRunCardView(
                    card: card,
                    at: message.date,
                    tint: MausPalette.color(chat.color),
                    openRun: routineRunOpener(card)
                )
            } else if let text = message.text, !text.isEmpty {
                // A computer that sent the kind without its card: the text
                // is written for exactly this reader.
                TextBubble(message: message, chat: chat, tailed: endsRun, openLink: openLink)
            }
        case .connector:
            if let connector = message.connector, session.surfaceGate.allows(.connectorCard) {
                ConnectorCardView(chat: chat, message: message, connector: connector)
            } else if let text = message.text, !text.isEmpty {
                TextBubble(message: message, chat: chat, tailed: endsRun, openLink: openLink)
            }
        case .access:
            if let access = message.access {
                AccessCardView(access: access)
            } else if let text = message.text, !text.isEmpty {
                TextBubble(message: message, chat: chat, tailed: endsRun, openLink: openLink)
            }
        case .goalRun:
            if let run = message.goalRun {
                GoalRunCardView(run: run)
            } else if let text = message.text, !text.isEmpty {
                TextBubble(message: message, chat: chat, tailed: endsRun, openLink: openLink)
            }
        case .unknown:
            // A message kind from a newer computer. Almost everything the
            // harness sends carries `text`, so showing it is usually the
            // whole message and always better than a gap in the transcript.
            // When there is nothing to show, show nothing — a placeholder
            // saying "unsupported" is a worse gap than the gap.
            if let text = message.text, !text.isEmpty {
                TextBubble(message: message, chat: chat, tailed: endsRun, openLink: openLink)
            }
        }
    }

    /// This failed turn is the conversation's last row and its bot is idle.
    private var retryable: Bool {
        guard ErrorRowRules.isError(message), case let .bot(bot) = chat else { return false }
        return ErrorRowRules.retryableErrorId(
            in: session.state.visibleTranscript(forThread: chat.threadId),
            busy: bot.busy == true,
            pendingId: session.state.pendingEdits[chat.threadId]?.placeholderId
        ) == message.id
    }

    /// A run thread is opened by the same route an "Opened thread" chip
    /// takes, so it lands on screen without joining the thread list. No
    /// route — the run was deleted, or the phone holds no bot owning it —
    /// means no button.
    private func routineRunOpener(_ card: RoutineRunCard) -> (() -> Void)? {
        guard let openThread, let ref = session.state.routineExecutionRef(for: card) else { return nil }
        return { openThread(ref) }
    }

    private func reactionGroups(_ reactions: [Reaction]) -> [(emoji: String, count: Int, mine: Bool)] {
        Dictionary(grouping: reactions, by: \.emoji)
            .map { (emoji: $0.key, count: $0.value.count, mine: $0.value.contains { $0.by == "user" }) }
            .sorted { $0.emoji < $1.emoji }
    }
}
