import Foundation

// New bot beyond the name and the look (matrix rows NB2-NB4, NB6; WP13):
// the starting role (an organization's or an imported preset, or one of the
// built-in roles), the team, the title, the description and the standing
// instructions, and the notice a read-only person gets instead of the form.
// Mirrors the desktop's NewBotDialog.tsx (StartingRole, the Identity
// section's Team picker), src/lib/bot-presets.ts and src/lib/bot-roles.ts.

// MARK: - Presets (GET /api/bot-presets, server/presets.ts WireBotPreset)

public struct BotPreset: Decodable, Identifiable, Hashable, Sendable {
    public struct Appearance: Decodable, Hashable, Sendable {
        public var color: String
        public var mascotExpression: String?
        public var mascotBody: String?

        public init(color: String, mascotExpression: String? = nil, mascotBody: String? = nil) {
            self.color = color
            self.mascotExpression = mascotExpression
            self.mascotBody = mascotBody
        }
    }

    public struct PresetBot: Decodable, Hashable, Sendable {
        public var name: String?
        public var title: String?
        public var description: String?
        public var soul: String?
        public var appearance: Appearance?

        public init(name: String? = nil, title: String? = nil, description: String? = nil, soul: String? = nil, appearance: Appearance? = nil) {
            self.name = name
            self.title = title
            self.description = description
            self.soul = soul
            self.appearance = appearance
        }
    }

    public struct Skill: Decodable, Hashable, Sendable {
        public var name: String
        public var description: String?
    }

    public var id: String
    /// "file" (imported) or "org" (the organization's shelf).
    public var source: String
    public var key: String
    public var name: String
    public var description: String?
    public var packageName: String
    public var release: String
    public var publisherName: String?
    public var bot: PresetBot
    public var skills: [Skill]
    public var skillsEnabled: Bool
    public var playbooks: [String]
    public var notes: [String]

    public init(
        id: String, source: String, key: String, name: String, description: String? = nil,
        packageName: String, release: String, publisherName: String? = nil, bot: PresetBot = PresetBot(),
        skills: [String] = [], skillsEnabled: Bool = false, playbooks: [String] = [], notes: [String] = []
    ) {
        self.id = id
        self.source = source
        self.key = key
        self.name = name
        self.description = description
        self.packageName = packageName
        self.release = release
        self.publisherName = publisherName
        self.bot = bot
        self.skills = skills.map { Skill(name: $0, description: nil) }
        self.skillsEnabled = skillsEnabled
        self.playbooks = playbooks
        self.notes = notes
    }

    enum CodingKeys: String, CodingKey {
        case id, source, key, name, description, packageName, release, publisherName, bot, skills, skillsEnabled, playbooks, notes
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        source = try c.decode(String.self, forKey: .source)
        key = try c.decodeIfPresent(String.self, forKey: .key) ?? id
        name = try c.decode(String.self, forKey: .name)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        packageName = try c.decodeIfPresent(String.self, forKey: .packageName) ?? ""
        release = try c.decodeIfPresent(String.self, forKey: .release) ?? ""
        publisherName = try c.decodeIfPresent(String.self, forKey: .publisherName)
        bot = (try? c.decodeIfPresent(PresetBot.self, forKey: .bot)) ?? PresetBot()
        skills = (try? c.decodeIfPresent([Skill].self, forKey: .skills)) ?? []
        skillsEnabled = (try? c.decodeIfPresent(Bool.self, forKey: .skillsEnabled)) ?? false
        playbooks = (try? c.decodeIfPresent([String].self, forKey: .playbooks)) ?? []
        notes = (try? c.decodeIfPresent([String].self, forKey: .notes)) ?? []
    }
}

struct BotPresetList: Decodable {
    var presets: [BotPreset]
}

/// A heading of the starting role menu (`presetGroups`): "From {publisher}"
/// for an organization's presets, "Imported presets" for files'.
public enum PresetGroupLabel: Hashable, Sendable {
    case organization(String)
    case imported
}

public struct PresetGroup: Hashable, Sendable {
    public var label: PresetGroupLabel
    public var presets: [BotPreset]
}

/// One line under the picker (`presetSummaryLines`); the app words it.
public enum PresetSummaryLine: Hashable, Sendable {
    case from(package: String, release: String)
    case fromOrganization(package: String, release: String, publisher: String)
    case text(String)
    case skills(names: String, switchedOn: Bool)
    case notes(String)
    case playbooks(String)
    /// "The model, computer, approval level and connected apps stay as set here."
    case keeps
}

// MARK: - Built-in roles (src/lib/bot-roles.ts BOT_ROLES)

public struct BotRole: Identifiable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var title: String
    public var description: String
    public var soul: String
}

// MARK: - What a starting role fills

/// The fields a starting role puts in the form (`presetDraftPatch`,
/// `roleProfilePatch`): name, title, description, standing instructions and,
/// for a preset with a look, its colour. Every one stays editable.
public struct NewBotRoleFill: Equatable, Sendable {
    public var name: String
    public var title: String
    public var description: String
    public var soul: String
    public var color: String?
    public var mascotBody: String?
    public var mascotExpression: String?
}

