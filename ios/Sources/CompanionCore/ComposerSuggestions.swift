// The suggestion strip above the composer (feature parity matrix CO11, CO12,
// RM9): "@" completes a bot (or @everyone in a room), "#" a thread title.
// The "@" rules are the desktop's (Composer.tsx `mentionQueryAt`,
// src/lib/mentions.ts `mentionChoicesForQuery`); "#" completes the titles
// src/lib/thread-refs.ts resolves, and a send carries a resolvable "#Title"
// as the canonical link the desktop sends (`serializeThreadRefs`).
import Foundation

// MARK: - "@"

/// One "@" choice: a bot, or the room itself (`@everyone`).
public struct MentionChoice: Hashable, Identifiable, Sendable {
    public static let everyoneId = "__everyone__"

    public var id: String
    public var name: String
    /// The bot's colour, for its chip; nil for @everyone.
    public var color: String?

    public init(id: String, name: String, color: String? = nil) {
        self.id = id
        self.name = name
        self.color = color
    }

    public var isEveryone: Bool { id == Self.everyoneId }
}

/// The "@" being typed at the end of the draft.
public struct MentionQuery: Hashable, Sendable {
    /// Character offset of the "@".
    public var start: Int
    public var query: String

    /// `mentionQueryAt`: the text between an "@" that starts a word and the
    /// caret (the draft's end on the phone); nil when no tag is being typed.
    public static func at(_ text: String) -> MentionQuery? {
        let characters = Array(text)
        guard let at = characters.lastIndex(of: "@") else { return nil }
        if at > 0, !characters[at - 1].isWhitespace { return nil }
        let query = String(characters[(at + 1)...])
        if query.count > 24 || query.contains("@") || query.contains("\n") { return nil }
        return MentionQuery(start: at, query: query)
    }

    /// The draft with the tag completed: `@Name ` replaces what was typed.
    public func completing(_ text: String, with choice: MentionChoice) -> String {
        let characters = Array(text)
        return String(characters[0..<min(start, characters.count)]) + "@\(choice.name) "
    }
}

public enum MentionSuggestions {
    /// The pool the desktop offers: in a room, @everyone (not in a DM) and
    /// its members; in a one-to-one chat, every other visible bot.
    public static func pool(for chat: Chat, bots: [Bot]) -> [MentionChoice] {
        switch chat {
        case let .bot(current):
            return bots
                .filter { $0.id != current.id && $0.hidden != true }
                .map { MentionChoice(id: $0.id, name: $0.name, color: $0.color) }
        case let .room(room):
            let members = room.memberIds.compactMap { id in bots.first { $0.id == id } }
                .map { MentionChoice(id: $0.id, name: $0.name, color: $0.color) }
            return (room.dm == true ? [] : [MentionChoice(id: MentionChoice.everyoneId, name: "everyone")]) + members
        }
    }

    /// `mentionChoicesForQuery`: every name containing the query; none once
    /// the tag is complete ("@Scout "), so the next send is a send.
    public static func choices(_ pool: [MentionChoice], query: String) -> [MentionChoice] {
        let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if query.hasSuffix(" "), pool.contains(where: { $0.name.lowercased() == normalized }) { return [] }
        return pool.filter { normalized.isEmpty || $0.name.lowercased().contains(normalized) }
    }
}

// MARK: - "#"

/// A thread the person can see (`ThreadRefCandidate`): a bot's task, or a
/// room's. `activeAt` orders threads that share a title.
public struct ThreadRefCandidate: Hashable, Identifiable, Sendable {
    public var botId: String
    public var botName: String
    public var threadId: String
    public var title: String
    public var activeAt: Double?

    public init(botId: String, botName: String, threadId: String, title: String, activeAt: Double? = nil) {
        self.botId = botId
        self.botName = botName
        self.threadId = threadId
        self.title = title
        self.activeAt = activeAt
    }

    public var id: String { "\(botId)/\(threadId)" }

    /// `collectThreadRefs`: bot threads, then room threads (not DMs).
    public static func collect(bots: [Bot], rooms: [Room]) -> [ThreadRefCandidate] {
        var out: [ThreadRefCandidate] = []
        for bot in bots {
            for task in bot.tasks ?? [] {
                out.append(ThreadRefCandidate(botId: bot.id, botName: bot.name, threadId: task.threadId, title: task.title, activeAt: task.createdAt))
            }
        }
        for room in rooms where room.dm != true {
            for task in room.tasks ?? [] {
                out.append(ThreadRefCandidate(botId: room.id, botName: room.name, threadId: task.threadId, title: task.title, activeAt: task.createdAt))
            }
        }
        return out
    }
}

