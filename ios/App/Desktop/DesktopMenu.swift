// iPad I2: the desktop sidebar's menus. One list of entries per menu (a bot
// row's Actions, a room row, a section header, the account, New), drawn two
// ways: as the desktop's own popover (`BotContextMenu`, `TeamMenuItems`,
// `SidebarProfileMenu` in Sidebar.tsx: 228 wide, radius 12, the elevated
// fill, 30 pt rows of 13/18 with a 16 pt icon) when a pointer clicks a row's
// "⋯", the account row or New; and as iPadOS's context menu for a long press
// or a right click, with the same entries in the same order.
//
// The entries reuse the phone's feature logic: the WP5 thread and folder
// actions (`ThreadActions`), the WP6 sidebar preferences and section prompts
// (`SidebarPrefsModel`, `SidebarSectionActions`), the WP11 room prompts
// (`RoomActions`) and the session's pin, profile and section calls. What the
// pairing may not do is left out (`SurfaceGate`), never drawn disabled.
import SwiftUI
import UIKit
import CompanionCore

// MARK: - Entries

struct DesktopMenuEntry: Identifiable {
    enum Kind {
        case action(@MainActor () -> Void)
        case submenu([DesktopMenuEntry])
        case divider
    }

    var id: String
    var title: String = ""
    var icon: DesktopIcon?
    var danger = false
    var disabled = false
    /// A keycap hint at the trailing edge ("⌘ /").
    var shortcut: String?
    var kind: Kind

    static func divider(_ id: String) -> DesktopMenuEntry { DesktopMenuEntry(id: "divider.\(id)", kind: .divider) }

    var isDivider: Bool {
        if case .divider = kind { return true }
        return false
    }
}

/// What the shell's popover shows and where (shell coordinates).
struct DesktopMenuRequest: Equatable {
    enum Kind: Equatable {
        case bot(String)
        case room(String)
        case section(String)
        case profile
        case new
    }

    var kind: Kind
    /// The menu's top-left (a row's "⋯": its bottom-left; a right click:
    /// the pointer), or its bottom-left when `opensUp`.
    var anchor: CGPoint
    var opensUp = false
}

/// The desktop popover's metrics, by menu (the DOM dumps 08, 10 and 11).
enum DesktopMenuStyle {
    case standard, section, profile, new

    var width: CGFloat {
        switch self {
        case .standard: 228
        case .section: 220
        case .profile: 259
        case .new: 240
        }
    }

    var rowHeight: CGFloat { self == .profile ? 32 : 30 }
    var iconSize: CGFloat {
        switch self {
        case .profile: 18
        case .section: 14
        default: 16
        }
    }

    /// The popover's height for `entries`: 6 pt padding and a 1 pt border
    /// each side, 2 pt between entries, a divider 8.5 pt.
    func height(_ entries: [DesktopMenuEntry]) -> CGFloat {
        let body = entries.reduce(CGFloat(0)) { $0 + ($1.isDivider ? 8.5 : rowHeight) }
        return body + CGFloat(max(0, entries.count - 1)) * 2 + 14
    }
}

// MARK: - Popover

/// The desktop's menu panel.
struct DesktopMenuPanel: View {
    @Environment(\.desktopTheme) private var theme
    let entries: [DesktopMenuEntry]
    let style: DesktopMenuStyle
    let dismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(entries) { entry in
                row(entry)
            }
        }
        .padding(6)
        .frame(width: style.width, alignment: .leading)
        .background(theme.elevated, in: RoundedRectangle(cornerRadius: max(theme.radiusXl, 0), style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: max(theme.radiusXl, 0), style: .continuous)
                .strokeBorder(theme.border, lineWidth: 1)
        )
        .shadow(color: .black.opacity(theme.dark ? 0.45 : 0.16), radius: 16, y: 8)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .accessibilityIdentifier("desktop-menu")
    }

    @ViewBuilder
    private func row(_ entry: DesktopMenuEntry) -> some View {
        switch entry.kind {
        case .divider:
            Rectangle().fill(theme.border).frame(height: 0.5)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
        case let .action(perform):
            Button {
                dismiss()
                perform()
            } label: {
                label(entry, chevron: false)
            }
            .buttonStyle(DesktopMenuRowStyle(radius: 6))
            .disabled(entry.disabled)
            .accessibilityIdentifier("desktop-menu.\(entry.id)")
        case let .submenu(children):
            Menu {
                DesktopMenuItems(entries: children, after: dismiss)
            } label: {
                label(entry, chevron: true)
            }
            .buttonStyle(DesktopMenuRowStyle(radius: 6))
            .disabled(entry.disabled || children.isEmpty)
            .accessibilityIdentifier("desktop-menu.\(entry.id)")
        }
    }

    private func label(_ entry: DesktopMenuEntry, chevron: Bool) -> some View {
        let tint = entry.danger ? theme.danger : theme.ink
        return HStack(spacing: 8) {
            if let icon = entry.icon {
                DesktopIconView(icon: icon, size: style.iconSize)
                    .frame(width: max(style.iconSize, 16), height: max(style.iconSize, 16))
            }
            Text(verbatim: entry.title)
                .font(theme.font(13))
                .lineLimit(1)
            Spacer(minLength: 0)
            if let shortcut = entry.shortcut {
                Text(verbatim: shortcut)
                    .font(theme.font(11))
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 6)
                    .frame(height: 17)
                    .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
            }
            if chevron {
                DesktopIconView(icon: .chevronRight, size: 14)
                    .foregroundStyle(theme.inkSecondary)
            }
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 8)
        .frame(height: style.rowHeight)
        .frame(maxWidth: .infinity, alignment: .leading)
        .opacity(entry.disabled ? 0.4 : 1)
        .contentShape(Rectangle())
    }
}

