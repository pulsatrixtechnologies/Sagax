// Connect apps > Manage > Installed on the phone (2026-10-26): one line per
// thing the person has, a port of the desktop's src/lib/installed-model.ts.
// An MCP server added by hand, the same address brought again by a
// marketplace plugin ("github" and "github-github") and the plugin itself
// fold into one entry named for people ("GitHub").
import Foundation

public struct InstalledBrings: Hashable, Sendable {
    /// a catalog app (a server at a catalog listing's address)
    public var app: Bool
    /// the marketplace of the plugin that brought it
    public var plugin: String?
    /// distinct MCP servers, by address
    public var connectors: Int
    public var skills: Int

    public init(app: Bool = false, plugin: String? = nil, connectors: Int = 0, skills: Int = 0) {
        self.app = app; self.plugin = plugin; self.connectors = connectors; self.skills = skills
    }
}

public struct InstalledEntry: Hashable, Sendable, Identifiable {
    public var key: String
    public var name: String
    public var logo: String?
    public var domain: String?
    /// the row the entry's page opens: the plugin, else the first server
    public var primary: ConnectAppItem
    public var members: [ConnectAppItem]
    public var brings: InstalledBrings
    public var status: ConnectAppStatus
    /// the MCP server names of the entry
    public var servers: [String]
    public var id: String { key }
}

extension ConnectApps {
    private static let displayNames: [String: String] = [
        "github": "GitHub", "gitlab": "GitLab", "gmail": "Gmail", "googledrive": "Google Drive",
        "googlecalendar": "Google Calendar", "googledocs": "Google Docs", "googlesheets": "Google Sheets",
        "microsoft365": "Microsoft 365", "onedrive": "OneDrive", "sharepoint": "SharePoint",
        "hubspot": "HubSpot", "youtube": "YouTube", "linkedin": "LinkedIn", "openai": "OpenAI",
        "chatgpt": "ChatGPT", "clickup": "ClickUp", "paypal": "PayPal",
    ]

    /// MCP hosts whose favicon is not the provider's logo.
    private static let knownHosts: [String: String] = [
        "api.githubcopilot.com": "github.com",
        "gmailmcp.googleapis.com": "mail.google.com",
        "drivemcp.googleapis.com": "drive.google.com",
        "calendarmcp.googleapis.com": "calendar.google.com",
    ]

