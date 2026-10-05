import Foundation

// The iPad's docked bot panel (packages I4 and I4b of the iPad desktop
// parity): which tabs and More sections a pairing shows, in the desktop's
// order, and the More list's search. The desktop's own rules are
// `bot-settings/panel-tabs.ts` (Details, Library, Computer, More; identity
// and routines live on Details, every other section on More) and
// `bot-settings/sections.ts` (the order, the labels' keywords). What a
// pairing may reach comes from `SurfaceGate`: a section the computer can
// only refuse is not listed.

/// A tab of the bot panel.
public enum DesktopPanelTab: String, CaseIterable, Hashable, Sendable {
    /// Coding and Activity (live work), then the routines.
    case details
    /// The bot's files (was Files).
    case library
    case computer
    /// Every other section behind one searchable list (was Advanced).
    case more

    /// The tabs this pairing shows, in order. More only when one of its
    /// sections is reachable.
    public static func visible(gate: SurfaceGate, slack: Bool = false) -> [DesktopPanelTab] {
        var tabs: [DesktopPanelTab] = [.details, .library, .computer]
        if !DesktopPanelSection.visible(gate: gate, slack: slack).isEmpty { tabs.append(.more) }
        return tabs
    }

    /// The tab a deep link to a section lands on (`tabForSection`): every
    /// section the list holds is on More.
    public static func holding(_ section: DesktopPanelSection) -> DesktopPanelTab { .more }
}

/// A section of the More tab (`BOT_SECTIONS` less identity and routines,
/// which Details holds).
public enum DesktopPanelSection: String, CaseIterable, Hashable, Sendable {
    case overview, slack, soul, skills, memory, access, worksOn, model, permissions, voice
    case visibility, sharing, perspicax, history, usage

    /// Search words beside the label (`sections.ts` keywords).
    public var keywords: [String] {
        switch self {
        case .overview: ["summary", "status", "what it does", "won't", "prompt", "what the model sees"]
        case .slack: ["slack", "slack app", "admin", "message", "direct messages", "mentions"]
        case .soul: ["standing instructions", "instructions", "persona", "rules", "soul.md"]
        case .skills: ["skills", "learned", "procedures", "teach"]
        case .memory: ["memory", "notes", "remember", "topics"]
        case .access: ["works on", "computer", "vm", "cloud", "vps", "folder", "workspace", "browser", "connected apps", "composio", "webhooks", "always allow", "grants", "tool selection", "tools", "mcp", "allow", "exclude"]
        case .worksOn: ["works on", "computer", "auto", "cloud", "local vm", "vm", "this computer", "browser", "off", "where it works"]
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
        // its own item on a server signed in with Perspicax only (Access
        // holds it everywhere else)
        case .worksOn: gate.allows(.botPerspicax) && gate.allows(.advancedBotPanel)
        case .usage: gate.allows(.botUsage)
        }
    }

    /// The More list for this pairing, in the desktop's order.
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

/// Details > Routines (`RoutineList.tsx` grouped, `routine-display.ts`).
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

/// The Library tab's sizes (`formatSize`): bytes under 1 KB, else one
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
    /// Works on: Browser turns the bot's own browser switch on with it.
    public var browser: Bool?

    public init(chiefOfStaff: Bool? = nil, approvePeerComms: Bool? = nil, approvalMode: String? = nil,
                confirmFullAccess: Bool? = nil, applyToAllThreads: Bool? = nil, computer: String? = nil,
                cloudBackend: String? = nil, cwd: String? = nil, browser: Bool? = nil) {
        self.browser = browser
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

/// One webhook as More > Access lists it (`GET /api/webhooks`, the
/// fields of `shared/webhooks.ts` the card shows; the credential never
/// rides this list).
public struct WebhookListing: Decodable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var botId: String
    public var enabled: Bool
    public var deliveryCount: Int

    public init(id: String, name: String, botId: String, enabled: Bool, deliveryCount: Int) {
        self.id = id
        self.name = name
        self.botId = botId
        self.enabled = enabled
        self.deliveryCount = deliveryCount
    }

    private enum CodingKeys: String, CodingKey { case id, name, botId, enabled, deliveryCount }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        botId = (try? c.decode(String.self, forKey: .botId)) ?? ""
        enabled = (try? c.decode(Bool.self, forKey: .enabled)) ?? false
        deliveryCount = (try? c.decode(Int.self, forKey: .deliveryCount)) ?? 0
    }
}

