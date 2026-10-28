import Foundation

// Routine folders (2026-10-28, shared/routine-folders.ts): a routine may sit
// in one named folder of its bot, and each bot keeps a stable order of its
// folders. GET /api/routines carries `folders` ({ botId: [name] }) and each
// routine its `folder`; POST /api/routines/folders changes them. Whoever may
// change a bot's routines arranges its folders: no admin right.
//
// The grouping mirrors `groupRoutinesByFolder` so the phone and the desktop
// cut a list the same way: routines in no folder first (a section without a
// title), then one section per folder in the bot's order, empty folders
// included so a new folder can be filled from its header.

/// One section of a bot's routines.
public struct RoutineFolderGroup: Identifiable, Hashable, Sendable {
    /// Nil: the routines in no folder.
    public var folder: String?
    public var routines: [Routine]
    /// The bot the section belongs to (nil in a single-bot grouping).
    public var botId: String?

    public init(folder: String?, routines: [Routine], botId: String? = nil) {
        self.folder = folder
        self.routines = routines
        self.botId = botId
    }

    public var id: String { "\(botId ?? ""):\(folder.map(RoutineFolders.key) ?? "")" }
}

public enum RoutineFolders {
    public static let maxLength = 60

    /// Two names are the same folder whatever their case.
    public static func key(_ name: String) -> String { name.lowercased() }

    /// A folder name as the server stores it: control characters dropped,
    /// spaces collapsed, trimmed, at most 60 characters. Nil: no folder.
    public static func clean(_ value: String) -> String? {
        let scalars = value.unicodeScalars.map { scalar -> Character in
            (scalar.value < 0x20 || scalar.value == 0x7F) ? " " : Character(scalar)
        }
        let collapsed = String(scalars)
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
        guard !collapsed.isEmpty else { return nil }
        let cut = String(collapsed.prefix(maxLength)).trimmingCharacters(in: .whitespaces)
        return cut.isEmpty ? nil : cut
    }

    /// "[Prefix] Title" read as a folder and the title without it (the
    /// desktop's `routinePrefixFolder`). Nil: no leading bracketed prefix, or
    /// nothing left after it.
    public static func prefixFolder(_ name: String) -> (folder: String, name: String)? {
        guard let regex = try? NSRegularExpression(pattern: #"^\s*\[([^\]\[\n]{1,80})\]\s*[-:·|]?\s*(.+)$"#),
              let match = regex.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)),
              let head = Range(match.range(at: 1), in: name),
              let tail = Range(match.range(at: 2), in: name),
              let folder = clean(String(name[head]))
        else { return nil }
        let rest = String(name[tail]).trimmingCharacters(in: .whitespacesAndNewlines)
        return rest.isEmpty ? nil : (folder, rest)
    }

    /// The routines Sort by prefix would file: a [X] title, in no folder yet.
    public static func prefixCandidates(_ routines: [Routine]) -> [Routine] {
        routines.filter { ($0.folder ?? "").isEmpty && prefixFolder($0.name) != nil }
    }

    /// The spelling the bot already uses for this name, else the name.
    public static func canonical(_ name: String, in order: [String]) -> String {
        order.first { key($0) == key(name) } ?? name
    }

    /// A bot's folders in order: its saved order first, then any folder a
    /// routine names that the order does not (an older file), by name.
    public static func ordered(_ order: [String], routines: [Routine]) -> [String] {
        var out: [String] = []
        var seen = Set<String>()
        for name in order where !seen.contains(key(name)) {
            seen.insert(key(name))
            out.append(name)
        }
        var extra: [String: String] = [:]
        for routine in routines {
            guard let folder = routine.folder, !folder.isEmpty else { continue }
            let folderKey = key(folder)
            if !seen.contains(folderKey) && extra[folderKey] == nil { extra[folderKey] = folder }
        }
        for name in extra.values.sorted(by: { $0.localizedCompare($1) == .orderedAscending }) {
            seen.insert(key(name))
            out.append(name)
        }
        return out
    }

    /// One bot's list cut into sections: no folder first (always present,
    /// possibly empty), then one per folder in order, empty ones included.
    public static func group(_ routines: [Routine], order: [String], botId: String? = nil) -> [RoutineFolderGroup] {
        let folders = ordered(order, routines: routines)
        var buckets: [String: [Routine]] = Dictionary(uniqueKeysWithValues: folders.map { (key($0), []) })
        var loose: [Routine] = []
        for routine in routines {
            if let folder = routine.folder, !folder.isEmpty, buckets[key(folder)] != nil {
                buckets[key(folder)]!.append(routine)
            } else {
                loose.append(routine)
            }
        }
        return [RoutineFolderGroup(folder: nil, routines: loose, botId: botId)]
            + folders.map { RoutineFolderGroup(folder: $0, routines: buckets[key($0)] ?? [], botId: botId) }
    }

    /// A list of several bots: every routine in no folder stays in one
    /// section without a title (the list as it always was, all bots mixed),
    /// then each bot's folders, bots in `botOrder` (then any other bot by
    /// id). `folders` is the listing's `{ botId: [name] }`.
    public static func groupAcrossBots(_ routines: [Routine], folders: [String: [String]], botOrder: [String]) -> [RoutineFolderGroup] {
        var byBot: [String: [Routine]] = [:]
        for routine in routines { byBot[routine.botId, default: []].append(routine) }
        let known = Set(botOrder)
        let others = Set(byBot.keys).union(folders.keys).subtracting(known).sorted()
        var loose: [Routine] = []
        var sections: [RoutineFolderGroup] = []
        for botId in botOrder + others {
            let mine = byBot[botId] ?? []
            let groups = group(mine, order: folders[botId] ?? [], botId: botId)
            loose += groups.first?.routines ?? []
            sections += groups.dropFirst()
        }
        // keep the caller's order for the loose ones
        let looseIds = Set(loose.map(\.id))
        return [RoutineFolderGroup(folder: nil, routines: routines.filter { looseIds.contains($0.id) })] + sections
    }
}

