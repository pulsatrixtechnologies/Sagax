// iPad I2 (first version): the desktop sidebar (`Sidebar.tsx`), comfortable
// density, measured in desktop-1366x1024-03-main.json: the 36 pt band, the
// brand row (mark, "Sagax", New), the search field, the pinned tiles, the
// collapsible sections with their rows (avatar 36, name, title chip,
// preview), the Team map and Automations links, the account row with the
// achievement points.
//
// Built from the phone's own state: `SidebarPrefsModel` (the person's
// sections, folds, order and hidden entries, WP6), the session's summaries,
// and the same pin and hide actions as the phone's row menu.
import SwiftUI
import UIKit
import CompanionCore

struct DesktopSidebar: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    @AppStorage(PrefKey.activityDetail) private var activityDetail = ActivityDetail.full.rawValue

    var body: some View {
        let layout = prefs.layout(session)
        return VStack(spacing: 0) {
            Color.clear.frame(height: DesktopShellRules.topBand)
            AnyView(brandRow)
            AnyView(searchField)
                .padding(.top, 6)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    AnyView(DesktopPinnedTiles(chats: pinnedChats(layout)))
                        .padding(.top, 18)
                    AnyView(sections(layout))
                }
                .padding(.bottom, 12)
            }
            .scrollIndicators(.never)
            AnyView(DesktopSidebarFooter())
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(theme.sidebar)
        .overlay(alignment: .trailing) {
            Rectangle().fill(theme.sidebarHairline.opacity(0.5)).frame(width: 0.5)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Bots and navigation"))
    }

    // MARK: Brand row

    private var brandRow: some View {
        HStack(spacing: 0) {
            Image("SagaxMark")
                .resizable()
                .renderingMode(.template)
                .scaledToFit()
                .foregroundStyle(theme.sidebarInk)
                .frame(width: 22, height: 17)
                .padding(.leading, 16)
            Text(verbatim: "Sagax")
                .font(theme.font(16, .semibold))
                .tracking(-0.16)
                .foregroundStyle(theme.sidebarInk)
                .padding(.leading, 8)
            Spacer(minLength: 0)
            Menu {
                if session.surfaceGate.allows(.createBot) {
                    Button { model.modal = .newBot } label: { Label("New bot", systemImage: "square.and.pencil") }
                }
                Button { model.modal = .newGroup } label: { Label("New group", systemImage: "person.2") }
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(theme.sidebarInkSecondary)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .hoverEffect(.highlight)
            .accessibilityLabel(Text("New"))
            .accessibilityIdentifier("desktop-sidebar-new")
            .padding(.trailing, 13)
        }
        .frame(height: 44)
    }

    // MARK: Search

    private var searchField: some View {
        Button { model.modal = .search } label: {
            HStack(spacing: 0) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(theme.sidebarInkSecondary)
                    .frame(width: 33, alignment: .center)
                Text("Search…")
                    .font(theme.font(13))
                    .foregroundStyle(theme.sidebarInkSecondary)
                Spacer(minLength: 0)
                DesktopKeycap(text: "⌘")
                DesktopKeycap(text: "K").padding(.leading, 2)
                    .padding(.trailing, 7)
            }
            .frame(height: 32)
            .background(theme.sidebarInk.opacity(0.05), in: RoundedRectangle(cornerRadius: theme.radiusLg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: theme.radiusLg, style: .continuous)
                    .strokeBorder(theme.sidebarHairline, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .keyboardShortcut("k", modifiers: .command)
        .padding(.leading, 8)
        .padding(.trailing, 13)
        .accessibilityLabel(Text("Search bots and messages"))
        .accessibilityIdentifier("desktop-sidebar-search")
    }

    // MARK: Pinned

    /// The Primary Bot (when it has no section), pinned bots, then pinned
    /// groups: the phone home's pinned grid, as the desktop's tiles.
    private func pinnedChats(_ layout: SidebarLayout) -> [Chat] {
        var chats: [Chat] = []
        if let chief = layout.unsectionedChief { chats.append(.bot(chief)) }
        chats += layout.pinnedBots.sorted { $0.createdAt < $1.createdAt }.map(Chat.bot)
        let shown = Set((layout.sections.flatMap(\.channels) + layout.unsectionedChannels).map(\.id))
        chats += session.state.rooms.filter { $0.dm != true && $0.pinned == true && shown.contains($0.id) }.map(Chat.room)
        return chats
    }

    // MARK: Sections

    private func sections(_ layout: SidebarLayout) -> some View {
        let previews = previewMap()
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(layout.sectionIds, id: \.self) { id in
                let rows = chats(for: id, in: layout)
                if !rows.isEmpty {
                    DesktopSidebarSection(
                        id: id,
                        title: title(for: id),
                        rows: rows,
                        previews: previews
                    )
                }
            }
        }
    }

    private func chats(for id: String, in layout: SidebarLayout) -> [Chat] {
        if id == SidebarSectionID.general {
            return layout.unsectionedBots.map(Chat.bot)
                + layout.unsectionedChannels.filter { $0.pinned != true }.map(Chat.room)
        }
        if id == SidebarSectionID.botChats {
            return layout.botChats.map(Chat.room)
        }
        guard let name = SidebarSectionID.userName(id),
              let section = layout.sections.first(where: { $0.name == name })
        else { return [] }
        return section.chiefs.map(Chat.bot)
            + section.channels.filter { $0.pinned != true }.map(Chat.room)
            + section.bots.map(Chat.bot)
    }

    private func title(for id: String) -> String {
        if id == SidebarSectionID.general { return String(localized: "General") }
        if id == SidebarSectionID.botChats { return String(localized: "Bot threads") }
        return SidebarSectionID.userName(id) ?? id
    }

    private func previewMap() -> [String: String] {
        let activity = ActivityDetail(rawValue: activityDetail) ?? .full
        var map: [String: String] = [:]
        for summary in session.state.chatSummaries(activity: activity) { map[summary.chat.id] = summary.preview }
        return map
    }
}

// MARK: - Keycap

struct DesktopKeycap: View {
    @Environment(\.desktopTheme) private var theme
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(theme.font(11))
            .foregroundStyle(theme.sidebarInkSecondary)
            .frame(minWidth: 17, minHeight: 16)
            .padding(.horizontal, 2)
            .background(theme.sidebarInk.opacity(0.05), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(theme.sidebarHairline, lineWidth: 1))
    }
}