/// `hover:bg-hover` on a menu row.
struct DesktopMenuRowStyle: ButtonStyle {
    @Environment(\.desktopTheme) private var theme
    var radius: CGFloat
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                (hovering || configuration.isPressed) ? theme.hover : .clear,
                in: RoundedRectangle(cornerRadius: radius, style: .continuous)
            )
            .onHover { hovering = $0 }
    }
}

/// The same entries as a system menu (a context menu or a submenu).
struct DesktopMenuItems: View {
    let entries: [DesktopMenuEntry]
    var after: () -> Void = {}

    var body: some View {
        ForEach(entries) { entry in
            switch entry.kind {
            case .divider:
                Divider()
            case let .action(perform):
                Button(role: entry.danger ? .destructive : nil) {
                    after()
                    perform()
                } label: {
                    if let icon = entry.icon {
                        Label(entry.title, systemImage: icon.symbol)
                    } else {
                        Text(verbatim: entry.title)
                    }
                }
                .disabled(entry.disabled)
            case let .submenu(children):
                Menu {
                    DesktopMenuItems(entries: children, after: after)
                } label: {
                    if let icon = entry.icon {
                        Label(entry.title, systemImage: icon.symbol)
                    } else {
                        Text(verbatim: entry.title)
                    }
                }
                .disabled(entry.disabled || children.isEmpty)
            }
        }
    }
}

/// The shell's layer for the open popover: a tap outside closes it.
struct DesktopMenuLayer: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var prefs = SidebarPrefsModel.shared

    var body: some View {
        GeometryReader { geometry in
            if let request = model.menu {
                let menus = DesktopSidebarMenus(session: session, model: model, prefs: prefs)
                let (entries, style) = menus.entries(for: request.kind)
                if !entries.isEmpty {
                    let size = CGSize(width: style.width, height: style.height(entries))
                    let origin = Self.origin(request, size: size, in: geometry.size)
                    ZStack(alignment: .topLeading) {
                        Color.black.opacity(0.001)
                            .contentShape(Rectangle())
                            .onTapGesture { model.menu = nil }
                            .accessibilityHidden(true)
                        DesktopMenuPanel(entries: entries, style: style) { model.menu = nil }
                            .offset(x: origin.x, y: origin.y)
                        // Esc closes it, as on the desktop
                        Button("") { model.menu = nil }
                            .keyboardShortcut(.cancelAction)
                            .opacity(0)
                            .accessibilityHidden(true)
                    }
                }
            }
        }
        .ignoresSafeArea()
    }

    /// Kept 8 pt inside the window, as `BotContextMenu` clamps it.
    static func origin(_ request: DesktopMenuRequest, size: CGSize, in bounds: CGSize) -> CGPoint {
        let y = request.opensUp ? request.anchor.y - size.height : request.anchor.y
        return CGPoint(
            x: max(8, min(request.anchor.x, bounds.width - size.width - 8)),
            y: max(8, min(y, bounds.height - size.height - 8))
        )
    }
}

// MARK: - The menus

/// The entries of every sidebar menu, from the session and the gate.
@MainActor
struct DesktopSidebarMenus {
    let session: Session
    let model: DesktopShellModel
    let prefs: SidebarPrefsModel

