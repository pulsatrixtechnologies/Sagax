import Foundation

// The iPad's docked bot panel (package I4 of the iPad desktop parity): which
// tabs and Advanced sections a pairing shows, in the desktop's order, and
// the Advanced list's search. The desktop's own rules are
// `bot-settings/panel-tabs.ts` (Details, Routines, Files, Computer,
// Advanced; identity and routines own their tabs, every other section is on
// Advanced) and `bot-settings/sections.ts` (the order, the labels'
// keywords). What a pairing may reach comes from `SurfaceGate`: a section
// the computer can only refuse is not listed.

/// A tab of the bot panel.
public enum DesktopPanelTab: String, CaseIterable, Hashable, Sendable {
    case details, routines, files, computer, advanced

    /// The tabs this pairing shows, in order. Advanced only when one of its
    /// sections is reachable.
    public static func visible(gate: SurfaceGate, slack: Bool = false) -> [DesktopPanelTab] {
        var tabs: [DesktopPanelTab] = [.details, .routines, .files, .computer]
        if !DesktopPanelSection.visible(gate: gate, slack: slack).isEmpty { tabs.append(.advanced) }
        return tabs
    }

    /// The tab a deep link to a section lands on (`tabForSection`).
    public static func holding(_ section: DesktopPanelSection) -> DesktopPanelTab { .advanced }
}

/// A section of the Advanced tab (`BOT_SECTIONS` less identity, routines
/// and worksOn, which other tabs hold).
public enum DesktopPanelSection: String, CaseIterable, Hashable, Sendable {
    case overview, slack, soul, skills, memory, access, model, permissions, voice
    case visibility, sharing, perspicax, history, usage

    /// Search words beside the label (`sections.ts` keywords).
    public var keywords: [String] {
        switch self {
        case .overview: ["summary", "status", "what it does", "won't", "prompt", "what the model sees"]
        case .slack: ["slack", "slack app", "admin", "message", "direct messages", "mentions"]
        case .soul: ["standing instructions", "instructions", "persona", "rules", "soul.md"]
        case .skills: ["skills", "learned", "procedures", "teach"]
        case .memory: ["memory", "notes", "remember", "topics"]
        case .access: ["works on", "computer", "vm", "cloud", "vps", "folder", "workspace", "browser", "connected apps", "composio", "webhooks", "always allow", "grants"]
        case .model: ["engine", "model", "provider", "cli", "effort"]
        case .permissions: ["auto mode", "approve", "auto approve", "review", "routine approvals", "peers", "contact", "coordination", "chief of staff", "section"]
        case .voice: ["voice", "alerts", "notifications", "speak"]
        case .visibility: ["visibility", "who can see", "private", "people", "admins", "members", "access", "hide"]
        case .sharing: ["share", "sharing", "people", "grant", "who can use", "members", "directory"]
        case .perspicax: ["perspicax", "mcp", "profile", "profiles", "tools", "connectwise"]
        case .history: ["history", "changes", "undo", "rollback", "log"]
        case .usage: ["tokens", "cost", "billing"]
        }
    }

    /// Whether this pairing reaches the section. `slack`: the server
    /// answered a link to the bot's Slack app.
    public func reachable(gate: SurfaceGate, slack: Bool) -> Bool {
        switch self {
        case .overview: gate.allows(.botOverview)
        case .slack: gate.allows(.botSlack) && slack
        case .soul, .skills, .memory, .access, .model, .permissions, .history:
            gate.allows(.advancedBotPanel)
        case .voice: true
        case .visibility: gate.allows(.botVisibility)
        case .sharing: gate.allows(.botSharing)
        case .perspicax: gate.allows(.botPerspicax)
        case .usage: gate.allows(.botUsage)
        }
    }

    /// The Advanced list for this pairing, in the desktop's order.
    public static func visible(gate: SurfaceGate, slack: Bool = false) -> [DesktopPanelSection] {
        allCases.filter { $0.reachable(gate: gate, slack: slack) }
    }

    /// The list's search (`sectionMatches`): the label or a keyword holds
    /// the query, ignoring case and surrounding spaces. An empty query
    /// matches everything.
    public func matches(_ query: String, label: String) -> Bool {
        let wanted = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !wanted.isEmpty else { return true }
        return ([rawValue, label] + keywords).contains { $0.lowercased().contains(wanted) }
    }
}

/// Where the panel sits at a window width (spec "At each iPad width"): docked
/// beside the chat from 1024 pt, over the leading edge below.
public enum DesktopPanelPlacement: Equatable, Sendable {
    case docked, overlay

    public static let dockMinWidth: Double = 1024
    public static let defaultWidth: Double = 360
    public static let minWidth: Double = 320
    public static let maxWidth: Double = 720

    public static func at(windowWidth: Double) -> DesktopPanelPlacement {
        windowWidth >= dockMinWidth ? .docked : .overlay
    }

    /// A stored or dragged width, held to the desktop's 320 to 720
    /// (`SETTINGS_MIN_WIDTH`, `SETTINGS_MAX_WIDTH`); nothing stored is 360.
    public static func clampedWidth(_ width: Double?) -> Double {
        guard let width, width.isFinite, width > 0 else { return defaultWidth }
        return min(maxWidth, max(minWidth, width))
    }
}

/// The Routines tab's list (`RoutineList.tsx`, `routine-display.ts`).
public enum DesktopRoutineList {
    public enum State: Equatable, Sendable { case active, paused, finished }

