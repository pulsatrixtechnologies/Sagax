// The iPhone's bot panel: the desktop's (`BotSettingsDialog.tsx`, tabs
// `bot-settings/panel-tabs.ts`) and the iPad's (Desktop/BotPanel*.swift)
// usage paths, drawn in the phone's own look (big mascot, cards, pill
// tabs), full screen over the chat.
//
//   header   the mascot (a tap opens the avatar editor, a long press the
//            owl's moves and style), the name, label and description,
//            each edited where it shows and saved on leaving the field
//   top bar  Close, Export conversation, and "..." with the bot's own
//            actions (Share as Template, Copy ID, Duplicate, Primary Bot,
//            Delete), each once
//   tabs     Details (Coding, Activity, Routines) | Library (Files: the
//            conversation's files by kind and the bot's links; Skills;
//            Plugins) |
//            Computer (the live computer, embedded) | More (a searchable
//            list in the desktop's order; each row pushes its page)
//
// Which tabs and sections a pairing shows is `DesktopPanelTab` /
// `DesktopPanelSection` (CompanionCore, from SurfaceGate), the same rules
// as the iPad's. Every door into it is a `BotPanelDoor`.
//
// Each sub-tree is type-erased (`AnyView`): a deep SwiftUI type overflowed
// the iPad's main-thread stack once (I1, build 6).
import CompanionCore
import PhotosUI
import SwiftUI
import UIKit

/// The full screen cover: one panel per bot.
struct PhoneBotPanel: View {
    let bot: Bot
    var tab: DesktopPanelTab = .details

    var body: some View {
        AnyView(PhoneBotPanelContent(bot: bot, startTab: tab)).id(bot.id)
    }
}

