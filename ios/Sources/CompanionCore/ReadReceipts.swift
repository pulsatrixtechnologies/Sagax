// "Seen by" and emoji reactions (desktop #270: SeenBy.tsx,
// src/lib/read-receipts.ts, read-receipts-feed.ts, Reactions.tsx,
// src/lib/reactions.ts, shared/reactions.ts).
//
// The server keeps one read position per participant per thread: a person's
// principal id, or `bot:<botId>`, at the newest message they have seen
// (GET/POST /api/threads/:t/read, frame `thread.read`). The transcript shows
// each participant once, under the last message they have read: faces in a
// room or a conversation between people, a "Seen" caption in a one-to-one
// chat with a bot. The viewer's own position is never drawn.
import Foundation

// MARK: - Wire

public struct ThreadReadPosition: Codable, Hashable, Sendable {
    public var messageId: String
    public var at: Double

    public init(messageId: String, at: Double) {
        self.messageId = messageId
        self.at = at
    }
}

/// `GET /api/threads/:t/read`.
public struct ThreadReads: Decodable, Equatable, Sendable {
    public var reads: [String: ThreadReadPosition]
    /// The viewer's participant id, as the server keys them.
    public var selfId: String?

    public init(reads: [String: ThreadReadPosition] = [:], selfId: String? = nil) {
        self.reads = reads
        self.selfId = selfId
    }

    enum CodingKeys: String, CodingKey { case reads, selfId = "self" }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let raw = (try? c.decodeIfPresent([String: Lossy<ThreadReadPosition>].self, forKey: .reads)) ?? nil
        reads = (raw ?? [:]).compactMapValues(\.value)
        selfId = (try? c.decodeIfPresent(String.self, forKey: .selfId)) ?? nil
    }
}

/// `thread.read`: one participant moved, or `reset` (fetch again).
public struct ThreadReadFrame: Hashable, Sendable {
    public var threadId: String
    public var participantId: String?
    public var read: ThreadReadPosition?
    public var reset: Bool

    public init(threadId: String, participantId: String? = nil, read: ThreadReadPosition? = nil, reset: Bool = false) {
        self.threadId = threadId
        self.participantId = participantId
        self.read = read
        self.reset = reset
    }
}

struct ThreadReadPostResponse: Decodable { var read: ThreadReadPosition? }

public extension CompanionClient {
    /// `GET /api/threads/:t/read`.
    func threadReads(threadId: String) async throws -> ThreadReads {
        guard Self.validRouteID(threadId) else { throw APIError.badURL }
        return try await send(makeRequest("GET", "/api/threads/\(threadId)/read"), as: ThreadReads.self)
    }

    /// `POST /api/threads/:t/read {messageId}`: this person's position. Nil
    /// back when they turned read receipts off (a conversation between two
    /// people) or the position would move back.
    @discardableResult
    func postThreadRead(threadId: String, messageId: String) async throws -> ThreadReadPosition? {
        guard Self.validRouteID(threadId), Self.validRouteID(messageId) else { throw APIError.badURL }
        return try await send(makeRequest("POST", "/api/threads/\(threadId)/read", body: ["messageId": messageId]), as: ThreadReadPostResponse.self).read
    }
}

// MARK: - Seen rows

public struct SeenEntry: Hashable, Sendable {
    public var participantId: String
    public var at: Double

    public init(participantId: String, at: Double) {
        self.participantId = participantId
        self.at = at
    }

    /// The bot behind `bot:<id>`, nil for a person.
    public var botId: String? { ReadReceiptRules.botId(of: participantId) }
}

public enum ReadReceiptRules {
    /// Faces in a row before "+N" (`SEEN_MAX_FACES`).
    public static let maxFaces = 5
    static let botPrefix = "bot:"

    public static func botId(of participantId: String) -> String? {
        participantId.hasPrefix(botPrefix) ? String(participantId.dropFirst(botPrefix.count)) : nil
    }

