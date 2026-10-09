// Browse Bots, the organisation bot catalogue (desktop
// src/components/bot-catalog/, src/lib/bot-catalog.ts, shared/bot-catalog.ts,
// server/routes/bot-catalog.ts): the bots the viewer owns, the ones shared
// with them and the ones published to the organisation, with the templates
// folded in. The wire shapes, the sections, the actions and the search are
// here so the iOS sheet and the tests read one model.
//
// Routes (all in CLIENT_ALLOW, none on the desktop's companion sidecar):
// GET /api/bot-catalog, GET /api/bot-catalog/:id,
// PUT /api/bot-catalog/:id/listing, POST /api/bot-catalog/:id/import.
import Foundation

// MARK: - Wire

/// Stored on the bot while it is offered to the organisation.
public struct BotCatalogListing: Codable, Hashable, Sendable {
    public var published: Bool
    public var category: String?
    public var featured: Bool?
    public var publishedAt: Double?
    public var publishedBy: String?

    public init(published: Bool, category: String? = nil, featured: Bool? = nil, publishedAt: Double? = nil, publishedBy: String? = nil) {
        self.published = published
        self.category = category
        self.featured = featured
        self.publishedAt = publishedAt
        self.publishedBy = publishedBy
    }
}

public enum BotCatalogSource: String, Codable, Hashable, Sendable {
    case mine, shared, organization
}

public struct BotCatalogLook: Decodable, Hashable, Sendable {
    public var color: String
    public var mascotLook: MascotLook?
    public var mascotSkin: MascotSkin?
    public var mascotBody: String?
    public var avatarUrl: String?

    public init(color: String = "green", mascotLook: MascotLook? = nil, mascotSkin: MascotSkin? = nil, mascotBody: String? = nil, avatarUrl: String? = nil) {
        self.color = color
        self.mascotLook = mascotLook
        self.mascotSkin = mascotSkin
        self.mascotBody = mascotBody
        self.avatarUrl = avatarUrl
    }

    enum CodingKeys: String, CodingKey { case color, mascotLook, mascotSkin, mascotBody, avatarUrl }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        color = (try? c.decodeIfPresent(String.self, forKey: .color)) ?? "green"
        // a look or skin this build cannot read draws the owl, never fails the row
        mascotLook = (try? c.decodeIfPresent(MascotLook.self, forKey: .mascotLook)) ?? nil
        mascotSkin = (try? c.decodeIfPresent(MascotSkin.self, forKey: .mascotSkin)) ?? nil
        mascotBody = (try? c.decodeIfPresent(String.self, forKey: .mascotBody)) ?? nil
        avatarUrl = (try? c.decodeIfPresent(String.self, forKey: .avatarUrl)) ?? nil
    }

    /// What the mascot views draw.
    public var resolvedLook: CompleteMascotLook { (mascotLook ?? .owl).complete }
    public var resolvedSkin: MascotSkin { mascotSkin ?? .none }
}

public struct BotCatalogEntry: Decodable, Hashable, Identifiable, Sendable {
    public struct Owner: Decodable, Hashable, Sendable {
        public var principalId: String
        public var name: String
    }

    public var id: String
    public var name: String
    public var title: String
    public var description: String
    public var look: BotCatalogLook
    public var owner: Owner
    public var source: BotCatalogSource
    public var archived: Bool
    public var primary: Bool
    public var catalog: BotCatalogListing?

    public init(
        id: String, name: String, title: String = "", description: String = "", look: BotCatalogLook = BotCatalogLook(),
        owner: Owner, source: BotCatalogSource, archived: Bool = false, primary: Bool = false, catalog: BotCatalogListing? = nil
    ) {
        self.id = id
        self.name = name
        self.title = title
        self.description = description
        self.look = look
        self.owner = owner
        self.source = source
        self.archived = archived
        self.primary = primary
        self.catalog = catalog
    }

    enum CodingKeys: String, CodingKey { case id, name, title, description, look, owner, source, archived, primary, catalog }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) ?? ""
        description = (try? c.decodeIfPresent(String.self, forKey: .description)) ?? ""
        look = (try? c.decodeIfPresent(BotCatalogLook.self, forKey: .look)) ?? BotCatalogLook()
        owner = (try? c.decodeIfPresent(Owner.self, forKey: .owner)) ?? Owner(principalId: "", name: "")
        source = try c.decode(BotCatalogSource.self, forKey: .source)
        archived = (try? c.decodeIfPresent(Bool.self, forKey: .archived)) ?? false
        primary = (try? c.decodeIfPresent(Bool.self, forKey: .primary)) ?? false
        catalog = (try? c.decodeIfPresent(BotCatalogListing.self, forKey: .catalog)) ?? nil
    }

    public var published: Bool { catalog?.published == true && !archived }
    /// The row's second line: the description, else the role.
    public var blurb: String { description.isEmpty ? title : description }
}

