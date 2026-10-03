// Achievements (#106, matrix ST9): the person's points, level, streak and
// unlocks, as the desktop's Settings > Achievements draws them
// (src/components/achievements/AchievementsPage.tsx).
//
// The server keeps only each achievement's state (server/routes/achievements.ts,
// GET /api/me/achievements); the catalog (names, icons, points, rewards) is
// data the app carries (AchievementCatalog.swift, generated from
// shared/achievements-catalog.ts). Both gates pass the four routes: the
// sidecar's ALLOWED (D1) and the server's CLIENT_ALLOW, for the person only.
import Foundation

/// A text in the catalog's languages.
public struct AchievementText: Hashable, Sendable {
    public var en: String
    public var fr: String
    public var ptBR: String

    public init(en: String, fr: String, ptBR: String) {
        self.en = en
        self.fr = fr
        self.ptBR = ptBR
    }

    /// The text for a language code ("fr", "pt", "en" ...): English otherwise.
    public func resolved(_ languageCode: String?) -> String {
        switch languageCode?.lowercased() {
        case "fr"?: return fr
        case "pt"?: return ptBR
        default: return en
        }
    }
}

public enum AchievementCategory: String, CaseIterable, Hashable, Sendable {
    case onboarding, productivity, power, voice, collaboration, streaks, mastery, secrets
}

/// The rarity an achievement's points set (`rarityForPoints`).
public enum AchievementRarity: String, Hashable, Sendable {
    case common, rare, epic, legendary

    public init(points: Int) {
        if points >= 100 { self = .legendary } else if points >= 50 { self = .epic } else if points >= 20 { self = .rare } else { self = .common }
    }
}

public enum AchievementReward: Hashable, Sendable {
    case character(id: String, name: AchievementText)
    case skin(character: String, skin: String, name: AchievementText, characterName: AchievementText)
    case appIcon(id: String)
    case title(id: String, name: AchievementText)

    /// The reward as one string, as the server lists it in `rewards`.
    public var key: String {
        switch self {
        case let .character(id, _): return "character:\(id)"
        case let .skin(character, skin, _, _): return "skin:\(character):\(skin)"
        case let .appIcon(id): return "appIcon:\(id)"
        case let .title(id, _): return "title:\(id)"
        }
    }
}

public struct AchievementDefinition: Identifiable, Hashable, Sendable {
    public var id: String
    public var category: AchievementCategory
    /// The desktop's lucide icon name.
    public var icon: String
    public var points: Int
    /// A secret until unlocked.
    public var hidden: Bool
    public var name: AchievementText
    public var description: AchievementText
    public var hint: AchievementText?
    public var rewards: [AchievementReward]

    public init(id: String, category: AchievementCategory, icon: String, points: Int, hidden: Bool, name: AchievementText,
                description: AchievementText, hint: AchievementText?, rewards: [AchievementReward]) {
        self.id = id
        self.category = category
        self.icon = icon
        self.points = points
        self.hidden = hidden
        self.name = name
        self.description = description
        self.hint = hint
        self.rewards = rewards
    }

    public var rarity: AchievementRarity { AchievementRarity(points: points) }

    public static func lookup(_ id: String) -> AchievementDefinition? { catalogById[id] }
    private static let catalogById = Dictionary(catalog.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
}

// MARK: - Wire

public struct AchievementSettings: Codable, Hashable, Sendable {
    public var showPoints: Bool
    public var toasts: Bool
    public var native: Bool
    public var `public`: Bool
    public var title: String?
    public var tzOffset: Int?

    public init(showPoints: Bool = true, toasts: Bool = true, native: Bool = false, public: Bool = false, title: String? = nil, tzOffset: Int? = nil) {
        self.showPoints = showPoints
        self.toasts = toasts
        self.native = native
        self.public = `public`
        self.title = title
        self.tzOffset = tzOffset
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        showPoints = (try? c.decodeIfPresent(Bool.self, forKey: .showPoints)) ?? true
        toasts = (try? c.decodeIfPresent(Bool.self, forKey: .toasts)) ?? true
        native = (try? c.decodeIfPresent(Bool.self, forKey: .native)) ?? false
        `public` = (try? c.decodeIfPresent(Bool.self, forKey: .public)) ?? false
        title = try? c.decodeIfPresent(String.self, forKey: .title)
        tzOffset = try? c.decodeIfPresent(Int.self, forKey: .tzOffset)
    }
}

public struct AchievementItemState: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    /// Milliseconds since 1970, once unlocked.
    public var unlockedAt: Double?
    public var current: Int
    public var target: Int
    /// Share of the server's people who have it (5 people or more).
    public var percent: Int?

