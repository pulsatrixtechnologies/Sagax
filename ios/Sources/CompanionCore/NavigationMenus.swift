// The home's menus, places and Settings list in the desktop's order, as
// plain data that any layout draws: the iPhone's context menus and popovers
// today, the iPad's desktop popovers later. Each plan says which entries a
// pairing shows and in which order, grouped where the desktop draws a
// divider; the views only map an entry to its label and its action.
//
// Sources, in the Electron renderer (src/components):
// - a bot row: `BotContextMenu` in Sidebar.tsx
// - a room row: `RoomContextMenu` in Sidebar.tsx
// - a section header: `orgSectionMenuItems` (OrgSectionMenu.tsx) on an
//   organization server, `TeamMenuItems` (Sidebar.tsx) elsewhere
// - the account: `SidebarProfileMenu.tsx` (with Archived bots from Sidebar.tsx)
// - New: `composeRows` (ComposeToPicker.tsx)
// - the places above the account footer: `places` in Sidebar.tsx
// - Settings: `SECTIONS` (SettingsModal.tsx)
//
// What a pairing may not do is left out (`SurfaceGate`), never drawn
// disabled. The one disabled entry is the desktop's own: Archive while the
// bot is the Primary Bot or the last active one.
import Foundation

// MARK: - Bot row

public enum BotMenuItem: String, Hashable, Sendable, CaseIterable {
    case newThread, newFolder
    case pin, unpin, moveTo, markUnread
    case rename, copyConversationId
    case hide, archive, delete
    case makePrimary, replacePrimary
}

/// Why Archive is drawn disabled (the desktop's hint).
public enum BotArchiveBlock: String, Hashable, Sendable {
    /// "Choose another Primary Bot first"
    case primary
    /// "Keep at least one active bot"
    case lastActive
}

public struct BotMenuContext: Hashable, Sendable {
    public var gate: SurfaceGate
    /// Settings > Appearance > Threads.
    public var showThreads: Bool
    /// Move to: the person's own sections (organization server), or the
    /// server's when the pairing may file bots.
    public var canMoveToSection: Bool
    /// The viewer as the server knows them; nil until known, which keeps
    /// the Primary Bot entries out.
    public var viewerId: String?
    /// Bots not archived, for Archive's "keep at least one".
    public var activeBotCount: Int

    public init(gate: SurfaceGate, showThreads: Bool, canMoveToSection: Bool, viewerId: String?, activeBotCount: Int) {
        self.gate = gate
        self.showThreads = showThreads
        self.canMoveToSection = canMoveToSection
        self.viewerId = viewerId
        self.activeBotCount = activeBotCount
    }
}

public struct BotMenuPlan: Hashable, Sendable {
    /// The entries, one group per run between the desktop's dividers.
    public var groups: [[BotMenuItem]]
    /// Set when Archive is shown but may not run now.
    public var archiveBlock: BotArchiveBlock?

    public var items: [BotMenuItem] { groups.flatMap { $0 } }

    public func enables(_ item: BotMenuItem) -> Bool {
        item != .archive || archiveBlock == nil
    }
}

// MARK: - Room row

public enum RoomMenuItem: String, Hashable, Sendable, CaseIterable {
    case viewProfile, rename, moveTo, copyConversationId, hide
    /// The phone's pinned row also holds groups; the desktop's room menu
    /// has no pin, so it comes after the desktop's entries.
    case pin, unpin
    case delete
}

public struct RoomMenuContext: Hashable, Sendable {
    public var gate: SurfaceGate
    public var access: RoomInfoAccess
    /// The person's own sections (organization server).
    public var personalSections: Bool
    /// A people-only conversation whose other person is known.
    public var knowsPeer: Bool
    /// The server keeps group pins (older ones do not).
    public var groupPinsSupported: Bool

    public init(gate: SurfaceGate, access: RoomInfoAccess, personalSections: Bool, knowsPeer: Bool, groupPinsSupported: Bool) {
        self.gate = gate
        self.access = access
        self.personalSections = personalSections
        self.knowsPeer = knowsPeer
        self.groupPinsSupported = groupPinsSupported
    }
}

// MARK: - Section header

public enum SectionMenuItem: String, Hashable, Sendable, CaseIterable {
    // OrgSectionMenu (the person's own sections)
    case newSection, rename, moveUp, moveDown, collapseAll, expandAll, delete
    // TeamMenuItems (a server team; Share team is the desktop's own)
    case addBots, renameTeam, deleteTeam
    /// A new bot that starts in this team (the team's own "New bot").
    case newBotHere
}

