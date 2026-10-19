// What the search sheet lists (iOS search, 2026-10-18; Grok Bot iOS
// reference search-ref.png): the same sources as the desktop's sidebar
// search (src/components/Sidebar.tsx filters bots and rooms by name, then
// SearchResults.tsx asks `GET /api/search` for messages), plus the
// organization's people (ComposeToPicker.tsx `composePeople`) and the bots'
// threads (the task picker's `threadGroups(matching:)`).
//
// The sheet has two modes. Search: bots, group chats, members, threads and
// messages, grouped by type in that order. New chat (the home's "+"): the
// create rows, then bots and members only, the way the desktop's "To:"
// picker lists them. Files and links have no search on the server
// (`/api/search` scans message text only), so they are not scopes here.
import Foundation

public enum SearchScope: String, CaseIterable, Identifiable, Sendable {
    case bots, groups, people, threads, messages
    public var id: String { rawValue }
}

public enum SearchSheetMode: Equatable, Sendable {
    case search
    case newChat
}

public enum SearchEntry: Hashable, Identifiable, Sendable {
    case createBot
    case createGroup
    case bot(Bot)
    case room(Room)
    case person(OrgDirectoryPerson)
    case thread(bot: Bot, task: BotTask)
    case message(SearchHit)

    public var id: String {
        switch self {
        case .createBot: "create-bot"
        case .createGroup: "create-group"
        case let .bot(bot): "bot.\(bot.id)"
        case let .room(room): "room.\(room.id)"
        case let .person(person): "person.\(person.principalId)"
        case let .thread(bot, task): "thread.\(bot.id).\(task.threadId)"
        case let .message(hit): "hit.\(hit.id)"
        }
    }

    public var scope: SearchScope? {
        switch self {
        case .createBot, .createGroup: nil
        case .bot: .bots
        case .room: .groups
        case .person: .people
        case .thread: .threads
        case .message: .messages
        }
    }
}

public enum SearchCatalog {
    /// Messages are asked from two characters on, as the desktop does
    /// (SearchResults.tsx `MIN_QUERY`).
    public static let minimumMessageQuery = 2
    /// At most this many threads, so a bot with hundreds of threads does not
    /// push the messages out of reach.
    public static let threadLimit = 20

    /// The scopes the filter menu offers: members only on an organization
    /// server, and New chat keeps to who one can write to.
    public static func scopes(mode: SearchSheetMode, organization: Bool) -> [SearchScope] {
        switch mode {
        case .search: organization ? SearchScope.allCases : SearchScope.allCases.filter { $0 != .people }
        case .newChat: organization ? [.bots, .people] : [.bots]
        }
    }

    public static func normalized(_ query: String) -> String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Everything the sheet lists, grouped by type in the order of
    /// `SearchScope`. `recency` gives a thread's last activity (epoch ms);
    /// pinned bots and rooms come first in their group, then the most recent.
    public static func entries(
        mode: SearchSheetMode,
        query rawQuery: String,
        scopes: Set<SearchScope>,
        bots: [Bot],
        rooms: [Room],
        people: [OrgDirectoryPerson],
        hits: [SearchHit],
        canCreateBots: Bool,
        recency: (String) -> Double?
    ) -> [SearchEntry] {
        let query = normalized(rawQuery)
        let shownBots = bots.filter { $0.hidden != true }
        var out: [SearchEntry] = []

        if mode == .newChat, query.isEmpty {
            if canCreateBots { out.append(.createBot) }
            out.append(.createGroup)
        }

        if scopes.contains(.bots) {
            let matching = shownBots.filter { query.isEmpty || matches(bot: $0, query) }
            out += sortedByPinAndRecency(matching.map { bot in
                (SearchEntry.bot(bot), bot.pinned == true || bot.chiefOfStaff == true, recency(bot.threadId) ?? bot.createdAt, bot.name)
            }, query: query)
        }

        if mode == .search, scopes.contains(.groups) {
            // A bot-to-bot room and a people-only conversation are not group
            // chats: the second is reached through its person below.
            let matching = rooms.filter { $0.dm != true && $0.peopleDm != true && (query.isEmpty || matches(room: $0, bots: shownBots, query)) }
            out += sortedByPinAndRecency(matching.map { room in
                (SearchEntry.room(room), room.pinned == true, recency(room.threadId) ?? room.createdAt, room.name)
            }, query: query)
        }

        if scopes.contains(.people) {
            let matching = people.filter { query.isEmpty || matches(person: $0, query) }
            out += matching
                .enumerated()
                .sorted { lhs, rhs in
                    let left = rank(People.displayName(lhs.element), query), right = rank(People.displayName(rhs.element), query)
                    if left != right { return left < right }
                    let a = People.displayName(lhs.element), b = People.displayName(rhs.element)
                    if a.localizedCaseInsensitiveCompare(b) != .orderedSame { return a.localizedCaseInsensitiveCompare(b) == .orderedAscending }
                    return lhs.offset < rhs.offset
                }
                .map { SearchEntry.person($0.element) }
        }

        guard mode == .search, !query.isEmpty else { return out }

        if scopes.contains(.threads) {
            var threads: [(SearchEntry, Double)] = []
            for bot in shownBots where bot.tasks != nil {
                for task in bot.threadGroups(matching: query).flatMap(\.tasks)
                where task.title.localizedCaseInsensitiveContains(query) {
                    threads.append((.thread(bot: bot, task: task), recency(task.threadId) ?? task.createdAt))
                }
            }
            out += threads.sorted { $0.1 > $1.1 }.prefix(threadLimit).map(\.0)
        }

        if scopes.contains(.messages), query.count >= minimumMessageQuery {
            out += hits.map(SearchEntry.message)
        }
        return out
    }