    /// Active first, then the soonest next run, then by name.
    public static func sorted(_ routines: [Routine]) -> [Routine] {
        routines.sorted { a, b in
            if a.enabled != b.enabled { return a.enabled }
            let left = a.nextRunAt ?? .infinity, right = b.nextRunAt ?? .infinity
            if left != right { return left < right }
            return a.name.localizedCompare(b.name) == .orderedAscending
        }
    }

    /// The line under the name: a consumed one-shot is finished, not paused.
    public static func state(_ routine: Routine, now: Date = Date()) -> State {
        if routine.schedule.type == .once, routine.nextRunAt == nil,
           let at = routine.schedule.at, at <= now.timeIntervalSince1970 * 1000 {
            return .finished
        }
        return routine.enabled ? .active : .paused
    }

    /// The bot's own routines.
    public static func of(botId: String, in routines: [Routine]) -> [Routine] {
        sorted(routines.filter { $0.botId == botId })
    }
}

/// The Files tab's sizes (`formatSize`): bytes under 1 KB, else one
/// decimal of KB or MB, base 1024.
public enum DesktopFileSize {
    public static func format(_ bytes: Int) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        if bytes < 1024 * 1024 { return String(format: "%.1f KB", Double(bytes) / 1024) }
        return String(format: "%.1f MB", Double(bytes) / (1024 * 1024))
    }
}

/// The panel's own bot fields (`PATCH /api/bots/:id`): Permissions (Chief
/// of Staff, ask before contacting other bots, the approval level) and
/// Access (works on, cloud backend, working folder). The server takes them
/// from an admin session only; `SurfaceGate.botAccessEdit` says when to send.
public struct BotPanelPatch: Encodable, Hashable, Sendable {
    public var chiefOfStaff: Bool?
    public var approvePeerComms: Bool?
    public var approvalMode: String?
    /// Full access asks for a confirmation (`FullAccessWarning`).
    public var confirmFullAccess: Bool?
    public var applyToAllThreads: Bool?
    public var computer: String?
    public var cloudBackend: String?
    public var cwd: String?

    public init(chiefOfStaff: Bool? = nil, approvePeerComms: Bool? = nil, approvalMode: String? = nil,
                confirmFullAccess: Bool? = nil, applyToAllThreads: Bool? = nil, computer: String? = nil,
                cloudBackend: String? = nil, cwd: String? = nil) {
        self.chiefOfStaff = chiefOfStaff
        self.approvePeerComms = approvePeerComms
        self.approvalMode = approvalMode
        self.confirmFullAccess = confirmFullAccess
        self.applyToAllThreads = applyToAllThreads
        self.computer = computer
        self.cloudBackend = cloudBackend
        self.cwd = cwd
    }

    public var isEmpty: Bool { self == BotPanelPatch() }

    /// Full access always carries its confirmation; the other levels never.
    public static func approval(_ level: ApprovalLevel, allThreads: Bool = true) -> BotPanelPatch {
        level == .full
            ? BotPanelPatch(approvalMode: level.rawValue, confirmFullAccess: true, applyToAllThreads: allThreads)
            : BotPanelPatch(approvalMode: level.rawValue)
    }
}

/// Where a bot works (`WorksOnSetting`): the six choices of the Access
/// section, in the desktop's order. Absent is Auto.
public enum DesktopWorksOn: String, CaseIterable, Hashable, Sendable {
    case auto, cloud, vm, local, browser, off

    public static func of(_ bot: Bot) -> DesktopWorksOn {
        bot.computer.flatMap(DesktopWorksOn.init(rawValue:)) ?? .auto
    }

    /// The value written: Auto clears the field.
    public var stored: String { rawValue }
}

public extension CompanionClient {
    /// `PATCH /api/bots/:id` with the panel's own fields.
    func patchBotSettings(botId: String, patch: BotPanelPatch) async throws -> Bot {
        try await send(patchBotSettingsRequest(botId: botId, patch: patch), as: BotResponse.self).bot
    }

    func patchBotSettingsRequest(botId: String, patch: BotPanelPatch) throws -> URLRequest {
        guard Self.validRouteID(botId), !patch.isEmpty else { throw APIError.badURL }
        return try makeRequest("PATCH", "/api/bots/\(botId)", encodedBody: patch)
    }
}

/// What the Computer tab's screen shows (`ComputerPanel` phases, the ones a
/// paired iPad can tell): Auto, Off and Browser never create or wake a
/// computer, so they show a live frame only when one is streaming; a bot
/// pinned to a computer asks it for a picture.
public enum DesktopComputerPhase: Equatable, Sendable {
    /// A picture to draw.
    case picture
    /// "This bot's computer is off".
    case off
    /// "This bot works in the built-in browser — no desktop here".
    case browser
    /// Waiting for the pinned computer's first picture.
    case waiting

    public static func of(worksOn: DesktopWorksOn, hasPicture: Bool) -> DesktopComputerPhase {
        switch worksOn {
        case .off: return .off
        case .browser: return .browser
        case .auto: return hasPicture ? .picture : .off
        case .cloud, .vm, .local: return hasPicture ? .picture : .waiting
        }
    }

    /// Whether the tab may poll the computer for screenshots.
    public static func polls(_ worksOn: DesktopWorksOn) -> Bool {
        switch worksOn {
        case .cloud, .vm, .local: true
        case .auto, .off, .browser: false
        }
    }
}