public struct SectionMenuContext: Hashable, Sendable {
    public var gate: SurfaceGate
    public var personalSections: Bool
    /// Nil for General (the phone's Bots and Group Chats buckets).
    public var name: String?
    public var canMoveUp: Bool
    public var canMoveDown: Bool
    /// Some section is open, so the fold entry collapses them all.
    public var anyExpanded: Bool

    public init(gate: SurfaceGate, personalSections: Bool, name: String?, canMoveUp: Bool, canMoveDown: Bool, anyExpanded: Bool) {
        self.gate = gate
        self.personalSections = personalSections
        self.name = name
        self.canMoveUp = canMoveUp
        self.canMoveDown = canMoveDown
        self.anyExpanded = anyExpanded
    }
}

// MARK: - Account, New, places, Settings

public enum AccountMenuItem: String, Hashable, Sendable, CaseIterable {
    case archivedBots, settings, achievements, about, help
}

public enum NewMenuItem: Hashable, Sendable {
    case createBot
    case createGroup
    /// Open this bot's conversation.
    case bot(String)
    /// Open the direct conversation with this person (organization server).
    case person(String)
}

/// The desktop sidebar's rows above the account footer.
public enum HomePlace: String, Hashable, Sendable, CaseIterable {
    case teamMap, automations, connectedApps, templates
}

/// The phone's Settings list, in the desktop's nav order. "Pair devices"
/// is the account card that heads the list (switch, add, sign out).
public enum PhoneSettingsSection: String, Hashable, Sendable, CaseIterable {
    case general, organization, appearance, achievements, experimental, plugins, pairDevices, computer, usage
}

// MARK: - Plans

public enum NavigationMenus {
    /// `BotContextMenu`: threads; Pin, Move to, Mark as Unread; Rename Bot,
    /// Copy conversation ID; Hide from sidebar, Archive, Delete; then the
    /// Primary Bot entry. "Put on the desktop" floats a window: desktop only.
    public static func bot(_ bot: Bot, _ context: BotMenuContext) -> BotMenuPlan {
        let gate = context.gate
        var groups: [[BotMenuItem]] = []
        if context.showThreads {
            groups.append(gate.allows(.threadFolders) ? [.newThread, .newFolder] : [.newThread])
        }

        var first: [BotMenuItem] = []
        // The Primary Bot heads the home on its own; it is never pinned.
        if bot.chiefOfStaff != true { first.append(bot.pinned == true ? .unpin : .pin) }
        if context.canMoveToSection { first.append(.moveTo) }
        first.append(.markUnread)
        groups.append(first)

        var second: [BotMenuItem] = []
        if gate.allows(.renameBot), gate.scope != .serverClient || owns(bot, context.viewerId) {
            second.append(.rename)
        }
        second.append(.copyConversationId)
        groups.append(second)

        var third: [BotMenuItem] = [.hide]
        var block: BotArchiveBlock?
        if gate.allows(.archiveBot) {
            third.append(.archive)
            if bot.chiefOfStaff == true { block = .primary } else if context.activeBotCount <= 1 { block = .lastActive }
        }
        if gate.allows(.botOwnerExtras) { third.append(.delete) }
        groups.append(third)

        if gate.allows(.primaryBot), let viewer = context.viewerId {
            switch PrimaryBotRules.menuAction(for: bot, viewerId: viewer) {
            case .replace?: groups.append([.replacePrimary])
            case .make?: groups.append([.makePrimary])
            case nil: break
            }
        }
        return BotMenuPlan(groups: groups, archiveBlock: block)
    }

    private static func owns(_ bot: Bot, _ viewerId: String?) -> Bool {
        guard let viewerId else { return false }
        return PrimaryBotRules.viewerOwns(bot, viewerId: viewerId)
    }

    /// `RoomContextMenu`: View profile, Rename, Move to team, Copy
    /// conversation ID, Hide from sidebar, Delete; the phone's group pin
    /// before Delete.
    public static func room(_ room: Room, _ context: RoomMenuContext) -> [[RoomMenuItem]] {
        let access = context.access
        let teamRoom = room.dm != true && room.peopleDm != true
        var main: [RoomMenuItem] = []
        if room.peopleDm == true, context.knowsPeer { main.append(.viewProfile) }
        if access.editable, room.peopleDm != true { main.append(.rename) }
        if context.personalSections ? teamRoom : access.canMoveSection { main.append(.moveTo) }
        main.append(.copyConversationId)
        main.append(.hide)
        var groups = [main]
        if context.groupPinsSupported, context.gate.scope != .sidecar, room.dm != true {
            groups.append([room.pinned == true ? .unpin : .pin])
        }
        if access.canDelete { groups.append([.delete]) }
        return groups
    }

