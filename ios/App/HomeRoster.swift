// The standard home (reference 01): the person's photo and two glass
// buttons, pinned bots as large mascots in three columns, then collapsible
// sections of two-line rows. Every value is measured in
// docs/superpowers/specs/assets/ios-visual-parity/measure-home.md (pt).
//
// The parts live here; `ChatListView` assembles them and owns navigation.
import SwiftUI
import CompanionCore

/// The measured home geometry.
enum HomeMetrics {
    /// Header controls sit this far below the safe area (y 68 on a 62 pt top).
    static let headerTop: CGFloat = 6
    static let headerHeight: CGFloat = 44
    /// From the safe-area top to the first pinned mascot (y 149.3).
    static let pinnedTop: CGFloat = 87.3
    static let pinnedColumn: CGFloat = 134
    static let pinnedMascot: CGFloat = 85
    /// One pinned row, mascot top to the next block (149.3 to 281.7).
    static let pinnedRowHeight: CGFloat = 132.4
    static let pinnedLabelGap: CGFloat = 12
    static let unreadDot: CGFloat = 10
    /// 7.7 pt of ink between the label and the dot.
    static let unreadGap: CGFloat = 5.4

    static let sectionHeaderHeight: CGFloat = 41
    /// Header text line top inside its block (baseline 31.3).
    static let sectionHeaderTextTop: CGFloat = 19.87
    static let sectionLeading: CGFloat = 20.5

    static let rowHeight: CGFloat = 80
    static let rowMascot: CGFloat = 42
    static let rowLeading: CGFloat = 23
    static let textColumn: CGFloat = 81.8
    static let rowTrailing: CGFloat = 21.7
    /// A long role truncates inside its chip ("Department Man...").
    static let chipMaxWidth: CGFloat = 118
    /// Name line top inside the row (baseline at 35).
    static let nameTop: CGFloat = 21.67
    static let nameLine: CGFloat = 16.7
    /// Name line bottom to preview line top (preview baseline 55.7).
    static let previewGap: CGFloat = 5.43
    static let previewLine: CGFloat = 14.9
    static let previewIconBox: CGFloat = 12
    static let previewIconGap: CGFloat = 8

    static var font12: Font { Theme.font(12) }
    static var name: Font { Theme.font(14, .medium) }
    static var chevron: Color { Theme.parity(Color(hex: 0x3C3C3D), Theme.chevron) }
}

// MARK: - Collapsed sections

/// Which home sections are folded, per device. Stored as one string so a
/// section name with any characters round-trips.
struct CollapsedSections {
    static let key = "companion.home.collapsedSections"

    static func decode(_ raw: String) -> Set<String> {
        guard let data = raw.data(using: .utf8),
              let list = try? JSONDecoder().decode([String].self, from: data) else { return [] }
        return Set(list)
    }

    static func encode(_ set: Set<String>) -> String {
        guard let data = try? JSONEncoder().encode(set.sorted()) else { return "[]" }
        return String(decoding: data, as: UTF8.self)
    }
}

// MARK: - Header

/// The person's photo in a 44 pt glass ring (38 pt photo inset 3 pt).
struct HomeAccountButton: View {
    @Environment(\.themePalette) var themePalette
    let action: () -> Void
    @EnvironmentObject private var session: Session

    var body: some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            ZStack {
                if let photo = session.accountPhoto {
                    Image(uiImage: photo).resizable().scaledToFill()
                } else if let chief = fallbackBot {
                    Theme.card
                    MascotCharacterView(bot: chief, size: 30)
                } else {
                    ProfileAvatar(name: displayName, size: 38)
                }
            }
            .frame(width: 38, height: 38)
            .clipShape(Circle())
            .frame(width: Theme.Metric.glassLarge, height: Theme.Metric.glassLarge)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .themeGlass(Circle())
        .accessibilityLabel(Text("Settings"))
        .accessibilityIdentifier("home-account")
        // "photo" once the person's own picture shows (UI tests wait on it).
        .accessibilityValue(Text(verbatim: session.accountPhoto == nil ? "" : "photo"))
    }

    /// Without a photo or a name, the paired computer's own mascot: its
    /// Primary Bot when it has one.
    private var fallbackBot: Bot? {
        guard session.account?.name == nil, session.account?.email == nil else { return nil }
        return session.state.bots.first { $0.chiefOfStaff == true && $0.hidden != true }
    }

    private var displayName: String {
        session.account?.name ?? session.account?.email ?? session.connection?.name ?? "You"
    }
}

// MARK: - Pinned

/// A pinned bot or group: an 85 pt mascot, its name centred beneath with
/// the unread dot after it.
struct HomePinnedCell: View {
    @Environment(\.themePalette) var themePalette
    let chat: Chat
    var state: MausState = .idle