    public init(id: String, unlockedAt: Double? = nil, current: Int = 0, target: Int = 1, percent: Int? = nil) {
        self.id = id
        self.unlockedAt = unlockedAt
        self.current = current
        self.target = target
        self.percent = percent
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        unlockedAt = try? c.decodeIfPresent(Double.self, forKey: .unlockedAt)
        current = (try? c.decodeIfPresent(Int.self, forKey: .current)) ?? 0
        target = (try? c.decodeIfPresent(Int.self, forKey: .target)) ?? 1
        percent = try? c.decodeIfPresent(Int.self, forKey: .percent)
    }

    public var unlocked: Bool { unlockedAt != nil }
    /// The progress bar: locked, several steps, and one taken at least.
    public var showsProgress: Bool { !unlocked && target > 1 && current > 0 }
}

public struct AchievementLevel: Codable, Hashable, Sendable {
    public var level: Int
    public var from: Int
    public var to: Int

    public init(level: Int, from: Int, to: Int) {
        self.level = level
        self.from = from
        self.to = to
    }

    /// `levelFor` in shared/achievements.ts: a level starts at 25·(L−1)·L.
    public init(points: Int) {
        func start(_ level: Int) -> Int { 25 * (level - 1) * level }
        var level = 1
        while start(level + 1) <= points { level += 1 }
        self.init(level: level, from: start(level), to: start(level + 1))
    }

    /// The bar toward the next level, 0 to 1.
    public func progress(points: Int) -> Double {
        guard to > from else { return 1 }
        return min(1, max(0, Double(points - from) / Double(to - from)))
    }
}

public struct AchievementSnapshot: Codable, Hashable, Sendable {
    public var points: Int
    public var maxPoints: Int
    public var level: AchievementLevel
    public var unlockedCount: Int
    public var count: Int
    public var streak: Int
    public var rewards: [String]
    public var recent: [String]
    public var items: [AchievementItemState]
    public var settings: AchievementSettings

    public init(points: Int = 0, maxPoints: Int = 0, level: AchievementLevel? = nil, unlockedCount: Int = 0, count: Int = 0, streak: Int = 0,
                rewards: [String] = [], recent: [String] = [], items: [AchievementItemState] = [], settings: AchievementSettings = AchievementSettings()) {
        self.points = points
        self.maxPoints = maxPoints
        self.level = level ?? AchievementLevel(points: points)
        self.unlockedCount = unlockedCount
        self.count = count
        self.streak = streak
        self.rewards = rewards
        self.recent = recent
        self.items = items
        self.settings = settings
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        points = (try? c.decodeIfPresent(Int.self, forKey: .points)) ?? 0
        maxPoints = (try? c.decodeIfPresent(Int.self, forKey: .maxPoints)) ?? 0
        level = (try? c.decodeIfPresent(AchievementLevel.self, forKey: .level)) ?? AchievementLevel(points: points)
        unlockedCount = (try? c.decodeIfPresent(Int.self, forKey: .unlockedCount)) ?? 0
        count = (try? c.decodeIfPresent(Int.self, forKey: .count)) ?? 0
        streak = (try? c.decodeIfPresent(Int.self, forKey: .streak)) ?? 0
        rewards = (try? c.decodeIfPresent([String].self, forKey: .rewards)) ?? []
        recent = (try? c.decodeIfPresent([String].self, forKey: .recent)) ?? []
        items = (try? c.decodeIfPresent([AchievementItemState].self, forKey: .items)) ?? []
        settings = (try? c.decodeIfPresent(AchievementSettings.self, forKey: .settings)) ?? AchievementSettings()
    }

    public func state(_ id: String) -> AchievementItemState? { items.first { $0.id == id } }

    /// The titles this person unlocked, in catalog order (the Title picker).
    public var unlockedTitles: [(id: String, name: AchievementText)] {
        let owned = Set(rewards)
        return AchievementDefinition.catalog.flatMap(\.rewards).compactMap { reward in
            if case let .title(id, name) = reward, owned.contains(reward.key) { return (id, name) }
            return nil
        }
    }
}

public struct AchievementUnlock: Codable, Hashable, Sendable {
    public var id: String
    public var points: Int
    public var unlockedAt: Double?

    public init(id: String, points: Int, unlockedAt: Double? = nil) {
        self.id = id
        self.points = points
        self.unlockedAt = unlockedAt
    }
}

/// An event only the app can see (`CLIENT_EVENTS`).
public struct AchievementEvent: Encodable, Hashable, Sendable {
    public var type: String
    public var key: String?
    public var value: Double?

    public init(type: String, key: String? = nil, value: Double? = nil) {
        self.type = type
        self.key = key.map { String($0.prefix(80)) }
        self.value = value
    }

    public static let appOpened = AchievementEvent(type: "app.opened")
    public static let viewed = AchievementEvent(type: "achievements.viewed")
    public static let trombiSummoned = AchievementEvent(type: "trombi.summoned")
    public static let appIconChanged = AchievementEvent(type: "appicon.changed")
}

