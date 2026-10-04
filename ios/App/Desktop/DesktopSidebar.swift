// iPad I2: the desktop sidebar (`Sidebar.tsx`), measured in the DOM dumps
// desktop-<W>x<H>-03-main (comfortable), -04-main-compact, -05-main-collapsed
// (the 80 pt icon rail) and -06-main-threads: the 36 pt band, the brand row
// (mark, "Sagax", New, collapse), the search field, the pinned tiles, the
// collapsible sections and their rows, the places (Team map, Automations,
// Connected apps) and the account row with its menu.
//
// Built from the phone's own state: `SidebarPrefsModel` (the person's
// sections, folds, order, hidden entries and the thread switch, WP6), the
// session's summaries, the WP5 thread and folder actions and the WP11 room
// prompts. Only the presentation is the desktop's.
//
// Sub-trees are type-erased (`AnyView`) at each column and list boundary:
// build 6 crashed at launch on iPad resolving one deep SwiftUI type.
import SwiftUI
import UIKit
import CompanionCore

/// The desktop's sidebar densities (`SidebarDensity`).
enum DesktopSidebarDensity: String, CaseIterable, Identifiable {
    case comfortable, compact, icons
    var id: String { rawValue }
}

/// What every sidebar view reads the same way.
@MainActor
enum DesktopSidebarState {
    /// Settings > Appearance > Show threads, or the parity surface's preset.
    static func showThreads(model: DesktopShellModel, prefs: SidebarPrefsModel) -> Bool {
        #if DEBUG
        if let preset = model.parityShowThreads { return preset }
        #endif
        return prefs.showThreads
    }
}

/// The shell's coordinate space, for menus anchored to a row.
let desktopShellSpace = "desktop-shell"

struct DesktopSidebar: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var prefs = SidebarPrefsModel.shared

    var body: some View {
        let layout = prefs.layout(session)
        let icons = model.density == .icons
        return VStack(spacing: 0) {
            Color.clear.frame(height: DesktopShellRules.topBand)
            if icons {
                AnyView(DesktopRailHead())
            } else {
                AnyView(DesktopSidebarHead())
            }
            AnyView(DesktopSidebarList(layout: layout))
                .frame(maxHeight: .infinity)
            AnyView(DesktopSidebarFooter())
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(theme.sidebar)
        .overlay(alignment: .trailing) {
            // border-r-[0.5px] border-hairline-weak
            Rectangle().fill(theme.sidebarInk.opacity(0.10)).frame(width: 0.5)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Bots and navigation"))
    }
}

// MARK: - Head

/// The brand row (h 44: mark 22 at x 16, "Sagax" 16/20 semibold at x 46,
/// New and Collapse 32 pt squares at x 201 and 235) and the search field
/// (8, 86, 259 x 32).
struct DesktopSidebarHead: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var model: DesktopShellModel

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                Image(theme.sidebarIsDark ? "PulsatrixMark-dark" : "PulsatrixMark-light")
                    .resizable()
                    .renderingMode(.original)
                    .scaledToFit()
                    .frame(width: 22, height: 17)
                    .padding(.leading, 16)
                    .accessibilityHidden(true)
                Text(verbatim: "Sagax")
                    .font(theme.font(16, .semibold))
                    .tracking(-0.16)
                    .foregroundStyle(theme.sidebarInk)
                    .lineLimit(1)
                    .padding(.leading, 8)
                Spacer(minLength: 0)
                DesktopNewButton()
                DesktopHeadButton(icon: .panelLeftClose, label: "Collapse sidebar to avatars", id: "desktop-sidebar-collapse") {
                    model.toggleCollapsed()
                }
                .padding(.leading, 2)
                .padding(.trailing, 13)
            }
            .frame(height: 44)
            DesktopSearchField()
                .padding(.top, 6)
                .padding(.leading, 8)
                .padding(.trailing, 13)
                .padding(.bottom, 8)
        }
    }
}

/// The rail's head: Expand, Search and New, 32 pt squares 4 apart.
struct DesktopRailHead: View {
    @EnvironmentObject private var model: DesktopShellModel

    var body: some View {
        VStack(spacing: 4) {
            DesktopHeadButton(icon: .panelLeftOpen, label: "Expand sidebar", id: "desktop-sidebar-expand") {
                model.toggleCollapsed()
            }
            DesktopHeadButton(icon: .search, label: "Search bots and messages", id: "desktop-sidebar-search") {
                model.modal = .search
            }
            DesktopNewButton()
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 4)
        .padding(.bottom, 8)
    }
}

