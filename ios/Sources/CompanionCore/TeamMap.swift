// The Team map (matrix TM1, TM2), as the desktop's TeamMapPage.tsx draws it
// from src/lib/team-map.ts and src/lib/team-canvas.ts: every visible bot by
// team, the team's chiefs ahead of its members, and the handoffs between
// bots from `GET /api/team-map` (both gates pass it).
//
// Arranging a bot inside its own team is personal presentation, kept on
// this device per workspace (`omb-team-canvas:<environment>:bot-order` on
// the desktop); moving it to another team changes its home team through
// `POST /api/sidebar-sections`, which the remote client never offers.
import Foundation

// MARK: - GET /api/team-map

public struct TeamMapSnapshot: Decodable, Hashable, Sendable {
    public struct Collaboration: Decodable, Hashable, Sendable {
        public var groupId: String
        public var botIds: [String]
        public var lastAt: Double
    }

    public struct Queued: Decodable, Hashable, Sendable {
        public var sourceBotId: String
        public var targetBotId: String
        public var reason: String?
    }

    public struct Running: Decodable, Hashable, Sendable {
        public var sourceBotId: String
        public var targetBotId: String
        public var threadId: String?
        public var groupId: String?
    }

    public var collaborations: [Collaboration]
    public var queued: [Queued]
    public var running: [Running]

    public init(collaborations: [Collaboration] = [], queued: [Queued] = [], running: [Running] = []) {
        self.collaborations = collaborations
        self.queued = queued
        self.running = running
    }

    private enum CodingKeys: String, CodingKey { case collaborations, queued, running }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        collaborations = (try? values.decodeIfPresent([Lossy<Collaboration>].self, forKey: .collaborations))?.compactMap(\.value) ?? []
        queued = (try? values.decodeIfPresent([Lossy<Queued>].self, forKey: .queued))?.compactMap(\.value) ?? []
        running = (try? values.decodeIfPresent([Lossy<Running>].self, forKey: .running))?.compactMap(\.value) ?? []
    }

    public static let empty = TeamMapSnapshot()
}

public extension CompanionClient {
    func teamMapRequest() throws -> URLRequest {
        try makeRequest("GET", "/api/team-map")
    }

    func teamMap() async throws -> TeamMapSnapshot {
        try await send(teamMapRequest(), as: TeamMapSnapshot.self)
    }
}

// MARK: - Teams (buildTeamMapSections)

public struct TeamMapSection: Hashable, Sendable, Identifiable {
    /// The exact persisted section; "" is the unsectioned team.
    public var key: String
    /// "General" for the unsectioned team.
    public var name: String
    public var chiefs: [Bot]
    public var members: [Bot]

    public var id: String { key }
    public var count: Int { chiefs.count + members.count }
}

public enum TeamMap {
    /// The desktop's name for the unsectioned team.
    public static let generalName = "General"

    private static func trim(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// `buildTeamMapSections`: a team per section a visible bot is in, in
    /// the order the bots come, then the named sections no bot is in yet.
    public static func sections(bots: [Bot], names: [String] = [], general: Bool = false) -> [TeamMapSection] {
        var order: [String] = []
        var members: [String: [Bot]] = [:]
        if general { order.append(""); members[""] = [] }
        for bot in bots where bot.hidden != true {
            let key = trim(bot.section ?? "")
            if members[key] == nil { order.append(key) }
            members[key, default: []].append(bot)
        }
        for name in names {
            let key = trim(name)
            if !key.isEmpty, members[key] == nil { order.append(key); members[key] = [] }
        }
        return order.map { key in
            let list = members[key] ?? []
            return TeamMapSection(
                key: key,
                name: key.isEmpty ? generalName : key,
                chiefs: list.filter { $0.chiefOfStaff == true },
                members: list.filter { $0.chiefOfStaff != true }
            )
        }
    }

    /// TeamMapPage's teams: the visible bots, the server's sections and the
    /// rooms' sections, General first, then the server's order.
    public static func pageSections(state: CompanionState) -> [TeamMapSection] {
        var names: [String] = []
        for name in state.sectionOrder + state.rooms.compactMap(\.section) where !name.isEmpty && !names.contains(name) {
            names.append(name)
        }
        func rank(_ key: String) -> Int { key.isEmpty ? -1 : names.firstIndex(of: key) ?? names.count }
        let built = sections(bots: state.bots.filter { $0.hidden != true }, names: names)
        // a stable sort, as Array.prototype.sort is
        return built.enumerated().sorted { left, right in
            let l = rank(left.element.key), r = rank(right.element.key)
            return l == r ? left.offset < right.offset : l < r
        }.map(\.element)
    }

    /// The team a bot belongs to: its trimmed section, "" for General.
    public static func teamKey(of bot: Bot) -> String { trim(bot.section ?? "") }
}

// MARK: - Handoffs (buildTeamMapEdges)

public struct TeamMapEdge: Hashable, Sendable, Identifiable {
    public enum State: String, Sendable { case running, queued, connected }

    public var sourceBotId: String
    public var targetBotId: String
    public var state: State
    public var reason: String?
    public var groupId: String?
    public var lastAt: Double?