    @EnvironmentObject private var session: Session

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                switch chat {
                case let .bot(bot):
                    BotMascotView(bot: bot, size: HomeMetrics.pinnedMascot, state: state, animated: state.showsActivity)
                case let .room(room):
                    GroupMascotView(
                        members: room.memberIds.compactMap { session.state.bot($0) },
                        size: HomeMetrics.pinnedMascot,
                        background: Theme.bg
                    )
                }
            }
            .frame(width: HomeMetrics.pinnedMascot, height: HomeMetrics.pinnedMascot)

            HStack(spacing: HomeMetrics.unreadGap) {
                Text(verbatim: chat.name)
                    .font(.system(size: 11.65))
                    .foregroundStyle(Theme.textSecondaryHome)
                    .lineLimit(1)
                if case let .bot(bot) = chat, bot.chiefOfStaff == true {
                    PrimaryBotBadge(size: 10)
                        .padding(.leading, -4)
                }
                if chat.unread && !chat.busy {
                    Circle()
                        .fill(Theme.unreadDot)
                        .frame(width: HomeMetrics.unreadDot, height: HomeMetrics.unreadDot)
                        .accessibilityLabel(Text("Unread"))
                }
            }
            .padding(.top, HomeMetrics.pinnedLabelGap)
            .padding(.horizontal, 6)
            Spacer(minLength: 0)
        }
        .frame(width: HomeMetrics.pinnedColumn, height: HomeMetrics.pinnedRowHeight, alignment: .top)
        .contentShape(Rectangle())
    }
}

// MARK: - Section header

struct HomeSectionHeader: View {
    @Environment(\.themePalette) var themePalette
    let title: String
    let collapsed: Bool
    let toggle: () -> Void

