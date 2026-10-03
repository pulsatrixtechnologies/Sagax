// The bot profile (references 03, 04, 07 to 10), pushed from the chat's name
// capsule. Every change saves at once through the server; nothing here is a
// draft.
//
// Layout follows measure-chat-profile.md §3 (in `Theme.Profile`): the glass
// back, share and "..." circles, the 84 pt mascot, the name card, the
// underlined tabs and each tab's cards 24 pt from the screen edges. The
// earlier settings form (`AgentProfileView`: model, voice, identity) stays
// reachable through "..." > Advanced.
import CompanionCore
import PhotosUI
import SwiftUI
import UIKit

struct BotProfileView: View {
    @Environment(\.themePalette) var themePalette
    enum Tab: String, CaseIterable, Identifiable {
        case info, links, media, files
        var id: String { rawValue }
        var title: LocalizedStringKey {
            switch self {
            case .info: "Info"
            case .links: "Links"
            case .media: "Media"
            case .files: "Files"
            }
        }
    }

    let bot: Bot

    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @StateObject private var owlHandle = OwlMascotHandle()
    @State private var nextWingMove = 0
    @State private var tab: Tab = .info
    @State private var draft: CharacterDraft
    @State private var notifications: Bool
    @State private var routines: [Routine] = []
    @State private var runs: [RoutineRun] = []
    @State private var routinesLoaded = false
    @State private var menuOpen = false
    @State private var confirmingDelete = false
    @State private var showingAdvanced = false
    @State private var showingThreads = false
    @State private var showingInstructions = false
    @State private var openRoutine: Routine?
    @State private var routinePushed = false
    @State private var editingRoutine = false
    @State private var exporting = false
    @State private var sharedFile: IdentifiedURL?
    @State private var generating = false
    @State private var generatePrompt = ""
    @State private var askingGenerate = false
    @State private var framing = false
    @State private var copiedToast = false
    @State private var scrollToEnd = 0
    @State private var parityRoutineInstruction = false

    // WP7: Activity, this chat's files, routine delete, skin locks, moves,
    // Primary Bot (matrix rows BP6-BP10, BP12, BF1-BF4, SB28).
    @StateObject private var activity: BotActivityModel
    @State private var activityRoute: BotActivityRoute?
    @State private var showingThreadFiles = false
    @State private var deletingRoutine: Routine?
    @State private var unlocks: MascotUnlocks = .nothingLocked
    @State private var viewerId = "local-owner"
    @State private var pickingPrimary = false
    @State private var primaryWorking = false

    @StateObject private var links = LibraryLoader<BotLink>()
    @StateObject private var media = LibraryLoader<BotLibraryFile>()
    @StateObject private var files = LibraryLoader<BotLibraryFile>()

    init(bot: Bot) {
        self.bot = bot
        _draft = State(initialValue: CharacterDraft(bot: bot))
        _notifications = State(initialValue: bot.notifications)
        _activity = StateObject(wrappedValue: BotActivityModel(botId: bot.id))
    }

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var role: String {
        current.displayRole
    }
    private var botRoutines: [Routine] {
        routines.filter { $0.botId == bot.id }.sorted { $0.createdAt < $1.createdAt }
    }

