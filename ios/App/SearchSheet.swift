// Search (reference 19): a full-height sheet 62 pt from the top with an X,
// a "Search" glass capsule and a filter circle (Bots, Group Chats,
// Messages). Empty, it lists every bot and group chat, pinned first then
// the most recent; typed, it filters them by name, role and instructions and
// adds message hits from `GET /api/search`. Rows use the home's metrics.
import SwiftUI
import CompanionCore

enum SearchScope: String, CaseIterable, Identifiable {
    case bots, groups, messages
    var id: String { rawValue }

    var title: LocalizedStringKey {
        switch self {
        case .bots: "Bots"
        case .groups: "Group Chats"
        case .messages: "Messages"
        }
    }
}

struct SearchSheet: View {
    let close: () -> Void
    let open: (Chat) -> Void
    let openHit: (SearchHit) -> Void

    @EnvironmentObject private var session: Session
    @State private var query = ""
    @State private var scopes = Set(SearchScope.allCases)
    @State private var hits: [SearchHit] = []
    @State private var searching = false
    @FocusState private var focused: Bool

    /// The sheet's top on the 874 pt screen and its corner radius.
    static let top: CGFloat = 62
    private static let radius: CGFloat = Theme.continuous(38)

    var body: some View {
        ZStack(alignment: .top) {
            Theme.dim
                .ignoresSafeArea()
                .onTapGesture(perform: close)
            VStack(spacing: 0) {
                header
                results
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(Theme.bg, in: SheetTopShape(radius: Self.radius))
            .clipShape(SheetTopShape(radius: Self.radius))
            .padding(.top, Self.top)
            .ignoresSafeArea(edges: [.top, .bottom])
        }
        .ignoresSafeArea(.keyboard)
        .onAppear { focused = true }
        .task(id: query) { await runSearch() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("search-sheet")
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 7.7) {
            GlassCircleButton(systemImage: "xmark", accessibilityLabel: "Close", action: close)
            HStack(spacing: 0) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(Theme.placeholder)
                    .frame(width: 15.3)
                    .padding(.leading, 15.3)
                    .padding(.trailing, 8.3)
                ZStack(alignment: .leading) {
                    if query.isEmpty {
                        Text("Search")
                            .font(.system(size: 14.75))
                            .foregroundStyle(Theme.placeholder)
                            .padding(.leading, 2)
                            .allowsHitTesting(false)
                    }
                    TextField("", text: $query)
                        .font(.system(size: 14.75))
                        .foregroundStyle(Theme.textPrimary)
                        .tint(Theme.caret)
                        .withoutKeyboardSuggestions()
                        .submitLabel(.search)
                        .focused($focused)
                        .accessibilityLabel(Text("Search"))
                        .accessibilityIdentifier("search-field")
                }
                if !query.isEmpty {
                    Button { query = "" } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.placeholder)
                    }
                    .buttonStyle(.plain)
                    .padding(.trailing, 12)
                    .accessibilityLabel(Text("Clear"))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: Theme.Metric.glassLarge)
            .themeGlass(Capsule())
            filterButton
        }
        .padding(.horizontal, Theme.Metric.screenEdge)
        .padding(.top, 80 - Self.top)
    }

    private var filterButton: some View {
        Menu {
            ForEach(SearchScope.allCases) { scope in
                Button {
                    if scopes.contains(scope) {
                        if scopes.count > 1 { scopes.remove(scope) }
                    } else {
                        scopes.insert(scope)
                    }
                } label: {
                    if scopes.contains(scope) {
                        Label(scope.title, systemImage: "checkmark")
                    } else {
                        Text(scope.title)
                    }
                }
            }
        } label: {
            Image(systemName: "line.3.horizontal.decrease")
                .font(.system(size: 19, weight: .regular))
                .foregroundStyle(scopes.count == SearchScope.allCases.count ? Theme.textPrimary : Theme.blue)
                .frame(width: Theme.Metric.glassLarge, height: Theme.Metric.glassLarge)
                .contentShape(Circle())
        }
        .themeGlass(Circle())
        .accessibilityLabel(Text("Filter"))
        .accessibilityIdentifier("search-filter")
    }

    // MARK: Results

    private var results: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(chats, id: \.id) { chat in
                    Button {
                        Haptics.selection()
                        open(chat)
                    } label: {
                        SearchResultRow(chat: chat, subtitle: subtitle(chat), label: typeLabel(chat))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("search-row.\(chat.id)")
                }
                if scopes.contains(.messages) {
                    ForEach(hits) { hit in
                        Button {
                            Haptics.selection()
                            openHit(hit)
                        } label: {
                            SearchResultRow(
                                chat: chat(for: hit),
                                title: hit.name,
                                subtitle: hit.snippet,
                                label: RelativeStamp.list(hit.at)
                            )
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("search-hit.\(hit.id)")
                    }
                }
                if searching && hits.isEmpty {
                    ProgressView().controlSize(.small).frame(maxWidth: .infinity).padding(.top, 16)
                }
                if !trimmed.isEmpty && chats.isEmpty && hits.isEmpty && !searching {
                    Text("No results")
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 40)
                }
            }
            .padding(.top, 155.67 - 124)
            .padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var trimmed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Bots and group chats, pinned first then the most recent, filtered by
    /// the query and the scope.
    private var chats: [Chat] {
        let state = session.state
        var list: [(chat: Chat, pinned: Bool, at: Double)] = []
        if scopes.contains(.bots) {
            for bot in state.bots where bot.hidden != true {
                let pinned = bot.pinned == true || bot.chiefOfStaff == true
                list.append((.bot(bot), pinned, state.visibleTranscript(forThread: bot.threadId).last?.at ?? bot.createdAt))
            }
        }
        if scopes.contains(.groups) {
            for room in state.rooms where room.dm != true {
                list.append((.room(room), room.pinned == true, state.visibleTranscript(forThread: room.threadId).last?.at ?? room.createdAt))
            }
        }
        let q = trimmed
        if !q.isEmpty {
            list = list.filter { entry in
                entry.chat.name.localizedCaseInsensitiveContains(q)
                    || entry.chat.subtitle.localizedCaseInsensitiveContains(q)
                    || subtitle(entry.chat).localizedCaseInsensitiveContains(q)
            }
        }
        return list.sorted { left, right in
            if left.pinned != right.pinned { return left.pinned }
            return left.at > right.at
        }.map(\.chat)
    }

    private func subtitle(_ chat: Chat) -> String {
        switch chat {
        case let .bot(bot):
            if let lead = bot.instructionsLead?.trimmingCharacters(in: .whitespacesAndNewlines), !lead.isEmpty { return lead }
            if !bot.description.isEmpty { return bot.description }
            return bot.title
        case .room:
            return String(localized: "Group Chat")
        }
    }

    private func typeLabel(_ chat: Chat) -> String {
        switch chat {
        case .bot: String(localized: "Bot")
        case .room: String(localized: "Group Chat")
        }
    }

    private func chat(for hit: SearchHit) -> Chat? {
        if let botId = hit.botId, let bot = session.state.bot(botId) { return .bot(bot) }
        if let groupId = hit.groupId, let room = session.state.rooms.first(where: { $0.id == groupId }) { return .room(room) }
        return nil
    }

    private func runSearch() async {
        let expected = trimmed
        guard expected.count >= 2, scopes.contains(.messages) else {
            hits = []
            searching = false
            return
        }
        searching = true
        try? await Task.sleep(nanoseconds: 250_000_000)
        guard !Task.isCancelled, trimmed == expected else { return }
        let found = await session.search(expected)
        guard !Task.isCancelled, trimmed == expected else { return }
        hits = found
        searching = false
    }
}

