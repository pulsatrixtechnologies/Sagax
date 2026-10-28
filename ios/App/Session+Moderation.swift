// Content between people (App Store guideline 1.2, CompanionCore
// Moderation.swift): Report another person's message to the admins, Block
// a person for oneself only, and accept the terms of use once per account.
// The blocked list and the acceptance live on the server, so the desktop
// and every phone of the person agree. A server without these routes (an
// older one) blocks nothing and asks nothing, as the desktop does.
import CompanionCore
import Foundation

extension Session {
    /// The ids `Moderation.isBlocked` reads.
    var blockedIds: Set<String> { Moderation.ids(blockedPeople) }

    /// Read the blocked list and whether the terms wait, after connecting.
    func loadModeration() async {
        guard let client = settingsClient, let connectionID = connection?.id else { return }
        if let people = try? await client.blockedPeople(), connection?.id == connectionID {
            blockedPeople = people
        }
#if DEBUG
        // screenshot harness: the demo without its one-time terms sheet
        if isDemo, ProcessInfo.processInfo.arguments.contains("-demo-terms-accepted") { return }
#endif
        // an older server (404), a pairing that is nobody in particular
        // (403) or no network: nothing to ask now
        guard let terms = try? await client.terms(), connection?.id == connectionID else { return }
        termsPending = !terms.accepted
    }

    /// "I agree": kept on the server with its date, for every device.
    func acceptTerms() async -> Bool {
        guard let client = settingsClient else { return false }
        guard let status = try? await client.acceptTerms() else { return false }
        termsPending = !status.accepted
        return status.accepted
    }

    /// Send a report on another person's message. Throws the server's words.
    func reportPerson(message: Message, in chat: Chat, reason: Moderation.Reason, note: String) async throws {
        guard let client = settingsClient else { throw APIError.transport(String(localized: "Not connected")) }
        try await client.reportMessage(threadId: chat.threadId, messageId: message.id, reason: reason, note: note)
    }

    func block(_ author: Moderation.Author) async -> Bool {
        guard let client = settingsClient else { return false }
        guard let people = try? await client.block(author) else { return false }
        blockedPeople = people
        return true
    }

    func unblock(_ id: String) async -> Bool {
        guard let client = settingsClient else { return false }
        guard let people = try? await client.unblock(id: id) else { return false }
        blockedPeople = people
        return true
    }

    /// The author of another person's line in this conversation, or nil.
    func personAuthor(of message: Message, in chat: Chat) -> Moderation.Author? {
        let inRoom: Bool
        if case .room = chat { inRoom = true } else { inRoom = false }
        return Moderation.personAuthor(of: message, viewer: roomViewer, inRoom: inRoom, isBot: { [state] in state.bot($0) != nil })
    }

    /// Whether this line is from someone this person blocked.
    func isBlockedLine(_ message: Message, in chat: Chat) -> Bool {
        guard !blockedPeople.isEmpty, let author = personAuthor(of: message, in: chat) else { return false }
        return blockedIds.contains(author.id)
    }
}