// MARK: - The action

/// `POST /api/routines/folders`: one action on one bot's folders.
public enum RoutineFolderAction: Encodable, Sendable, Equatable {
    case create(botId: String, name: String)
    case rename(botId: String, from: String, to: String)
    /// Its routines go back to no folder; none is deleted.
    case delete(botId: String, name: String)
    case reorder(botId: String, order: [String])
    /// `folder` nil: out of any folder. A name the bot lacks is created.
    case move(botId: String, routineIds: [String], folder: String?)
    case sortByPrefix(botId: String)
    case restore(botId: String, undo: WidgetJSON)

    public var botId: String {
        switch self {
        case let .create(botId, _), let .rename(botId, _, _), let .delete(botId, _),
             let .reorder(botId, _), let .move(botId, _, _), let .sortByPrefix(botId),
             let .restore(botId, _):
            botId
        }
    }

    private enum CodingKeys: String, CodingKey { case action, botId, name, from, to, order, routineIds, folder, undo }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(botId, forKey: .botId)
        switch self {
        case let .create(_, name):
            try container.encode("create", forKey: .action)
            try container.encode(name, forKey: .name)
        case let .rename(_, from, to):
            try container.encode("rename", forKey: .action)
            try container.encode(from, forKey: .from)
            try container.encode(to, forKey: .to)
        case let .delete(_, name):
            try container.encode("delete", forKey: .action)
            try container.encode(name, forKey: .name)
        case let .reorder(_, order):
            try container.encode("reorder", forKey: .action)
            try container.encode(order, forKey: .order)
        case let .move(_, routineIds, folder):
            try container.encode("move", forKey: .action)
            try container.encode(routineIds, forKey: .routineIds)
            // null is meaningful: out of the folder
            if let folder { try container.encode(folder, forKey: .folder) } else { try container.encodeNil(forKey: .folder) }
        case .sortByPrefix:
            try container.encode("sort-by-prefix", forKey: .action)
        case let .restore(_, undo):
            try container.encode("restore", forKey: .action)
            try container.encode(undo, forKey: .undo)
        }
    }
}

/// The answer: the bot's folders in order, the routines the action changed,
/// and what Undo puts back (Sort by prefix only).
public struct RoutineFolderResult: Decodable, Sendable {
    public var folders: [String]
    public var routines: [Routine]
    public var undo: WidgetJSON?
}

/// The whole listing with the folder order of each bot.
public struct RoutineListing: Sendable {
    public var routines: [Routine]
    public var runs: [RoutineRun]
    /// `{ botId: [name] }`; empty from a server without folders.
    public var folders: [String: [String]]
    /// Whether the server has routine folders: a server with them always
    /// sends `folders`, one from before them never does (2026-10-28).
    public var foldersSupported: Bool

    public init(routines: [Routine], runs: [RoutineRun], folders: [String: [String]] = [:], foldersSupported: Bool = true) {
        self.routines = routines
        self.runs = runs
        self.folders = folders
        self.foldersSupported = foldersSupported
    }
}

// MARK: - Collapsed folders

/// Which folders a person folded, per bot, kept on this device.
public struct RoutineFolderCollapse {
    public static let storageKey = "sagax.routineFolders.collapsed.v1"
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    private var stored: [String: [String]] {
        defaults.dictionary(forKey: Self.storageKey) as? [String: [String]] ?? [:]
    }

    public func isCollapsed(botId: String, folder: String) -> Bool {
        stored[botId]?.contains(RoutineFolders.key(folder)) ?? false
    }

    public func setCollapsed(_ collapsed: Bool, botId: String, folder: String) {
        var all = stored
        var keys = Set(all[botId] ?? [])
        if collapsed { keys.insert(RoutineFolders.key(folder)) } else { keys.remove(RoutineFolders.key(folder)) }
        all[botId] = keys.isEmpty ? nil : keys.sorted()
        defaults.set(all, forKey: Self.storageKey)
    }

    /// A renamed folder keeps its fold.
    public func rename(botId: String, from: String, to: String) {
        guard isCollapsed(botId: botId, folder: from) else { return }
        setCollapsed(false, botId: botId, folder: from)
        setCollapsed(true, botId: botId, folder: to)
    }
}