/// A 32 pt ghost square with an 18 pt icon (`SIDEBAR_HEAD_BUTTON`).
struct DesktopHeadButton: View {
    @Environment(\.desktopTheme) private var theme
    let icon: DesktopIcon
    let label: LocalizedStringKey
    let id: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            DesktopIconView(icon: icon, size: 18, strokeWidth: 1.75)
                .foregroundStyle(hovering ? theme.sidebarInk : theme.sidebarInkSecondary)
                .frame(width: 32, height: 32)
                .background(hovering ? theme.sidebarHover : .clear, in: RoundedRectangle(cornerRadius: theme.radiusLg, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityLabel(Text(label))
        .accessibilityIdentifier(id)
    }
}

/// New: the desktop's compose-to picker (create a bot, a group chat, or
/// open one of the first nine bots), anchored under the button. ⌘N.
struct DesktopNewButton: View {
    @EnvironmentObject private var model: DesktopShellModel

    var body: some View {
        GeometryReader { geometry in
            DesktopHeadButton(icon: .plus, label: "New", id: "desktop-sidebar-new") {
                let frame = geometry.frame(in: .named(desktopShellSpace))
                model.menu = DesktopMenuRequest(kind: .new, anchor: CGPoint(x: frame.minX, y: frame.maxY + 4))
            }
        }
        .frame(width: 32, height: 32)
    }
}

/// The search field: opens the palette (⌘K).
struct DesktopSearchField: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var model: DesktopShellModel

    var body: some View {
        Button { model.modal = .search } label: {
            HStack(spacing: 0) {
                DesktopIconView(icon: .search, size: 14)
                    .foregroundStyle(theme.sidebarInkSecondary)
                    .padding(.leading, 10)
                Text("Search…")
                    .font(theme.font(13))
                    .foregroundStyle(theme.sidebarInkSecondary)
                    .lineLimit(1)
                    .padding(.leading, 8)
                Spacer(minLength: 0)
                DesktopKeycap(text: "⌘")
                DesktopKeycap(text: "K").padding(.leading, 2)
                    .padding(.trailing, 6)
            }
            .frame(height: 30)
            .background(theme.sidebarInk.opacity(0.05), in: RoundedRectangle(cornerRadius: theme.radiusLg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: theme.radiusLg, style: .continuous)
                    .strokeBorder(theme.sidebarHairline, lineWidth: 1)
                    .padding(-1)
            )
            .padding(1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Search bots and messages"))
        .accessibilityIdentifier("desktop-sidebar-search")
    }
}

// MARK: - Keycap

/// `kbd`: 16 tall, at least 16 wide, radius 5, 11 pt, 4 pt padding.
struct DesktopKeycap: View {
    @Environment(\.desktopTheme) private var theme
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(theme.font(11))
            .foregroundStyle(theme.sidebarInkSecondary)
            .padding(.horizontal, 4)
            .frame(minWidth: 16, minHeight: 16, maxHeight: 16)
            .background(theme.sidebarInk.opacity(0.05), in: RoundedRectangle(cornerRadius: 5, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(theme.sidebarHairline, lineWidth: 1))
    }
}

// MARK: - List

/// The scrolling list: pinned tiles, then each section. Its edges fade like
/// the desktop's (`useScrollFade`: the top 28 once scrolled, the bottom 48
/// while more is below).
struct DesktopSidebarList: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    @AppStorage(PrefKey.activityDetail) private var activityDetail = ActivityDetail.full.rawValue
    let layout: SidebarLayout
    @State private var contentFrame: CGRect = .zero
    @State private var viewport: CGFloat = 0

    var body: some View {
        let icons = model.density == .icons
        let previews = previewMap()
        let sections = DesktopSidebarSections.visible(layout, session: session)
        let fadeTop = contentFrame.minY < -1
        let fadeBottom = contentFrame.maxY > viewport + 1
        return GeometryReader { outer in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    AnyView(DesktopPinnedTiles(chats: pinnedChats))
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(sections.enumerated()), id: \.element.id) { index, section in
                            AnyView(DesktopSidebarSection(
                                section: section,
                                first: index == 0,
                                previews: previews,
                                reorderable: sections.count > 1
                            ))
                        }
                        if !icons, !layout.hiddenRows.isEmpty {
                            AnyView(DesktopHiddenEntries(rows: layout.hiddenRows))
                        }
                    }
                }
                .padding(.top, 4)
                .padding(.bottom, 24)
                .padding(.leading, 8)
                .padding(.trailing, icons ? 8.5 : 13)
                .background(GeometryReader { inner in
                    let frame = inner.frame(in: .named("desktop-sidebar-list"))
                    Color.clear
                        .onAppear { contentFrame = frame }
                        .onValueChange(of: frame) { contentFrame = $0 }
                })
            }
            .scrollIndicators(.never)
            .onAppear { viewport = outer.size.height }
            .onValueChange(of: outer.size.height) { viewport = $0 }
            .mask(
                LinearGradient(stops: [
                    .init(color: fadeTop ? .clear : .black, location: 0),
                    .init(color: .black, location: fadeTop ? min(0.5, 28 / max(outer.size.height, 1)) : 0),
                    .init(color: .black, location: fadeBottom ? max(0.5, 1 - 48 / max(outer.size.height, 1)) : 1),
                    .init(color: fadeBottom ? .clear : .black, location: 1),
                ], startPoint: .top, endPoint: .bottom)
            )
        }
        .coordinateSpace(name: "desktop-sidebar-list")
    }

    /// Pinned bots (`Sidebar.tsx` `pinnedBots`: bots only; a pinned group
    /// stays in its section), in the roster's order.
    private var pinnedChats: [Chat] {
        let pinned = Set(layout.pinnedBots.map(\.id))
        return session.state.bots.filter { pinned.contains($0.id) }.map(Chat.bot)
    }

    private func previewMap() -> [String: String] {
        let activity = ActivityDetail(rawValue: activityDetail) ?? .full
        var map: [String: String] = [:]
        for summary in session.state.chatSummaries(activity: activity) { map[summary.chat.id] = summary.preview }
        return map
    }
}