    private static func same(_ a: String?, _ b: String?) -> Bool {
        guard let a = a?.trimmingCharacters(in: .whitespaces).lowercased(), let b = b?.trimmingCharacters(in: .whitespaces).lowercased(),
              !a.isEmpty, !b.isEmpty else { return false }
        return a == b
    }

    /// Who wrote a message, as a participant id: the bot that said it, or
    /// the person whose session sent it.
    public static func participant(of message: Message, soloBotId: String? = nil) -> String? {
        if message.role == .user {
            let id = message.sender?.id?.trimmingCharacters(in: .whitespaces).lowercased()
            return id?.isEmpty == false ? id : nil
        }
        return (message.from?.botId ?? soloBotId).map { botPrefix + $0 }
    }

    /// A room or a conversation between people: a text line with text or
    /// attachments carries the row.
    public static func roomAnchorable(_ message: Message) -> Bool {
        message.kind == .text && (!(message.text ?? "").isEmpty || !(message.attachments ?? []).isEmpty)
    }

    /// `seenRows`: for every message that gets a row, who has read up to it,
    /// oldest reader first. Each participant once, under the newest message
    /// at or before their position that is anchorable and that they did not
    /// write. The viewer is left out, and so is a position on a message this
    /// page has not loaded.
    public static func seenRows(
        order: [Message], anchorable: (Message) -> Bool, reads: [String: ThreadReadPosition], selfId: String?,
        soloBotId: String? = nil
    ) -> [String: [SeenEntry]] {
        var index: [String: Int] = [:]
        for (at, message) in order.enumerated() { index[message.id] = at }
        var rows: [String: [SeenEntry]] = [:]
        for (participantId, position) in reads {
            if same(participantId, selfId) { continue }
            guard let from = index[position.messageId] else { continue }
            var at = from
            while at >= 0 {
                let message = order[at]
                if anchorable(message), !same(participant(of: message, soloBotId: soloBotId), participantId) {
                    rows[message.id, default: []].append(SeenEntry(participantId: participantId, at: position.at))
                    break
                }
                at -= 1
            }
        }
        for key in rows.keys {
            rows[key]?.sort { $0.at != $1.at ? $0.at < $1.at : $0.participantId < $1.participantId }
        }
        return rows
    }

    /// `botSeenCaption`: a one-to-one chat with a bot shows "Seen" under the
    /// last line of yours the bot consumed, only until it answers below.
    public static func botSeenCaption(order: [Message], reads: [String: ThreadReadPosition], botId: String) -> (messageId: String, at: Double)? {
        let participantId = botPrefix + botId
        guard let read = reads[participantId] else { return nil }
        let rows = seenRows(
            order: order, anchorable: { $0.role == .user && $0.kind == .text },
            reads: [participantId: read], selfId: nil, soloBotId: botId
        )
        guard let messageId = rows.keys.first, let at = order.firstIndex(where: { $0.id == messageId }) else { return nil }
        if order[(at + 1)...].contains(where: { $0.role == .bot && $0.kind == .text }) { return nil }
        return (messageId, read.at)
    }

    /// "Seen", or "Seen at 14:03" once a minute or more has passed.
    public static func captionShowsTime(sentAt: Double, seenAt: Double) -> Bool { seenAt - sentAt >= 60_000 }

    /// A `thread.read` frame applied to a thread's positions; a reset
    /// (nil back) means fetch again.
    public static func apply(_ frame: ThreadReadFrame, to reads: [String: ThreadReadPosition]) -> [String: ThreadReadPosition]? {
        if frame.reset { return nil }
        guard let id = frame.participantId, let read = frame.read else { return reads }
        var next = reads
        next[id] = read
        return next
    }

    /// The faces drawn and how many go into "+N".
    public static func faces(_ entries: [SeenEntry]) -> (shown: [SeenEntry], more: Int) {
        (Array(entries.prefix(maxFaces)), max(0, entries.count - maxFaces))
    }
}

