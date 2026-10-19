// Search (Grok Bot iOS reference search-ref.png, 2026-10-18; parity 19): a
// full-height sheet 62 pt from the top with rounded top corners, an X, a
// "Search" glass capsule with the caret already in it and a filter circle.
// The keyboard opens at once with a blue Search return key. Empty, it lists
// the bots (then group chats and, on an organization server, the members),
// pinned first then the most recent; typed, it filters them live and adds
// the bots' threads and the message hits of `GET /api/search`, grouped by
// type in that order, the match in bold, the type on the right.
//
// The home's "+" opens the same sheet as New chat: Create new Bot, Create
// group chat, then the bots and the members one may write to (the desktop's
// "To:" picker, ComposeToPicker.tsx). A member opens the direct
// conversation with them (`POST /api/people-dms`).
//
// Every length is the reference's on its 402 pt screen times the sheet's
// width over 402 (`SearchSheetMetrics`), so a narrower or wider phone keeps
// the proportions; the text follows Dynamic Type instead.
import SwiftUI
import UIKit
import CompanionCore

/// Where a result leads: `chat` restores the thread the person last had
/// open (as the home's rows do); `exact` is already on the thread to show
/// (a thread, a message, a direct conversation).
enum SearchDestination {
    case chat(Chat)
    case exact(Chat)
}

/// The reference's lengths on its 402 pt screen, scaled to the sheet.
struct SearchSheetMetrics {
    static let referenceWidth: CGFloat = 402
    /// Clamped so an iPad's large sheet does not blow the rows up past
    /// what a hand reads comfortably (deliberate: the reference is a
    /// phone; 1.25 keeps an 80 pt row at 100 pt at most).
    let scale: CGFloat

    init(width: CGFloat) {
        scale = width > 0 ? min(max(width / Self.referenceWidth, 0.85), 1.25) : 1
    }

    func pt(_ value: CGFloat) -> CGFloat { (value * scale).rounded(toPlaces: 2) }

    var edge: CGFloat { pt(Theme.Metric.screenEdge) }
    var control: CGFloat { pt(Theme.Metric.glassLarge) }
    var headerGap: CGFloat { pt(7.7) }
    /// The header's top inside the sheet (y 80 on screen).
    var headerTop: CGFloat { pt(80 - SearchSheet.top) }
    /// The first row's top under the header (y 155.67 on screen).
    var listTop: CGFloat { pt(155.67 - 124) }
    var rowHeight: CGFloat { pt(HomeMetrics.rowHeight) }
    var slot: CGFloat { pt(HomeMetrics.rowMascot) }
    /// Drawn as the home draws it (56 in the 42 slot): our shapes fill
    /// about 0.83 of their frame, the reference's ~46.5 pt.
    var drawn: CGFloat { pt(HomeMetrics.rowMascotDrawn) }
    var rowLeading: CGFloat { pt(HomeMetrics.rowLeading) }
    var textGap: CGFloat { pt(HomeMetrics.textColumn - HomeMetrics.rowLeading - HomeMetrics.rowMascot) }
    var rowTrailing: CGFloat { pt(HomeMetrics.rowTrailing) }
    var lineGap: CGFloat { pt(5.03) }
    var searchIconLeading: CGFloat { pt(15.3) }
    var searchIconGap: CGFloat { pt(8.3) }
}

private extension CGFloat {
    func rounded(toPlaces places: Int) -> CGFloat {
        let factor = pow(10, CGFloat(places))
        return (self * factor).rounded() / factor
    }
}

extension SearchScope {
    var title: LocalizedStringKey {
        switch self {
        case .bots: "Bots"
        case .groups: "Group Chats"
        case .people: "Members"
        case .threads: "Threads"
        case .messages: "Messages"
        }
    }

    /// The small grey word on the right of a result.
    var typeLabel: String {
        switch self {
        case .bots: String(localized: "Bot")
        case .groups: String(localized: "Group Chat")
        case .people: String(localized: "Member")
        case .threads: String(localized: "Thread")
        case .messages: String(localized: "Message")
        }
    }
}