public struct BotCatalogResponse: Decodable, Sendable {
    public struct Viewer: Decodable, Hashable, Sendable {
        public var principalId: String
        public var admin: Bool
        public var canCreate: Bool
    }

    public var organization: Bool
    public var viewer: Viewer
    public var entries: [BotCatalogEntry]

    public init(organization: Bool, viewer: Viewer, entries: [BotCatalogEntry]) {
        self.organization = organization
        self.viewer = viewer
        self.entries = entries
    }

    enum CodingKeys: String, CodingKey { case organization, viewer, entries }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        organization = (try? c.decodeIfPresent(Bool.self, forKey: .organization)) ?? false
        viewer = (try? c.decodeIfPresent(Viewer.self, forKey: .viewer)) ?? Viewer(principalId: "", admin: false, canCreate: false)
        // one malformed bot never hides the rest
        entries = (try c.decodeIfPresent([Lossy<BotCatalogEntry>].self, forKey: .entries) ?? []).compactMap(\.value)
    }
}

/// GET /api/bot-catalog/:id, read only.
public struct BotCatalogDetail: Decodable, Sendable {
    public struct Skill: Decodable, Hashable, Sendable { public var name: String; public var description: String? }
    public struct Routine: Decodable, Hashable, Sendable { public var name: String; public var schedule: String?; public var enabled: Bool? }
    public struct Integration: Decodable, Hashable, Sendable { public var name: String; public var kind: String }

    public var entry: BotCatalogEntry
    public var soul: String
    /// Nil when this viewer may not read them (published, not shared).
    public var memories: [String]?
    public var skills: [Skill]
    public var routines: [Routine]
    public var integrations: [Integration]

    enum CodingKeys: String, CodingKey { case entry, soul, memories, skills, routines, integrations }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        entry = try c.decode(BotCatalogEntry.self, forKey: .entry)
        soul = (try? c.decodeIfPresent(String.self, forKey: .soul)) ?? ""
        memories = (try? c.decodeIfPresent([String].self, forKey: .memories)) ?? nil
        skills = (try? c.decodeIfPresent([Lossy<Skill>].self, forKey: .skills))??.compactMap(\.value) ?? []
        routines = (try? c.decodeIfPresent([Lossy<Routine>].self, forKey: .routines))??.compactMap(\.value) ?? []
        integrations = (try? c.decodeIfPresent([Lossy<Integration>].self, forKey: .integrations))??.compactMap(\.value) ?? []
    }
}

struct BotCatalogListingResponse: Decodable { var catalog: BotCatalogListing? }
struct BotCatalogImportResponse: Decodable { var botId: String }

struct BotCatalogListingBody: Encodable {
    var published: Bool
    var category: String?
    var featured: Bool?
}

public extension CompanionClient {
    /// `GET /api/bot-catalog`.
    func botCatalog() async throws -> BotCatalogResponse {
        try await send(makeRequest("GET", "/api/bot-catalog"), as: BotCatalogResponse.self)
    }

    /// `GET /api/bot-catalog/:id`.
    func botCatalogDetail(botId: String) async throws -> BotCatalogDetail {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(makeRequest("GET", "/api/bot-catalog/\(botId)"), as: BotCatalogDetail.self)
    }

    /// `PUT /api/bot-catalog/:id/listing`: publish, withdraw or feature.
    /// Nil back is a withdrawn bot.
    func setBotCatalogListing(botId: String, published: Bool, category: String? = nil, featured: Bool? = nil) async throws -> BotCatalogListing? {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        let body = BotCatalogListingBody(published: published, category: category.flatMap(BotCatalogRules.normalizeCategory), featured: featured)
        return try await send(makeRequest("PUT", "/api/bot-catalog/\(botId)/listing", encodedBody: body), as: BotCatalogListingResponse.self).catalog
    }

    /// `POST /api/bot-catalog/:id/import`: a copy of the bot for the viewer
    /// (soul, skills, model, settings; no threads, memory or routines).
    func importCatalogBot(botId: String) async throws -> String {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(makeRequest("POST", "/api/bot-catalog/\(botId)/import", body: [:]), as: BotCatalogImportResponse.self).botId
    }
}

// MARK: - Templates folded in

/// A template of the Templates section: a preset of New bot (an admin read),
/// a community team (admin, read only on iOS) or a built-in role.
public struct BotCatalogTemplate: Hashable, Identifiable, Sendable {
    public enum Source: String, Hashable, Sendable { case preset, community, role }