/// The "#" being typed at the end of the draft.
public struct ThreadRefQuery: Hashable, Sendable {
    public var start: Int
    public var query: String

    /// A "#" at a word start (not `C#`, `&#39;` or `##`), followed by up to
    /// 60 characters on one line; "# " (a heading) is not a reference.
    public static func at(_ text: String) -> ThreadRefQuery? {
        let characters = Array(text)
        guard let at = characters.lastIndex(of: "#") else { return nil }
        if at > 0, ThreadRefs.notWordStart(characters[at - 1]) { return nil }
        let query = String(characters[(at + 1)...])
        if query.count > 60 || query.contains("\n") || query.contains("#") { return nil }
        if let first = query.first, first.isWhitespace { return nil }
        return ThreadRefQuery(start: at, query: query)
    }

    public func completing(_ text: String, with thread: ThreadRefCandidate) -> String {
        let characters = Array(text)
        return String(characters[0..<min(start, characters.count)]) + "#\(thread.title.trimmingCharacters(in: .whitespaces)) "
    }
}

public enum ThreadRefSuggestions {
    /// Linkable titles containing the query, the open bot's own threads
    /// first, then the newest; the open thread itself is left out, and a
    /// completed title ("#QA PR 245 ") closes the strip.
    public static func choices(
        _ threads: [ThreadRefCandidate],
        query: String,
        currentBotId: String?,
        currentThreadId: String?,
        limit: Int = 20
    ) -> [ThreadRefCandidate] {
        let normalized = query.trimmingCharacters(in: .whitespaces).lowercased()
        if query.hasSuffix(" "), threads.contains(where: { $0.title.trimmingCharacters(in: .whitespaces).lowercased() == normalized }) {
            return []
        }
        var seen = Set<String>()
        let matching = threads.filter { thread in
            let title = thread.title.trimmingCharacters(in: .whitespaces)
            guard ThreadRefs.linkable(title), thread.threadId != currentThreadId, seen.insert(thread.id).inserted else { return false }
            return normalized.isEmpty || title.lowercased().contains(normalized)
        }
        let sorted = matching.enumerated().sorted { a, b in
            let ownA = a.element.botId == currentBotId, ownB = b.element.botId == currentBotId
            if ownA != ownB { return ownA }
            let prefixA = a.element.title.lowercased().hasPrefix(normalized), prefixB = b.element.title.lowercased().hasPrefix(normalized)
            if prefixA != prefixB { return prefixA }
            let atA = a.element.activeAt ?? 0, atB = b.element.activeAt ?? 0
            if atA != atB { return atA > atB }
            return a.offset < b.offset
        }
        return Array(sorted.prefix(limit).map(\.element))
    }
}

/// Thread references in a draft (src/lib/thread-refs.ts).
public enum ThreadRefs {
    static let urlPrefix = "openmausbot://thread/"

    /// A "#" glued to one of these is not a word start.
    static func notWordStart(_ character: Character) -> Bool {
        character.isLetter || character.isNumber || character == "_" || character == "#" || character == "&"
    }

    static func wordCharacter(_ character: Character) -> Bool {
        character.isLetter || character.isNumber || character == "_"
    }

    /// Only a real name links: "123" would make every issue number a link.
    static func linkable(_ title: String) -> Bool {
        !title.isEmpty && !title.allSatisfy(\.isNumber)
    }

    /// `threadRefUrl`: the canonical link a reference is sent as.
    public static func url(botId: String, threadId: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        let thread = threadId.addingPercentEncoding(withAllowedCharacters: allowed) ?? threadId
        let bot = botId.addingPercentEncoding(withAllowedCharacters: allowed) ?? botId
        return "\(urlPrefix)\(thread)?bot=\(bot)"
    }