struct SearchSheet: View {
    @Environment(\.themePalette) var themePalette
    var mode: SearchSheetMode = .search
    /// Inside a system sheet (the iPad's): no dim of its own, no top inset.
    var embedded = false
    /// What the field holds when the sheet opens (a parity capture).
    var initialQuery = ""
    let close: () -> Void
    let open: (SearchDestination) -> Void
    var createBot: (() -> Void)?
    var createGroup: (() -> Void)?

    @EnvironmentObject private var session: Session
    @ObservedObject private var directory = PeopleDirectory.shared
    @State private var query = ""
    @State private var scopes: Set<SearchScope>?
    @State private var hits: [SearchHit] = []
    @State private var searching = false
    @State private var failed = false
    @State private var opening: String?
    @State private var keyboardHeight: CGFloat = 0
    /// The open in flight (a member, a thread, a message): cancelled when
    /// the sheet goes, so a late answer never navigates behind it.
    @State private var openTask: Task<Void, Never>?
    @FocusState private var focused: Bool
    @ScaledMetric(relativeTo: .body) private var typeScale: CGFloat = 1
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    /// The sheet's top on the 874 pt screen and its corner radius.
    static let top: CGFloat = 62
    private static let radius: CGFloat = Theme.continuous(38)

    private var organization: Bool { session.surfaceGate.allows(.people) }
    private var available: [SearchScope] { SearchCatalog.scopes(mode: mode, organization: organization) }
    private var active: Set<SearchScope> { scopes ?? Set(available) }
    private var trimmed: String { SearchCatalog.normalized(query) }