public struct WebhooksResponse: Decodable, Sendable {
    public var webhooks: [WebhookListing]

    /// One bot's webhooks, in the server's order.
    public func of(botId: String) -> [WebhookListing] { webhooks.filter { $0.botId == botId } }
}

public extension CompanionClient {
    /// `GET /api/webhooks`: the triggers (More > Access's Webhooks card).
    func webhooks() async throws -> WebhooksResponse {
        try await send(makeRequest("GET", "/api/webhooks"), as: WebhooksResponse.self)
    }

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

/// `whenLabel` (src/lib/schedule-label.ts): the time for today, else the
/// short month and day.
public enum DesktopWhenLabel {
    public static func label(_ ms: Double, now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current) -> String {
        let date = Date(timeIntervalSince1970: ms / 1000)
        if calendar.isDate(date, inSameDayAs: now) {
            return date.formatted(Date.FormatStyle(date: .omitted, time: .shortened, locale: locale, calendar: calendar, timeZone: calendar.timeZone))
        }
        return date.formatted(Date.FormatStyle(locale: locale, calendar: calendar, timeZone: calendar.timeZone).month(.abbreviated).day())
    }
}

/// The panel's name, label and description, edited where they show
/// (`InlineEditableText.tsx` `inlineEditCommit`): what leaving the field
/// saves. Nothing when the trimmed text did not change or a required value
/// was emptied; otherwise the trimmed text (an empty optional value clears).
public enum DesktopInlineEdit {
    public static func commit(draft: String, current: String, required: Bool) -> String? {
        let next = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        if next == current.trimmingCharacters(in: .whitespacesAndNewlines) { return nil }
        if required && next.isEmpty { return nil }
        return next
    }
}

/// More > Access's Works on choices and their notes (`AccessSection.tsx`
/// with `src/lib/place.ts` and `src/lib/feature-flags.ts`).
public enum DesktopWorksOnRules {
    /// Whether this server offers a place (`placeOffered`): every place on
    /// an organization server; an OMB Cloud home has no "this computer" and
    /// no Local VM; elsewhere Cloud only while a Boat or VPS computer is
    /// switched on.
    public static func offered(_ place: DesktopWorksOn, config: ConfigStatus?, organization: Bool) -> Bool {
        switch place {
        case .auto, .off: return true
        default: break
        }
        if organization { return true }
        if config?.cloudHome == true { return place != .local && place != .vm }
        if place == .cloud { return cloudComputersOffered(config) }
        return true
    }

    /// A Boat or a VPS computer may be chosen (`cloudComputersOffered`).
    public static func cloudComputersOffered(_ config: ConfigStatus?) -> Bool {
        config?.features?.boatComputer == true || config?.features?.vpsComputer == true
    }

    /// The grid, in the desktop's order: Auto, the offered places, Off.
    public static func choices(config: ConfigStatus?, organization: Bool) -> [DesktopWorksOn] {
        DesktopWorksOn.allCases.filter { offered($0, config: config, organization: organization) }
    }

    /// The server has a browser engine (`browserAvailable`).
    public static func browserAvailable(_ config: ConfigStatus?) -> Bool {
        config?.browserEngine?.kind == "engine"
    }

    /// The built-in browser switch in Experimental features.
    public static func browserFeature(_ config: ConfigStatus?) -> Bool {
        config?.features?.browser == true
    }

    /// "Works on: Browser" may be chosen (`browserSelectable`).
    public static func browserSelectable(config: ConfigStatus?, modelCanBrowse: Bool) -> Bool {
        browserAvailable(config) && browserFeature(config) && modelCanBrowse
    }

    /// Why Browser cannot be chosen (`browserDisabledReason`).
    public enum BrowserBlock: Equatable, Sendable {
        /// The engine is not installed yet (`browser.notInstalled`).
        case notInstalled
        /// The server's own words.
        case server(String)
        /// `browser.noEngine`.
        case noEngine
        /// Switched off under Experimental features.
        case featureOff
        /// The bot's model cannot use the browser.
        case model
    }