    /// A section header. The person's own sections: `orgSectionMenuItems`.
    /// A server team: `TeamMenuItems` for a pairing that may manage teams,
    /// then the moves and the fold (the desktop drags; a phone cannot) and
    /// New bot here.
    public static func section(_ context: SectionMenuContext, canCreateBotHere: Bool) -> [[SectionMenuItem]] {
        let fold: SectionMenuItem = context.anyExpanded ? .collapseAll : .expandAll
        if context.personalSections {
            var items: [SectionMenuItem] = [.newSection]
            if context.name != nil { items.append(.rename) }
            if context.canMoveUp { items.append(.moveUp) }
            if context.canMoveDown { items.append(.moveDown) }
            items.append(fold)
            if context.name != nil { items.append(.delete) }
            return [items]
        }
        var groups: [[SectionMenuItem]] = []
        if context.name != nil, context.gate.allows(.sectionManagement) {
            groups.append([.addBots, .renameTeam, .deleteTeam])
        }
        var extras: [SectionMenuItem] = []
        if context.name != nil, context.canMoveUp { extras.append(.moveUp) }
        if context.name != nil, context.canMoveDown { extras.append(.moveDown) }
        extras.append(fold)
        if context.name != nil, canCreateBotHere, context.gate.allows(.createBot), context.gate.allows(.createBotTeam) {
            extras.append(.newBotHere)
        }
        groups.append(extras)
        return groups
    }

    /// `SidebarProfileMenu` on a phone: Archived bots (housekeeping, when
    /// there are any), Settings, Achievements, then About and Help Center.
    /// "Your phone" and Keyboard shortcuts are the desktop's own.
    public static func account(gate: SurfaceGate, hasArchivedBots: Bool, achievementsReady: Bool) -> [[AccountMenuItem]] {
        var groups: [[AccountMenuItem]] = []
        if gate.allows(.archiveBot), hasArchivedBots { groups.append([.archivedBots]) }
        var main: [AccountMenuItem] = [.settings]
        if gate.allows(.achievements), achievementsReady { main.append(.achievements) }
        groups.append(main)
        groups.append([.about, .help])
        return groups
    }

    /// `composeRows` in browse mode: Create new Bot (when the pairing may),
    /// Create group chat, every bot, then the organization's people.
    public static func new(gate: SurfaceGate, bots: [Bot], people: [String]) -> [[NewMenuItem]] {
        var create: [NewMenuItem] = []
        if gate.allows(.createBot) { create.append(.createBot) }
        create.append(.createGroup)
        var groups = [create]
        let shown = bots.filter { $0.hidden != true }
        if !shown.isEmpty { groups.append(shown.map { .bot($0.id) }) }
        if gate.allows(.people), !people.isEmpty { groups.append(people.map { .person($0) }) }
        return groups
    }

    /// The sidebar's places: Team map, Automations, then the experimental
    /// Connected apps and Templates while Settings > Experimental turns them
    /// on (`connectedAppsEnabled`, `templatesEnabled`).
    public static func places(gate: SurfaceGate, connected: Bool, features: ServerFeatures?) -> [HomePlace] {
        guard connected else { return [] }
        var places: [HomePlace] = []
        if gate.allows(.teamMap) { places.append(.teamMap) }
        places.append(.automations)
        if features?.connectedApps == true, gate.allows(.connectedApps) { places.append(.connectedApps) }
        if features?.templates == true, gate.allows(.templates) { places.append(.templates) }
        return places
    }

    /// Settings in the desktop's order (`SECTIONS`), the sections a phone
    /// pairing can use: General, Organization, Appearance, Achievements,
    /// Experimental, Plugins (where the desktop keeps its connections),
    /// Pair devices, Computer, Usage.
    public static func settings(gate: SurfaceGate, connected: Bool, achievementsAvailable: Bool) -> [PhoneSettingsSection] {
        var sections: [PhoneSettingsSection] = [.general]
        if gate.allows(.organizationSettings) { sections.append(.organization) }
        sections.append(.appearance)
        if connected, gate.allows(.achievements), achievementsAvailable { sections.append(.achievements) }
        if connected, gate.allows(.experimentalSettings) { sections.append(.experimental) }
        if connected { sections.append(.plugins) }
        sections.append(.pairDevices)
        if connected { sections += [.computer, .usage] }
        return sections
    }
}
