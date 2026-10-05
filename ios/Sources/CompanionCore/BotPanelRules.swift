import Foundation

// The smaller rules of the bot panel (WP7 of the iOS feature parity matrix):
// per-bot usage (BP14, `bot-settings/UsageSection.tsx` with
// `src/lib/usage.ts`), the Primary Bot (SB28, `src/lib/primary-bot.ts`),
// the read-only notice and proposal status (BP9, `src/lib/viewer.ts`,
// `bot-settings/ProposalStatus.tsx`), and the skin locks and rarities of the
// character editor (BP6, `shared/achievements.ts` and the skin tiers of
// `shared/mascot-look.ts` / `shared/mascot-skins.ts`).

// MARK: - Usage

/// What a bot has spent across its threads (`botUsage`).
public struct BotUsageTotal: Hashable, Sendable {
    public var input: Int
    public var output: Int
    /// Absent unless every thread with input reported its cache split.
    public var cachedInput: Int?
    /// nil until any thread reports a price.
    public var costUsd: Double?
    public var turns: Int

    public init(input: Int = 0, output: Int = 0, cachedInput: Int? = nil, costUsd: Double? = nil, turns: Int = 0) {
        self.input = input
        self.output = output
        self.cachedInput = cachedInput
        self.costUsd = costUsd
        self.turns = turns
    }

    /// `sumUsage` over the bot's threads.
    public static func of(_ bot: Bot) -> BotUsageTotal {
        sum((bot.tasks ?? []).map(\.usage))
    }

    public static func sum(_ items: [TaskUsage?]) -> BotUsageTotal {
        var out = BotUsageTotal()
        var cacheUnknown = false
        for case let usage? in items {
            out.input += usage.input
            out.output += usage.output
            out.turns += usage.turns
            if let cached = usage.cachedInput { out.cachedInput = (out.cachedInput ?? 0) + cached }
            if let cost = usage.costUsd, cost.isFinite { out.costUsd = (out.costUsd ?? 0) + cost }
            if usage.input > 0, usage.cachedInput == nil { cacheUnknown = true }
        }
        if cacheUnknown { out.cachedInput = nil }
        return out
    }

    /// Input served from the prompt cache, clamped to `input`.
    public var cached: Int { cachedInput.map { min(max(0, $0), input) } ?? 0 }

    /// The Tokens figure: fresh input plus output when the cache split is
    /// known, input plus output otherwise (`headlineTokens`).
    public var headlineTokens: Int {
        cachedInput != nil ? max(0, input - cached) + output : input + output
    }

    public var hasCost: Bool { costUsd.map(\.isFinite) ?? false }

    /// 950 -> "950", 12_400 -> "12.4k", 2_300_000 -> "2.3M" (`formatTokens`).
    public static func formatTokens(_ n: Int) -> String {
        if n < 1000 { return String(n) }
        func trim(_ x: Double) -> String {
            if x >= 100 { return String(Int(x.rounded())) }
            let text = String(format: "%.1f", x)
            return text.hasSuffix(".0") ? String(text.dropLast(2)) : text
        }
        if n < 1_000_000 { return "\(trim(Double(n) / 1000))k" }
        return "\(trim(Double(n) / 1_000_000))M"
    }

    /// Dollars, with enough precision that a cheap turn isn't "$0.00".
    public static func formatUsd(_ usd: Double) -> String {
        guard usd.isFinite else { return "" }
        if usd == 0 { return "$0" }
        if usd < 0.01 { return String(format: "$%.3f", usd) }
        return String(format: "$%.2f", usd)
    }
}

// MARK: - Primary Bot

public enum PrimaryBotRules {
    /// The viewer's id as the server knows it (`viewerActorId`): the
    /// principal, else the profile email, else "local-owner".
    public static func viewerId(config: ConfigStatus?) -> String {
        if let principal = config?.viewer?.principalId?.trimmingCharacters(in: .whitespaces), !principal.isEmpty {
            return principal.lowercased()
        }
        let email = config?.profile?.email.trimmingCharacters(in: .whitespaces).lowercased() ?? ""
        return email.isEmpty ? "local-owner" : email
    }

    /// A bot without a recorded owner (or "local-owner") is the operator's,
    /// the viewer on a personal server (`viewerOwnsBot`).
    public static func viewerOwns(_ bot: Bot, viewerId: String) -> Bool {
        let owner = bot.ownerUserId?.trimmingCharacters(in: .whitespaces).lowercased() ?? ""
        if owner.isEmpty || owner == "local-owner" { return true }
        return owner == viewerId.trimmingCharacters(in: .whitespaces).lowercased()
    }

    /// The star is the viewer's own Primary Bot only.
    public static func isViewersPrimary(_ bot: Bot, viewerId: String) -> Bool {
        bot.chiefOfStaff == true && viewerOwns(bot, viewerId: viewerId)
    }

    /// What the bot's menu offers (Sidebar.tsx `primaryItem`): the Primary
    /// Bot offers to hand the role over, the viewer's other bots to take it,
    /// someone else's bot neither.
    public enum MenuAction: Hashable, Sendable { case replace, make }

    public static func menuAction(for bot: Bot, viewerId: String) -> MenuAction? {
        if isViewersPrimary(bot, viewerId: viewerId) { return .replace }
        if viewerOwns(bot, viewerId: viewerId), bot.hidden != true { return .make }
        return nil
    }

