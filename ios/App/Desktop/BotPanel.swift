// iPad I4 (first version): the bot panel (`BotSettingsDialog.tsx`), docked
// at the trailing edge from 1024 pt, over the leading edge below. Its tabs
// are the desktop's (`bot-settings/panel-tabs.ts`): Details (name, title and
// description edited in place, Coding and Activity, Routines), Library (the
// conversation's files), Computer, More (every other setting).
//
// Every tab reuses the phone's feature views: `BotActivityCard` (WP7),
// `ThreadFilesView`, `ComputerView`, `AgentProfileView` with the advanced
// sections (WP16), `RoutineDetailView`. Sizes from
// desktop-1366x1024-33-panel-details.json: top bar 48 with 36 pt round
// buttons, mascot 112 at y 60, name 17/24 medium, title 12/16, tab pills
// 13/20 (selected `elevated-hover`), body 16 pt in.
import SwiftUI
import UIKit
import CompanionCore

enum BotPanelTab: String, CaseIterable, Identifiable {
    case details, library, computer, more
    var id: String { rawValue }

    var title: LocalizedStringKey {
        switch self {
        case .details: "Details"
        case .library: "Library"
        case .computer: "Computer"
        case .more: "More"
        }
    }
}

struct BotPanel: View {
    let bot: Bot
    let docked: Bool

    var body: some View {
        // one panel per bot: its activity poller and drafts start over
        AnyView(BotPanelContent(bot: bot, docked: docked)).id(bot.id)
    }
}