    var body: some View {
        ZStack(alignment: .top) {
            Theme.bg.ignoresSafeArea()
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 0) {
                        identity
                        tabBar
                        tabContent
                            .padding(.top, 16)
                        Color.clear.frame(height: 1).id("profile-end")
                    }
                    .padding(.top, Theme.Profile.mascotTop)
                    .padding(.bottom, 65)
                }
                .scrollIndicators(.visible)
                .ignoresSafeArea()
                .accessibilityIdentifier("profile-scroll")
                .onValueChange(of: scrollToEnd) { _ in
                    // 04: the routines card's top at y 477.7 of the 874 pt screen (the
                    // Activity card below keeps this from clamping at the end)
                    proxy.scrollTo("profile-routines-anchor", anchor: UnitPoint(x: 0.5, y: 477.7 / 874))
                }
            }
            ProfileTopFade().ignoresSafeArea()
            header
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
                .padding(.top, 0)
                .transition(.scale(scale: 0.6, anchor: .topTrailing).combined(with: .opacity))
            }
            if copiedToast {
                Text("Copied")
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.textPrimary)
                    .padding(.horizontal, 18)
                    .frame(height: 40)
                    .themeGlass(Capsule(), interactive: false)
                    .padding(.top, 60)
                    .transition(.opacity)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden(true)
        .background(SwipeBackBridge())
        .persistentSystemOverlays(.hidden)
        .navigationDestination(isPresented: $showingInstructions) {
            InstructionView(bot: current)
        }
        .navigationDestination(isPresented: $routinePushed) {
            if let openRoutine {
                RoutineDetailView(routine: openRoutine, showsInstruction: parityRoutineInstruction) { await loadRoutines() }
            }
        }
        .sheet(isPresented: $showingAdvanced) {
            AgentProfileView(bot: current)
        }
        .sheet(isPresented: $showingThreads) {
            TaskManagerView(chat: .bot(current)) { threadId in session.openChat(threadId: threadId) }
        }
        .sheet(isPresented: $editingRoutine) {
            RoutineEditorView(routine: nil, presetBotId: bot.id) { await loadRoutines() }
        }
        .sheet(item: $activityRoute) { route in
            BotActivitySheet(botId: bot.id, route: route, model: activity) { threadBotId, threadId in
                activityRoute = nil
                openThread(botId: threadBotId, threadId: threadId)
            }
        }
        .sheet(isPresented: $showingThreadFiles) {
            NavigationStack {
                ThreadFilesView(threadId: bot.threadId) { file in
                    showingThreadFiles = false
                    showInChat(file)
                }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(String(localized: "Done")) { showingThreadFiles = false }
                    }
                }
            }
        }
        .sheet(isPresented: $pickingPrimary) {
            PrimaryBotPicker(currentId: current.id, viewerId: viewerId) { _ in }
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
        .sheet(item: $sharedFile) { file in
            ProfileShareSheet(items: [file.url])
        }
        .sheet(isPresented: $framing) {
            PictureFramingSheet(bot: current) { zoom, x, y in
                Task { await edit(BotProfileEdit(avatarZoom: zoom, avatarFocusX: x, avatarFocusY: y)) }
            }
        }
        .alert(String(localized: "Generate a picture"), isPresented: $askingGenerate) {
            TextField(String(localized: "Art direction"), text: $generatePrompt)
            Button(String(localized: "Generate")) { Task { await generatePicture() } }
            Button(String(localized: "Cancel"), role: .cancel) {}
        } message: {
            Text("Describe the picture. It is made with the image provider set up on your computer.")
        }
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
        .onValueChange(of: current.color) { _ in syncDraft() }
        .onValueChange(of: current.mascotLook) { _ in syncDraft() }
        .onValueChange(of: current.mascotSkin) { _ in syncDraft() }
        .onValueChange(of: current.notifications) { value in notifications = value }
        .task {
            if session.surfaceGate.allows(.botActivity) { activity.start(client: session.profileClient) }
            async let config = session.configStatus()
            async let earned = session.profileClient?.mascotUnlocks()
            await loadRoutines()
            viewerId = PrimaryBotRules.viewerId(config: await config)
            if let earned = try? await earned { unlocks = earned }
            #if DEBUG
            await applyParityScreen()
            #endif
        }
        .onValueChange(of: tab) { selected in loadTab(selected) }
        .onValueChange(of: BotActivityRules.signature(current.tasks)) { _ in Task { await activity.refresh() } }
        .onDisappear { activity.stop() }
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: Theme.Metric.controlGap) {
            ProfileBackButton { dismiss() }
            Spacer()
            ShareGlassButton { Task { await shareTemplate() } }
                .accessibilityLabel(Text("Share as Template"))
                .accessibilityIdentifier("profile-share")
            .disabled(exporting)
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
        [
            // The open conversation's (thread) id, as the desktop's Copy ID
            // copies (SB23): `bot` is the chat's projection onto the thread
            // on screen, `current` the stored record. The bot's own id is a long press on its name, so the
            // panel keeps reference 07's four rows.
            GlassMenuItem(id: "copy-id", title: Text("Copy ID"), systemImage: "doc.on.doc") { copy(bot.threadId) },
            GlassMenuItem(id: "threads", title: Text("Threads"), systemImage: "bubble.left.and.bubble.right") { showingThreads = true },
            GlassMenuItem(id: "advanced", title: Text("Advanced"), systemImage: "slider.horizontal.3") { showingAdvanced = true },
        ] + (session.surfaceGate.allows(.botOwnerExtras) ? [
            // D4: an owner's or an admin's, not a client session's.
            GlassMenuItem(id: "delete", title: Text("Delete Bot"), systemImage: "trash", destructive: true) { confirmingDelete = true },
        ] : [])
    }

    // MARK: Identity

    private var identity: some View {
        VStack(spacing: 0) {
            // a tap plays the owl's next wing move, as the desktop preview does
            BotMascotView(bot: current, size: Theme.Profile.mascot, state: .idle, animated: true, owlHandle: owlHandle)
                .contentShape(Rectangle())
                .onTapGesture {
                    let moves = OwlWingMove.allCases
                    owlHandle.flourish(moves[nextWingMove % moves.count])
                    nextWingMove += 1
                }
                .contextMenu {
                    // BP7, BP8: the character's moves and the owl's style
                    CharacterMovesMenu(
                        look: draft.complete,
                        onMove: { owlHandle.flourish($0) },
                        onStyle: { style in
                            var next = draft
                            var look = next.complete
                            look.style = style
                            next.look = look.stored
                            saveLook(next)
                        }
                    )
                }
                .accessibilityIdentifier("profile-mascot")
                .accessibilityAddTraits(.isButton)
            ProfileCard {
                Text(current.name)
                    .font(Theme.Font.profileName)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                    .padding(.horizontal, Theme.Profile.textInset)
                    .frame(maxWidth: .infinity)
                    .frame(height: Theme.Profile.nameRow)
                    .contextMenu {
                        Button(String(localized: "Copy Bot ID"), systemImage: "person.text.rectangle") { copy(bot.id) }
                        // SB28: the Primary Bot, as the desktop's bot menu offers it
                        if session.surfaceGate.allows(.primaryBot) {
                            switch PrimaryBotRules.menuAction(for: current, viewerId: viewerId) {
                            case .make:
                                Button(String(localized: "Make primary bot"), systemImage: "star") {
                                    Task { await PrimaryBotActions.make(current.id, session: session, done: { _ in }, working: $primaryWorking) }
                                }
                            case .replace:
                                Button(String(localized: "Replace with different Bot"), systemImage: "arrow.left.arrow.right") { pickingPrimary = true }
                            case nil:
                                EmptyView()
                            }
                        }
                    }
                    .accessibilityIdentifier("profile-name")
                ProfileDivider(leading: Theme.Profile.textInset)
                Text(role)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.parity(Color(hex: 0x9B9BA2), Theme.textSecondary))
                    .lineLimit(1)
                    .padding(.horizontal, Theme.Profile.textInset)
                    .frame(maxWidth: .infinity)
                    .frame(height: Theme.Profile.roleRow)
                    .accessibilityIdentifier("profile-role")
            }
            .padding(.top, 240 - Theme.Profile.mascotTop - Theme.Profile.mascot)
        }
    }

    // MARK: Tabs

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(Tab.allCases) { item in
                Button {
                    Haptics.selection()
                    tab = item
                } label: {
                    VStack(spacing: 2) {
                        Text(item.title)
                            .font(Theme.Font.tab)
                            .foregroundStyle(tab == item ? Theme.textPrimary : Theme.textTertiary)
                            .frame(height: 30)
                        Rectangle()
                            .fill(tab == item ? Theme.textPrimary : Color.clear)
                            .frame(width: Theme.Profile.tabUnderline, height: 2)
                    }
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("profile-tab.\(item.rawValue)")
                .accessibilityAddTraits(tab == item ? .isSelected : [])
            }
        }
        .background(alignment: .bottom) {
            Rectangle().fill(Theme.tabHairline).frame(height: 1)
        }
        .padding(.horizontal, Theme.Profile.cardMargin)
        // label centre at y 383, underline 400 to 402
        .padding(.top, 368 - 333.3)
    }

    @ViewBuilder private var tabContent: some View {
        switch tab {
        case .info: infoTab
        case .links: LinksTab(bot: current, loader: links)
        case .media: MediaTab(bot: current, loader: media)
        case .files:
            FilesTab(
                bot: current, loader: files,
                onOpenThreadFiles: session.surfaceGate.allows(.threadFiles) ? { showingThreadFiles = true } : nil
            )
        }
    }

    private func loadTab(_ selected: Tab) {
        guard let client = session.profileClient else { return }
        let botId = bot.id
        switch selected {
        case .info: break
        case .links:
            links.loadFirst { cursor, limit in try await client.botLinks(botId: botId, cursor: cursor, limit: limit) }
        case .media:
            media.loadFirst(first: CompanionClient.ProfilePage.firstMedia) { cursor, limit in
                try await client.botFiles(botId: botId, kind: .media, cursor: cursor, limit: limit)
            }
        case .files:
            files.loadFirst(first: CompanionClient.ProfilePage.firstFiles) { cursor, limit in
                try await client.botFiles(botId: botId, kind: .file, cursor: cursor, limit: limit)
            }
        }
    }

    // MARK: Info

    private var infoTab: some View {
        VStack(spacing: 0) {
            BotPanelNoticesView(bot: current)
            ProfileSectionLabel(text: "Character")
            characterCard
            ProfileFooter(text: "How this Bot's mark looks everywhere")

            ProfileCard {
                Button {
                    Haptics.selection()
                    showingInstructions = true
                } label: {
                    ProfileRow(
                        icon: ProfileRowIcon(systemImage: "doc.text", size: 16),
                        title: Text("Instructions"),
                        height: Theme.Profile.singleRow
                    ) { ProfileChevronTrailing() }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("profile-instructions")
            }
            .padding(.top, 16.7)

            ProfileSectionLabel(text: "Routines")
                .padding(.top, Theme.Profile.cardGap)
            Color.clear.frame(height: 0).id("profile-routines-anchor")
            routinesCard

            ProfileCard {
                ProfileRow(title: Text("Notifications"), height: Theme.Profile.toggleRow, textOffset: 0.67) {
                    Toggle("", isOn: Binding(
                        get: { notifications },
                        set: { value in
                            notifications = value
                            Task { await edit(BotProfileEdit(notifications: value), revert: { notifications = !value }) }
                        }
                    ))
                    .labelsHidden()
                    .toggleStyle(ParityToggleStyle(width: Theme.Profile.toggle.width, height: Theme.Profile.toggle.height))
                    .padding(.trailing, Theme.Profile.textInset)
                    .accessibilityIdentifier("profile-notifications")
                }
            }
            .padding(.top, Theme.Profile.cardGap)
            ProfileFooter(text: "Get notified when this Bot finishes or needs input")

            ProfileCard {
                Button {
                    Task { await shareTemplate() }
                } label: {
                    ProfileRow(
                        // the glyph is drawn over the row (`ShareGlyph`)
                        icon: ProfileRowIcon(systemImage: "circle", color: .clear),
                        title: Text("Share as Template"),
                        titleColor: Theme.accentText,
                        height: Theme.Profile.singleRow
                    ) {
                        if exporting { ProgressView().controlSize(.small).padding(.trailing, Theme.Profile.textInset) }
                    }
                }
                .buttonStyle(.plain)
                .overlay(alignment: .leading) {
                    // 16 x 16 pt, centred 30 pt into the card
                    ShareGlyph(lineWidth: 1.6)
                        .fill(Theme.blue)
                        .frame(width: 16, height: 16)
                        .padding(.leading, Theme.Profile.iconCentre - 8)
                        .allowsHitTesting(false)
                }
                .disabled(exporting)
                .accessibilityIdentifier("profile-share-template")
            }
            .padding(.top, 16.7)

            // BP10: what the bot is doing, below the reference's cards. It
            // starts under the fold of the scrolled Info tab (04, 07: the
            // Share card ends 67 pt above the screen's bottom edge), so the
            // reference screens keep their empty end.
            if session.surfaceGate.allows(.botActivity) {
                ProfileSectionLabel(text: "Activity")
                    .padding(.top, 76)
                BotActivityCard(
                    bot: current,
                    model: activity,
                    onOpen: { activityRoute = .detail($0) },
                    onHistory: { activityRoute = .history($0) }
                )
            }
        }
    }

    private var characterCard: some View {
        ProfileCard {
            CharacterEditor(
                draft: Binding(get: { draft }, set: { saveLook($0) }),
                metrics: .profileCard,
                showsPhotoRow: true,
                showsReset: false,
                hasPhoto: current.avatarUrl != nil,
                onPhotoPicked: { data in Task { await uploadPicture(data) } },
                onRemovePhoto: { Task { await edit(BotProfileEdit(avatarCrop: .mascot, avatarUrl: .clear)) } },
                onGeneratePhoto: { generatePrompt = ""; askingGenerate = true },
                onFramePhoto: { framing = true },
                unlocks: session.surfaceGate.allows(.characterExtras) ? unlocks : .nothingLocked
            )
            .frame(height: 252, alignment: .top)
            .clipped()
            .overlay { if generating { ProgressView().controlSize(.large) } }
            ProfileDivider(leading: Theme.Profile.textInset)
            Button {
                Haptics.selection()
                draft = .default
                Task { await edit(.resetLook) }
            } label: {
                Text("Reset to default")
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.accentText)
                    .offset(y: -0.6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, Theme.Profile.textInset)
                    .frame(height: Theme.Profile.row)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("character-reset")
        }
    }

    private var routinesCard: some View {
        ProfileCard {
            ForEach(Array(botRoutines.enumerated()), id: \.element.id) { index, routine in
                Button {
                    Haptics.selection()
                    parityRoutineInstruction = false
                    openRoutine = routine
                    routinePushed = true
                } label: {
                    ProfileRow(
                        icon: ProfileRowIcon(
                            systemImage: "clock", size: 17,
                            color: routine.enabled ? Theme.routineActive : Theme.routinePaused
                        ),
                        title: Text(verbatim: routine.name),
                        subtitle: Text(verbatim: RoutineWording.subtitle(routine)),
                        // 03/04: the first row measures 63.3 pt, the next 62.3
                        height: index == 0 ? Theme.Profile.routineRow : Theme.Profile.routineRow - 1
                    ) { ProfileChevronTrailing() }
                }
                .buttonStyle(.plain)
                .contextMenu {
                    // BP12: delete from the profile
                    if session.surfaceGate.allows(.routineDelete) {
                        Button(String(localized: "Delete routine"), systemImage: "trash", role: .destructive) { deletingRoutine = routine }
                    }
                }
                .accessibilityIdentifier("profile-routine.\(routine.name)")
                ProfileDivider()
            }
            Button {
                Haptics.selection()
                editingRoutine = true
            } label: {
                ProfileRow(
                    icon: ProfileRowIcon(systemImage: "plus", size: 18, color: Theme.blue),
                    title: Text("Add routine"),
                    titleColor: Theme.accentText,
                    // the routines card measures 173 pt with two routines
                    height: 45.4
                )
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("profile-add-routine")
        }
    }

    // MARK: Actions

    /// A look change from the editor: shown at once, saved at once, and put
    /// back if the server refuses.
    private func saveLook(_ next: CharacterDraft) {
        let previous = draft
        guard next != previous else { return }
        draft = next
        var change = BotProfileEdit()
        if next.color != previous.color { change.color = next.color }
        if next.look != previous.look { change.mascotLook = next.look }
        if next.skin != previous.skin { change.mascotSkin = next.skin }
        guard !change.isEmpty else { return }
        Task { await edit(change, revert: { draft = previous }) }
    }

    private func syncDraft() {
        let server = CharacterDraft(bot: current)
        if server != draft { draft = server }
    }

    @discardableResult
    private func edit(_ change: BotProfileEdit, revert: (() -> Void)? = nil) async -> Bool {
        guard let client = session.profileClient else { revert?(); return false }
        do {
            let updated = try await client.editBot(botId: bot.id, edit: change)
            session.applyProfileBot(updated)
            return true
        } catch {
            revert?()
            session.actionError = error.localizedDescription
            return false
        }
    }

    private func uploadPicture(_ data: Data) async {
        guard let mime = Self.imageMIME(data) else {
            session.actionError = String(localized: "Choose a PNG, JPEG, GIF, or WebP image.")
            return
        }
        let crop = current.avatarCrop.flatMap { $0 == .mascot ? nil : $0 } ?? .circle
        _ = await session.uploadAvatar(data, mime: mime, for: current, crop: crop)
    }

    private func generatePicture() async {
        let prompt = generatePrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else { return }
        generating = true
        defer { generating = false }
        _ = await session.generateAvatar(prompt: String(prompt.prefix(400)), for: current)
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

    /// Open an activity entry's thread: this chat is under the profile, so
    /// the profile goes; another thread opens like a deep link.
    private func openThread(botId: String, threadId: String) {
        let here = threadId == bot.threadId
        Task {
            // the activity sheet closes first: a pop under a closing sheet is dropped
            try? await Task.sleep(nanoseconds: 700_000_000)
            dismiss()
            guard !here else { return }
            try? await Task.sleep(nanoseconds: 700_000_000)
            session.openChat(threadId: threadId)
        }
    }

    /// A file's message in the chat under the profile (FilesSection.tsx `jump`).
    private func showInChat(_ file: ThreadFile) {
        let threadId = bot.threadId
        Task {
            // the files sheet closes first: a pop under a closing sheet is dropped
            try? await Task.sleep(nanoseconds: 700_000_000)
            dismiss()
            try? await Task.sleep(nanoseconds: 500_000_000)
            await session.jump(to: file.messageId, inThread: threadId)
        }
    }

    private func copy(_ id: String) {
        UIPasteboard.general.string = id
        withAnimation { copiedToast = true }
        Task {
            try? await Task.sleep(nanoseconds: 1_400_000_000)
            withAnimation { copiedToast = false }
        }
    }

    private func deleteBot() async {
        guard let client = session.profileClient else { return }
        do {
            try await client.deleteBot(botId: bot.id)
            // Pop this screen, then let the chat under it see its bot gone
            // and pop itself (a screen that is not on top cannot pop).
            dismiss()
            try? await Task.sleep(nanoseconds: 700_000_000)
            session.applyBotDeleted(bot.id)
        } catch {
            session.actionError = error.localizedDescription
        }
    }

    private func loadRoutines() async {
        let loaded = await session.loadRoutines()
        routines = loaded.routines
        runs = loaded.runs
        routinesLoaded = true
    }

    private static func imageMIME(_ data: Data) -> String? {
        let bytes = [UInt8](data.prefix(12))
        if bytes.starts(with: [0x89, 0x50, 0x4e, 0x47]) { return "image/png" }
        if bytes.starts(with: [0xff, 0xd8, 0xff]) { return "image/jpeg" }
        if bytes.starts(with: Array("GIF8".utf8)) { return "image/gif" }
        if bytes.count >= 12,
           String(bytes: bytes[0..<4], encoding: .ascii) == "RIFF",
           String(bytes: bytes[8..<12], encoding: .ascii) == "WEBP" { return "image/webp" }
        return nil
    }

    // MARK: Parity harness

    #if DEBUG
    /// Opens the state a reference screenshot shows.
    private func applyParityScreen() async {
        guard let screen = ParityLaunch.current?.screen else { return }
        switch screen {
        case .profileLinks: tab = .links
        case .profileMedia: tab = .media
        case .profileFiles: tab = .files
        case .profileInfoScrolled, .profileMoreMenu:
            try? await Task.sleep(nanoseconds: 600_000_000)
            scrollToEnd += 1
            if screen == .profileMoreMenu {
                try? await Task.sleep(nanoseconds: 400_000_000)
                menuOpen = true
            }
        case .routineDetail, .routineInstruction:
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            if let first = botRoutines.first(where: { $0.schedule.type == .cron }) ?? botRoutines.first {
                parityRoutineInstruction = screen == .routineInstruction
                openRoutine = first
                routinePushed = true
            }
        default: break
        }
    }
    #endif
}

// MARK: - Paging

/// One tab's list: the first page, then "Show more" pages, each from the
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