    /// A server or plugin name as people say it: "github-github" is
    /// "GitHub", "acme-docs" is "Acme Docs", "linear-mcp" is "Linear".
    public static func readableName(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return name }
        let all = trimmed.split(whereSeparator: { $0 == "-" || $0 == "_" || $0 == " " }).map(String.init)
        let named = all.filter { !["mcp", "server"].contains($0.lowercased()) }
        let words = named.isEmpty ? all : named
        var kept: [String] = []
        for word in words where kept.last?.lowercased() != word.lowercased() { kept.append(word) }
        if let known = displayNames[appKey(kept.joined())] { return known }
        if trimmed.rangeOfCharacter(from: .uppercaseLetters) != nil, kept.count == all.count { return trimmed }
        return kept.map { displayNames[$0.lowercased()] ?? ($0.prefix(1).uppercased() + $0.dropFirst()) }.joined(separator: " ")
    }

    static func addressKey(_ url: String?) -> String? {
        guard let url, let parsed = URL(string: url), let scheme = parsed.scheme, let host = parsed.host else { return nil }
        var path = parsed.path
        while path.hasSuffix("/") { path.removeLast() }
        return "\(scheme)://\(host.lowercased())\(path)"
    }

    private static func address(_ item: ConnectAppItem) -> String? {
        item.kind == .mcp && item.description.lowercased().hasPrefix("http") ? addressKey(item.description) : nil
    }

    /// The provider's site for an MCP host: a known one, else the host
    /// without its "mcp." part.
    static func providerSite(_ host: String?) -> String? {
        guard let host else { return nil }
        if let known = knownHosts[host] { return known }
        let labels = host.split(separator: ".").map(String.init)
        if let at = labels.lastIndex(of: "mcp"), labels.count - at - 1 >= 2 { return labels[(at + 1)...].joined(separator: ".") }
        return host
    }

    private static func rank(_ status: ConnectAppStatus) -> Int {
        switch status {
        case .needsAuth: 0
        case .pending: 1
        case .connected: 2
        case .available: 3
        case .off: 4
        }
    }

    /// Installed rows folded into entries: the same readable app, the same
    /// MCP address or a parent plugin are one. `catalog`: the addresses of
    /// the catalog's apps.
    public static func installedEntries(_ items: [ConnectAppItem], catalog: Set<String> = []) -> [InstalledEntry] {
        let installed = items.filter { $0.installed && !($0.kind == .skill && $0.parent == nil) }
        let keys = Set(installed.map(\.key))
        let markets = Set(items.filter { $0.kind == .plugin }.map(\.source))
        let apps = Set(catalog.compactMap { addressKey($0) })
        var parent: [String: String] = [:]
        for item in installed { parent[item.key] = item.key }
        func find(_ key: String) -> String {
            var at = key
            while let next = parent[at], next != at { at = next }
            parent[key] = at
            return at
        }
        func union(_ a: String, _ b: String) {
            let ra = find(a), rb = find(b)
            if ra != rb { parent[rb] = ra }
        }
        var byMark: [String: String] = [:]
        func claim(_ mark: String?, _ key: String) {
            guard let mark else { return }
            if let seen = byMark[mark] { union(seen, key) } else { byMark[mark] = key }
        }
        for item in installed {
            if let up = item.parent, keys.contains(up) { union(up, item.key) }
            if item.kind == .skill { continue }
            claim(address(item).map { "url:\($0)" }, item.key)
            let key = appKey(readableName(item.name))
            claim(key.isEmpty ? nil : "app:\(key)", item.key)
        }
        var groups: [String: [ConnectAppItem]] = [:]
        var order: [String] = []
        for item in installed {
            let root = find(item.key)
            if groups[root] == nil { order.append(root) }
            groups[root, default: []].append(item)
        }
        func kindRank(_ item: ConnectAppItem) -> Int {
            switch item.kind {
            case .plugin: 0
            case .featured: 1
            case .mcp: 2
            case .skill: 3
            }
        }
        var entries: [InstalledEntry] = []
        for root in order {
            let members = groups[root] ?? []
            if members.allSatisfy({ $0.kind == .skill }) { continue }
            let ordered = members.sorted { kindRank($0) != kindRank($1) ? kindRank($0) < kindRank($1) : $0.name.localizedCompare($1.name) == .orderedAscending }
            let primary = ordered[0]
            let plugin = ordered.first { $0.kind == .plugin }
            let servers = ordered.filter { $0.kind == .mcp }
            let addresses = Set(servers.map { address($0) ?? "name:\($0.id)" })
            let app = servers.contains { address($0).map(apps.contains) ?? false } || ordered.contains { $0.kind == .featured }
            let name = readableName((ordered.first { $0.kind != .mcp && $0.kind != .skill } ?? primary).name)
            let serverHost = servers.first.flatMap { Self.host($0.description) }
            let worst = ordered.filter { $0.kind != .skill }.map(\.status).min { rank($0) < rank($1) } ?? .off
            entries.append(InstalledEntry(
                key: primary.key,
                name: name,
                logo: ordered.first { $0.logo != nil }?.logo,
                domain: ordered.first { $0.kind != .mcp && $0.domain != nil }?.domain ?? providerSite(serverHost),
                primary: primary,
                members: ordered,
                brings: InstalledBrings(
                    app: app,
                    plugin: plugin?.source ?? servers.first { markets.contains($0.source) }?.source,
                    connectors: app && !addresses.isEmpty ? addresses.count - 1 : addresses.count,
                    skills: ordered.filter { $0.kind == .skill }.count
                ),
                status: worst,
                servers: servers.map(\.id)
            ))
        }
        return entries.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    /// Discover: what can still be added.
    public static func discover(_ items: [ConnectAppItem]) -> [ConnectAppItem] {
        items.filter { !$0.installed }
    }
}
