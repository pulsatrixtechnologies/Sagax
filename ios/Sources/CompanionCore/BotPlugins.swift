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