    /// `preset:<id>`, `community:<slug>` or `role:<id>`.
    public var id: String
    public var source: Source
    public var name: String
    public var title: String
    public var description: String
    public var color: String
    public var creator: String
    public var category: String?
    public var soul: String
    public var skills: [String]
    public var members: Int?
    public var notes: [String]
    public var preset: BotPreset?
    public var role: BotRole?

    public init(
        id: String, source: Source, name: String, title: String, description: String, color: String, creator: String,
        category: String?, soul: String = "", skills: [String] = [], members: Int? = nil, notes: [String] = [],
        preset: BotPreset? = nil, role: BotRole? = nil
    ) {
        self.id = id
        self.source = source
        self.name = name
        self.title = title
        self.description = description
        self.color = color
        self.creator = creator
        self.category = category
        self.soul = soul
        self.skills = skills
        self.members = members
        self.notes = notes
        self.preset = preset
        self.role = role
    }
}

// MARK: - Sections, actions, search

public enum BotCatalogItem: Hashable, Identifiable, Sendable {
    case bot(BotCatalogEntry)
    case template(BotCatalogTemplate)

    public var id: String {
        switch self {
        case let .bot(entry): return "bot:\(entry.id)"
        case let .template(template): return template.id
        }
    }

    public var name: String {
        switch self {
        case let .bot(entry): return entry.name
        case let .template(template): return template.name
        }
    }

    /// "by <creator>".
    public var creator: String {
        switch self {
        case let .bot(entry): return entry.owner.name
        case let .template(template): return template.creator
        }
    }

    public var category: String? {
        switch self {
        case let .bot(entry): return entry.catalog?.category
        case let .template(template): return template.category
        }
    }
}

public enum BotCatalogSectionID: String, CaseIterable, Hashable, Sendable {
    case featured, shared, mine, organization, templates
}

public struct BotCatalogSection: Hashable, Identifiable, Sendable {
    public var id: BotCatalogSectionID
    public var items: [BotCatalogItem]
}

public enum BotCatalogAction: String, Hashable, Sendable {
    case open, addToSidebar, removeFromSidebar, `import`, useTemplate, publish, unpublish, feature, unfeature
}

public struct BotCatalogFilter: Equatable, Sendable {
    public var category = "all"
    public var query = ""
    public var showArchived = false

    public init(category: String = "all", query: String = "", showArchived: Bool = false) {
        self.category = category
        self.query = query
        self.showArchived = showArchived
    }
}

public enum BotCatalogRules {
    /// The chips offered by default, before the categories publishers typed.
    public static let defaultCategories = ["engineering", "sales", "marketing", "design", "personal", "people", "product", "operations"]
    /// The cards a section shows before "View all".
    public static let sectionPreview = 6