    var body: some View {
        GeometryReader { proxy in
            let metrics = SearchSheetMetrics(width: proxy.size.width)
            ZStack(alignment: .top) {
                if !embedded {
                    Theme.dim
                        .ignoresSafeArea()
                        .onTapGesture(perform: dismiss)
                        .accessibilityHidden(true)
                }
                VStack(spacing: 0) {
                    header(metrics)
                    results(metrics)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .background(Theme.bg, in: SheetTopShape(radius: embedded ? 0 : Self.radius))
                .clipShape(SheetTopShape(radius: embedded ? 0 : Self.radius))
                .padding(.top, embedded ? 0 : Self.top)
                .ignoresSafeArea(edges: embedded ? [] : [.top, .bottom])
            }
        }
        // The sheet stays put under the keyboard as in the reference; the
        // list gets the keyboard's height at its end so its last rows can
        // still be scrolled above it.
        .ignoresSafeArea(.keyboard)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { note in
            guard let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
            keyboardHeight = max(0, UIScreen.main.bounds.height - frame.minY)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            keyboardHeight = 0
        }
        .onAppear {
            if query.isEmpty, !initialQuery.isEmpty { query = initialQuery }
            focused = true
        }
        .task {
            // A sheet that slides in can drop the first focus request.
            try? await Task.sleep(nanoseconds: 350_000_000)
            if !focused { focused = true }
        }
        .task(id: SearchTaskKey(query: trimmed, messages: active.contains(.messages))) { await runSearch() }
        .task { await directory.load(session) }
        .onDisappear { openTask?.cancel() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(mode == .newChat ? "new-chat-sheet" : "search-sheet")
        .accessibilityAction(.escape, dismiss)
    }

    private func dismiss() {
        openTask?.cancel()
        openTask = nil
        focused = false
        close()
    }

    // MARK: Header

    private func header(_ m: SearchSheetMetrics) -> some View {
        HStack(spacing: m.headerGap) {
            circleButton(systemImage: "xmark", size: m.control, weight: .regular, label: "Close", id: "search-close", action: dismiss)
            searchField(m)
            if available.count > 1 { filterButton(m) }
        }
        .padding(.horizontal, m.edge)
        .padding(.top, m.headerTop)
    }

    private func searchField(_ m: SearchSheetMetrics) -> some View {
        HStack(spacing: 0) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15 * m.scale, weight: .regular))
                .foregroundStyle(Theme.placeholder)
                .frame(width: 15.3 * m.scale)
                .padding(.leading, m.searchIconLeading)
                .padding(.trailing, m.searchIconGap)
                .accessibilityHidden(true)
            ZStack(alignment: .leading) {
                if query.isEmpty {
                    Text(placeholder)
                        .font(.system(size: 14.75 * typeScale))
                        .foregroundStyle(Theme.placeholder)
                        .lineLimit(1)
                        .padding(.leading, 2)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                TextField("", text: $query)
                    .font(.system(size: 14.75 * typeScale))
                    .foregroundStyle(Theme.textPrimary)
                    .tint(Theme.caret)
                    .withoutKeyboardSuggestions()
                    .submitLabel(.search)
                    .onSubmit { focused = false }
                    .focused($focused)
                    .accessibilityLabel(Text(placeholder))
                    .accessibilityIdentifier("search-field")
            }
            if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Theme.placeholder)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.trailing, 6)
                .accessibilityLabel(Text("Clear"))
                .accessibilityIdentifier("search-clear")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: m.control)
        .themeGlass(Capsule())
    }

    private var placeholder: LocalizedStringKey {
        switch mode {
        case .search: "Search"
        case .newChat: organization ? "Search bots and members" : "Search bots"
        }
    }

    private func circleButton(systemImage: String, size: CGFloat, weight: Font.Weight, label: LocalizedStringKey, id: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            Image(systemName: systemImage)
                .font(.system(size: 19 * size / Theme.Metric.glassLarge, weight: weight))
                .foregroundStyle(Theme.textPrimary)
                .frame(width: size, height: size)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .themeGlass(Circle())
        .accessibilityLabel(Text(label))
        .accessibilityIdentifier(id)
    }

    private func filterButton(_ m: SearchSheetMetrics) -> some View {
        let narrowed = active.count < available.count
        return Menu {
            ForEach(available) { scope in
                Button {
                    toggle(scope)
                } label: {
                    if active.contains(scope) {
                        Label(scope.title, systemImage: "checkmark")
                    } else {
                        Text(scope.title)
                    }
                }
            }
            if narrowed {
                Divider()
                Button("Show everything") { scopes = nil }
            }
        } label: {
            Image(systemName: "line.3.horizontal.decrease")
                .font(.system(size: 19 * m.scale, weight: .regular))
                .foregroundStyle(narrowed ? Theme.blue : Theme.textPrimary)
                .frame(width: m.control, height: m.control)
                .contentShape(Circle())
        }
        .themeGlass(Circle())
        .accessibilityLabel(Text("Filter"))
        .accessibilityValue(Text(verbatim: available.filter(active.contains).map { String(localized: $0.titleResource) }.joined(separator: ", ")))
        .accessibilityIdentifier("search-filter")
    }

    private func toggle(_ scope: SearchScope) {
        var next = active
        if next.contains(scope) {
            // never zero: the last one on stays on
            if next.count > 1 { next.remove(scope) }
        } else {
            next.insert(scope)
        }
        scopes = next == Set(available) ? nil : next
    }

    // MARK: Results

    private var entries: [SearchEntry] {
        let state = session.state
        let people = organization ? (directory.directory?.messageable(viewer: session.roomViewer.actorId) ?? []) : []
        return SearchCatalog.entries(
            mode: mode,
            query: query,
            scopes: active,
            bots: state.bots,
            rooms: state.rooms,
            people: people,
            hits: hits,
            canCreateBots: session.surfaceGate.allows(.createBot) && createBot != nil,
            recency: { state.visibleTranscript(forThread: $0).last?.at }
        )
        .filter { entry in
            if case .createGroup = entry { return createGroup != nil }
            return true
        }
    }

    private func results(_ m: SearchSheetMetrics) -> some View {
        let list = entries
        let found = list.contains { $0.scope != nil }
        return ScrollViewReader { reader in ScrollView {
          VStack(spacing: 0) {
            // above the list's top padding, so scrolling here keeps it
            Color.clear.frame(height: 0).id(Self.listTopID)
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(list) { entry in
                    Button { activate(entry) } label: {
                        SearchResultRow(entry: entry, query: trimmed, metrics: m, typeScale: typeScale, large: dynamicTypeSize.isAccessibilitySize, busy: opening == entry.id)
                    }
                    .buttonStyle(.plain)
                    .disabled(opening != nil)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text(verbatim: SearchResultRow.title(entry, session: session)))
                    .accessibilityValue(Text(verbatim: SearchResultRow.accessibilityValue(entry, session: session)))
                    .accessibilityAddTraits(.isButton)
                    .accessibilityIdentifier(identifier(entry))
                }
                if searching && hits.isEmpty && trimmed.count >= SearchCatalog.minimumMessageQuery {
                    ProgressView()
                        .controlSize(.small)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 16)
                        .accessibilityLabel(Text("Searching messages"))
                }
                if failed {
                    Text("Messages could not be searched.")
                        .font(.system(size: 13 * typeScale))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 12)
                }
                if !found && !searching && !failed {
                    emptyState
                        .padding(.horizontal, m.edge)
                        .padding(.top, 40 * m.scale)
                }
                if mode == .newChat && !organization {
                    // Solo: there is nobody else on this computer to write to.
                    Text("Bots only on this computer. With Sagax Business, the members of your organization are listed here too.")
                        .font(.system(size: 13 * typeScale))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, m.edge * 2)
                        .padding(.top, 20 * m.scale)
                        .accessibilityIdentifier("new-chat-solo-note")
                }
            }
            .padding(.top, m.listTop)
            .padding(.bottom, 24 + keyboardHeight)
          }
        }
        .scrollDismissesKeyboard(.interactively)
        // a new query reads from its first result, never from where the
        // last one was scrolled
        .onValueChange(of: trimmed) { _ in reader.scrollTo(Self.listTopID, anchor: .top) }
        // and the sheet opens on its first row once the keyboard has risen
        // (its height arrives as the list's end padding while it slides in)
        .task {
            try? await Task.sleep(nanoseconds: 600_000_000)
            reader.scrollTo(Self.listTopID, anchor: .top)
        }
        }
    }

    private static let listTopID = "search-list-top"

    @ViewBuilder
    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 28 * typeScale, weight: .regular))
                .foregroundStyle(Theme.placeholder)
                .accessibilityHidden(true)
            if trimmed.isEmpty {
                Text(mode == .newChat ? "Nobody to write to yet" : "Nothing to search yet")
                    .font(.system(size: 15 * typeScale, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
            } else {
                Text("No results for “\(trimmed)”")
                    .font(.system(size: 15 * typeScale, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .multilineTextAlignment(.center)
                Text(active.count < available.count ? "Some filters are off." : "Check the spelling or try another word.")
                    .font(.system(size: 13 * typeScale))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                if active.count < available.count {
                    Button("Show everything") { scopes = nil }
                        .font(.system(size: 14 * typeScale, weight: .medium))
                        .foregroundStyle(Theme.blue)
                        .padding(.top, 4)
                        .accessibilityIdentifier("search-show-everything")
                }
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("search-empty")
    }

    /// The identifiers the UI tests know: the New menu's for New chat.
    private func identifier(_ entry: SearchEntry) -> String {
        switch (mode, entry) {
        case (_, .createBot): "plus-menu.new-bot"
        case (_, .createGroup): "plus-menu.new-group"
        case let (.newChat, .bot(bot)): "plus-menu.bot.\(bot.id)"
        case let (.newChat, .person(person)): "plus-menu.person.\(person.principalId)"
        case let (_, .bot(bot)): "search-row.\(bot.id)"
        case let (_, .room(room)): "search-row.\(room.id)"
        case let (_, .person(person)): "search-person.\(person.principalId)"
        case let (_, .thread(bot, task)): "search-thread.\(bot.id).\(task.threadId)"
        case let (_, .message(hit)): "search-hit.\(hit.id)"
        }
    }

    private func activate(_ entry: SearchEntry) {
        Haptics.selection()
        switch entry {
        case .createBot:
            createBot?()
        case .createGroup:
            createGroup?()
        case let .bot(bot):
            open(.chat(.bot(bot)))
        case let .room(room):
            open(.chat(.room(room)))
        case let .person(person):
            run(entry) { await PeopleDirectory.shared.openConversation(with: person.principalId, session: session) }
        case let .thread(bot, task):
            run(entry) { await session.switchTask(task, for: bot).map(Chat.bot) }
        case let .message(hit):
            run(entry) { await session.open(hit) }
        }
    }

    private func run(_ entry: SearchEntry, _ work: @escaping () async -> Chat?) {
        opening = entry.id
        openTask?.cancel()
        openTask = Task {
            let chat = await work()
            opening = nil
            guard !Task.isCancelled, let chat else { return }
            open(.exact(chat))
        }
    }

    private func runSearch() async {
        let expected = trimmed
        failed = false
        guard mode == .search, expected.count >= SearchCatalog.minimumMessageQuery, active.contains(.messages) else {
            hits = []
            searching = false
            return
        }
        // as the desktop: the previous query's hits are not left clickable
        searching = true
        hits = []
        try? await Task.sleep(nanoseconds: 250_000_000)
        guard !Task.isCancelled, trimmed == expected else { return }
        let found = await session.searchMessages(expected)
        guard !Task.isCancelled, trimmed == expected else { return }
        hits = found ?? []
        failed = found == nil
        searching = false
    }
}

private struct SearchTaskKey: Hashable {
    let query: String
    let messages: Bool
}

private extension SearchScope {
    var titleResource: LocalizedStringResource {
        switch self {
        case .bots: "Bots"
        case .groups: "Group Chats"
        case .people: "Members"
        case .threads: "Threads"
        case .messages: "Messages"
        }
    }
}

/// One result: the home's 80 pt row, the mascot drawn as the home draws it,
/// the name in white with the match in bold, one grey line under it and the
/// type on the right.
struct SearchResultRow: View {
    @Environment(\.themePalette) var themePalette
    let entry: SearchEntry
    let query: String
    let metrics: SearchSheetMetrics
    let typeScale: CGFloat
    /// An accessibility text size: two lines each and a taller row.
    let large: Bool
    var busy = false

    @EnvironmentObject private var session: Session

    var body: some View {
        let m = metrics
        HStack(alignment: .center, spacing: 0) {
            avatar
                .frame(width: m.drawn, height: m.drawn)
                .frame(width: m.slot, height: m.slot)
                .padding(.leading, m.rowLeading)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: m.lineGap) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(Self.highlighted(Self.title(entry, session: session), range: titleRange, bold: true))
                        .font(Theme.font(14 * typeScale, .medium))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(large ? 2 : 1)
                    Spacer(minLength: 8)
                    if busy {
                        ProgressView().controlSize(.mini)
                    } else if let label = Self.typeLabel(entry) {
                        Text(verbatim: label)
                            .font(Theme.font(12 * typeScale))
                            .foregroundStyle(Theme.parity(Color(hex: 0x575759), Theme.placeholder))
                            .lineLimit(1)
                            .fixedSize()
                    }
                }
                if let subtitle = Self.subtitle(entry, session: session), !subtitle.isEmpty {
                    Text(Self.highlighted(subtitle, range: subtitleRange(subtitle), bold: false))
                        .font(Theme.font(12.5 * typeScale))
                        .foregroundStyle(Theme.textSecondaryHome)
                        .lineLimit(large ? 2 : 1)
                }
            }
            .padding(.leading, m.textGap)
            .padding(.trailing, m.rowTrailing)
            .padding(.vertical, large ? 10 : 0)
        }
        .frame(maxWidth: .infinity, minHeight: m.rowHeight, alignment: .leading)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var avatar: some View {
        switch entry {
        case .createBot:
            actionGlyph("plus")
        case .createGroup:
            actionGlyph("person.2")
        case let .bot(bot), let .thread(bot, _):
            BotMascotView(bot: bot, size: metrics.drawn)
        case let .room(room):
            GroupMascotView(members: room.memberIds.compactMap { session.state.bot($0) }, size: metrics.drawn, background: Theme.bg)
        case let .person(person):
            PersonAvatar(initials: People.initials(People.displayName(person)), size: metrics.slot, presenceId: person.principalId)
        case let .message(hit):
            if let botId = hit.botId, let bot = session.state.bot(botId) {
                BotMascotView(bot: bot, size: metrics.drawn)
            } else if let groupId = hit.groupId, let room = session.state.rooms.first(where: { $0.id == groupId }) {
                GroupMascotView(members: room.memberIds.compactMap { session.state.bot($0) }, size: metrics.drawn, background: Theme.bg)
            } else {
                Image(systemName: "text.bubble")
                    .font(.system(size: 18 * metrics.scale))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
    }

    private func actionGlyph(_ name: String) -> some View {
        Image(systemName: name)
            .font(.system(size: 17 * metrics.scale, weight: .medium))
            .foregroundStyle(Theme.textPrimary)
            .frame(width: metrics.slot, height: metrics.slot)
            .background(Theme.inset, in: Circle())
    }

    private var titleRange: Range<String.Index>? {
        guard case .message = entry else {
            return SearchCatalog.highlightRange(in: Self.title(entry, session: session), query: query)
        }
        return nil
    }

    private func subtitleRange(_ subtitle: String) -> Range<String.Index>? {
        if case let .message(hit) = entry { return SearchCatalog.highlightRange(in: hit, query: query) }
        return SearchCatalog.highlightRange(in: subtitle, query: query)
    }

    static func highlighted(_ text: String, range: Range<String.Index>?, bold: Bool) -> AttributedString {
        var out = AttributedString(text)
        guard let range,
              let lower = AttributedString.Index(range.lowerBound, within: out),
              let upper = AttributedString.Index(range.upperBound, within: out) else { return out }
        if bold {
            out[lower..<upper].inlinePresentationIntent = .stronglyEmphasized
        } else {
            out[lower..<upper].foregroundColor = Theme.textPrimary
        }
        return out
    }

    // MARK: Words

    static func title(_ entry: SearchEntry, session: Session) -> String {
        switch entry {
        case .createBot: String(localized: "Create new Bot")
        case .createGroup: String(localized: "Create group chat")
        case let .bot(bot): bot.name
        case let .room(room): room.name
        case let .person(person): People.displayName(person)
        case let .thread(_, task): task.title.isEmpty ? String(localized: "New thread") : task.title
        case let .message(hit): hit.task.map { "\(hit.name) · \($0)" } ?? hit.name
        }
    }

    static func subtitle(_ entry: SearchEntry, session: Session) -> String? {
        switch entry {
        case .createBot, .createGroup:
            return nil
        case let .bot(bot):
            if let lead = bot.instructionsLead?.trimmingCharacters(in: .whitespacesAndNewlines), !lead.isEmpty { return lead }
            if !bot.description.isEmpty { return bot.description }
            // a title that only repeats the name says nothing
            return bot.title.caseInsensitiveCompare(bot.name) == .orderedSame ? nil : bot.title
        case let .room(room):
            let names = room.memberIds.compactMap { session.state.bot($0)?.name }
            return names.isEmpty ? String(localized: "Group Chat") : names.joined(separator: ", ")
        case let .person(person):
            // the role or label, else the address (ComposeToPicker's line)
            if let label = PeopleDirectory.shared.label(person.principalId) { return label }
            return person.email ?? person.login
        case let .thread(bot, _):
            return bot.name
        case let .message(hit):
            return hit.snippet
        }
    }

    static func typeLabel(_ entry: SearchEntry) -> String? {
        if case let .message(hit) = entry { return "\(SearchScope.messages.typeLabel) · \(RelativeStamp.list(hit.at))" }
        return entry.scope?.typeLabel
    }

    static func accessibilityValue(_ entry: SearchEntry, session: Session) -> String {
        [typeLabel(entry), subtitle(entry, session: session)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

extension View {
    /// The iPad's search sheet: a page sheet (large) where the system has it.
    @ViewBuilder
    func searchPageSheet() -> some View {
        if #available(iOS 18.0, *) {
            presentationSizing(.page).presentationDragIndicator(.hidden)
        } else {
            presentationDragIndicator(.hidden)
        }
    }
}

/// Rounded top corners only; the bottom runs off the screen.
struct SheetTopShape: Shape {
    var radius: CGFloat

    func path(in rect: CGRect) -> Path {
        CardSheetShape(topRadius: radius, bottomRadius: radius).path(in: rect)
    }
}
