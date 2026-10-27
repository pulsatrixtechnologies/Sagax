import Foundation

/// One error per bot and cause in a conversation (the maintainer,
/// 2026-10-27): a person who sends again while a bot cannot answer must not
/// see the thread fill with the same failed row and the same access card each
/// time. The same rule as the desktop's shared/failure-dedup.ts
/// (`repeatedFailureIds`): within a thread, only the last row of each failure
/// is drawn since that bot last answered. A reply from that bot in between
/// means the cause went away, so a later failure shows again.
public enum FailureDedup {
    /// What makes two rows the same failure, or nil for any other row.
    /// A failed turn (`error: <cause>`, `tool.ok == false`) keys on its bot
    /// and its cause with the whitespace collapsed; an access card on its
    /// bot, its reason and its engine.
    public static func key(_ message: Message, threadBotId: String = "") -> String? {
        guard message.role == .bot else { return nil }
        if message.kind == .access, let access = message.access {
            let bot = nonEmpty(access.botId) ?? nonEmpty(message.from?.botId) ?? threadBotId
            return ["access", bot, access.reason, access.engine].joined(separator: "\u{0}")
        }
        guard message.kind == .activity, let tool = message.tool, tool.ok == false,
              let cause = failedTurnCause(tool.name) else { return nil }
        let bot = nonEmpty(message.from?.botId) ?? threadBotId
        return ["error", bot, collapse(cause)].joined(separator: "\u{0}")
    }

    /// The ids of rows that repeat a failure shown later in the same
    /// stretch: only the last of each is drawn.
    public static func repeatedIds(_ messages: [Message], threadBotId: String = "") -> Set<String> {
        var hidden = Set<String>()
        var latest: [String: String] = [:]
        for message in messages {
            if let bot = answeredBy(message, threadBotId: threadBotId) {
                latest = latest.filter { botOf(key: $0.key) != bot }
                continue
            }
            guard let key = key(message, threadBotId: threadBotId) else { continue }
            if let earlier = latest[key] { hidden.insert(earlier) }
            latest[key] = message.id
        }
        return hidden
    }

    /// The cause a failed-turn row carries, without its `error:` marker;
    /// nil for any other activity row (shared/failed-turn.ts).
    static func failedTurnCause(_ name: String) -> String? {
        let marker = "error:"
        guard name.hasPrefix(marker) else { return nil }
        return String(name.dropFirst(marker.count)).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func answeredBy(_ message: Message, threadBotId: String) -> String? {
        guard message.role == .bot, message.kind == .text else { return nil }
        return nonEmpty(message.from?.botId) ?? threadBotId
    }

    private static func botOf(key: String) -> String {
        let parts = key.split(separator: "\u{0}", omittingEmptySubsequences: false)
        return parts.count > 1 ? String(parts[1]) : ""
    }

    private static func collapse(_ text: String) -> String {
        text.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).joined(separator: " ")
    }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }
}
