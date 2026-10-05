// The conversation's side of the message actions (WP1): what the rows read
// through `MessageActionContext`, the pinned banner under the header, and
// the reply strip above the composer. The rules live in CompanionCore
// (MessageActions.swift); this only connects them to this screen's state.
import SwiftUI
import CompanionCore

extension ChatView {
    /// The banner's height, reserved under the header while a pin shows.
    static let pinnedBannerHeight: CGFloat = 40

    var messageActionContext: MessageActionContext {
        let all = messages
        let chat = current
        let gate = session.surfaceGate
        var context = MessageActionContext()
        context.lookup = { id in all.first { $0.id == id } }
        context.jump = { id in
            let thread = chat.threadId
            Task { await session.jump(to: id, inThread: thread) }
        }
        if gate.allows(.replyQuote) {
            context.reply = { message in
                replyTo = message
                composerFocused = true
            }
        }
        if case let .bot(bot) = chat, let last = MessageActionRules.lastBotTextId(in: all),
           let lastMessage = all.last(where: { $0.id == last }),
           MessageActionRules.canRegenerate(
            lastMessage, in: all, busy: bot.busy == true,
            pendingId: session.state.pendingEdits[chat.threadId]?.placeholderId
           ) {
            context.regenerableMessageId = last
        }
        context.pinnedMessageId = pinnedMessageId
        context.mentionPeers = mentionPeers
        if case let .room(room) = chat { context.mentionEveryone = room.dm != true }
        return context
    }

    var pinnedMessageId: String? {
        switch current {
        case let .bot(bot): bot.pinnedMessageIdForShownThread
        case let .room(room): room.pinnedMessageId
        }
    }

    var pinnedPreview: PinnedPreview? {
        PinnedPreview.resolve(
            pinnedMessageId,
            in: messages,
            fallbackName: current.isBot ? current.name : String(localized: "A bot")
        )
    }

    /// Who an @mention may name here: the other bots in a bot's chat, the
    /// members in a room (ChatView.tsx `mentionPeers`, GroupView.tsx).
    var mentionPeers: [MentionPeer] {
        switch current {
        case let .bot(bot):
            return session.state.bots.filter { $0.id != bot.id }.map { MentionPeer(name: $0.name, color: $0.color) }
        case let .room(room):
            return room.memberIds.compactMap { session.state.bot($0) }.map { MentionPeer(name: $0.name, color: $0.color) }
        }
    }

    /// The pinned message under the header: tap to jump, X to unpin.
    @ViewBuilder
    var pinnedBanner: some View {
        if let preview = pinnedPreview {
            let chat = current
            PinnedMessageBanner(
                preview: preview,
                onJump: {
                    let thread = chat.threadId
                    Task { await session.jump(to: preview.messageId, inThread: thread) }
                },
                onUnpin: session.surfaceGate.allows(.messagePin)
                    ? { Task { await session.setPinnedMessage(nil, in: chat) } }
                    : nil
            )
            .padding(.horizontal, Theme.Chat.bubbleLeading)
            .padding(.top, Self.topBarHeight + 2)
            .frame(maxWidth: CompanionLayout.chatWidth)
            .frame(maxWidth: .infinity)
            .transition(.opacity)
        }
    }

    /// The quote strip above the field while a reply is being written.
    @ViewBuilder
    var replyStrip: some View {
        if let replyTo {
            ReplyQuote(
                message: replyTo,
                fallbackName: current.isBot ? current.name : String(localized: "Bot"),
                onClear: { self.replyTo = nil }
            )
            // A container, so the X keeps its own identifier.
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("reply-strip")
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}
