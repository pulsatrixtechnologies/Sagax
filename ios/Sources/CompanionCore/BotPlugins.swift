import Foundation

// The bot panel's Library > Plugins (`bot-settings/BotPluginsCard.tsx`,
// server/routes/bot-plugins.ts): Claude Code plugins on one bot. The owner,
// or a person who manages the bot, adds a marketplace and installs its
// plugins; everyone else reads the list (`canChange`). The companion
// sidecar has no such route.

/// The panel's Library views (`LibraryTab.tsx` `LIBRARY_VIEWS`).
public enum BotLibraryView: String, CaseIterable, Hashable, Sendable {
    case files, skills, plugins

    /// The views this pairing reaches, in the desktop's order: Skills reads
    /// the bot's skills route (the advanced panel's), Plugins a server route
    /// the sidecar does not forward.
    public static func visible(gate: SurfaceGate) -> [BotLibraryView] {
        var out: [BotLibraryView] = [.files]
        if gate.allows(.advancedBotPanel) { out.append(.skills) }
        if gate.scope != .sidecar { out.append(.plugins) }
        return out
    }
}

public struct BotPluginMarketplace: Decodable, Hashable, Identifiable, Sendable {
    public struct Plugin: Decodable, Hashable, Identifiable, Sendable {
        public var name: String
        public var description: String?
        public var version: String?
        public var installed: Bool
        public var id: String { name }

        private enum CodingKeys: String, CodingKey { case name, description, version, installed }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = try c.decode(String.self, forKey: .name)
            description = try? c.decode(String.self, forKey: .description)
            version = try? c.decode(String.self, forKey: .version)
            installed = (try? c.decode(Bool.self, forKey: .installed)) ?? false
        }
    }

    public var name: String
    public var source: String
    public var description: String?
    public var plugins: [Plugin]
    public var id: String { name }

    private enum CodingKeys: String, CodingKey { case name, source, description, plugins }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        source = (try? c.decode(String.self, forKey: .source)) ?? ""
        description = try? c.decode(String.self, forKey: .description)
        plugins = (try? c.decode([Plugin].self, forKey: .plugins)) ?? []
    }
}

public struct BotInstalledPlugin: Decodable, Hashable, Identifiable, Sendable {
    public var key: String
    public var name: String
    public var marketplace: String
    public var description: String?
    public var version: String?
    public var enabled: Bool
    public var id: String { key }

    private enum CodingKeys: String, CodingKey { case key, name, marketplace, description, version, enabled }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(String.self, forKey: .key)
        name = (try? c.decode(String.self, forKey: .name)) ?? key
        marketplace = (try? c.decode(String.self, forKey: .marketplace)) ?? ""
        description = try? c.decode(String.self, forKey: .description)
        version = try? c.decode(String.self, forKey: .version)
        enabled = (try? c.decode(Bool.self, forKey: .enabled)) ?? false
    }
}

/// `BotPluginsView`: what GET and every write answer.
public struct BotPluginsListing: Decodable, Hashable, Sendable {
    public var marketplaces: [BotPluginMarketplace]
    public var plugins: [BotInstalledPlugin]
    public var canChange: Bool
    public var managedByAdmin: Bool
    /// The bot's engine loads plugins (Claude Code); others keep them unused.
    public var loadsPlugins: Bool

    private struct Engine: Decodable { var loadsPlugins: Bool? }
    private enum CodingKeys: String, CodingKey { case marketplaces, plugins, canChange, managedByAdmin, engine }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        marketplaces = (try? c.decode([BotPluginMarketplace].self, forKey: .marketplaces)) ?? []
        plugins = (try? c.decode([BotInstalledPlugin].self, forKey: .plugins)) ?? []
        canChange = (try? c.decode(Bool.self, forKey: .canChange)) ?? false
        managedByAdmin = (try? c.decode(Bool.self, forKey: .managedByAdmin)) ?? false
        loadsPlugins = (try? c.decode(Engine.self, forKey: .engine))?.loadsPlugins ?? true
    }
}