    public var id: String { "\(sourceBotId):\(targetBotId)" }
}

public extension TeamMap {
    /// One edge per pair of visible bots: a running handoff outranks a
    /// queued one, which outranks the connection an earlier conversation
    /// left. Running first, then queued, then the most recent.
    static func edges(bots: [Bot], snapshot: TeamMapSnapshot) -> [TeamMapEdge] {
        let visible = Set(bots.filter { $0.hidden != true }.map(\.id))
        var order: [String] = []
        var edges: [String: TeamMapEdge] = [:]
        func key(_ a: String, _ b: String) -> String { [a, b].sorted().joined(separator: ":") }
        func set(_ edge: TeamMapEdge) {
            let k = key(edge.sourceBotId, edge.targetBotId)
            if edges[k] == nil { order.append(k) }
            edges[k] = edge
        }
        for collaboration in snapshot.collaborations where collaboration.botIds.count >= 2 {
            let source = collaboration.botIds[0], target = collaboration.botIds[1]
            guard visible.contains(source), visible.contains(target) else { continue }
            set(TeamMapEdge(sourceBotId: source, targetBotId: target, state: .connected, groupId: collaboration.groupId, lastAt: collaboration.lastAt))
        }
        for delegation in snapshot.queued where visible.contains(delegation.sourceBotId) && visible.contains(delegation.targetBotId) {
            set(TeamMapEdge(sourceBotId: delegation.sourceBotId, targetBotId: delegation.targetBotId, state: .queued, reason: delegation.reason))
        }
        for delegation in snapshot.running where visible.contains(delegation.sourceBotId) && visible.contains(delegation.targetBotId) {
            set(TeamMapEdge(sourceBotId: delegation.sourceBotId, targetBotId: delegation.targetBotId, state: .running, groupId: delegation.groupId))
        }
        func priority(_ state: TeamMapEdge.State) -> Int {
            switch state { case .running: 0; case .queued: 1; case .connected: 2 }
        }
        return order.compactMap { edges[$0] }.enumerated().sorted { left, right in
            let a = left.element, b = right.element
            if priority(a.state) != priority(b.state) { return priority(a.state) < priority(b.state) }
            if (a.lastAt ?? 0) != (b.lastAt ?? 0) { return (a.lastAt ?? 0) > (b.lastAt ?? 0) }
            return left.offset < right.offset
        }.map(\.element)
    }
}

// MARK: - A bot's status line (teamMapStatus)

public struct TeamMapStatus: Hashable, Sendable {
    public enum Tone: String, Sendable { case success, warning, danger, idle }
    /// "Waiting for you", "No signal", "Working" or "Ready".
    public var label: String
    public var tone: Tone
}

public extension TeamMap {
    static func status(_ bot: Bot) -> TeamMapStatus {
        if bot.activity == "waiting-on-you" { return TeamMapStatus(label: "Waiting for you", tone: .warning) }
        if bot.activity == "dead" || bot.activity == "no-signal" { return TeamMapStatus(label: "No signal", tone: .danger) }
        if bot.busy == true || bot.activity == "working" { return TeamMapStatus(label: "Working", tone: .success) }
        return TeamMapStatus(label: "Ready", tone: .idle)
    }
}

// MARK: - Personal order inside a team (team-canvas.ts)

public extension TeamMap {
    /// `orderBots`: the person's order first, the rest as they come.
    static func ordered(_ bots: [Bot], order: [String]) -> [Bot] {
        var rank: [String: Int] = [:]
        for (index, id) in order.enumerated() where rank[id] == nil { rank[id] = index }
        return bots.enumerated().sorted { left, right in
            let l = rank[left.element.id] ?? Int.max, r = rank[right.element.id] ?? Int.max
            return l == r ? left.offset < right.offset : l < r
        }.map(\.element)
    }

    /// `reorderBot`: the lane's ids with `botId` at `index` among the others.
    static func reorder(_ ids: [String], botId: String, to index: Int) -> [String] {
        guard ids.contains(botId) else { return ids }
        var remaining = ids.filter { $0 != botId }
        remaining.insert(botId, at: max(0, min(remaining.count, index)))
        return remaining
    }

    /// `arrangeBot` (Alt+arrow on the desktop): the team's saved order after
    /// moving `bot` one place up (-1) or down (+1) in its lane (chiefs or
    /// members); nil when it is already at that end or not on the map.
    static func arrange(_ bot: Bot, by delta: Int, in sections: [TeamMapSection], orders: [String: [String]]) -> [String]? {
        let key = teamKey(of: bot)
        guard let section = sections.first(where: { $0.key == key }) else { return nil }
        let saved = orders[key] ?? []
        let chief = bot.chiefOfStaff == true
        let lane = ordered(chief ? section.chiefs : section.members, order: saved)
        guard let index = lane.firstIndex(where: { $0.id == bot.id }) else { return nil }
        let destination = index + delta
        guard destination >= 0, destination < lane.count else { return nil }
        let other = ordered(chief ? section.members : section.chiefs, order: saved).map(\.id)
        return reorder(lane.map(\.id), botId: bot.id, to: destination) + other
    }

    /// `parseBotOrders`: a saved record, read defensively.
    static func parseOrders(_ raw: String?) -> [String: [String]] {
        guard let data = raw?.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        var out: [String: [String]] = [:]
        for (key, value) in object {
            guard let list = value as? [Any] else { continue }
            var seen = Set<String>()
            out[key] = list.compactMap { $0 as? String }.filter { !$0.isEmpty && seen.insert($0).inserted }
        }
        return out
    }

    static func encodeOrders(_ orders: [String: [String]]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: orders, options: [.sortedKeys]) else { return "{}" }
        return String(decoding: data, as: UTF8.self)
    }

    /// Where a workspace's order is kept on this device.
    static func ordersKey(workspace: String) -> String { "omb-team-canvas:\(workspace):bot-order" }
}