    var body: some View {
        Button {
            Haptics.selection()
            withAnimation(.snappy(duration: 0.22)) { toggle() }
        } label: {
            HStack(spacing: 9) {
                Text(verbatim: title)
                    .font(.system(size: 12.33))
                    .foregroundStyle(Theme.textSecondaryHome)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(HomeMetrics.chevron)
                    .rotationEffect(.degrees(collapsed ? -90 : 0))
                Spacer(minLength: 0)
            }
            .frame(height: 14.32)
            .padding(.top, HomeMetrics.sectionHeaderTextTop)
            .padding(.leading, HomeMetrics.sectionLeading)
            .frame(height: HomeMetrics.sectionHeaderHeight, alignment: .top)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityValue(collapsed ? Text("Collapsed") : Text("Expanded"))
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Rows

/// What a row's trailing side shows besides the time.
struct HomeRowStatus: Equatable {
    var waiting = false
    var working = false
    var threadCount = 0
    var unread = false
}

/// One bot or group on two lines: 42 pt mascot, name, role chip and time,
/// then the preview with its leading icon.
struct HomeChatRow: View {
    @Environment(\.themePalette) var themePalette
    let chat: Chat
    let preview: RosterPreviewLine
    let stamp: String
    var status = HomeRowStatus()
    var state: MausState = .idle

    @EnvironmentObject private var session: Session

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Group {
                switch chat {
                case let .bot(bot):
                    BotMascotView(bot: bot, size: HomeMetrics.rowMascot, state: state, animated: state.showsActivity)
                case let .room(room):
                    GroupMascotView(
                        members: room.memberIds.compactMap { session.state.bot($0) },
                        size: HomeMetrics.rowMascot,
                        background: Theme.bg
                    )
                }
            }
            .frame(width: HomeMetrics.rowMascot, height: HomeMetrics.rowMascot)
            .padding(.top, (HomeMetrics.rowHeight - HomeMetrics.rowMascot) / 2)
            .accessibilityHidden(true)
            .padding(.leading, HomeMetrics.rowLeading)

            VStack(alignment: .leading, spacing: HomeMetrics.previewGap) {
                nameLine.frame(height: HomeMetrics.nameLine)
                previewLine.frame(height: HomeMetrics.previewLine)
            }
            .padding(.top, HomeMetrics.nameTop)
            .padding(.leading, HomeMetrics.textColumn - HomeMetrics.rowLeading - HomeMetrics.rowMascot)
            .padding(.trailing, HomeMetrics.rowTrailing)
        }
        .frame(maxWidth: .infinity, minHeight: HomeMetrics.rowHeight, maxHeight: HomeMetrics.rowHeight, alignment: .topLeading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var role: String {
        if case let .bot(bot) = chat { return bot.displayRole }
        return ""
    }

    private var nameLine: some View {
        HStack(spacing: 7.5) {
            HStack(spacing: 5) {
                Text(verbatim: chat.name)
                    .font(HomeMetrics.name)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                if case let .bot(bot) = chat, bot.chiefOfStaff == true {
                    PrimaryBotBadge(size: 12)
                }
            }
            .layoutPriority(2)
            if !role.isEmpty {
                RoleChip(text: role, font: .system(size: 11.65, weight: .medium), horizontalPadding: 6)
                    .frame(maxWidth: HomeMetrics.chipMaxWidth, alignment: .leading)
                    .layoutPriority(0)
            }
            Spacer(minLength: 8)
            trailing.layoutPriority(1)
        }
    }

    private var trailing: some View {
        HStack(spacing: 6) {
            if status.threadCount >= 2 {
                HStack(spacing: 2) {
                    Image(systemName: "square.stack")
                        .font(.system(size: 10))
                    Text(verbatim: "\(status.threadCount)")
                        .font(Theme.Font.time)
                        .monospacedDigit()
                }
                .foregroundStyle(Theme.textTertiary)
                .accessibilityLabel(Text("\(status.threadCount) threads"))
            }
            if status.waiting {
                Image(systemName: "hand.raised.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(MausPalette.color(chat.color))
                    .accessibilityLabel(Text("Waiting on you"))
            }
            if status.working {
                ProgressView()
                    .controlSize(.mini)
                    .accessibilityLabel(Text("Working"))
            } else if !stamp.isEmpty {
                Text(verbatim: stamp)
                    .font(Theme.Font.time)
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .fixedSize()
    }

    private var previewLine: some View {
        HStack(spacing: 0) {
            if let icon = previewIcon {
                Image(systemName: icon.name)
                    .font(.system(size: icon.size))
                    .foregroundStyle(Theme.textSecondaryHome)
                    .frame(width: HomeMetrics.previewIconBox, alignment: .leading)
                    .padding(.trailing, HomeMetrics.previewIconGap)
            }
            Text(verbatim: previewText)
                .font(Theme.Font.preview)
                .foregroundStyle(Theme.textSecondaryHome)
                .lineLimit(1)
            Spacer(minLength: 8)
            if status.unread {
                Circle()
                    .fill(Theme.unreadDot)
                    .frame(width: HomeMetrics.unreadDot, height: HomeMetrics.unreadDot)
                    .accessibilityLabel(Text("Unread"))
            }
        }
    }

    private var previewText: String {
        if preview.text.isEmpty, preview.kind == .attachment { return String(localized: "Attachment") }
        return preview.text
    }

    private var previewIcon: (name: String, size: CGFloat)? {
        switch preview.kind {
        case .plain: nil
        case .attachment: ("paperclip", 12.5)
        case .sentToBot: ("paperplane", 11.5)
        }
    }
}

// MARK: - "+" popover

/// The glass popover that grows out of the "+" button: New Bot and New
/// Group Chat, 14 pt, on a 35.8 pt pitch with about 10 pt of padding.
struct HomePlusMenu: View {
    @Environment(\.themePalette) var themePalette
    var canCreateBot: Bool
    let newBot: () -> Void
    let newGroup: () -> Void
    let dismiss: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.opacity(0.001)
                .ignoresSafeArea()
                .onTapGesture(perform: dismiss)
            VStack(alignment: .leading, spacing: 0) {
                if canCreateBot {
                    item(Text("New Bot"), action: newBot)
                        .accessibilityIdentifier("plus-menu.new-bot")
                }
                item(Text("New Group Chat"), action: newGroup)
                    .accessibilityIdentifier("plus-menu.new-group")
            }
            // item centres 28 and 63.8 pt down (reference 18, measured on
            // the text)
            .padding(.top, 10.08)
            .padding(.bottom, 9.59)
            .frame(width: 250.67, height: 91.33, alignment: .topLeading)
            .background(alignment: .topLeading) { searchUnderGlass }
            .themeGlass(RoundedRectangle(cornerRadius: Theme.continuous(31.5), style: .continuous), fill: Theme.parity(Color(hex: 0x323232), Theme.menuGlass), interactive: false)
            .padding(.trailing, 7.7)
            .transition(.scale(scale: 0.4, anchor: .topTrailing).combined(with: .opacity))
        }
    }

    /// The search button stays visible under the glass, softened, as in the
    /// reference: it sits 166 pt into the popover, 28 pt down.
    private var searchUnderGlass: some View {
        ZStack {
            Circle().fill(Theme.textPrimary.opacity(0.11)).frame(width: 46, height: 46).blur(radius: 4)
            Image(systemName: "magnifyingglass")
                .font(.system(size: 19, weight: .medium))
                .foregroundStyle(Theme.textPrimary.opacity(0.17))
                .blur(radius: 1.4)
        }
        .frame(width: 44, height: 44)
        // the glyph peaks 1.6 pt higher than the circle's centre in the reference
        .offset(x: 166.3 - 22, y: 28 - 22 - 1.6)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func item(_ title: Text, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            title
                .font(Theme.Font.body)
                .foregroundStyle(Theme.parity(Color(hex: 0xF9F9F9), Theme.textPrimary))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, 28.4)
                .frame(height: 35.83)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