/// One sidebar section's rows, in the desktop's order (chiefs, groups, then
/// members).
struct DesktopSidebarSectionData: Identifiable {
    var id: String
    var title: String
    var rows: [Chat]
    /// The server or personal section name ("" for General).
    var name: String
}

enum DesktopSidebarSections {
    @MainActor
    static func visible(_ layout: SidebarLayout, session: Session) -> [DesktopSidebarSectionData] {
        layout.sectionIds.compactMap { id in
            let rows = chats(for: id, in: layout)
            guard !rows.isEmpty else { return nil }
            return DesktopSidebarSectionData(id: id, title: title(for: id), rows: rows, name: SidebarSectionID.userName(id) ?? "")
        }
    }

    static func chats(for id: String, in layout: SidebarLayout) -> [Chat] {
        if id == SidebarSectionID.general {
            let chief = layout.unsectionedChief.flatMap { $0.pinned == true ? nil : Chat.bot($0) }
            return (chief.map { [$0] } ?? [])
                + layout.unsectionedChannels.map(Chat.room)
                + layout.unsectionedBots.filter { $0.pinned != true }.map(Chat.bot)
        }
        if id == SidebarSectionID.botChats {
            return layout.botChats.map(Chat.room)
        }
        guard let name = SidebarSectionID.userName(id),
              let section = layout.sections.first(where: { $0.name == name })
        else { return [] }
        return section.chiefs.filter { $0.pinned != true }.map(Chat.bot)
            + section.channels.map(Chat.room)
            + section.bots.filter { $0.pinned != true }.map(Chat.bot)
    }

    static func title(for id: String) -> String {
        if id == SidebarSectionID.general { return String(localized: "General") }
        if id == SidebarSectionID.botChats { return String(localized: "Bot threads") }
        return SidebarSectionID.userName(id) ?? id
    }
}

// MARK: - Section