    /// The viewer's own visible bots they may choose, not the current one,
    /// matching the search, by name (`primaryBotChoices`).
    public static func choices(_ bots: [Bot], viewerId: String, currentId: String?, query: String = "") -> [Bot] {
        let wanted = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return bots
            .filter { $0.hidden != true && $0.id != currentId && viewerOwns($0, viewerId: viewerId) }
            .filter { wanted.isEmpty || "\($0.name) \($0.title)".lowercased().contains(wanted) }
            .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    /// The fleet after the server handed the role over: the same person's
    /// other bots give it up (`withPrimaryBot`).
    public static func withPrimary(_ bots: [Bot], primary: Bot) -> [Bot] {
        let owner = primary.ownerUserId?.trimmingCharacters(in: .whitespaces).lowercased() ?? ""
        return bots.map { bot in
            var next = bot
            if bot.id == primary.id { return primary }
            let botOwner = bot.ownerUserId?.trimmingCharacters(in: .whitespaces).lowercased() ?? ""
            if bot.chiefOfStaff == true, botOwner == owner { next.chiefOfStaff = false }
            return next
        }
    }
}

// MARK: - Read-only notice and proposals

public enum BotPanelNotices {
    /// "Your administrator lets you use shared bots only" (`viewerBotsReadOnly`).
    public static func botsReadOnly(_ config: ConfigStatus?) -> Bool { config?.viewer?.botsReadOnly == true }

    /// A Chief covers this bot when it leads the bot's section or manages it
    /// (`chiefCovers`): then the Primary Bot can propose changes to it.
    public static func chiefCovers(_ bot: Bot, in bots: [Bot]) -> Bool {
        func key(_ section: String?) -> String { (section ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
        let target = key(bot.section)
        return bots.contains { candidate in
            candidate.id != bot.id && candidate.chiefOfStaff == true
                && (key(candidate.section) == target || (candidate.managedSections ?? []).contains { key($0) == target })
        }
    }
}

// MARK: - Skin locks

/// A skin's rarity (`SkinTier`).
public enum SkinTier: String, CaseIterable, Hashable, Sendable {
    case common, rare, epic, legendary
}

/// What the person may wear (`Unlocks`): nothing is locked on a server
/// without achievements.
public struct MascotUnlocks: Hashable, Sendable {
    public var enforced: Bool
    public var keys: Set<String>

    public init(enforced: Bool, keys: Set<String> = []) {
        self.enforced = enforced
        self.keys = keys
    }

    public static let nothingLocked = MascotUnlocks(enforced: false)

    /// The character every person has (`DEFAULT_CHARACTERS`): the owl.
    public static let defaultCharacters: Set<MascotCharacter> = [.owl]

    public func characterUnlocked(_ character: MascotCharacter) -> Bool {
        !enforced || Self.defaultCharacters.contains(character) || keys.contains("character:\(character.rawValue)")
    }

    /// Earned or grandfathered, or Common on an unlocked character.
    public func skinUnlocked(_ character: MascotCharacter, skin: String) -> Bool {
        guard enforced else { return true }
        if keys.contains("skin:\(character.rawValue):\(skin)") { return true }
        return Self.tier(character, skin: skin) == .common && characterUnlocked(character)
    }

    /// The editor's lock: what the bot wears now always stays usable.
    public func characterLocked(_ character: MascotCharacter, current: MascotCharacter) -> Bool {
        character != current && !characterUnlocked(character)
    }

    public func skinLocked(_ character: MascotCharacter, skin: String, current: String) -> Bool {
        skin != current && !skinUnlocked(character, skin: skin)
    }

    public static func tier(_ character: MascotCharacter, skin: String) -> SkinTier {
        switch character {
        case .owl:
            switch skin {
            case "gold", "frost": return .rare
            case "neon", "lightning", "chrome": return .epic
            case "inferno", "holo", "galaxy", "spirit": return .legendary
            default: return .common
            }
        case .shape:
            switch skin {
            case "outline", "gold": return .rare
            case "neon", "chrome", "crystal", "circuit": return .epic
            case "holo", "molten", "galaxy": return .legendary
            default: return .common
            }
        case .trombi:
            switch skin {
            case "gold": return .rare
            case "neon", "chrome", "glitch": return .epic
            case "holo", "molten": return .legendary
            default: return .common
            }
        }
    }
}

/// GET /api/me/achievements, the part the editor reads.
struct AchievementRewards: Decodable {
    var rewards: [String]?
}

public extension CompanionClient {
    /// What the person unlocked (`loadAchievements`): a server without
    /// achievements answers 404, and then nothing is locked.
    func mascotUnlocks() async throws -> MascotUnlocks {
        do {
            let snapshot = try await send(makeRequest("GET", "/api/me/achievements"), as: AchievementRewards.self)
            return MascotUnlocks(enforced: true, keys: Set(snapshot.rewards ?? []))
        } catch let APIError.status(code, _) where code == 404 {
            return .nothingLocked
        }
    }

    /// `POST /api/bots/:id/primary`: the server hands the role over from
    /// the previous Primary Bot and answers with this bot.
    func makePrimaryBot(botId: String) async throws -> Bot {
        try await send(makePrimaryBotRequest(botId: botId), as: BotResponse.self).bot
    }

    func makePrimaryBotRequest(botId: String) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try makeRequest("POST", "/api/bots/\(botId)/primary")
    }
}