public struct AchievementEventsResult: Decodable, Hashable, Sendable {
    public var accepted: Int
    public var unlocked: [AchievementUnlock]
    public var snapshot: AchievementSnapshot?

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        accepted = (try? c.decodeIfPresent(Int.self, forKey: .accepted)) ?? 0
        unlocked = (try? c.decodeIfPresent([AchievementUnlock].self, forKey: .unlocked)) ?? []
        snapshot = try? c.decodeIfPresent(AchievementSnapshot.self, forKey: .snapshot)
    }

    private enum CodingKeys: String, CodingKey { case accepted, unlocked, snapshot }
}

/// A change of the four switches, the title or the time zone: only the
/// fields set are sent; `clearTitle` sends `title: null` ("No title").
public struct AchievementSettingsPatch: Encodable, Hashable, Sendable {
    public var showPoints: Bool?
    public var toasts: Bool?
    public var native: Bool?
    public var `public`: Bool?
    public var title: String?
    public var clearTitle = false
    public var tzOffset: Int?

    public init(showPoints: Bool? = nil, toasts: Bool? = nil, native: Bool? = nil, public: Bool? = nil, title: String? = nil, clearTitle: Bool = false, tzOffset: Int? = nil) {
        self.showPoints = showPoints
        self.toasts = toasts
        self.native = native
        self.public = `public`
        self.title = title
        self.clearTitle = clearTitle
        self.tzOffset = tzOffset
    }

    private enum Keys: String, CodingKey { case settings }
    private enum Fields: String, CodingKey { case showPoints, toasts, native, `public`, title, tzOffset }

    public func encode(to encoder: Encoder) throws {
        var outer = encoder.container(keyedBy: Keys.self)
        var c = outer.nestedContainer(keyedBy: Fields.self, forKey: .settings)
        try c.encodeIfPresent(showPoints, forKey: .showPoints)
        try c.encodeIfPresent(toasts, forKey: .toasts)
        try c.encodeIfPresent(native, forKey: .native)
        try c.encodeIfPresent(`public`, forKey: .public)
        if clearTitle { try c.encodeNil(forKey: .title) } else { try c.encodeIfPresent(title, forKey: .title) }
        try c.encodeIfPresent(tzOffset, forKey: .tzOffset)
    }

    /// The settings with this change applied: shown before the server answers.
    public func applied(to settings: AchievementSettings) -> AchievementSettings {
        var next = settings
        if let showPoints { next.showPoints = showPoints }
        if let toasts { next.toasts = toasts }
        if let native { next.native = native }
        if let value = `public` { next.public = value }
        if clearTitle { next.title = nil } else if let title { next.title = title }
        if let tzOffset { next.tzOffset = tzOffset }
        return next
    }
}

/// The page's two filters: a category tab and Show (all, unlocked, locked).
public enum AchievementFilter: String, CaseIterable, Hashable, Sendable {
    case all, unlocked, locked
}

public extension AchievementSnapshot {
    /// The cards of a tab and filter, in catalog order.
    func cards(category: AchievementCategory?, filter: AchievementFilter) -> [AchievementDefinition] {
        AchievementDefinition.catalog.filter { definition in
            if let category, definition.category != category { return false }
            let unlocked = state(definition.id)?.unlocked == true
            switch filter {
            case .all: return true
            case .unlocked: return unlocked
            case .locked: return !unlocked
            }
        }
    }
}

// MARK: - Client

public extension CompanionClient {
    /// `GET /api/me/achievements`. A 404 means this server keeps none.
    func achievements() async throws -> AchievementSnapshot {
        try await send(makeRequest("GET", "/api/me/achievements"), as: AchievementSnapshot.self)
    }

    /// `POST /api/me/achievements/events`, at most 32 events.
    func reportAchievements(_ events: [AchievementEvent]) async throws -> AchievementEventsResult {
        try await send(reportAchievementsRequest(events), as: AchievementEventsResult.self)
    }

    /// `PUT /api/me/achievements/settings`.
    func updateAchievementSettings(_ patch: AchievementSettingsPatch) async throws -> AchievementSettings {
        struct Answer: Decodable { var settings: AchievementSettings }
        return try await send(makeRequest("PUT", "/api/me/achievements/settings", encodedBody: patch), as: Answer.self).settings
    }

    func reportAchievementsRequest(_ events: [AchievementEvent]) throws -> URLRequest {
        struct Body: Encodable { var events: [AchievementEvent] }
        return try makeRequest("POST", "/api/me/achievements/events", encodedBody: Body(events: Array(events.prefix(32))))
    }

    func updateAchievementSettingsRequest(_ patch: AchievementSettingsPatch) throws -> URLRequest {
        try makeRequest("PUT", "/api/me/achievements/settings", encodedBody: patch)
    }
}