public extension CompanionClient {
    private func pluginsPath(_ botId: String, _ rest: String = "") throws -> String {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return "/api/bots/\(botId)/plugins\(rest)"
    }

    /// One path segment (`makeRequest` encodes it): a key or a name that
    /// would leave its segment is refused.
    private static func segment(_ value: String) throws -> String {
        guard !value.isEmpty, value != ".", value != "..", value.rangeOfCharacter(from: CharacterSet(charactersIn: "/?#\\")) == nil
        else { throw APIError.badURL }
        return value
    }

    func botPlugins(botId: String) async throws -> BotPluginsListing {
        try await send(makeRequest("GET", pluginsPath(botId)), as: BotPluginsListing.self)
    }

    func botPluginRequest(botId: String, key: String, enabled: Bool?) throws -> URLRequest {
        let path = try pluginsPath(botId, "/\(Self.segment(key))")
        if let enabled { return try makeRequest("PATCH", path, body: ["enabled": enabled]) }
        return try makeRequest("DELETE", path)
    }

    /// `PATCH /api/bots/:id/plugins/:key` (on, off) or DELETE (uninstall).
    func setBotPlugin(botId: String, key: String, enabled: Bool?) async throws -> BotPluginsListing {
        try await send(botPluginRequest(botId: botId, key: key, enabled: enabled), as: BotPluginsListing.self)
    }

    func installBotPluginRequest(botId: String, marketplace: String, plugin: String) throws -> URLRequest {
        var request = try makeRequest("POST", pluginsPath(botId, "/install"), body: ["marketplace": marketplace, "plugin": plugin])
        request.timeoutInterval = 180
        return request
    }

    func installBotPlugin(botId: String, marketplace: String, plugin: String) async throws -> BotPluginsListing {
        try await send(installBotPluginRequest(botId: botId, marketplace: marketplace, plugin: plugin), as: BotPluginsListing.self)
    }

    func addBotPluginMarketplaceRequest(botId: String, source: String) throws -> URLRequest {
        var request = try makeRequest("POST", pluginsPath(botId, "/marketplaces"), body: ["source": source])
        request.timeoutInterval = 180
        return request
    }

    func addBotPluginMarketplace(botId: String, source: String) async throws -> BotPluginsListing {
        try await send(addBotPluginMarketplaceRequest(botId: botId, source: source), as: BotPluginsListing.self)
    }

    func removeBotPluginMarketplace(botId: String, name: String) async throws -> BotPluginsListing {
        try await send(makeRequest("DELETE", pluginsPath(botId, "/marketplaces/\(Self.segment(name))")), as: BotPluginsListing.self)
    }
}

// The iPad Library reads BotPluginsView. The phone Library above reads
// BotPluginsListing. botPlugins and installBotPlugin are overloaded on
// the return type so each screen keeps its decoder.

// A bot's Claude Code plugins: the bot panel's Library > Plugins
// (`src/components/bot-settings/BotPluginsCard.tsx`, `src/lib/my-connections.ts`,
// server/routes/bot-plugins.ts). The owner (or a person who manages the bot)
// adds a marketplace and installs its plugins; everyone else who uses the
// bot reads the list. A server answers these routes; the companion sidecar
// (`companion/src/routes.ts`) does not list them, so a sidecar pairing never
// shows the Plugins view (`SurfaceFeature.botPlugins`).

public struct BotPluginsView: Codable, Equatable, Sendable {
    public struct Listing: Codable, Equatable, Sendable, Identifiable {
        public struct Plugin: Codable, Equatable, Sendable, Identifiable {
            public var name: String
            public var description: String?
            public var version: String?
            public var category: String?
            public var installed: Bool
            public var external: Bool?
            public var id: String { name }
        }

        public var name: String
        public var source: String
        public var description: String?
        public var plugins: [Plugin]
        public var id: String { name }
    }

    public struct Installed: Codable, Equatable, Sendable, Identifiable {
        public var key: String
        public var name: String
        public var marketplace: String
        public var description: String?
        public var version: String?
        public var enabled: Bool
        public var removed: [String]
        public var declaredMcpServers: [String]
        public var id: String { key }