/// One result: the home's 80 pt row with the type label (or a time) on the
/// right and one grey line under the name.
struct SearchResultRow: View {
    let chat: Chat?
    var title: String?
    let subtitle: String
    let label: String

    @EnvironmentObject private var session: Session

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Group {
                switch chat {
                case let .bot(bot)?:
                    BotMascotView(bot: bot, size: HomeMetrics.rowMascot)
                case let .room(room)?:
                    GroupMascotView(members: room.memberIds.compactMap { session.state.bot($0) }, size: HomeMetrics.rowMascot, background: Theme.bg)
                case nil:
                    Image(systemName: "text.bubble")
                        .font(.system(size: 18))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .frame(width: HomeMetrics.rowMascot, height: HomeMetrics.rowMascot)
            .padding(.top, (HomeMetrics.rowHeight - HomeMetrics.rowMascot) / 2)
            .padding(.leading, HomeMetrics.rowLeading)
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 5.03) {
                HStack(spacing: 8) {
                    Text(verbatim: title ?? chat?.name ?? "")
                        .font(HomeMetrics.name)
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text(verbatim: label)
                        .font(HomeMetrics.font12)
                        .foregroundStyle(Color(hex: 0x575759))
                        .lineLimit(1)
                        .fixedSize()
                }
                .frame(height: HomeMetrics.nameLine)
                Text(verbatim: subtitle)
                    .font(Theme.Font.preview)
                    .foregroundStyle(Theme.textSecondaryHome)
                    .lineLimit(1)
                    .frame(height: HomeMetrics.previewLine)
            }
            .padding(.top, HomeMetrics.nameTop)
            .padding(.leading, HomeMetrics.textColumn - HomeMetrics.rowLeading - HomeMetrics.rowMascot)
            .padding(.trailing, 21.7)
        }
        .frame(maxWidth: .infinity, minHeight: HomeMetrics.rowHeight, maxHeight: HomeMetrics.rowHeight, alignment: .topLeading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// Rounded top corners only; the bottom runs off the screen.
struct SheetTopShape: Shape {
    var radius: CGFloat

    func path(in rect: CGRect) -> Path {
        CardSheetShape(topRadius: radius, bottomRadius: radius).path(in: rect)
    }
}