    // MARK: Matching

    public static func matches(bot: Bot, _ query: String) -> Bool {
        bot.name.localizedCaseInsensitiveContains(query)
            || bot.title.localizedCaseInsensitiveContains(query)
            || bot.description.localizedCaseInsensitiveContains(query)
            || (bot.instructionsLead ?? "").localizedCaseInsensitiveContains(query)
    }

    public static func matches(room: Room, bots: [Bot], _ query: String) -> Bool {
        if room.name.localizedCaseInsensitiveContains(query) { return true }
        let members = Set(room.memberIds)
        return bots.contains { members.contains($0.id) && $0.name.localizedCaseInsensitiveContains(query) }
    }

    public static func matches(person: OrgDirectoryPerson, _ query: String) -> Bool {
        "\(person.name) \(person.login) \(person.email ?? "") \(person.label ?? "")".localizedCaseInsensitiveContains(query)
    }

    /// `matchRank` of ComposeToPicker.tsx: 0 the name starts with the query,
    /// 1 a word of the name does, 2 it matches elsewhere.
    public static func rank(_ name: String, _ query: String) -> Int {
        let q = query.lowercased()
        guard !q.isEmpty else { return 0 }
        let text = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if text.hasPrefix(q) { return 0 }
        if text.split(whereSeparator: { " ._@-".contains($0) }).contains(where: { $0.hasPrefix(q) }) { return 1 }
        return 2
    }

    private static func sortedByPinAndRecency(_ list: [(SearchEntry, Bool, Double, String)], query: String) -> [SearchEntry] {
        list.enumerated().sorted { lhs, rhs in
            let l = lhs.element, r = rhs.element
            if !query.isEmpty {
                let left = rank(l.3, query), right = rank(r.3, query)
                if left != right { return left < right }
            }
            if l.1 != r.1 { return l.1 }
            if l.2 != r.2 { return l.2 > r.2 }
            return lhs.offset < rhs.offset
        }.map(\.element.0)
    }

    // MARK: Highlight

    /// Where the query first appears in `text`, case and diacritics
    /// ignored, for the bold run of a result.
    public static func highlightRange(in text: String, query: String) -> Range<String.Index>? {
        let q = normalized(query)
        guard !q.isEmpty else { return nil }
        return text.range(of: q, options: [.caseInsensitive, .diacriticInsensitive])
    }

    /// The server's own match in a message snippet (`matchStart`,
    /// `matchLength` in UTF-16 units, as JavaScript counts), else the query.
    public static func highlightRange(in hit: SearchHit, query: String) -> Range<String.Index>? {
        let utf16 = hit.snippet.utf16
        if hit.matchLength > 0, hit.matchStart >= 0, hit.matchStart + hit.matchLength <= utf16.count,
           let start = utf16.index(utf16.startIndex, offsetBy: hit.matchStart, limitedBy: utf16.endIndex),
           let end = utf16.index(start, offsetBy: hit.matchLength, limitedBy: utf16.endIndex),
           let lower = String.Index(start, within: hit.snippet),
           let upper = String.Index(end, within: hit.snippet) {
            return lower..<upper
        }
        return highlightRange(in: hit.snippet, query: query)
    }
}