/// A section: its header (11/16 medium, uppercase, tracking 0.44, a 16 pt
/// chevron) and, unless folded, its rows. The rail draws rows only. A row
/// dropped here files it in this section, a header dropped here moves that
/// section before or after this one (DD1).
struct DesktopSidebarSection: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    let section: DesktopSidebarSectionData
    let first: Bool
    let previews: [String: String]
    let reorderable: Bool
    @State private var height: CGFloat = 0

    var body: some View {
        let icons = model.density == .icons
        let collapsed = !icons && prefs.isCollapsed(section.id)
        let targeted = model.dropTarget == section.id
        VStack(alignment: .leading, spacing: 4) {
            if !icons {
                AnyView(DesktopSectionHeader(section: section, collapsed: collapsed, reorderable: reorderable))
                    .padding(.bottom, 2)
            }
            if !collapsed {
                VStack(alignment: .leading, spacing: icons ? 4 : 2) {
                    ForEach(section.rows, id: \.id) { chat in
                        AnyView(DesktopSidebarRowGroup(chat: chat, preview: previews[chat.id] ?? "", sectionId: section.id))
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text(verbatim: section.title))
            }
        }
        .padding(.top, icons || first ? 0 : 10)
        .background(
            RoundedRectangle(cornerRadius: theme.radiusLg, style: .continuous)
                .fill(targeted ? theme.sidebarHover.opacity(0.7) : .clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: theme.radiusLg, style: .continuous)
                .strokeBorder(targeted ? theme.accent.opacity(0.5) : .clear, lineWidth: 1)
        )
        .background(GeometryReader { proxy in
            Color.clear.onAppear { height = proxy.size.height }
                .onValueChange(of: proxy.size.height) { height = $0 }
        })
        .dropDestination(for: String.self) { items, location in
            DesktopSidebarDrop.drop(items, on: section, after: location.y > height / 2, session: session, model: model, prefs: prefs)
        } isTargeted: { inside in
            if inside { model.dropTarget = section.id } else if model.dropTarget == section.id { model.dropTarget = nil }
        }
        .accessibilityIdentifier("desktop-section.\(section.id)")
    }
}