// MARK: - Reactions

public struct ReactionChip: Hashable, Sendable {
    public var emoji: String
    public var count: Int
    public var mine: Bool
    public var actors: [ReactionActor]
}

public enum ReactionRules {
    /// `QUICK_REACTIONS`.
    public static let quick = ["👍", "❤️", "😂", "🎉", "👀", "🙏", "✅", "❌"]
    /// One emoji sequence is at most 32 UTF-16 units (shared/reactions.ts).
    public static let maxEmojiUnits = 32

    /// Who the viewer is on a reaction: the read receipts' `self`, the
    /// session's principal, and on a personal server the legacy "user".
    public static func selfIds(readSelf: String?, viewerId: String?, personalServer: Bool) -> Set<String> {
        var ids = Set<String>()
        for id in [readSelf, viewerId] {
            if let id = id?.trimmingCharacters(in: .whitespaces).lowercased(), !id.isEmpty { ids.insert(id) }
        }
        if personalServer { ids.insert("user") }
        return ids
    }

    /// The chips of one message in the order the emojis first landed; an
    /// older server's one-entry-per-person shape folds into one chip.
    public static func chips(_ reactions: [Reaction], selfIds: Set<String>) -> [ReactionChip] {
        var order: [String] = []
        var firstAt: [String: Double] = [:]
        var actors: [String: [ReactionActor]] = [:]
        for reaction in reactions {
            if actors[reaction.emoji] == nil {
                order.append(reaction.emoji)
                actors[reaction.emoji] = []
            }
            if let at = reaction.at { firstAt[reaction.emoji] = min(firstAt[reaction.emoji] ?? at, at) }
            if let list = reaction.actors, !list.isEmpty {
                for actor in list where !(actors[reaction.emoji] ?? []).contains(where: { $0.id.lowercased() == actor.id.lowercased() }) {
                    actors[reaction.emoji, default: []].append(actor)
                }
            } else if let by = reaction.by {
                let actor = by == "user"
                    ? ReactionActor(id: "user", kind: "person", name: nil)
                    : ReactionActor(id: botPrefixed(by), kind: "bot", name: nil)
                actors[reaction.emoji, default: []].append(actor)
            }
        }
        let sorted = order.enumerated().sorted { lhs, rhs in
            let a = firstAt[lhs.element] ?? .infinity
            let b = firstAt[rhs.element] ?? .infinity
            return a != b ? a < b : lhs.offset < rhs.offset
        }.map(\.element)
        return sorted.map { emoji in
            let list = actors[emoji] ?? []
            return ReactionChip(
                emoji: emoji, count: max(list.count, 1),
                mine: list.contains { selfIds.contains($0.id.lowercased()) }, actors: list
            )
        }
    }

    private static func botPrefixed(_ id: String) -> String { id.hasPrefix("bot:") ? id : "bot:\(id)" }

    public enum ActorLabel: Hashable, Sendable { case you, name(String), aBot, someone }

    /// "You", a person's name, a bot's name, "A bot" or "Someone" (the app
    /// words them).
    public static func actorLabel(_ actor: ReactionActor, selfIds: Set<String>) -> ActorLabel {
        if selfIds.contains(actor.id.lowercased()) { return .you }
        if let name = actor.name, !name.isEmpty { return .name(name) }
        return actor.kind == "bot" ? .aBot : .someone
    }

    /// One emoji as the reaction route takes it: a single grapheme that is
    /// an emoji, at most 32 UTF-16 units. Nil for anything else.
    public static func emoji(from text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count == 1, (trimmed as NSString).length <= maxEmojiUnits,
              let first = trimmed.unicodeScalars.first,
              first.properties.isEmojiPresentation || trimmed.unicodeScalars.contains(where: { $0.properties.isEmoji && $0.value > 0xFF })
        else { return nil }
        return trimmed
    }
}