    private var gate: SurfaceGate { session.surfaceGate }
    private var showThreads: Bool { DesktopSidebarState.showThreads(model: model, prefs: prefs) }

    func entries(for kind: DesktopMenuRequest.Kind) -> ([DesktopMenuEntry], DesktopMenuStyle) {
        switch kind {
        case let .bot(id):
            guard let bot = session.state.bot(id) else { return ([], .standard) }
            return (self.bot(bot), .standard)
        case let .room(id):
            guard let room = session.state.rooms.first(where: { $0.id == id }) else { return ([], .standard) }
            return (self.room(room), .standard)
        case let .section(id):
            return (section(id), .section)
        case .profile:
            return (profile(), .profile)
        case .new:
            return (new(), .new)
        }
    }

    // MARK: Bot row (BotContextMenu)

    func bot(_ bot: Bot) -> [DesktopMenuEntry] {
        var out: [DesktopMenuEntry] = []
        if showThreads {
            out.append(DesktopMenuEntry(id: "new-thread", title: String(localized: "New thread"), icon: .plus, kind: .action {
                Task {
                    if let created = await session.createRosterThread(for: bot) {
                        model.openThreadLists.insert(bot.id)
                        model.open(.bot(created))
                    }
                }
            }))
            if gate.allows(.threadFolders) {
                out.append(DesktopMenuEntry(id: "new-folder", title: String(localized: "New folder"), icon: .folderPlus, kind: .action {
                    model.openThreadLists.insert(bot.id)
                    model.threadActions.newFolder(for: bot)
                }))
            }
            out.append(.divider("threads"))
        }
        // "Put on the desktop" floats a bot in its own window: none on iPad.
        let copyId = DesktopMenuEntry(id: "copy-id", title: String(localized: "Copy conversation ID"), icon: .clipboardCopy, kind: .action {
            model.threadActions.copyConversationId(bot)
        })
        if gate.scope == .sidecar {
            // The remote client's bot menu (Sidebar.tsx, remoteClient)
            if let move = moveBot(bot) { out.append(move) }
            out.append(DesktopMenuEntry(id: "edit-profile", title: String(localized: "Edit profile"), icon: .pencil, kind: .action {
                model.open(.bot(bot))
                model.panelOpen = true
            }))
            out.append(copyId)
            return out
        }
        if bot.chiefOfStaff != true {
            out.append(DesktopMenuEntry(
                id: "pin", title: bot.pinned == true ? String(localized: "Unpin") : String(localized: "Pin"),
                icon: bot.pinned == true ? .pinOff : .pin,
                kind: .action { Task { await session.setPinned(bot, pinned: bot.pinned != true) } }
            ))
        }
        if let move = moveBot(bot) { out.append(move) }
        out.append(DesktopMenuEntry(id: "mark-unread", title: String(localized: "Mark as Unread"), icon: .bellDot, kind: .action {
            model.threadActions.markUnread(bot, session: session)
        }))
        out.append(.divider("d1"))
        out.append(DesktopMenuEntry(id: "rename", title: String(localized: "Rename Bot"), icon: .pencil, kind: .action {
            model.renameDraft = bot.name
            model.renamingBot = bot
        }))
        out.append(copyId)
        out.append(.divider("d2"))
        out.append(DesktopMenuEntry(id: "hide", title: String(localized: "Hide from sidebar"), icon: .eyeOff, kind: .action {
            prefs.hide(session, .bot, bot.id)
        }))
        if gate.allows(.botOwnerExtras) {
            out.append(DesktopMenuEntry(id: "delete", title: String(localized: "Delete"), icon: .trash, danger: true, kind: .action {
                model.deletingBot = bot
            }))
        }
        return out
    }

