// Connect apps' one search (2026-10-29): a single field over every tab
// that finds plugins, skills, MCP servers (installed or not), bots (mine,
// shared with me, the organization's), templates (the xAI Bot Marketplace
// too) and the marketplaces, grouped by kind. Each hit says where it opens:
// an app or a server its page, a skill its page, a bot or a template its
// card, a marketplace the Sources tab. The filters of the tab in front
// (Discover's category and type, Bots' category and archived switch) narrow
// their own groups; the other groups are not filtered.
import Foundation

public enum ConnectAppsSearchGroup: String, CaseIterable, Hashable, Sendable {
    case plugins, skills, servers, bots, templates, xai, marketplaces
}

/// Where a hit leads.
public enum ConnectAppsSearchTarget: Hashable, Sendable {
    /// An app, a plugin or an MCP server: its page (`ConnectAppItem.key`).
    case app(String)
    /// A skill: its page (the skill's name).
    case skill(String)
    /// A bot or a template: its card in Bots.
    case catalog(BotCatalogItem)
    /// A marketplace: the Sources tab.
    case marketplace(String)
}

public struct ConnectAppsSearchHit: Hashable, Identifiable, Sendable {
    public var id: String
    public var title: String
    public var detail: String
    public var target: ConnectAppsSearchTarget
    /// The app row, for the icon and the status (nil for bots and marketplaces).
    public var app: ConnectAppItem?
}

public struct ConnectAppsSearchSection: Hashable, Identifiable, Sendable {
    public var group: ConnectAppsSearchGroup
    public var hits: [ConnectAppsSearchHit]
    public var id: ConnectAppsSearchGroup { group }
}

/// What the search reads: the rows Connect apps already holds.
public struct ConnectAppsSearchSources: Sendable {
    public var apps: [ConnectAppItem]
    public var bots: [BotCatalogEntry]
    public var templates: [BotCatalogTemplate]
    public var marketplaces: [Marketplace]

    public init(apps: [ConnectAppItem] = [], bots: [BotCatalogEntry] = [], templates: [BotCatalogTemplate] = [], marketplaces: [Marketplace] = []) {
        self.apps = apps
        self.bots = bots
        self.templates = templates
        self.marketplaces = marketplaces
    }
}

/// The filters of the tab in front, applied to that tab's groups.
public struct ConnectAppsSearchFilters: Equatable, Sendable {
    public var appFilter: ConnectAppFilter
    public var appType: ConnectAppTypeFilter
    public var botCategory: String
    public var showArchived: Bool

    public init(appFilter: ConnectAppFilter = .all, appType: ConnectAppTypeFilter = .any, botCategory: String = "all", showArchived: Bool = false) {
        self.appFilter = appFilter
        self.appType = appType
        self.botCategory = botCategory
        self.showArchived = showArchived
    }
}

public enum ConnectAppsSearch {
    /// The order of the groups on the page.
    public static let order: [ConnectAppsSearchGroup] = [.plugins, .skills, .servers, .bots, .templates, .xai, .marketplaces]
    /// The hits a group shows before "Show all".
    public static let preview = 5

    private static func fold(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil).lowercased()
    }

    /// Every word of the query is in the text; case and accents ignored.
    static func contains(_ text: String, words: [String]) -> Bool {
        let folded = fold(text)
        return words.allSatisfy { folded.contains($0) }
    }

    static func words(_ query: String) -> [String] {
        fold(query).split(whereSeparator: \.isWhitespace).map(String.init)
    }

    /// The group an app row belongs to: a marketplace plugin, a skill, or an
    /// MCP server (one the person added, or one of the catalog's apps).
    public static func group(_ item: ConnectAppItem) -> ConnectAppsSearchGroup {
        switch item.kind {
        case .plugin: .plugins
        case .skill: .skills
        case .mcp, .featured: .servers
        }
    }

    private static func byName<T>(_ name: KeyPath<T, String>) -> (T, T) -> Bool {
        { $0[keyPath: name].localizedCompare($1[keyPath: name]) == .orderedAscending }
    }

    /// The grouped results, in `order`, empty groups left out; an empty
    /// query finds nothing (each tab then shows its own content).
    public static func sections(query: String, sources: ConnectAppsSearchSources, filters: ConnectAppsSearchFilters = ConnectAppsSearchFilters()) -> [ConnectAppsSearchSection] {
        let words = words(query)
        guard !words.isEmpty else { return [] }
        var groups: [ConnectAppsSearchGroup: [ConnectAppsSearchHit]] = [:]

        let apps = sources.apps
            .filter { contains("\($0.name) \($0.id) \($0.description) \($0.domain ?? "") \($0.source)", words: words) }
            .filter { ConnectApps.matches($0, filter: filters.appFilter) && ConnectApps.matches($0, type: filters.appType) }
            .sorted { a, b in
                if a.installed != b.installed { return a.installed }
                return a.name.localizedCompare(b.name) == .orderedAscending
            }
        for item in apps {
            let target: ConnectAppsSearchTarget = item.kind == .skill ? .skill(item.id) : .app(item.key)
            groups[group(item), default: []].append(ConnectAppsSearchHit(
                id: "app:\(item.key)", title: item.name, detail: item.description, target: target, app: item
            ))
        }

        func keepCategory(_ category: String?) -> Bool {
            filters.botCategory == "all" || category == filters.botCategory
        }
        var seenBots = Set<String>()
        let bots = sources.bots
            .filter { filters.showArchived || !$0.archived }
            .filter { keepCategory($0.catalog?.category) }
            .filter { BotCatalogRules.matches(.bot($0), query: query) || contains("\($0.description)", words: words) }
            .sorted(by: byName(\.name))
        for entry in bots where seenBots.insert(entry.id).inserted {
            groups[.bots, default: []].append(ConnectAppsSearchHit(
                id: "bot:\(entry.id)", title: entry.name, detail: entry.blurb, target: .catalog(.bot(entry)), app: nil
            ))
        }

        let templates = sources.templates
            .filter { keepCategory($0.category) }
            .filter { BotCatalogRules.matches(.template($0), query: query) }
            .sorted(by: byName(\.name))
        for template in templates {
            groups[template.source == .xai ? .xai : .templates, default: []].append(ConnectAppsSearchHit(
                id: "template:\(template.id)", title: template.name,
                detail: template.description.isEmpty ? template.title : template.description,
                target: .catalog(.template(template)), app: nil
            ))
        }

        for market in sources.marketplaces.sorted(by: byName(\.name)) where contains("\(market.name) \(market.source)", words: words) {
            groups[.marketplaces, default: []].append(ConnectAppsSearchHit(
                id: "market:\(market.name)", title: market.name, detail: market.source,
                target: .marketplace(market.name), app: nil
            ))
        }

        return order.compactMap { group in
            guard let hits = groups[group], !hits.isEmpty else { return nil }
            return ConnectAppsSearchSection(group: group, hits: hits)
        }
    }
}