/// The header button: folds the section; long press or right click opens
/// the section menu; drag reorders.
struct DesktopSectionHeader: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    let section: DesktopSidebarSectionData
    let collapsed: Bool
    let reorderable: Bool
    @State private var hovering = false

    var body: some View {
        let menu = DesktopSidebarMenus(session: session, model: model, prefs: prefs).section(section.id)
        let header = Button {
            withAnimation(.snappy(duration: 0.2)) { prefs.toggleCollapsed(session, section.id) }
        } label: {
            HStack(spacing: 8) {
                Text(verbatim: section.title.uppercased())
                    .font(theme.font(11, .medium))
                    .tracking(0.44)
                    .lineLimit(1)
                if collapsed { attentionMarks }
                Spacer(minLength: 0)
                DesktopIconView(icon: .chevronRight, size: 16)
                    .rotationEffect(.degrees(collapsed ? 0 : 90))
            }
            .foregroundStyle(hovering ? theme.sidebarInk : theme.sidebarInkSecondary)
            .padding(.horizontal, 12)
            .frame(height: 30)
            .frame(maxWidth: .infinity)
            .background(hovering ? theme.sidebarHover : .clear, in: RoundedRectangle(cornerRadius: theme.radiusLg, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityAddTraits(.isHeader)
        .accessibilityValue(Text(collapsed ? "Collapsed" : "Expanded"))
        .accessibilityIdentifier("desktop-section-header.\(section.id)")
        return Group {
            if menu.isEmpty {
                AnyView(header)
            } else {
                AnyView(header.contextMenu { DesktopMenuItems(entries: menu) })
            }
        }
        .modifier(DesktopDraggable(payload: reorderable ? "section:\(section.id)" : nil))
    }

    /// A folded section's marks: waiting, unread and working counts.
    @ViewBuilder private var attentionMarks: some View {
        let waiting = section.rows.filter { $0.desktopStatus == .waitingOnYou }.count
        let unread = section.rows.filter { $0.unread && !$0.busy }.count
        let working = section.rows.contains { $0.desktopStatus == .working }
        if waiting > 0 { countBadge(waiting, tint: theme.warning) }
        if unread > 0 { countBadge(unread, tint: theme.accent) }
        if working {
            Circle().fill(theme.success).frame(width: 6, height: 6).frame(width: 16, height: 16)
        }
    }

    private func countBadge(_ count: Int, tint: Color) -> some View {
        Text(verbatim: "\(count)")
            .font(theme.font(9, .semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 4)
            .frame(minWidth: 16, minHeight: 16)
            .background(tint.opacity(0.15), in: Capsule())
    }
}

/// `.draggable` when there is something to drag.
struct DesktopDraggable: ViewModifier {
    let payload: String?

    func body(content: Content) -> some View {
        if let payload {
            content.draggable(payload)
        } else {
            content
        }
    }
}

/// DD1: what a drop on a section does, through the same calls as the menus
/// (WP6): a person's own sections on an organization server, the server's
/// teams (`POST /api/sidebar-sections`, or `PUT` to take one out) for a
/// pairing that may file bots, `PATCH /api/groups/:id` for a group; a
/// dropped header reorders the sections (the synced order).
@MainActor
enum DesktopSidebarDrop {
    @discardableResult
    static func drop(
        _ items: [String], on section: DesktopSidebarSectionData, after: Bool,
        session: Session, model: DesktopShellModel, prefs: SidebarPrefsModel
    ) -> Bool {
        model.dropTarget = nil
        guard let item = items.first else { return false }
        let layout = prefs.layout(session)
        if let from = item.stripping("section:") {
            let next = SidebarSectionID.place(layout.sectionIds, from, at: section.id, after: after)
            guard next != layout.sectionIds else { return false }
            prefs.setSectionOrder(session, next)
            return true
        }
        guard section.id != SidebarSectionID.botChats else { return false }
        if let id = item.stripping("bot:"), let bot = session.state.bot(id) {
            if layout.personal {
                model.sectionActions.error = prefs.assignPersonal(session, key: PersonalSections.itemKey(bot: id), to: section.name)
                return true
            }
            let current = bot.section?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard current != section.name else { return false }
            if section.name.isEmpty {
                guard session.surfaceGate.allows(.sectionManagement) else { return false }
                Task { _ = await session.setServerSectionBots(current, add: [], remove: [id]) }
            } else {
                guard session.canAdminister || session.surfaceGate.scope == .sidecar else { return false }
                Task { await session.assignSection(name: section.name, botIds: [id]) }
            }
            return true
        }
        if let id = item.stripping("room:"), let room = session.state.rooms.first(where: { $0.id == id }) {
            if layout.personal {
                model.sectionActions.error = prefs.assignPersonal(session, key: PersonalSections.itemKey(group: id), to: section.name)
                return true
            }
            guard session.roomAccess(room).canMoveSection else { return false }
            let current = room.section?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard current != section.name else { return false }
            model.roomActions.move(room, to: section.name, session)
            return true
        }
        return false
    }
}

private extension String {
    func stripping(_ prefix: String) -> String? {
        hasPrefix(prefix) ? String(dropFirst(prefix.count)) : nil
    }
}

// MARK: - Hidden entries

/// `HiddenEntriesRow`: "Hidden (N)", opening the list with Show.
struct DesktopHiddenEntries: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    let rows: [SidebarHiddenRow]
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Button { withAnimation(.snappy(duration: 0.2)) { open.toggle() } } label: {
                HStack(spacing: 8) {
                    DesktopIconView(icon: .eyeOff, size: 14)
                    Text("Hidden (\(rows.count))")
                        .font(theme.font(12))
                    Spacer(minLength: 0)
                    DesktopIconView(icon: .chevronRight, size: 14)
                        .rotationEffect(.degrees(open ? 90 : 0))
                }
                .foregroundStyle(theme.sidebarInkSecondary)
                .padding(.horizontal, 12)
                .frame(height: 30)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("desktop-sidebar-hidden")
            if open {
                ForEach(rows) { row in
                    HStack(spacing: 8) {
                        Text(verbatim: row.name)
                            .font(theme.font(13))
                            .foregroundStyle(theme.sidebarInkSecondary)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        Button {
                            prefs.show(session, [row.key])
                        } label: {
                            DesktopIconView(icon: .eye, size: 14)
                                .foregroundStyle(theme.sidebarInkSecondary)
                                .frame(width: 24, height: 24)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("Show \(row.name) in the sidebar"))
                        .accessibilityIdentifier("desktop-hidden-show.\(row.key)")
                    }
                    .padding(.leading, 34)
                    .padding(.trailing, 8)
                    .frame(height: 28)
                }
            }
        }
        .padding(.top, 10)
    }
}

// MARK: - Footer

/// The places (Team map, Automations, Connected apps: 36 pt rows, a 20 pt
/// icon at x 16, 13/20 at x 46), the hairline, and the account row (the
/// initials 28, the name 13/20 medium, the achievement points when shown)
/// opening the account menu. The rail keeps the same rows as icons.
struct DesktopSidebarFooter: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var achievements = AchievementStore.shared

    var body: some View {
        let icons = model.density == .icons
        return VStack(spacing: 2) {
            if session.connection != nil, session.surfaceGate.allows(.teamMap) {
                place("Team map", icon: .network, id: "team-map", icons: icons) { model.modal = .teamMap }
            }
            if session.connection != nil {
                place("Automations", icon: .calendarDays, id: "automations", icons: icons) { model.modal = .automations }
            }
            // The remote client keeps Connected apps; a client session may
            // not reach it. (Templates waits for its modal: nothing to open.)
            if session.connection != nil, session.surfaceGate.allows(.connectedApps) {
                place("Connected apps", icon: .puzzle, id: "connected-apps", icons: icons) { model.modal = .plugins }
            }
            Rectangle().fill(theme.sidebarHairline).frame(height: 1)
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
            if icons { railAccount } else { account }
        }
        .padding(.leading, 8)
        .padding(.trailing, icons ? 8.5 : 13)
        .padding(.top, 4)
        .padding(.bottom, 12)
    }

    private func place(_ title: LocalizedStringKey, icon: DesktopIcon, id: String, icons: Bool, action: @escaping () -> Void) -> some View {
        DesktopPlaceRow(title: title, icon: icon, id: id, iconOnly: icons, action: action)
    }

    private var account: some View {
        GeometryReader { geometry in
            Button {
                let frame = geometry.frame(in: .named(desktopShellSpace))
                model.menu = DesktopMenuRequest(kind: .profile, anchor: CGPoint(x: frame.minX, y: frame.minY - 4), opensUp: true)
            } label: {
                HStack(spacing: 10) {
                    initialsCircle
                    VStack(alignment: .leading, spacing: 0) {
                        Text(verbatim: displayName)
                            .font(theme.font(13, .medium))
                            .foregroundStyle(theme.sidebarInk)
                            .lineLimit(1)
                        if let snapshot = achievements.snapshot, snapshot.settings.showPoints {
                            Label {
                                Text("\(snapshot.points.formatted()) points")
                            } icon: {
                                Image(systemName: "trophy")
                            }
                            .labelStyle(DesktopCompactLabelStyle())
                            .font(theme.font(11))
                            .foregroundStyle(theme.sidebarInkSecondary)
                            .accessibilityIdentifier("desktop-sidebar-points")
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.leading, 8)
                .frame(height: 40)
                .contentShape(Rectangle())
            }
            .buttonStyle(DesktopSidebarRowButtonStyle())
            .accessibilityLabel(Text(displayName))
            .accessibilityHint(Text("Opens the account menu"))
            .accessibilityIdentifier("desktop-sidebar-account")
        }
        .frame(height: 40)
    }

    private var railAccount: some View {
        Button { model.modal = .settings } label: {
            initialsCircle
                .frame(width: 44, height: 40)
                .contentShape(Rectangle())
        }
        .buttonStyle(DesktopSidebarRowButtonStyle())
        .frame(maxWidth: .infinity)
        .accessibilityLabel(Text("App settings"))
        .accessibilityIdentifier("desktop-sidebar-account")
    }

    private var initialsCircle: some View {
        Text(verbatim: initials)
            .font(theme.font(10.64, .medium))
            .foregroundStyle(theme.sidebarInkSecondary)
            .frame(width: 28, height: 28)
            .background(theme.raised, in: Circle())
    }

    private var displayName: String {
        session.account?.name ?? session.account?.email ?? session.connection?.name ?? String(localized: "You")
    }

    private var initials: String {
        let words = displayName.split(whereSeparator: { $0 == " " || $0 == "@" || $0 == "." }).prefix(2)
        let letters = words.compactMap(\.first).map { String($0).uppercased() }.joined()
        return letters.isEmpty ? "?" : letters
    }
}

/// One place row (`SidebarPlaces`).
struct DesktopPlaceRow: View {
    @Environment(\.desktopTheme) private var theme
    let title: LocalizedStringKey
    let icon: DesktopIcon
    let id: String
    let iconOnly: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                DesktopIconView(icon: icon, size: 20)
                if !iconOnly {
                    Text(title)
                        .font(theme.font(13))
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
            }
            .foregroundStyle(theme.sidebarInkSecondary)
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, alignment: iconOnly ? .center : .leading)
            .frame(height: 36)
            .contentShape(Rectangle())
        }
        .buttonStyle(DesktopSidebarRowButtonStyle())
        .accessibilityLabel(Text(title))
        .accessibilityIdentifier("desktop-sidebar-\(id)")
    }
}

/// `hover:bg-sidebar-hover` on a sidebar button.
struct DesktopSidebarRowButtonStyle: ButtonStyle {
    @Environment(\.desktopTheme) private var theme
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                (hovering || configuration.isPressed) ? theme.sidebarHover : .clear,
                in: RoundedRectangle(cornerRadius: theme.radiusLg, style: .continuous)
            )
            .onHover { hovering = $0 }
    }
}

struct DesktopCompactLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon
            configuration.title
        }
    }
}