        public init(key: String, name: String, marketplace: String, description: String? = nil, version: String? = nil,
                    enabled: Bool, removed: [String] = [], declaredMcpServers: [String] = []) {
            self.key = key; self.name = name; self.marketplace = marketplace; self.description = description
            self.version = version; self.enabled = enabled; self.removed = removed; self.declaredMcpServers = declaredMcpServers
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            key = try c.decode(String.self, forKey: .key)
            name = try c.decode(String.self, forKey: .name)
            marketplace = try c.decode(String.self, forKey: .marketplace)
            description = try c.decodeIfPresent(String.self, forKey: .description)
            version = try c.decodeIfPresent(String.self, forKey: .version)
            enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
            removed = try c.decodeIfPresent([String].self, forKey: .removed) ?? []
            declaredMcpServers = try c.decodeIfPresent([String].self, forKey: .declaredMcpServers) ?? []
        }
    }

    /// `{ mode: "any" }` or `{ mode: "list", allow: [...] }`: the marketplaces
    /// the organization allows (Settings > Organization > allowed marketplaces).
    public struct Policy: Codable, Equatable, Sendable {
        public var mode: String
        public var allow: [String]?
        public var isList: Bool { mode == "list" }
    }

    public struct Engine: Codable, Equatable, Sendable {
        public var loadsPlugins: Bool
    }

    public var marketplaces: [Listing]
    public var plugins: [Installed]
    public var policy: Policy
    public var engine: Engine
    public var canChange: Bool
    public var managedByAdmin: Bool?
}

public enum BotPluginRules {
    /// A plugin's key is `name@marketplace` (bot-plugins.ts `ROUTE`).
    public static func validKey(_ key: String) -> Bool {
        let parts = key.split(separator: "@", omittingEmptySubsequences: false)
        return parts.count == 2 && parts.allSatisfy { validName(String($0)) }
    }

    /// A marketplace or plugin name: `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`.
    public static func validName(_ name: String) -> Bool {
        let bytes = Array(name.utf8)
        guard (1...64).contains(bytes.count) else { return false }
        func alnum(_ b: UInt8) -> Bool { (48...57).contains(b) || (65...90).contains(b) || (97...122).contains(b) }
        return alnum(bytes[0]) && bytes.dropFirst().allSatisfy { alnum($0) || $0 == 46 || $0 == 95 || $0 == 45 }
    }
}

public extension CompanionClient {
    /// `GET /api/bots/:id/plugins`.
    func botPlugins(botId: String) async throws -> BotPluginsView {
        try await send(botPluginsRequest("GET", botId: botId), as: BotPluginsView.self)
    }