    /// `normalizeCatalogCategory`: trimmed, single spaces, at most 40
    /// characters; a default category typed in any case is its id.
    public static func normalizeCategory(_ value: String) -> String? {
        let collapsed = value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        let text = String(collapsed.prefix(40)).trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return nil }
        return defaultCategories.first { $0 == text.lowercased() } ?? text
    }

    /// The chips: All, the defaults, then the ones publishers typed, sorted.
    public static func categories(_ items: [BotCatalogItem]) -> [String] {
        var custom = Set<String>()
        for item in items {
            if let category = item.category, !defaultCategories.contains(category) { custom.insert(category) }
        }
        return ["all"] + defaultCategories + custom.sorted { $0.localizedCompare($1) == .orderedAscending }
    }

    private static func fold(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil).lowercased()
    }

    /// Name, role or creator; a template also by its description and skills.
    /// Case and accents ignored.
    public static func matches(_ item: BotCatalogItem, query: String) -> Bool {
        let needle = fold(query.trimmingCharacters(in: .whitespacesAndNewlines))
        guard !needle.isEmpty else { return true }
        let haystack: String
        switch item {
        case let .bot(entry):
            haystack = "\(entry.name) \(entry.title) \(entry.owner.name)"
        case let .template(template):
            haystack = "\(template.name) \(template.title) \(template.creator) \(template.description) \(template.skills.joined(separator: " "))"
        }
        return fold(haystack).contains(needle)
    }

    /// The home's sections in order: Featured, Shared with me, My Bots,
    /// Organization, Templates. A solo server has mine and templates only.
    public static func sections(_ data: BotCatalogResponse, templates: [BotCatalogTemplate], filter: BotCatalogFilter) -> [BotCatalogSection] {
        func keep(_ item: BotCatalogItem) -> Bool {
            (filter.category == "all" || item.category == filter.category) && matches(item, query: filter.query)
        }
        func bots(_ include: (BotCatalogEntry) -> Bool) -> [BotCatalogItem] {
            data.entries.filter(include).map(BotCatalogItem.bot).filter(keep)
        }
        var out: [BotCatalogSection] = []
        if data.organization {
            out.append(BotCatalogSection(id: .featured, items: bots { $0.published && $0.catalog?.featured == true }))
            out.append(BotCatalogSection(id: .shared, items: bots { $0.source == .shared }))
        }
        out.append(BotCatalogSection(id: .mine, items: bots { $0.source == .mine && (filter.showArchived || !$0.archived) }))
        if data.organization { out.append(BotCatalogSection(id: .organization, items: bots { $0.published })) }
        out.append(BotCatalogSection(id: .templates, items: templates.map(BotCatalogItem.template).filter(keep)))
        return out
    }

    /// What the viewer may do with an item, the primary action first
    /// (`catalogActions`).
    public static func actions(
        _ item: BotCatalogItem, organization: Bool, admin: Bool, canCreate: Bool, inSidebar: (String) -> Bool
    ) -> [BotCatalogAction] {
        switch item {
        case let .template(template):
            // a community team is added on the computer
            return canCreate && template.source != .community ? [.useTemplate] : []
        case let .bot(entry):
            var out: [BotCatalogAction] = []
            let published = entry.catalog?.published == true
            switch entry.source {
            case .shared:
                out.append(inSidebar(entry.id) ? .removeFromSidebar : .addToSidebar)
                out.append(.open)
                if canCreate { out.append(.import) }
            case .organization:
                if canCreate { out.append(.import) }
            case .mine:
                if !entry.archived { out.append(.open) }
                if organization, !entry.archived { out.append(published ? .unpublish : .publish) }
            }
            if organization, admin, published, !entry.archived {
                out.append(entry.catalog?.featured == true ? .unfeature : .feature)
                if entry.source != .mine { out.append(.unpublish) }
            }
            return out
        }
    }

    /// The row's button: never publish, withdraw or feature.
    public static func cardAction(_ actions: [BotCatalogAction]) -> BotCatalogAction? {
        guard let first = actions.first, ![.publish, .unpublish, .feature, .unfeature].contains(first) else { return nil }
        return first
    }

    /// Presets, then the community teams, then the built-in roles (the
    /// organization packages of the desktop are read on the computer).
    public static func templates(presets: [BotPreset], community: [TeamLibraryCatalog.Team], roles: [BotRole]) -> [BotCatalogTemplate] {
        let roleCategory = ["assistant": "personal", "inbox": "operations", "research": "product", "coder": "engineering", "community": "marketing", "ops": "operations"]
        let palette = ["blue", "purple", "teal", "orange", "pink", "green"]
        var out: [BotCatalogTemplate] = presets.map { preset in
            BotCatalogTemplate(
                id: "preset:\(preset.id)", source: .preset,
                name: preset.bot.name ?? preset.name,
                title: preset.bot.title ?? "",
                description: preset.bot.description ?? preset.description ?? "",
                color: preset.bot.appearance?.color ?? "green",
                creator: preset.publisherName ?? preset.packageName,
                category: nil,
                soul: preset.bot.soul ?? "",
                skills: preset.skills.map(\.name),
                notes: preset.notes,
                preset: preset
            )
        }
        out += community.map { team in
            let lower = (team.category ?? "").trimmingCharacters(in: .whitespaces).lowercased()
            return BotCatalogTemplate(
                id: "community:\(team.slug)", source: .community, name: team.name, title: "", description: team.summary,
                color: "teal", creator: "Community",
                category: lower.isEmpty ? nil : (defaultCategories.contains(lower) ? lower : team.category),
                members: team.members
            )
        }
        out += roles.enumerated().map { index, role in
            BotCatalogTemplate(
                id: "role:\(role.id)", source: .role, name: role.name, title: role.title, description: role.description,
                color: palette[index % palette.count], creator: "Sagax", category: roleCategory[role.id], soul: role.soul, role: role
            )
        }
        return out
    }

    /// What "Use this template" creates (a preset sends its id so the server
    /// adds its skills and notes, as New bot does).
    public static func draft(for template: BotCatalogTemplate) -> NewBotDraft? {
        switch template.source {
        case .community: return nil
        case .preset:
            guard let preset = template.preset else { return nil }
            let fill = NewBotRules.fill(preset)
            return NewBotDraft(
                name: fill.name.isEmpty ? preset.name : fill.name, color: fill.color ?? "green",
                title: fill.title.isEmpty ? nil : fill.title, description: fill.description.isEmpty ? nil : fill.description,
                soul: fill.soul.isEmpty ? nil : fill.soul, preset: preset.id,
                mascotBody: fill.mascotBody, mascotExpression: fill.mascotExpression
            )
        case .role:
            guard let role = template.role else { return nil }
            return NewBotDraft(name: role.name, color: template.color, title: role.title, description: role.description, soul: role.soul)
        }
    }
}