    /// "Move to": the person's own sections on an organization server, the
    /// server's teams for a pairing that may file bots.
    private func moveBot(_ bot: Bot) -> DesktopMenuEntry? {
        let layout = prefs.layout(session)
        let title = String(localized: "Move to")
        if layout.personal {
            let key = PersonalSections.itemKey(bot: bot.id)
            let current = (prefs.personal ?? .empty).section(of: key)
            var children = layout.sectionNames.filter { $0 != current }.map { name in
                DesktopMenuEntry(id: "move.\(name)", title: name, kind: .action {
                    model.sectionActions.error = prefs.assignPersonal(session, key: key, to: name)
                })
            }
            if current != nil {
                children.append(DesktopMenuEntry(id: "move.general", title: String(localized: "Move to General"), icon: .folderInput, kind: .action {
                    model.sectionActions.error = prefs.assignPersonal(session, key: key, to: "")
                }))
            }
            children.append(DesktopMenuEntry(id: "move.new", title: String(localized: "New section…"), icon: .folderPlus, kind: .action {
                model.sectionActions.startNew(assigning: key)
            }))
            return DesktopMenuEntry(id: "move", title: title, icon: .folderPlus, kind: .submenu(children))
        }
        guard session.canAdminister || gate.scope == .sidecar else { return nil }
        let current = bot.section?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        var children = session.state.sidebarSections.map(\.name).filter { $0 != current }.map { name in
            DesktopMenuEntry(id: "move.\(name)", title: name, kind: .action {
                Task { await session.assignSection(name: name, botIds: [bot.id]) }
            })
        }
        if !current.isEmpty, gate.allows(.sectionManagement) {
            children.append(DesktopMenuEntry(id: "move.general", title: String(localized: "Move to General"), icon: .folderInput, kind: .action {
                Task { _ = await session.setServerSectionBots(current, add: [], remove: [bot.id]) }
            }))
        }
        return DesktopMenuEntry(id: "move", title: title, icon: .folderPlus, kind: .submenu(children))
    }

    // MARK: Room row (RoomContextMenu)

    func room(_ room: Room) -> [DesktopMenuEntry] {
        var out: [DesktopMenuEntry] = []
        let access = session.roomAccess(room)
        let actions = model.roomActions
        if session.groupPinsSupported, gate.scope != .sidecar {
            out.append(DesktopMenuEntry(
                id: "pin", title: room.pinned == true ? String(localized: "Unpin") : String(localized: "Pin"),
                icon: room.pinned == true ? .pinOff : .pin,
                kind: .action { Task { await session.setPinned(room, pinned: room.pinned != true) } }
            ))
        }
        if access.editable {
            out.append(DesktopMenuEntry(id: "rename", title: String(localized: "Rename group chat"), icon: .pencil, kind: .action {
                actions.startRename(room)
            }))
        }
        let layout = prefs.layout(session)
        if layout.personal, room.dm != true, room.peopleDm != true {
            let key = PersonalSections.itemKey(group: room.id)
            let current = (prefs.personal ?? .empty).section(of: key)
            var children = layout.sectionNames.filter { $0 != current }.map { name in
                DesktopMenuEntry(id: "move.\(name)", title: name, kind: .action {
                    model.sectionActions.error = prefs.assignPersonal(session, key: key, to: name)
                })
            }
            if current != nil {
                children.append(DesktopMenuEntry(id: "move.general", title: String(localized: "Move to General"), icon: .folderInput, kind: .action {
                    model.sectionActions.error = prefs.assignPersonal(session, key: key, to: "")
                }))
            }
            out.append(DesktopMenuEntry(id: "move", title: String(localized: "Move to"), icon: .folderPlus, kind: .submenu(children)))
        } else if !layout.personal, access.canMoveSection {
            let current = room.section?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            var children = RoomSections.names(session.state).filter { $0 != current }.map { name in
                DesktopMenuEntry(id: "move.\(name)", title: name, kind: .action { actions.move(room, to: name, session) })
            }
            children.append(DesktopMenuEntry(id: "move.new", title: String(localized: "New section"), icon: .folderPlus, kind: .action {
                actions.sectionDraft = ""
                actions.newSectionFor = room
            }))
            if !current.isEmpty {
                children.append(DesktopMenuEntry(id: "move.none", title: String(localized: "Remove from section"), danger: true, kind: .action {
                    actions.move(room, to: "", session)
                }))
            }
            out.append(DesktopMenuEntry(id: "move", title: String(localized: "Move to"), icon: .folderPlus, kind: .submenu(children)))
        }
        out.append(DesktopMenuEntry(id: "copy-id", title: String(localized: "Copy conversation ID"), icon: .clipboardCopy, kind: .action {
            actions.copyConversationId(room)
        }))
        out.append(DesktopMenuEntry(id: "hide", title: String(localized: "Hide from sidebar"), icon: .eyeOff, kind: .action {
            prefs.hide(session, room: room)
        }))
        if access.canDelete {
            out.append(.divider("delete"))
            out.append(DesktopMenuEntry(id: "delete", title: String(localized: "Delete group chat"), icon: .trash, danger: true, kind: .action {
                actions.deleting = room
            }))
        }
        return out
    }