    public static func browserBlock(config: ConfigStatus?) -> BrowserBlock {
        if !browserAvailable(config) {
            let engine = config?.browserEngine
            if engine?.kind == "unavailable", engine?.installable == true { return .notInstalled }
            if engine?.kind == "unavailable", let reason = engine?.reason, !reason.isEmpty { return .server(reason) }
            return .noEngine
        }
        return browserFeature(config) ? .model : .featureOff
    }

    /// The Auto note and the cloud backend show for Auto or Cloud when a
    /// cloud computer is on offer (never on an organization server).
    public static func showsCloudBackend(worksOn: DesktopWorksOn, config: ConfigStatus?, organization: Bool) -> Bool {
        guard !organization, worksOn == .auto || worksOn == .cloud else { return false }
        return config?.cloudHome == true || cloudComputersOffered(config)
    }
}

// MARK: - The iPhone's bot panel

// The iPhone shows the same panel as the iPad and the desktop
// (`BotSettingsDialog.tsx`): the same tabs and More sections, from the same
// `DesktopPanelTab` / `DesktopPanelSection` rules, full screen. What is the
// phone's own is below: the doors into it, the bot's actions in its top
// bar, and the Library's chips (the conversation's files by kind, and the
// bot's links as one more chip).

/// A way into the bot panel and the tab it opens on.
public enum BotPanelDoor: String, CaseIterable, Hashable, Sendable {
    /// The chat's name capsule (a long press is Threads).
    case nameCapsule
    /// The + sheet's "Bot settings".
    case plusSettings
    /// The chat's computer button.
    case computerButton
    /// The + sheet's Computer.
    case plusComputer

    public var tab: DesktopPanelTab {
        switch self {
        case .nameCapsule, .plusSettings: .details
        case .computerButton, .plusComputer: .computer
        }
    }
}

/// The bot's own actions, in the panel's top bar menu. The desktop keeps
/// them in the sidebar row's menu (Duplicate, Primary Bot, Delete) and has
/// no per-bot template share; the phone has no sidebar under the panel, so
/// they sit together in one menu, each once.
public enum BotPanelAction: String, CaseIterable, Hashable, Sendable {
    case shareTemplate, copyId, duplicate, makePrimary, replacePrimary, delete

    /// What this pairing may do with this bot, in menu order.
    public static func available(gate: SurfaceGate, bot: Bot, viewerId: String) -> [BotPanelAction] {
        var out: [BotPanelAction] = [.shareTemplate, .copyId]
        if gate.allows(.duplicateBot) { out.append(.duplicate) }
        if gate.allows(.primaryBot) {
            switch PrimaryBotRules.menuAction(for: bot, viewerId: viewerId) {
            case .make: out.append(.makePrimary)
            case .replace: out.append(.replacePrimary)
            case nil: break
            }
        }
        // D4: an owner's or an admin's, not a client session's
        if gate.allows(.botOwnerExtras) { out.append(.delete) }
        return out
    }
}

/// A chip of the Library tab: a kind of the conversation's files
/// (`FilesSection.tsx` `visibleFilters`), or the bot's links.
public enum BotLibraryChip: Hashable, Sendable {
    case files(ThreadFileFilter)
    case links

    public var fileFilter: ThreadFileFilter? {
        if case let .files(filter) = self { return filter }
        return nil
    }

    /// The chips to show: the files' kinds as the desktop shows them (two
    /// kinds or more), then Links when the bot has any. With links and a
    /// single kind of file, All stands for the files.
    public static func visible(counts: [ThreadFileFilter: Int], selected: BotLibraryChip, links: Int) -> [BotLibraryChip] {
        let kinds = ThreadFileRules.visibleFilters(counts: counts, selected: selected.fileFilter ?? .all).map(BotLibraryChip.files)
        guard links > 0 || selected == .links else { return kinds }
        return (kinds.isEmpty ? [.files(.all)] : kinds) + [.links]
    }
}
