// A bot's Claude Code plugins: the bot panel's Library > Plugins
// (`src/components/bot-settings/BotPluginsCard.tsx`, `src/lib/my-connections.ts`,
// server/routes/bot-plugins.ts). The owner (or a person who manages the bot)
// adds a marketplace and installs its plugins; everyone else who uses the
// bot reads the list. A server answers these routes; the companion sidecar
// (`companion/src/routes.ts`) does not list them, so a sidecar pairing never
// shows the Plugins view (`SurfaceFeature.botPlugins`).
import Foundation

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