    // MARK: Section header (TeamMenuItems, OrgSectionMenu)

    func section(_ id: String) -> [DesktopMenuEntry] {
        let layout = prefs.layout(session)
        let actions = model.sectionActions
        let name = SidebarSectionID.userName(id)
        var out: [DesktopMenuEntry] = []
        if layout.personal {
            out.append(DesktopMenuEntry(id: "new", title: String(localized: "New section…"), icon: .plus, kind: .action { actions.startNew() }))
            if let name {
                out.append(DesktopMenuEntry(id: "rename", title: String(localized: "Rename…"), icon: .pencil, kind: .action {
                    actions.startRename(name, personal: true)
                }))
            }
        } else if let name, gate.allows(.sectionManagement) {
            out.append(DesktopMenuEntry(id: "add-bots", title: String(localized: "Add bots"), icon: .users, kind: .action {
                actions.startEditingBots(name)
            }))
            out.append(DesktopMenuEntry(id: "rename", title: String(localized: "Rename team"), icon: .pencil, kind: .action {
                actions.startRename(name, personal: false)
            }))
        }
        var moves: [DesktopMenuEntry] = []
        if let name, layout.canMove(name, by: -1) {
            moves.append(DesktopMenuEntry(id: "up", title: String(localized: "Move up"), icon: .arrowUp, kind: .action {
                prefs.moveSection(session, name, by: -1)
            }))
        }
        if let name, layout.canMove(name, by: 1) {
            moves.append(DesktopMenuEntry(id: "down", title: String(localized: "Move down"), icon: .arrowDown, kind: .action {
                prefs.moveSection(session, name, by: 1)
            }))
        }
        let delete: DesktopMenuEntry?
        if let name, layout.personal {
            delete = DesktopMenuEntry(id: "delete", title: String(localized: "Delete section"), icon: .trash, danger: true, kind: .action {
                actions.startDelete(.personal(name))
            })
        } else if let name, gate.allows(.sectionManagement) {
            delete = DesktopMenuEntry(id: "delete", title: String(localized: "Delete team"), icon: .trash, danger: true, kind: .action {
                actions.startDelete(.server(name))
            })
        } else {
            delete = nil
        }
        if let delete { out.append(delete) }
        if !moves.isEmpty {
            if !out.isEmpty { out.append(.divider("moves")) }
            out += moves
        }
        return out
    }

    // MARK: Account (SidebarProfileMenu)

    func profile() -> [DesktopMenuEntry] {
        // "Get Sagax for iOS" is this app; the desktop's own row is left out.
        [
            DesktopMenuEntry(id: "settings", title: String(localized: "Settings"), icon: .settings, kind: .action {
                model.modal = .settings
            }),
            DesktopMenuEntry(id: "shortcuts", title: String(localized: "Keyboard shortcuts"), icon: .keyboard, shortcut: "⌘ /", kind: .action {
                model.modal = .shortcuts
            }),
            .divider("about"),
            DesktopMenuEntry(id: "about", title: String(localized: "About"), icon: .info, kind: .action {
                model.modal = .about
            }),
            DesktopMenuEntry(id: "help", title: String(localized: "Help Center"), icon: .help, kind: .action {
                if let url = URL(string: "https://github.com/pulsatrixtechnologies/sagax/tree/main/docs") {
                    UIApplication.shared.open(url)
                }
            }),
        ]
    }

    // MARK: New (⌘N)

    /// New: create a bot or a group chat, or open one of the first nine
    /// bots (⌘1 to ⌘9), as the desktop's compose-to picker lists them.
    func new() -> [DesktopMenuEntry] {
        var out: [DesktopMenuEntry] = []
        if gate.allows(.createBot) {
            out.append(DesktopMenuEntry(id: "new-bot", title: String(localized: "Create new Bot"), icon: .plus, kind: .action {
                model.modal = .newBot
            }))
        }
        out.append(DesktopMenuEntry(id: "new-group", title: String(localized: "Create group chat"), icon: .users, kind: .action {
            model.modal = .newGroup
        }))
        let bots = session.state.bots.filter { $0.hidden != true }.prefix(9)
        if !bots.isEmpty { out.append(.divider("bots")) }
        for (index, bot) in bots.enumerated() {
            out.append(DesktopMenuEntry(id: "bot.\(bot.id)", title: bot.name, shortcut: "⌘\(index + 1)", kind: .action {
                model.jump(to: index, in: session)
            }))
        }
        return out
    }
}