private struct BotPanelContent: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot
    let docked: Bool

    @State private var sharedFile: ShareFile?

    private var current: Bot { session.state.bot(bot.id) ?? bot }

    var body: some View {
        VStack(spacing: 0) {
            AnyView(topBar)
            AnyView(BotPanelIdentity(bot: current))
            AnyView(tabs)
                .padding(.top, 16)
            AnyView(tabBody)
                .padding(.top, 12)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .background(theme.app)
        .overlay(alignment: docked ? .leading : .trailing) {
            Rectangle().fill(theme.hairlineWeak).frame(width: 1)
        }
        .sheet(item: $sharedFile) { file in ActivityShareSheet(items: [file.url]) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Bot panel"))
        .accessibilityIdentifier("desktop-bot-panel")
    }

    private var topBar: some View {
        HStack(spacing: 8) {
            Spacer(minLength: 0)
            DesktopRoundButton(systemImage: "square.and.arrow.up", label: "Export conversation") {
                Task {
                    if let url = await session.export(threadId: current.threadId, format: "markdown") {
                        sharedFile = ShareFile(url: url)
                    }
                }
            }
            DesktopRoundButton(systemImage: "sidebar.right", label: "Close") { model.togglePanel() }
                .keyboardShortcut(.escape, modifiers: [])
                .accessibilityIdentifier("desktop-panel-close")
        }
        .padding(.trailing, 12)
        .padding(.top, 6)
        .frame(height: 48, alignment: .top)
    }

    private var tabs: some View {
        HStack(spacing: 2) {
            ForEach(BotPanelTab.allCases) { tab in
                let selected = model.panelTab == tab
                Button { model.panelTab = tab } label: {
                    Text(tab.title)
                        .font(theme.font(13))
                        .foregroundStyle(selected ? theme.ink : theme.inkSecondary)
                        .padding(.horizontal, 8)
                        .frame(height: 28)
                        .background(selected ? theme.elevatedHover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier("desktop-panel-tab.\(tab.rawValue)")
            }
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var tabBody: some View {
        switch model.panelTab {
        case .details:
            BotPanelDetails(bot: current)
        case .library:
            ThreadFilesView(threadId: current.threadId) { file in
                Task { await session.jump(to: file.messageId, inThread: current.threadId) }
            }
        case .computer:
            NavigationStack { ComputerView(bot: current) }
        case .more:
            AgentProfileView(bot: current)
        }
    }
}

// MARK: - Identity

/// The 112 pt mascot (a tap plays the owl's next move), then the name, the
/// title and the description, each edited in place as on the desktop.
private struct BotPanelIdentity: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot

    @StateObject private var owlHandle = OwlMascotHandle()
    @State private var nextMove = 0
    @State private var name = ""
    @State private var title = ""
    @State private var blurb = ""
    @FocusState private var field: Field?

    private enum Field { case name, title, blurb }

    private var canEdit: Bool { session.surfaceGate.allows(.botOwnerExtras) }

    var body: some View {
        VStack(spacing: 0) {
            BotMascotView(bot: bot, size: 112, state: MausState.forChat(.bot(bot), in: session.state), animated: true, owlHandle: owlHandle)
                .frame(width: 112, height: 119)
                .contentShape(Rectangle())
                .onTapGesture {
                    let moves = OwlWingMove.allCases
                    owlHandle.flourish(moves[nextMove % moves.count])
                    nextMove += 1
                }
                .padding(.top, 12)
                .accessibilityLabel(Text("\(bot.name)'s character"))
            editable($name, placeholder: "Name", font: theme.font(17, .medium), color: theme.ink, field: .name)
                .padding(.top, 20)
            editable($title, placeholder: "Add a title", font: theme.font(12), color: theme.inkSecondary, field: .title)
                .padding(.top, 2)
            editable($blurb, placeholder: "One line on what this bot is for", font: theme.font(12), color: theme.inkTertiary, field: .blurb)
                .lineLimit(1...3)
                .padding(.top, 6)
        }
        .padding(.horizontal, 16)
        .onAppear(perform: sync)
        .onValueChange(of: bot.name) { _ in if field != .name { name = bot.name } }
        .onValueChange(of: bot.title) { _ in if field != .title { title = bot.title } }
        .onValueChange(of: bot.description) { _ in if field != .blurb { blurb = bot.description } }
        .onValueChangePair(of: field) { left, _ in commit(left) }
    }

    private func editable(_ text: Binding<String>, placeholder: LocalizedStringKey, font: Font, color: Color, field which: Field) -> some View {
        TextField("", text: text, prompt: Text(placeholder).foregroundColor(theme.inkTertiary), axis: .vertical)
            .font(font)
            .foregroundStyle(color)
            .multilineTextAlignment(.center)
            .tint(theme.focus)
            .focused($field, equals: which)
            .disabled(!canEdit)
            .onSubmit { field = nil }
            .accessibilityIdentifier("desktop-panel-\(which)")
    }

    private func sync() {
        name = bot.name
        title = bot.title
        blurb = bot.description
    }

    /// Saves the field that just lost focus, if it changed.
    private func commit(_ left: Field?) {
        guard let left else { return }
        var patch = BotProfilePatch()
        switch left {
        case .name:
            let value = name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty, value != bot.name else { name = bot.name; return }
            patch.name = value
        case .title:
            let value = title.trimmingCharacters(in: .whitespacesAndNewlines)
            guard value != bot.title else { return }
            patch.title = value
        case .blurb:
            let value = blurb.trimmingCharacters(in: .whitespacesAndNewlines)
            guard value != bot.description else { return }
            patch.description = value
        }
        let target = bot
        Task {
            if await session.updateProfile(patch, for: target) == nil { sync() }
        }
    }
}

// MARK: - Details

/// Details: Coding and Activity (live work, WP7), then the bot's routines.
private struct BotPanelDetails: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot

    @StateObject private var activity: BotActivityModel
    @State private var activityRoute: BotActivityRoute?
    @State private var routines: [Routine] = []
    @State private var loaded = false
    @State private var openRoutine: Routine?
    @State private var addingRoutine = false

    init(bot: Bot) {
        self.bot = bot
        _activity = StateObject(wrappedValue: BotActivityModel(botId: bot.id))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if session.surfaceGate.allows(.botActivity) {
                    BotActivityCard(
                        bot: bot, model: activity,
                        onOpen: { activityRoute = .detail($0) },
                        onHistory: { activityRoute = .history($0) }
                    )
                }
                sectionLabel("Routines")
                    .padding(.top, 20)
                routineList
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.automatic)
        .task {
            if session.surfaceGate.allows(.botActivity) { activity.start(client: session.profileClient) }
            await load()
        }
        .onDisappear { activity.stop() }
        .onValueChange(of: BotActivityRules.signature(bot.tasks)) { _ in Task { await activity.refresh() } }
        .sheet(item: $activityRoute) { route in
            BotActivitySheet(botId: bot.id, route: route, model: activity) { _, threadId in
                activityRoute = nil
                session.openChat(threadId: threadId)
            }
        }
        .sheet(item: $openRoutine) { routine in
            NavigationStack {
                RoutineDetailView(routine: routine) { await load() }
            }
            .environmentObject(session)
        }
        .sheet(isPresented: $addingRoutine) {
            RoutineEditorView(routine: nil, presetBotId: bot.id) { await load() }
                .environmentObject(session)
        }
    }

    private func sectionLabel(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(theme.font(13))
            .foregroundStyle(theme.inkSecondary)
            .padding(.bottom, 8)
    }

    @ViewBuilder
    private var routineList: some View {
        let mine = routines.filter { $0.botId == bot.id }.sorted { $0.createdAt < $1.createdAt }
        VStack(spacing: 0) {
            if !loaded {
                ProgressView().controlSize(.small).frame(maxWidth: .infinity).padding(12)
            } else if mine.isEmpty {
                Text("No routines yet.")
                    .font(theme.font(13))
                    .foregroundStyle(theme.inkTertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
            }
            ForEach(mine) { routine in
                Button { openRoutine = routine } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "clock")
                            .font(.system(size: 14))
                            .foregroundStyle(routine.enabled ? theme.success : theme.inkTertiary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: routine.name)
                                .font(theme.font(13, .medium))
                                .foregroundStyle(theme.ink)
                                .lineLimit(1)
                            Text(verbatim: RoutineWording.subtitle(routine))
                                .font(theme.font(12))
                                .foregroundStyle(theme.inkSecondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(theme.inkTertiary)
                    }
                    .padding(.horizontal, 12)
                    .frame(minHeight: 48)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityIdentifier("desktop-panel-routine.\(routine.name)")
                Rectangle().fill(theme.hairlineWeak).frame(height: 1).padding(.leading, 12)
            }
            Button { addingRoutine = true } label: {
                Label("Add routine", systemImage: "plus")
                    .font(theme.font(13))
                    .foregroundStyle(theme.accentText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .frame(height: 40)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
        }
        .background(theme.card, in: RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
    }

    private func load() async {
        let result = await session.loadRoutines()
        routines = result.routines
        loaded = true
    }
}