public enum NewBotRules {
    /// The desktop's six built-in roles, in its order and its words.
    public static let builtInRoles: [BotRole] = [
        BotRole(
            id: "assistant", name: "Assistant", title: "General assistant",
            description: "Answers questions, drafts text, and takes on whatever you hand it.",
            soul: "You are a capable, plain-spoken assistant. Ask one clarifying question when a request is ambiguous; otherwise do the work and show the result. Keep replies short and concrete."
        ),
        BotRole(
            id: "inbox", name: "Inbox", title: "Email triage",
            description: "Reads your inbox, flags what needs you, and drafts replies for approval.",
            soul: "You manage the user's email. Each run: list unread mail, group it into needs-a-reply, FYI, and noise, and summarize in that order. Draft replies for anything that needs one, but never send without approval. Never unsubscribe, delete, or forward mail on your own."
        ),
        BotRole(
            id: "research", name: "Scout", title: "Researcher",
            description: "Digs through the web and your files, and comes back with a sourced brief.",
            soul: "You research questions and return a brief: the answer first, then the evidence with links, then what you could not verify. Prefer primary sources. Say clearly when sources disagree. Never present a guess as a finding."
        ),
        BotRole(
            id: "coder", name: "Dev", title: "Coding partner",
            description: "Works inside a project folder: reads, edits, runs tests, explains changes.",
            soul: "You are a careful engineer working in the user's project folder. Read before you edit. Run the project's tests after changes and report the real output. Keep diffs small and explain what changed and why. Never push, publish, or delete branches unless told to."
        ),
        BotRole(
            id: "community", name: "Watch", title: "Community monitor",
            description: "Watches Discord, Slack, or forums and reports what matters, on a schedule.",
            soul: "You monitor the user's community channels. Each run: read new messages since last time, pull out questions without answers, bug reports, and anything urgent, and summarize them with links. Never post or reply in the channels yourself; you report to the user."
        ),
        BotRole(
            id: "ops", name: "Ops", title: "Operations",
            description: "Keeps calendars, tasks, and follow-ups moving; nudges you before things slip.",
            soul: "You keep the user's week on track. Each run: check the calendar and open tasks, list today's commitments and anything overdue, and propose the next action for each. Draft messages when a follow-up is due, but always ask before sending."
        ),
    ]

    /// Organization presets under "From {publisher}", then imported ones, in
    /// the server's order (`presetGroups`).
    public static func presetGroups(_ presets: [BotPreset]) -> [PresetGroup] {
        var groups: [PresetGroup] = []
        for preset in presets {
            let label: PresetGroupLabel = preset.source == "org"
                ? .organization(preset.publisherName ?? preset.packageName)
                : .imported
            if let index = groups.firstIndex(where: { $0.label == label }) {
                groups[index].presets.append(preset)
            } else {
                groups.append(PresetGroup(label: label, presets: [preset]))
            }
        }
        return groups
    }

    /// `presetDraftPatch`: the preset's own name (its bot's, else its
    /// label), title, description and instructions, empty when it has none,
    /// and its look. Never a model, computer or approval level.
    public static func fill(_ preset: BotPreset) -> NewBotRoleFill {
        let look = preset.bot.appearance
        return NewBotRoleFill(
            name: preset.bot.name ?? preset.name,
            title: preset.bot.title ?? "",
            description: preset.bot.description ?? "",
            soul: preset.bot.soul ?? "",
            color: look?.color,
            mascotBody: look?.mascotBody,
            mascotExpression: look?.mascotExpression
        )
    }

    /// `roleProfilePatch`.
    public static func fill(_ role: BotRole) -> NewBotRoleFill {
        NewBotRoleFill(name: role.name, title: role.title, description: role.description, soul: role.soul)
    }

    /// `presetSummaryLines`.
    public static func summary(_ preset: BotPreset) -> [PresetSummaryLine] {
        var lines: [PresetSummaryLine] = []
        if preset.source == "org", let publisher = preset.publisherName {
            lines.append(.fromOrganization(package: preset.packageName, release: preset.release, publisher: publisher))
        } else {
            lines.append(.from(package: preset.packageName, release: preset.release))
        }
        if let description = preset.description, !description.isEmpty { lines.append(.text(description)) }
        let skills = preset.skills.map(\.name).joined(separator: ", ")
        if !skills.isEmpty { lines.append(.skills(names: skills, switchedOn: preset.skillsEnabled)) }
        if !preset.notes.isEmpty { lines.append(.notes(preset.notes.joined(separator: ", "))) }
        if !preset.playbooks.isEmpty { lines.append(.playbooks(preset.playbooks.joined(separator: ", "))) }
        lines.append(.keeps)
        return lines
    }

    /// The Team picker's teams after "Unassigned": the server's sections, then
    /// any a bot names, once each, without the empty one.
    public static func teams(sections: [String], bots: [Bot]) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for name in sections + bots.map({ $0.section ?? "" }) where !name.isEmpty && !seen.contains(name) {
            seen.insert(name)
            out.append(name)
        }
        return out
    }

    /// A person who may only use the bots shared with them gets the notice,
    /// never the form (`viewerBotsReadOnly || !viewerCanCreateBots`).
    public static func readOnly(_ config: ConfigStatus?) -> Bool {
        config?.viewer?.botsReadOnly == true || config?.viewer?.canCreateBots == false
    }

    /// The server's limits on what the form sends (shared/bot-profile.ts).
    public static let titleLimit = 200
    public static let descriptionLimit = 4_000
    public static let soulLimit = 24_000
}

public extension CompanionClient {
    /// New bot's presets. A server or sidecar that does not offer them (a
    /// member, an older desktop) leaves the built-in roles only, as on the
    /// desktop: the caller treats a throw as no presets.
    func botPresets() async throws -> [BotPreset] {
        try await send(makeRequest("GET", "/api/bot-presets"), as: BotPresetList.self).presets
    }
}