// MARK: - Pinned tiles

/// 80 x 128 tiles, 8 pt apart and centred: a 72 pt mascot, the name 11/16,
/// the title badge 10/16. The selected tile is filled `sidebar-selected`.
struct DesktopPinnedTiles: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let chats: [Chat]

    var body: some View {
        if chats.isEmpty {
            EmptyView()
        } else {
            let columns = Array(repeating: GridItem(.fixed(80), spacing: 8), count: 3)
            LazyVGrid(columns: chats.count >= 3 ? columns : Array(columns.prefix(chats.count)), spacing: 8) {
                ForEach(chats, id: \.id) { chat in
                    tile(chat)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.trailing, 5)
        }
    }

    private func tile(_ chat: Chat) -> some View {
        let selected = model.selected?.id == chat.id
        return Button { model.open(session.threadSelection.restoringThread(chat, connectionID: session.connection?.id)) } label: {
            VStack(spacing: 0) {
                ChatAvatarView(chat: chat, size: 72, state: MausState.forChat(chat, in: session.state), background: theme.sidebar)
                    .frame(width: 72, height: 72)
                    .padding(.top, 6)
                Text(verbatim: PeopleDirectory.shared.name(chat, session: session))
                    .font(theme.font(11))
                    .tracking(0.055)
                    .foregroundStyle(theme.sidebarInk)
                    .lineLimit(1)
                    .frame(height: 16)
                    .padding(.top, 6)
                if let title = chat.desktopTitle {
                    DesktopTitleChip(text: title, size: 10)
                        .padding(.top, 6)
                }
                Spacer(minLength: 0)
            }
            .frame(width: 80, height: 128)
            .background(selected ? theme.sidebarSelected : .clear, in: RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .contextMenu { DesktopRowMenu(chat: chat) }
        .accessibilityIdentifier("desktop-pinned.\(chat.id)")
    }
}

/// The title badge after a name (rows) or under it (tiles).
struct DesktopTitleChip: View {
    @Environment(\.desktopTheme) private var theme
    let text: String
    var size: CGFloat = 11

    var body: some View {
        Text(verbatim: text)
            .font(theme.font(size, size >= 11 ? .medium : .regular))
            .foregroundStyle(theme.sidebarInkSecondary)
            .lineLimit(1)
            .padding(.horizontal, 6)
            .frame(height: 18)
            .frame(maxWidth: 79)
            .fixedSize(horizontal: true, vertical: false)
            .background(theme.sidebarInk.opacity(0.05), in: RoundedRectangle(cornerRadius: 5, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(theme.sidebarHairline, lineWidth: 1))
    }
}

extension Chat {
    /// The bot's title (its label), as the desktop's chip shows it.
    var desktopTitle: String? {
        guard case let .bot(bot) = self else { return nil }
        let title = bot.title.trimmingCharacters(in: .whitespacesAndNewlines)
        return title.isEmpty ? nil : title
    }
}

// MARK: - Sections

/// A section header (11/16 medium, uppercase, tracking 0.44, chevron) and,
/// unless folded, its rows.
struct DesktopSidebarSection: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    let id: String
    let title: String
    let rows: [Chat]
    let previews: [String: String]

    var body: some View {
        let collapsed = prefs.isCollapsed(id)
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.snappy(duration: 0.2)) { prefs.toggleCollapsed(session, id) }
            } label: {
                HStack(spacing: 0) {
                    Text(verbatim: title.uppercased())
                        .font(theme.font(11, .medium))
                        .tracking(0.44)
                        .foregroundStyle(theme.sidebarInkSecondary)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(theme.sidebarInkSecondary)
                        .rotationEffect(.degrees(collapsed ? -90 : 0))
                }
                .padding(.leading, 12)
                .padding(.trailing, 10)
                .frame(height: 30)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .accessibilityAddTraits(.isHeader)
            .accessibilityValue(Text(collapsed ? "Collapsed" : "Expanded"))
            if !collapsed {
                VStack(spacing: 2) {
                    ForEach(rows, id: \.id) { chat in
                        DesktopSidebarRow(chat: chat, preview: previews[chat.id] ?? "")
                    }
                }
                .padding(.top, 6)
            }
        }
        .padding(.leading, 8)
        .padding(.trailing, 13)
        .padding(.top, 14)
    }
}

