// The interactive cards' actions (feature parity package WP2). Each one is
// the desktop renderer's (store.tsx `decideRequest`, `dismissCard`,
// `stopParallelTask`, SecretRequestCard and ConnectorCard): the requests live
// in CompanionCore (Client+Cards.swift), the rules in CardActions.swift.
import Foundation
import CompanionCore

extension Session {
    /// One dock decision. "Always allow" saves the bot's grant BEFORE the
    /// answer goes out: the bot may ask again within milliseconds.
    func decide(_ choice: ApprovalDockRules.Choice, on pending: PendingApproval, in chat: Chat) async {
        let decision = ApprovalDockRules.decision(choice, for: pending)
        let thread = pending.answerThread(conversation: chat.threadId)
        if let key = decision.alwaysAllowKey, let botId = askingBotId(pending, in: chat) {
            await perform { try await $0.alwaysAllow(botId: botId, key: key, threadId: thread) }
        }
        await perform { try await $0.respond(threadId: thread, decision: decision) }
    }

    /// "Allow all read-only (N)": one allow per read-only ask, nothing else.
    func allowAll(_ approvals: [PendingApproval], in chat: Chat) async {
        for pending in approvals {
            let decision = ApprovalDockRules.decision(.allowOnce, for: pending)
            await perform { try await $0.respond(threadId: pending.answerThread(conversation: chat.threadId), decision: decision) }
        }
    }

    /// "Cancel turn": stops the whole reply. A parallel task's cancel stops
    /// that task, never this conversation's turn.
    func cancelTurn(for pending: PendingApproval, in chat: Chat) async {
        switch chat {
        case let .bot(bot):
            if let task = pending.threadId, task != chat.threadId {
                await perform { try await $0.stopParallelTask(botId: bot.id, threadId: task) }
            } else {
                await perform { try await $0.interrupt(botId: bot.id, threadId: chat.threadId) }
            }
        case let .room(room):
            await perform { try await $0.cancelRoomTurn(groupId: room.id) }
        }
    }

    /// The bot that asked: the conversation's bot, or the room member.
    func askingBotId(_ pending: PendingApproval, in chat: Chat) -> String? {
        switch chat {
        case let .bot(bot): bot.id
        case let .room(room): pending.message.from?.botId ?? room.busyBotId
        }
    }

    /// The pending approvals of the parallel tasks this conversation runs:
    /// their threads are loaded so the dock can show their asks.
    func parallelApprovals(for chat: Chat) -> [PendingApproval] {
        guard case let .bot(bot) = chat, let tasks = state.bot(bot.id)?.tasks else { return [] }
        return ApprovalDockRules.waitingParallelTasks(tasks, of: chat.threadId).flatMap { task in
            ApprovalDockRules.parallelPendings(state.visibleTranscript(forThread: task.threadId), task: task)
        }
    }

    func loadParallelApprovalThreads(for chat: Chat) async {
        guard case let .bot(bot) = chat, let tasks = state.bot(bot.id)?.tasks else { return }
        for task in ApprovalDockRules.waitingParallelTasks(tasks, of: chat.threadId) {
            await loadThreadIfNeeded(task.threadId)
        }
    }

    // MARK: Option card

    /// The X of an option card: a quiz is put away, a live ask answered.
    func dismissOptionCard(_ message: Message, in chat: Chat) async {
        guard let card = message.card else { return }
        switch OptionCardRules.dismissal(for: card) {
        case .patch:
            guard case let .bot(bot) = chat else { return }
            await perform { try await $0.dismissCard(botId: bot.id, messageId: message.id) }
        case let .respond(behavior, words):
            guard let requestId = card.requestId else { return }
            let decision = ApprovalDecision(
                requestId: requestId, behavior: behavior, message: words, reviewedSha256: nil,
                always: false, rememberCommand: false, alwaysAllowKey: nil
            )
            await perform { try await $0.respond(threadId: chat.threadId, decision: decision) }
        }
    }

    // MARK: Parallel task

    func stopParallelTask(botId: String, threadId: String) async {
        await perform { try await $0.stopParallelTask(botId: botId, threadId: threadId) }
    }

    // MARK: Credential card

    /// The card's bot: the conversation's, or the room member that asked.
    func cardBotId(_ message: Message, in chat: Chat) -> String? {
        switch chat {
        case let .bot(bot): bot.id
        case .room: message.from?.botId
        }
    }

    /// Returns the computer's refusal, if any, for the card to show.
    func resumeSecretCard(_ message: Message, in chat: Chat) async -> String? {
        await cardRequest(message, in: chat) { try await $0.resumeSecretCard(botId: $1, messageId: message.id, threadId: chat.threadId) }
    }

    func dismissSecretCard(_ message: Message, in chat: Chat) async -> String? {
        await cardRequest(message, in: chat) { try await $0.dismissSecretCard(botId: $1, messageId: message.id, threadId: chat.threadId) }
    }

    // MARK: Connector card

    func authorizeConnectorCard(_ message: Message, in chat: Chat) async throws -> URL {
        guard let client = computerClient, let botId = cardBotId(message, in: chat) else {
            throw APIError.transport("This computer is offline.")
        }
        return try await client.authorizeConnectorCard(botId: botId, messageId: message.id, threadId: chat.threadId)
    }

    /// Whether the app is connected now (the computer resumes the task once
    /// it is). Nil when the check itself failed.
    func connectorCardStatus(_ message: Message, in chat: Chat) async -> Bool? {
        guard let client = computerClient, let botId = cardBotId(message, in: chat) else { return nil }
        return try? await client.connectorCardStatus(botId: botId, messageId: message.id, threadId: chat.threadId).connected
    }

    func resumeConnectorCard(_ message: Message, in chat: Chat) async -> String? {
        await cardRequest(message, in: chat) { try await $0.resumeConnectorCard(botId: $1, messageId: message.id, threadId: chat.threadId) }
    }

    func dismissConnectorCard(_ message: Message, in chat: Chat) async {
        _ = await cardRequest(message, in: chat) { try await $0.dismissConnectorCard(botId: $1, messageId: message.id, threadId: chat.threadId) }
    }

    /// A card request whose failure the card shows itself (the desktop's
    /// local error line) rather than the app-wide alert.
    private func cardRequest(
        _ message: Message, in chat: Chat,
        _ body: (CompanionClient, String) async throws -> Void
    ) async -> String? {
        guard let client = computerClient, let botId = cardBotId(message, in: chat) else {
            return String(localized: "This computer is offline.")
        }
        do {
            try await body(client, botId)
            return nil
        } catch {
            return error.localizedDescription
        }
    }
}