    /// `threadRefMarkdown`.
    public static func markdown(_ thread: ThreadRefCandidate) -> String {
        let label = thread.title.trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "[", with: "\\[")
            .replacingOccurrences(of: "]", with: "\\]")
        return "[\(label)](\(url(botId: thread.botId, threadId: thread.threadId)))"
    }

    /// `parseThreadRefUrl` (the strict shape copy emits): the thread and its bot.
    public static func parse(_ value: String) -> (threadId: String, botId: String?)? {
        let raw = value.trimmingCharacters(in: .whitespaces)
        guard raw.lowercased().hasPrefix(urlPrefix),
              let components = URLComponents(string: raw),
              components.host?.lowercased() == "thread", components.port == nil, components.fragment == nil
        else { return nil }
        let threadId = String(components.path.dropFirst())
        guard !threadId.isEmpty, !threadId.contains("/"), threadId.count <= 256 else { return nil }
        let items = components.queryItems ?? []
        guard items.allSatisfy({ $0.name == "bot" }), items.count <= 1 else { return nil }
        if let bot = items.first {
            guard let value = bot.value, !value.isEmpty else { return nil }
            return (threadId, value)
        }
        return (threadId, nil)
    }

    /// `pick`: which of several same-titled threads a mention means.
    static func pick(_ candidates: [ThreadRefCandidate], currentBotId: String?) -> ThreadRefCandidate {
        if candidates.count == 1 { return candidates[0] }
        let own = candidates.filter { $0.botId == currentBotId }
        if own.count == 1 { return own[0] }
        let pool = own.count > 1 ? own : candidates
        let stamps = pool.map(\.activeAt)
        if stamps.allSatisfy({ $0 != nil }) {
            let newest = stamps.compactMap { $0 }.max()
            let latest = pool.filter { $0.activeAt == newest }
            if latest.count == 1 { return latest[0] }
        }
        return pool[0]
    }

    /// `resolveThreadRefs` then `serializeThreadRefs`: every resolvable
    /// "#Title" outside a markdown link or inline code becomes the canonical
    /// link, so the thread id stays machine-readable in the stored send.
    public static func serialize(_ text: String, threads: [ThreadRefCandidate], currentBotId: String?) -> String {
        guard text.contains("#") else { return text }
        var groups: [(lower: String, candidates: [ThreadRefCandidate])] = []
        var seen = Set<String>()
        for thread in threads {
            let title = thread.title.trimmingCharacters(in: .whitespaces)
            guard linkable(title), seen.insert(thread.id).inserted else { continue }
            var copy = thread
            copy.title = title
            let lower = title.lowercased()
            if let index = groups.firstIndex(where: { $0.lower == lower }) {
                groups[index].candidates.append(copy)
            } else {
                groups.append((lower, [copy]))
            }
        }
        guard !groups.isEmpty else { return text }
        groups.sort { $0.lower.count > $1.lower.count }

        let characters = Array(text)
        var out = ""
        var index = 0
        while index < characters.count {
            let character = characters[index]
            // inline code and markdown links pass through untouched
            if character == "`", let close = characters[(index + 1)...].firstIndex(of: "`") {
                out += String(characters[index...close])
                index = close + 1
                continue
            }
            if character == "[", let end = markdownLinkEnd(characters, from: index) {
                out += String(characters[index..<end])
                index = end
                continue
            }
            if character == "#", index == 0 || !notWordStart(characters[index - 1]) {
                let start = index + 1
                var matched: (end: Int, thread: ThreadRefCandidate)?
                for group in groups {
                    let end = start + group.lower.count
                    guard end <= characters.count,
                          String(characters[start..<end]).lowercased() == group.lower
                    else { continue }
                    if end < characters.count, wordCharacter(characters[end]) { continue }
                    matched = (end, pick(group.candidates, currentBotId: currentBotId))
                    break
                }
                if let matched {
                    out += markdown(matched.thread)
                    index = matched.end
                    continue
                }
            }
            out.append(character)
            index += 1
        }
        return out
    }

    /// `[label](target)` starting at `from`: the index after its `)`.
    private static func markdownLinkEnd(_ characters: [Character], from start: Int) -> Int? {
        var index = start + 1
        var escaped = false
        while index < characters.count {
            let character = characters[index]
            if character == "\n" { return nil }
            if escaped { escaped = false } else if character == "\\" { escaped = true } else if character == "]" { break }
            index += 1
        }
        guard index + 1 < characters.count, characters[index] == "]", characters[index + 1] == "(" else { return nil }
        guard let close = characters[(index + 2)...].firstIndex(where: { $0 == ")" || $0 == "\n" }),
              characters[close] == ")"
        else { return nil }
        return close + 1
    }
}