/// A comfortable row: 259 x 54, avatar 36 at x 8, name 14/20 medium, the
/// title chip, the preview 13/18 secondary.
struct DesktopSidebarRow: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let chat: Chat
    let preview: String

    var body: some View {
        let selected = model.selected?.id == chat.id
        Button { model.open(session.threadSelection.restoringThread(chat, connectionID: session.connection?.id)) } label: {
            HStack(spacing: 0) {
                ChatAvatarView(chat: chat, size: 36, state: MausState.forChat(chat, in: session.state), background: theme.sidebar)
                    .frame(width: 36, height: 36)
                    .padding(.leading, 8)
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 6) {
                        Text(verbatim: PeopleDirectory.shared.name(chat, session: session))
                            .font(theme.font(14, .medium))
                            .foregroundStyle(theme.sidebarInk)
                            .lineLimit(1)
                            .layoutPriority(1)
                        if let title = chat.desktopTitle { DesktopTitleChip(text: title) }
                    }
                    .frame(height: 20)
                    if !preview.isEmpty {
                        Text(verbatim: preview)
                            .font(theme.font(13))
                            .foregroundStyle(theme.sidebarInkSecondary)
                            .lineLimit(1)
                            .frame(height: 18)
                            .padding(.trailing, 28)
                    }
                }
                .padding(.leading, 8)
                Spacer(minLength: 0)
                if chat.unread && !chat.busy {
                    Circle().fill(theme.accent).frame(width: 8, height: 8).padding(.trailing, 10)
                        .accessibilityLabel(Text("Unread"))
                }
            }
            .frame(height: 54)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? theme.sidebarSelected : .clear, in: RoundedRectangle(cornerRadius: theme.radiusLg, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .contextMenu { DesktopRowMenu(chat: chat) }
        .accessibilityIdentifier("desktop-row.\(chat.id)")
    }
}