    /// `POST /api/bots/:id/plugins/marketplaces {source}`: owner/repo or an https git address.
    func addPluginMarketplace(botId: String, source: String) async throws -> BotPluginsView {
        let trimmed = source.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw APIError.badURL }
        return try await send(botPluginsRequest("POST", botId: botId, tail: "/marketplaces", body: ["source": trimmed], slow: true), as: BotPluginsView.self)
    }

    /// `POST /api/bots/:id/plugins/marketplaces/:name/update`.
    func updatePluginMarketplace(botId: String, name: String) async throws -> BotPluginsView {
        guard BotPluginRules.validName(name) else { throw APIError.badURL }
        return try await send(botPluginsRequest("POST", botId: botId, tail: "/marketplaces/\(name)/update", slow: true), as: BotPluginsView.self)
    }

    /// `DELETE /api/bots/:id/plugins/marketplaces/:name`, with its plugins.
    func removePluginMarketplace(botId: String, name: String) async throws -> BotPluginsView {
        guard BotPluginRules.validName(name) else { throw APIError.badURL }
        return try await send(botPluginsRequest("DELETE", botId: botId, tail: "/marketplaces/\(name)"), as: BotPluginsView.self)
    }

    /// `POST /api/bots/:id/plugins/install {marketplace, plugin}`: install or update.
    func installBotPlugin(botId: String, marketplace: String, plugin: String) async throws -> BotPluginsView {
        guard BotPluginRules.validName(marketplace), BotPluginRules.validName(plugin) else { throw APIError.badURL }
        return try await send(botPluginsRequest("POST", botId: botId, tail: "/install", body: ["marketplace": marketplace, "plugin": plugin], slow: true), as: BotPluginsView.self)
    }

    /// `PATCH /api/bots/:id/plugins/:key {enabled}`.
    func setBotPluginEnabled(botId: String, key: String, enabled: Bool) async throws -> BotPluginsView {
        guard BotPluginRules.validKey(key) else { throw APIError.badURL }
        return try await send(botPluginsRequest("PATCH", botId: botId, tail: "/\(key)", body: ["enabled": enabled]), as: BotPluginsView.self)
    }

    /// `DELETE /api/bots/:id/plugins/:key`.
    func uninstallBotPlugin(botId: String, key: String) async throws -> BotPluginsView {
        guard BotPluginRules.validKey(key) else { throw APIError.badURL }
        return try await send(botPluginsRequest("DELETE", botId: botId, tail: "/\(key)"), as: BotPluginsView.self)
    }

    /// The request (tested without a network). Installing clones a
    /// repository: the desktop waits three minutes.
    func botPluginsRequest(_ method: String, botId: String, tail: String = "", body: [String: Any]? = nil, slow: Bool = false) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        var request = try makeRequest(method, "/api/bots/\(botId)/plugins\(tail)", body: body)
        if slow { request.timeoutInterval = 180 }
        return request
    }
}

// MARK: - Backup models (bot-settings/ModelSection.tsx FallbackChain)

public enum BotFallbackRules {
    public static let limit = 5

    /// The engines that can be added: available, with a default model, not
    /// the bot's own engine and not already in the list.
    public static func candidates(_ instances: [Instance], bot: Bot) -> [Instance] {
        let chain = bot.fallback ?? []
        return instances.filter { instance in
            instance.snapshot.state == "available"
                && !instance.models.default.trimmingCharacters(in: .whitespaces).isEmpty
                && instance.instanceId != bot.modelSelection.instanceId
                && !chain.contains { $0.instanceId == instance.instanceId }
        }
    }

    /// The list with this engine's default model appended (unchanged at the limit).
    public static func adding(_ instance: Instance, to chain: [ModelSelection]) -> [ModelSelection] {
        guard chain.count < limit, !chain.contains(where: { $0.instanceId == instance.instanceId }) else { return chain }
        return chain + [ModelSelection(instanceId: instance.instanceId, model: instance.models.default)]
    }
}

public extension CompanionClient {
    /// `PATCH /api/bots/:id {fallback}`: an admin session only (the sidecar's
    /// companion fields and a client session's refuse it).
    func setBotFallback(botId: String, fallback: [ModelSelection]) async throws -> Bot {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        struct Body: Encodable { var fallback: [ModelSelection] }
        return try await send(makeRequest("PATCH", "/api/bots/\(botId)", encodedBody: Body(fallback: fallback)), as: BotResponse.self).bot
    }
}

// MARK: - Sending on your behalf (bot-settings/PermissionsSection.tsx OutboundControl)

public extension CompanionClient {
    /// `PATCH /api/bots/:id {outbound}`: an admin session's field.
    func setBotOutbound(botId: String, outbound: OutboundPolicy) async throws -> Bot {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        struct Body: Encodable { var outbound: OutboundPolicy }
        return try await send(makeRequest("PATCH", "/api/bots/\(botId)", encodedBody: Body(outbound: outbound)), as: BotResponse.self).bot
    }

    /// `GET /api/bots/:id/outbound`: how many sends went out today.
    func botOutboundToday(botId: String) async throws -> Int? {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        struct Answer: Decodable { var today: Int? }
        return try await send(makeRequest("GET", "/api/bots/\(botId)/outbound"), as: Answer.self).today
    }
}