private struct PhoneBotPanelContent: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss

    let bot: Bot

    @State private var tab: DesktopPanelTab
    @State private var path = NavigationPath()
    @State private var slackURL: URL?
    @State private var viewerId = "local-owner"
    @State private var menuOpen = false
    @State private var toast: String?
    @State private var editingAvatar = false
    @State private var confirmingDelete = false
    @State private var pickingPrimary = false
    @State private var primaryWorking = false
    @State private var exporting = false
    @State private var sharedFile: IdentifiedURL?
    @State private var query = ""
    @State private var scrollToRoutines = 0
    @StateObject private var owlHandle = OwlMascotHandle()
    @State private var draft: CharacterDraft
    @State private var libraryStart: BotLibraryChip = .files(.all)

    // Details
    @StateObject private var activity: BotActivityModel
    @State private var activityRoute: BotActivityRoute?
    @State private var routines: [Routine] = []
    @State private var routinesLoaded = false
    @State private var addingRoutine = false
    @State private var runLogs = false
    @State private var deletingRoutine: Routine?

    init(bot: Bot, startTab: DesktopPanelTab) {
        self.bot = bot
        _tab = State(initialValue: startTab)
        _draft = State(initialValue: CharacterDraft(bot: bot))
        _activity = StateObject(wrappedValue: BotActivityModel(botId: bot.id))
    }

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var gate: SurfaceGate { session.surfaceGate }
    private var tabs: [DesktopPanelTab] { DesktopPanelTab.visible(gate: gate, slack: slackURL != nil) }
    private var sections: [DesktopPanelSection] { DesktopPanelSection.visible(gate: gate, slack: slackURL != nil) }
    private var botRoutines: [Routine] { DesktopRoutineList.of(botId: bot.id, in: routines) }

    var body: some View {
        NavigationStack(path: $path) {
            AnyView(root)
                .navigationDestination(for: DesktopPanelSection.self) { section in
                    BotPanelSectionPage(section: section, bot: current, worksOnListed: sections.contains(.worksOn), slackURL: slackURL)
                }
                .navigationDestination(for: PanelRoutineRoute.self) { route in
                    if let routine = routines.first(where: { $0.id == route.id }) {
                        RoutineDetailView(routine: routine, showsInstruction: route.instruction) { await loadRoutines() }
                    }
                }
                .navigationDestination(for: PanelComputerRoute.self) { _ in ComputerView(bot: current) }
        }
        .tint(Theme.accentText)
        .sheet(isPresented: $editingAvatar) { PhoneBotAvatarSheet(bot: current, draft: $draft) }
        .sheet(item: $activityRoute) { route in
            BotActivitySheet(botId: bot.id, route: route, model: activity) { _, threadId in
                activityRoute = nil
                openThread(threadId)
            }
        }
        .sheet(isPresented: $addingRoutine) {
            RoutineEditorView(routine: nil, presetBotId: bot.id) { await loadRoutines() }
        }
        .sheet(isPresented: $runLogs) { AutomationsSheet() }
        .sheet(isPresented: $pickingPrimary) {
            PrimaryBotPicker(currentId: current.id, viewerId: viewerId) { show($0) }
        }
        .sheet(item: $sharedFile) { file in ProfileShareSheet(items: [file.url]) }
        .confirmationDialog(
            String(localized: "Delete \(current.name)?"),
            isPresented: $confirmingDelete,
            titleVisibility: .visible
        ) {
            Button(String(localized: "Delete Bot"), role: .destructive) { Task { await deleteBot() } }
            Button(String(localized: "Cancel"), role: .cancel) {}
        } message: {
            Text("The bot, its threads and its routines are removed from your computer. This cannot be undone.")
        }
        .confirmationDialog(
            String(localized: "Delete \(deletingRoutine?.name ?? String(localized: "this routine"))?"),
            isPresented: Binding(get: { deletingRoutine != nil }, set: { if !$0 { deletingRoutine = nil } }),
            titleVisibility: .visible
        ) {
            Button(String(localized: "Delete routine"), role: .destructive) {
                guard let routine = deletingRoutine else { return }
                Task {
                    if await session.deleteRoutine(routine) { await loadRoutines() }
                    deletingRoutine = nil
                }
            }
        } message: {
            Text("Past run receipts remain available.")
        }
        .onValueChange(of: current.color) { _ in syncDraft() }
        .onValueChange(of: current.mascotLook) { _ in syncDraft() }
        .onValueChange(of: current.mascotSkin) { _ in syncDraft() }
        .onValueChange(of: BotActivityRules.signature(current.tasks)) { _ in Task { await activity.refresh() } }
        .onDisappear { activity.stop() }
        .task {
            if gate.allows(.botActivity) { activity.start(client: session.profileClient) }
            async let config = session.configStatus()
            await loadRoutines()
            viewerId = PrimaryBotRules.viewerId(config: await config)
            if gate.allows(.botSlack) { slackURL = await session.profileClient?.slackManagementURL(botId: bot.id) }
            #if DEBUG
            await applyParityScreen()
            #endif
        }
    }

    // MARK: Root

    private var root: some View {
        ZStack(alignment: .top) {
            Theme.bg.ignoresSafeArea()
            GeometryReader { proxy in
                ScrollViewReader { reader in
                    ScrollView {
                        VStack(spacing: 0) {
                            AnyView(identity)
                            AnyView(tabBar)
                                .padding(.top, 24)
                            AnyView(tabBody(width: proxy.size.width))
                                .padding(.top, 20)
                            Color.clear.frame(height: 1).id("panel-end")
                        }
                        .padding(.top, 64)
                        .padding(.bottom, 48)
                    }
                    .scrollIndicators(.visible)
                    .scrollDismissesKeyboard(.interactively)
                    // the embedded computer is a trackpad: it takes the drags
                    .scrollDisabled(tab == .computer)
                    .accessibilityIdentifier("profile-scroll")
                    .onValueChange(of: scrollToRoutines) { _ in
                        reader.scrollTo("profile-routines-anchor", anchor: .top)
                    }
                }
            }
            ProfileTopFade().ignoresSafeArea()
            AnyView(topBar)
            if menuOpen {
                Color.black.opacity(0.001)
                    .ignoresSafeArea()
                    .onTapGesture { withAnimation(.snappy(duration: 0.2)) { menuOpen = false } }
                    .accessibilityHidden(true)
                HStack {
                    Spacer()
                    GlassMenuPanel(items: menuItems) { withAnimation(.snappy(duration: 0.2)) { menuOpen = false } }
                        .padding(.trailing, 8.3)
                }
                .transition(.scale(scale: 0.6, anchor: .topTrailing).combined(with: .opacity))
            }
            if let toast {
                Text(verbatim: toast)
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.textPrimary)
                    .padding(.horizontal, 18)
                    .frame(height: 40)
                    .themeGlass(Capsule(), interactive: false)
                    .padding(.top, 60)
                    .transition(.opacity)
                    .accessibilityIdentifier("panel-toast")
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bot-panel")
    }

    // MARK: Top bar

    private var topBar: some View {
        HStack(spacing: Theme.Metric.controlGap) {
            GlassCircleButton(systemImage: "xmark", accessibilityLabel: "Close", glyphSize: 16) { dismiss() }
                .chatGlassRim(Circle())
                .accessibilityIdentifier("panel-close")
            Spacer()
            Menu {
                Section(String(localized: "Export Conversation")) {
                    Button(String(localized: "Copy as Markdown"), systemImage: "doc.on.doc") { exportConversation(copy: true) }
                    Button(String(localized: "Download as .md"), systemImage: "arrow.down.to.line") { exportConversation(copy: false) }
                }
            } label: {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.textPrimary)
                    .frame(width: Theme.Metric.glassLarge, height: Theme.Metric.glassLarge)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .themeGlass(Circle())
            .chatGlassRim(Circle())
            .accessibilityLabel(Text("Export conversation"))
            .accessibilityIdentifier("panel-export")
            GlassCircleButton(systemImage: "ellipsis", accessibilityLabel: "More", glyphSize: 15, weight: .semibold) {
                withAnimation(.snappy(duration: 0.22)) { menuOpen.toggle() }
            }
            .chatGlassRim(Circle())
            .accessibilityIdentifier("profile-more")
        }
        .padding(.horizontal, Theme.Metric.screenEdge)
        .padding(.top, 6)
    }

    private var menuItems: [GlassMenuItem] {
        BotPanelAction.available(gate: gate, bot: current, viewerId: viewerId).map { action in
            switch action {
            case .shareTemplate:
                GlassMenuItem(id: "share-template", title: Text("Share as Template"), systemImage: "square.and.arrow.up.on.square") {
                    Task { await shareTemplate() }
                }
            case .copyId:
                // the open conversation's id, as the desktop's Copy ID
                GlassMenuItem(id: "copy-id", title: Text("Copy ID"), systemImage: "doc.on.doc") { copy(bot.threadId) }
            case .duplicate:
                GlassMenuItem(id: "duplicate", title: Text("Duplicate"), systemImage: "plus.square.on.square") {
                    Task { await duplicate() }
                }
            case .makePrimary:
                GlassMenuItem(id: "make-primary", title: Text("Make primary bot"), systemImage: "star") {
                    Task { await PrimaryBotActions.make(current.id, session: session, done: { show($0) }, working: $primaryWorking) }
                }
            case .replacePrimary:
                GlassMenuItem(id: "replace-primary", title: Text("Replace with different Bot"), systemImage: "arrow.left.arrow.right") {
                    pickingPrimary = true
                }
            case .delete:
                GlassMenuItem(id: "delete", title: Text("Delete Bot"), systemImage: "trash", destructive: true) { confirmingDelete = true }
            }
        }
    }

    // MARK: Identity

    private var identity: some View {
        VStack(spacing: 0) {
            BotMascotView(bot: current, size: Theme.Profile.mascot, state: MausState.forChat(.bot(current), in: session.state),
                          animated: true, owlHandle: owlHandle)
                .contentShape(Rectangle())
                // a tap opens the character editor, as the desktop's mascot does
                .onTapGesture {
                    Haptics.selection()
                    editingAvatar = true
                }
                .contextMenu {
                    // the owl's moves and style (an iPhone extra)
                    CharacterMovesMenu(
                        look: draft.complete,
                        onMove: { owlHandle.flourish($0) },
                        onStyle: { style in
                            var look = draft.complete
                            look.style = style
                            saveLook(look.stored)
                        }
                    )
                }
                .accessibilityLabel(Text("Edit avatar"))
                .accessibilityIdentifier("profile-mascot")
                .accessibilityAddTraits(.isButton)
            ProfileCard {
                PhoneInlineText(value: current.name, placeholder: nil, label: "Edit name", font: Theme.Font.profileName,
                                required: true, limit: 100, id: "profile-name") { save(name: $0) }
                    .frame(minHeight: Theme.Profile.nameRow)
                ProfileDivider(leading: Theme.Profile.textInset)
                PhoneInlineText(value: current.title, placeholder: "Add a label", label: "Edit label",
                                font: .system(size: 13), muted: true, limit: 200, id: "profile-role") { save(title: $0) }
                    .frame(minHeight: Theme.Profile.roleRow)
                ProfileDivider(leading: Theme.Profile.textInset)
                PhoneInlineText(value: current.description, placeholder: "One line on what this bot is for", label: "Description",
                                font: Theme.Profile.labelFont, muted: true, limit: 4000, multiline: true, id: "profile-description") {
                    save(description: $0)
                }
                .frame(minHeight: Theme.Profile.roleRow)
            }
            .padding(.top, 20)
        }
    }

    // MARK: Tabs

    private var tabBar: some View {
        HStack(spacing: 4) {
            ForEach(tabs) { item in
                let selected = tab == item
                Button {
                    Haptics.selection()
                    tab = item
                } label: {
                    Text(item.title)
                        .font(Theme.Font.tab)
                        .foregroundStyle(selected ? Theme.textPrimary : Theme.textTertiary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity)
                        .frame(height: 34)
                        .background(selected ? Theme.cardRaised : Color.clear, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("panel-tab.\(item.rawValue)")
                .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
            }
        }
        .padding(4)
        .background(Theme.card, in: Capsule())
        .padding(.horizontal, Theme.Profile.cardMargin)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Bot panel"))
    }

    private func tabBody(width: CGFloat) -> some View {
        switch tabs.contains(tab) ? tab : .details {
        case .details: AnyView(details)
        case .library:
            AnyView(PhoneBotLibrary(bot: current, start: libraryStart) { file in showInChat(file) })
        case .computer:
            AnyView(ComputerView(bot: current, embeddedWidth: width - Theme.Profile.cardMargin * 2) {
                path.append(PanelComputerRoute())
            }
            .frame(maxWidth: .infinity))
        case .more: AnyView(more)
        }
    }

    // MARK: Details

    private var details: some View {
        VStack(spacing: 0) {
            BotPanelNoticesView(bot: current)
            if gate.allows(.botActivity) {
                BotActivityCard(
                    bot: current,
                    model: activity,
                    onOpen: { activityRoute = .detail($0) },
                    onHistory: { activityRoute = .history($0) }
                )
                .padding(.bottom, Theme.Profile.cardGap + 8)
            }
            ProfileSectionLabel(text: "Routines")
            Color.clear.frame(height: 0).id("profile-routines-anchor")
            AnyView(routinesCard)
        }
    }

    private var routinesCard: some View {
        ProfileCard {
            if !routinesLoaded {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Loading routines…")
                }
                .font(Theme.Profile.labelFont)
                .foregroundStyle(Theme.textSecondary)
                .frame(maxWidth: .infinity, minHeight: Theme.Profile.row)
            }
            ForEach(botRoutines) { routine in
                Button {
                    Haptics.selection()
                    path.append(PanelRoutineRoute(id: routine.id, instruction: false))
                } label: {
                    ProfileRow(
                        icon: ProfileRowIcon(systemImage: "clock", size: 17,
                                             color: routine.enabled ? Theme.routineActive : Theme.routinePaused),
                        title: Text(verbatim: routine.name),
                        subtitle: Text(verbatim: RoutineWording.subtitle(routine)),
                        height: Theme.Profile.routineRow
                    ) { ProfileChevronTrailing() }
                }
                .buttonStyle(.plain)
                .contextMenu {
                    if gate.allows(.routineDelete) {
                        Button(String(localized: "Delete routine"), systemImage: "trash", role: .destructive) { deletingRoutine = routine }
                    }
                }
                .accessibilityIdentifier("profile-routine.\(routine.name)")
                ProfileDivider()
            }
            Button {
                Haptics.selection()
                addingRoutine = true
            } label: {
                ProfileRow(icon: ProfileRowIcon(systemImage: "plus", size: 18, color: Theme.blue),
                           title: Text("Add routine"), titleColor: Theme.accentText, height: Theme.Profile.row)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("profile-add-routine")
            ProfileDivider()
            Button {
                Haptics.selection()
                runLogs = true
            } label: {
                ProfileRow(icon: ProfileRowIcon(systemImage: "doc.text", size: 16), title: Text("Run logs"),
                           height: Theme.Profile.row) { ProfileChevronTrailing() }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("panel-run-logs")
        }
    }

    // MARK: More

    private var more: some View {
        let shown = sections.filter { $0.matches(query, label: $0.localizedTitle) }
        return VStack(spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
                TextField(String(localized: "Search"), text: $query)
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.textPrimary)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityLabel(Text("Search settings"))
                    .accessibilityIdentifier("panel-more-search")
            }
            .padding(.horizontal, 14)
            .frame(height: 40)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(.horizontal, Theme.Profile.cardMargin)
            ProfileCard {
                ForEach(Array(shown.enumerated()), id: \.element) { index, section in
                    if index > 0 { ProfileDivider() }
                    NavigationLink(value: section) {
                        ProfileRow(icon: ProfileRowIcon(systemImage: section.symbol, size: 16), title: Text(section.title),
                                   height: Theme.Profile.singleRow) { ProfileChevronTrailing() }
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("panel-row.\(section.rawValue)")
                }
                if shown.isEmpty {
                    Text("Nothing matches “\(query.trimmingCharacters(in: .whitespacesAndNewlines))”")
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(Theme.Profile.textInset)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("panel-more")
    }

    // MARK: Actions

    private func save(name: String? = nil, title: String? = nil, description: String? = nil) {
        var patch = BotProfilePatch()
        patch.name = name
        patch.title = title
        patch.description = description
        let target = current
        Task { _ = await session.updateProfile(patch, for: target) }
    }

    private func saveLook(_ look: MascotLook) {
        var change = BotProfileEdit()
        change.mascotLook = look
        Task {
            guard let client = session.profileClient else { return }
            do { session.applyProfileBot(try await client.editBot(botId: bot.id, edit: change)) }
            catch { session.actionError = error.localizedDescription }
        }
    }

    private func syncDraft() {
        let server = CharacterDraft(bot: current)
        if server != draft { draft = server }
    }

    private func show(_ message: String) {
        withAnimation { toast = message }
        Task {
            try? await Task.sleep(nanoseconds: 1_800_000_000)
            withAnimation { toast = nil }
        }
    }

    private func copy(_ id: String) {
        UIPasteboard.general.string = id
        show(String(localized: "Copied"))
    }

    private func exportConversation(copy: Bool) {
        let threadId = current.threadId
        Task {
            guard let url = await session.export(threadId: threadId, format: "markdown") else { return }
            if copy {
                if let text = try? String(contentsOf: url, encoding: .utf8) {
                    UIPasteboard.general.string = text
                    show(String(localized: "Copied"))
                }
            } else {
                sharedFile = IdentifiedURL(url: url)
            }
        }
    }

    private func shareTemplate() async {
        guard !exporting, let client = session.profileClient else { return }
        exporting = true
        defer { exporting = false }
        do {
            let export = try await client.exportBot(botId: bot.id)
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("bot-export-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let url = folder.appendingPathComponent(BotExport.shareFileName(botName: current.name))
            try export.document.write(to: url, options: .atomic)
            sharedFile = IdentifiedURL(url: url)
        } catch {
            session.actionError = error.localizedDescription
        }
    }

    /// Duplicate (store.tsx `duplicateBot`): a new bot, then the source's
    /// profile on it as "<name> copy".
    private func duplicate() async {
        guard let client = session.profileClient else { return }
        let source = current
        let admin = gate.scope == .serverAdmin
        do {
            // the fleet carries no instructions: read them for the copy
            let soul = try? await client.soul(botId: source.id).soul
            let copy = try await client.duplicateBot(source, soul: soul, computerFields: admin, carryVisibility: admin)
            session.applyProfileBot(copy)
            show(String(localized: "Added \(copy.name)."))
        } catch {
            session.actionError = error.localizedDescription
        }
    }

    private func deleteBot() async {
        guard let client = session.profileClient else { return }
        do {
            try await client.deleteBot(botId: bot.id)
            // Close the panel, then let the chat under it see its bot gone
            // and pop itself.
            dismiss()
            try? await Task.sleep(nanoseconds: 700_000_000)
            session.applyBotDeleted(bot.id)
        } catch {
            session.actionError = error.localizedDescription
        }
    }

    private func loadRoutines() async {
        routines = await session.loadRoutines().routines
        routinesLoaded = true
    }

    /// An activity entry's thread: this chat is under the panel, so the
    /// panel goes; another thread opens like a deep link.
    private func openThread(_ threadId: String) {
        let here = threadId == bot.threadId
        Task {
            try? await Task.sleep(nanoseconds: 600_000_000)
            dismiss()
            guard !here else { return }
            try? await Task.sleep(nanoseconds: 700_000_000)
            session.openChat(threadId: threadId)
        }
    }

    /// A file's message in the chat under the panel (FilesSection.tsx `jump`).
    private func showInChat(_ file: ThreadFile) {
        let threadId = bot.threadId
        dismiss()
        Task {
            try? await Task.sleep(nanoseconds: 600_000_000)
            await session.jump(to: file.messageId, inThread: threadId)
        }
    }

    // MARK: Parity harness

    #if DEBUG
    private func applyParityScreen() async {
        guard let screen = ParityLaunch.current?.screen else { return }
        switch screen {
        case .profileLinks: libraryStart = .links; tab = .library
        case .profileMedia: libraryStart = .files(.image); tab = .library
        case .profileFiles: tab = .library
        case .profileInfoScrolled, .profileMoreMenu:
            try? await Task.sleep(nanoseconds: 600_000_000)
            scrollToRoutines += 1
            if screen == .profileMoreMenu {
                try? await Task.sleep(nanoseconds: 400_000_000)
                menuOpen = true
            }
        case .routineDetail, .routineInstruction:
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            if let first = botRoutines.first(where: { $0.schedule.type == .cron }) ?? botRoutines.first {
                path.append(PanelRoutineRoute(id: first.id, instruction: screen == .routineInstruction))
            }
        default: break
        }
    }
    #endif
}

private struct PanelRoutineRoute: Hashable {
    let id: String
    let instruction: Bool
}

private struct PanelComputerRoute: Hashable {}

// MARK: - Inline text

/// Text that becomes a field on a tap (`InlineEditableText`): Return or
/// leaving the field saves (`DesktopInlineEdit.commit`), so nothing waits
/// for a Save button.
struct PhoneInlineText: View {
    @Environment(\.themePalette) var themePalette
    let value: String
    let placeholder: LocalizedStringKey?
    let label: LocalizedStringKey
    let font: Font
    var muted = false
    var required = false
    var limit = 200
    var multiline = false
    let id: String
    let onSave: (String) -> Void

    @State private var editing = false
    @State private var draft = ""
    @FocusState private var focused: Bool

    private var shown: String { value.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        Group {
            if editing {
                AnyView(field)
            } else {
                AnyView(text)
            }
        }
        .padding(.horizontal, Theme.Profile.textInset)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
    }

    private var text: some View {
        Group {
            if shown.isEmpty, let placeholder {
                Text(placeholder).foregroundStyle(Theme.textTertiary)
            } else {
                Text(verbatim: shown).foregroundStyle(muted ? Theme.textSecondary : Theme.textPrimary)
            }
        }
        .font(font)
        .multilineTextAlignment(.center)
        .lineLimit(multiline ? 4 : 1)
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
        .onTapGesture {
            draft = value
            editing = true
        }
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(verbatim: shown))
        .accessibilityHint(Text("Double tap to edit"))
        .accessibilityIdentifier(id)
    }

    private var field: some View {
        TextField("", text: $draft, prompt: placeholder.map { Text($0) }, axis: multiline ? .vertical : .horizontal)
            .font(font)
            .foregroundStyle(Theme.textPrimary)
            .multilineTextAlignment(.center)
            .lineLimit(multiline ? 1...6 : 1...1)
            .focused($focused)
            .submitLabel(.done)
            .onSubmit { focused = false }
            .onValueChange(of: draft) { next in
                if multiline, next.contains("\n") { draft = next.replacingOccurrences(of: "\n", with: ""); focused = false }
                if draft.count > limit { draft = String(draft.prefix(limit)) }
            }
            .onAppear { focused = true }
            .onValueChange(of: focused) { now in if !now { commit() } }
            .accessibilityLabel(Text(label))
            .accessibilityIdentifier("\(id)-field")
    }

    private func commit() {
        guard editing else { return }
        editing = false
        if let next = DesktopInlineEdit.commit(draft: draft, current: value, required: required) { onSave(next) }
    }
}

// MARK: - Library loader

/// One list's pages: the first, then "Show more" pages, each from the
/// server's cursor.
@MainActor
final class LibraryLoader<Item: Sendable & Hashable>: ObservableObject {
    typealias Fetch = (_ cursor: String?, _ limit: Int) async throws -> LibraryPage<Item>

    @Published private(set) var page: LibraryPage<Item>?
    @Published private(set) var loading = false
    @Published private(set) var problem: String?
    private var fetch: Fetch?

    func loadFirst(first: Int = CompanionClient.ProfilePage.firstLinks, _ fetch: @escaping Fetch) {
        guard page == nil, !loading else { return }
        self.fetch = fetch
        loading = true
        problem = nil
        Task {
            do { page = try await fetch(nil, first) } catch { problem = error.localizedDescription }
            loading = false
        }
    }

    func loadMore() {
        guard let fetch, let current = page, let cursor = current.nextCursor, !loading else { return }
        loading = true
        Task {
            do { page = current.appending(try await fetch(cursor, CompanionClient.ProfilePage.more)) } catch { problem = error.localizedDescription }
            loading = false
        }
    }
}