/// A row's long press / right click: the items of the phone's row menu that
/// the desktop's bot and room menus share (I2 adds the rest).
struct DesktopRowMenu: View {
    @EnvironmentObject private var session: Session
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    let chat: Chat

    var body: some View {
        switch chat {
        case let .bot(bot):
            if bot.chiefOfStaff != true {
                Button {
                    Task { await session.setPinned(bot, pinned: bot.pinned != true) }
                } label: {
                    Label(bot.pinned == true ? "Unpin" : "Pin", systemImage: bot.pinned == true ? "pin.slash" : "pin")
                }
            }
            Button {
                UIPasteboard.general.string = bot.threadId
            } label: {
                Label("Copy conversation ID", systemImage: "doc.on.doc")
            }
            Button {
                prefs.hide(session, .bot, bot.id)
            } label: {
                Label("Hide from sidebar", systemImage: "eye.slash")
            }
        case let .room(room):
            if session.groupPinsSupported {
                Button {
                    Task { await session.setPinned(room, pinned: room.pinned != true) }
                } label: {
                    Label(room.pinned == true ? "Unpin" : "Pin", systemImage: room.pinned == true ? "pin.slash" : "pin")
                }
            }
            Button {
                UIPasteboard.general.string = room.threadId
            } label: {
                Label("Copy conversation ID", systemImage: "doc.on.doc")
            }
            Button {
                prefs.hide(session, room: room)
            } label: {
                Label("Hide from sidebar", systemImage: "eye.slash")
            }
        }
    }
}

// MARK: - Footer

/// Team map, Automations, the hairline and the account row (initials 28,
/// name 13 medium, the achievement points under it when shown).
struct DesktopSidebarFooter: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var achievements = AchievementStore.shared

    var body: some View {
        VStack(spacing: 2) {
            if session.connection != nil, session.surfaceGate.allows(.teamMap) {
                link("Team map", systemImage: "point.3.connected.trianglepath.dotted", id: "team-map") { model.modal = .teamMap }
            }
            if session.connection != nil {
                link("Automations", systemImage: "calendar", id: "automations") { model.modal = .automations }
            }
            Rectangle().fill(theme.sidebarHairline).frame(height: 1)
                .padding(.horizontal, 8)
                .padding(.top, 6)
                .padding(.bottom, 7)
            account
        }
        .padding(.leading, 8)
        .padding(.trailing, 13)
        .padding(.bottom, 12)
    }

    private func link(_ title: LocalizedStringKey, systemImage: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 0) {
                Image(systemName: systemImage)
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(theme.sidebarInkSecondary)
                    .frame(width: 38, alignment: .center)
                Text(title)
                    .font(theme.font(13))
                    .foregroundStyle(theme.sidebarInkSecondary)
                Spacer(minLength: 0)
            }
            .frame(height: 36)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityIdentifier("desktop-sidebar-\(id)")
    }

    private var account: some View {
        Button { model.modal = .settings } label: {
            HStack(spacing: 10) {
                Text(verbatim: initials)
                    .font(theme.font(10.64, .medium))
                    .foregroundStyle(theme.sidebarInkSecondary)
                    .frame(width: 28, height: 28)
                    .background(theme.raised, in: Circle())
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
            .frame(minHeight: 40)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(Text(displayName))
        .accessibilityHint(Text("Opens Settings"))
        .accessibilityIdentifier("desktop-sidebar-account")
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

struct DesktopCompactLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon
            configuration.title
        }
    }
}
