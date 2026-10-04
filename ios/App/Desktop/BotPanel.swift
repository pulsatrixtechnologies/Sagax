// iPad I4: the bot panel (`BotSettingsDialog.tsx`), docked at the trailing
// edge from 1024 pt, over the leading edge below (`max-lg:absolute`). Its
// tabs are the ones the desktop references draw (`bot-settings/panel-tabs.ts`
// as captured): Details (name, label, description), Routines, Files (the
// conversation's files), Computer, Advanced (every other section behind a
// searchable list). Which tabs and sections a pairing shows is
// `DesktopPanelTab` / `DesktopPanelSection` (CompanionCore), from
// `SurfaceGate`.
//
// Sizes from desktop-1366x1024-33-panel-details.json: top bar 48 with 36 pt
// round buttons at y 6 (Back on an Advanced section; Export, Inspector,
// Close), the 112x119 mascot button at y 60 (it opens the character
// editor), name 17/24 medium at y 199, label 12/16 at y 225, tabs 13/20 at
// y 257 (px 6, py 4, radius 6, selected `elevated-hover`), the body from
// y 297, 16 pt in. Everything below the top bar scrolls as one column.
//
// Each sub-tree is type-erased (`AnyView`): a deep SwiftUI type overflowed
// the iPad's main-thread stack once (I1, build 6).
import SwiftUI
import UIKit
import CompanionCore

typealias BotPanelTab = DesktopPanelTab

extension DesktopPanelTab: Identifiable {
    public var id: String { rawValue }

    var title: LocalizedStringKey {
        switch self {
        case .details: "Details"
        case .routines: "Routines"
        case .files: "Files"
        case .computer: "Computer"
        case .advanced: "Advanced"
        }
    }
}

struct BotPanel: View {
    let bot: Bot
    let docked: Bool

    var body: some View {
        // one panel per bot: its loads and drafts start over
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
    @State private var exportOpen = false
    @State private var slackURL: URL?

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var tabs: [DesktopPanelTab] { DesktopPanelTab.visible(gate: session.surfaceGate, slack: slackURL != nil) }
    private var tab: DesktopPanelTab { tabs.contains(model.panelTab) ? model.panelTab : .details }

    var body: some View {
        VStack(spacing: 0) {
            AnyView(topBar)
            ScrollView {
                VStack(spacing: 0) {
                    AnyView(BotPanelIdentity(bot: current))
                    AnyView(tabRow)
                        .padding(.top, 16)
                        .padding(.bottom, 12)
                    AnyView(tabBody)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                }
            }
            .scrollIndicators(.automatic)
            .scrollDismissesKeyboard(.interactively)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(theme.app)
        .overlay(alignment: docked ? .leading : .trailing) {
            Rectangle().fill(theme.hairlineWeak).frame(width: 0.5)
        }
        .overlay {
            if model.avatarEditorOpen {
                // a tap outside the editor closes it
                Color.black.opacity(0.001)
                    .onTapGesture { withAnimation(.easeOut(duration: 0.15)) { model.avatarEditorOpen = false } }
                    .accessibilityHidden(true)
            }
        }
        .overlay(alignment: docked ? .topTrailing : .topLeading) {
            if model.avatarEditorOpen {
                AnyView(BotAvatarEditorLayer(bot: current, docked: docked))
            }
        }
        .sheet(item: $sharedFile) { file in ActivityShareSheet(items: [file.url]) }
        .task(id: session.connection?.id) {
            if session.surfaceGate.allows(.botSlack) {
                slackURL = await session.profileClient?.slackManagementURL(botId: bot.id)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Bot panel"))
        .accessibilityIdentifier("desktop-bot-panel")
    }

    // MARK: Top bar

    private var topBar: some View {
        HStack(spacing: 8) {
            if tab == .advanced, model.panelSection != nil {
                DesktopRoundButton(systemImage: "chevron.left", label: "Back") { model.panelSection = nil }
                    .accessibilityIdentifier("desktop-panel-back")
            }
            Spacer(minLength: 0)
            DesktopRoundButton(systemImage: "square.and.arrow.up", label: "Export conversation", active: exportOpen) { exportOpen.toggle() }
                .overlay(alignment: .topTrailing) {
                    if exportOpen { exportMenu }
                }
                .zIndex(1)
            if session.surfaceGate.allows(.inspector) {
                DesktopRoundButton(systemImage: "ladybug", label: "Inspector") { model.requestInspector() }
                    .accessibilityIdentifier("desktop-panel-inspector")
            }
            DesktopRoundButton(systemImage: "sidebar.right", label: "Close") { model.togglePanel() }
                .keyboardShortcut(.escape, modifiers: [])
                .accessibilityIdentifier("desktop-panel-close")
        }
        .padding(.horizontal, 12)
        .frame(height: 48)
        .zIndex(2)
    }

    private var exportMenu: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Export Conversation")
                .font(theme.font(12))
                .foregroundStyle(theme.inkSecondary)
                .padding(.horizontal, 14)
                .padding(.top, 10)
                .padding(.bottom, 4)
            DesktopMenuRow(systemImage: "doc.on.doc", title: Text("Copy as Markdown")) {
                exportOpen = false
                Task {
                    if let url = await session.export(threadId: current.threadId, format: "markdown"),
                       let text = try? String(contentsOf: url, encoding: .utf8) {
                        PlatformBridge.copyToPasteboard(text)
                    }
                }
            }
            DesktopMenuRow(systemImage: "arrow.down.to.line", title: Text("Download as .md")) {
                exportOpen = false
                Task {
                    if let url = await session.export(threadId: current.threadId, format: "markdown") {
                        sharedFile = ShareFile(url: url)
                    }
                }
            }
        }
        .padding(.horizontal, 6)
        .padding(.bottom, 6)
        .frame(width: 219, alignment: .leading)
        .background(theme.menu, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.25), radius: 14, y: 8)
        .fixedSize()
        .alignmentGuide(.top) { d in d[.top] - 40 }
    }

    // MARK: Tabs

    private var tabRow: some View {
        HStack(spacing: 2) {
            ForEach(tabs) { item in
                let selected = tab == item
                Button { choose(item) } label: {
                    Text(item.title)
                        .font(theme.font(13))
                        .foregroundStyle(selected ? theme.ink : theme.inkSecondary)
                        .padding(.horizontal, 6)
                        .frame(height: 28)
                        .background(selected ? theme.elevatedHover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
                .accessibilityIdentifier("desktop-panel-tab.\(item.rawValue)")
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Bot panel"))
    }

    private func choose(_ item: DesktopPanelTab) {
        // the Advanced tab opens on its list
        if item == .advanced { model.panelSection = nil }
        model.panelTab = item
    }

    @ViewBuilder
    private var tabBody: some View {
        switch tab {
        case .details:
            AnyView(BotPanelDetails(bot: current))
        case .routines:
            AnyView(BotPanelRoutines(bot: current))
        case .files:
            AnyView(BotPanelFiles(bot: current, docked: docked))
        case .computer:
            AnyView(BotPanelComputer(bot: current))
        case .advanced:
            AnyView(BotPanelAdvanced(bot: current, slackURL: slackURL))
        }
    }
}

// MARK: - Identity

/// The 112 pt mascot (the Edit avatar button, 112x119 at y 60), the name
/// 17/24 medium and the label 12/16.
private struct BotPanelIdentity: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot

    @StateObject private var owlHandle = OwlMascotHandle()

    var body: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.15)) { model.avatarEditorOpen.toggle() }
            } label: {
                BotMascotView(bot: bot, size: 112, state: MausState.forChat(.bot(bot), in: session.state), animated: true, owlHandle: owlHandle)
                    .frame(width: 112, height: 119)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.top, 12)
            .accessibilityLabel(Text("Edit avatar"))
            .accessibilityIdentifier("desktop-panel-avatar")
            Text(verbatim: bot.name)
                .font(theme.font(17, .medium))
                .foregroundStyle(theme.ink)
                .lineLimit(1)
                .frame(height: 24)
                .padding(.top, 20)
            let label = bot.title.trimmingCharacters(in: .whitespacesAndNewlines)
            if !label.isEmpty {
                Text(verbatim: label)
                    .font(theme.font(12))
                    .foregroundStyle(theme.inkSecondary)
                    .lineLimit(1)
                    .frame(height: 16)
                    .padding(.top, 2)
            }
        }
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity)
        .onValueChange(of: model.avatarMove) { move in
            if let move { owlHandle.flourish(move) }
        }
    }
}

// MARK: - Details

/// Details (`IdentitySection` without its avatar): Name, Label (optional),
/// Description with "View full", saved as each field is left.
private struct BotPanelDetails: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot

    @State private var name = ""
    @State private var title = ""
    @State private var blurb = ""
    @State private var viewingFull = false
    @FocusState private var field: Field?

    private enum Field { case name, title, blurb }

    private var canEdit: Bool { session.surfaceGate.allows(.botOwnerExtras) || session.canAdminister }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PanelLabel(text: "Name")
                .frame(height: 19.5)
            PanelTextField(placeholder: "Name", text: $name) { field = nil }
                .focused($field, equals: .name)
                .padding(.top, 6)
                .accessibilityIdentifier("desktop-panel-name")
            PanelLabel(text: "Label (optional)", size: 12)
                .frame(height: 18)
                .padding(.top, 16.5)
            PanelTextField(placeholder: "Describe what your agent does", text: $title) { field = nil }
                .focused($field, equals: .title)
                .padding(.top, 4)
                .accessibilityIdentifier("desktop-panel-title")
            HStack(alignment: .center) {
                PanelLabel(text: "Description")
                Button { viewingFull = true } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "book")
                            .font(.system(size: 11))
                        Text("View full")
                            .font(theme.font(11.5, .medium))
                    }
                    .foregroundStyle(theme.accentText)
                    .padding(.horizontal, 6)
                    .frame(height: 25.2)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
            }
            .padding(.top, 16)
            PanelTextArea(placeholder: "One line on what this bot is for", text: $blurb)
                .focused($field, equals: .blurb)
                .frame(height: 72)
                .padding(.top, 6)
                .accessibilityIdentifier("desktop-panel-blurb")
            Text("Shown in rosters, on the phone, and to other bots. Standing instructions belong in Soul, which has room for a full document.")
                .font(theme.font(11))
                .foregroundStyle(theme.inkSecondary)
                .lineSpacing(16.5 - 13.1)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 13)
        }
        .disabled(!canEdit)
        .padding(.top, 8)
        .padding(.leading, 16.5)
        .padding(.trailing, 16)
        .padding(.bottom, 24)
        .onAppear(perform: sync)
        .onValueChange(of: bot.name) { _ in if field != .name { name = bot.name } }
        .onValueChange(of: bot.title) { _ in if field != .title { title = bot.title } }
        .onValueChange(of: bot.description) { _ in if field != .blurb { blurb = bot.description } }
        .onValueChangePair(of: field) { left, _ in commit(left) }
        .sheet(isPresented: $viewingFull) {
            BotPanelFullDescription(bot: bot)
                .environmentObject(session)
        }
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

/// "View full": the whole description, read in a sheet.
private struct BotPanelFullDescription: View {
    @Environment(\.dismiss) private var dismiss
    let bot: Bot

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(verbatim: bot.description.isEmpty ? String(localized: "No description yet.") : bot.description)
                    .font(.body)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(20)
                    .textSelection(.enabled)
            }
            .navigationTitle(Text(verbatim: bot.name))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}

// MARK: - Routines

/// Routines (`RoutinesSection` + `RoutineList`): the header (calendar
/// glyph, "Routines" 13 secondary, New and Run logs 28 pt icon buttons),
/// then a row per routine (name and state 13/18, the 44x20 switch).
private struct BotPanelRoutines: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot

    @State private var routines: [Routine] = []
    @State private var loaded = false
    @State private var openRoutine: Routine?
    @State private var adding = false
    @State private var toggling: Set<String> = []

    private var mine: [Routine] { DesktopRoutineList.of(botId: bot.id, in: routines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "calendar.badge.clock")
                    .font(.system(size: 14))
                    .foregroundStyle(theme.inkSecondary)
                    .frame(width: 16, height: 16)
                Text("Routines")
                    .font(theme.font(13))
                    .foregroundStyle(theme.inkSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                iconButton("plus", label: "Create schedule") { adding = true }
                    .accessibilityIdentifier("desktop-panel-routine-new")
                iconButton("doc.text", label: "Run logs") { model.modal = .automations }
            }
            .frame(height: 28)
            list
        }
        .padding(.top, 8)
        .padding(.leading, 16.5)
        .padding(.trailing, 16)
        .padding(.bottom, 24)
        .task { await load() }
        .sheet(item: $openRoutine) { routine in
            NavigationStack {
                RoutineDetailView(routine: routine) { await load() }
            }
            .environmentObject(session)
        }
        .sheet(isPresented: $adding) {
            RoutineEditorView(routine: nil, presetBotId: bot.id) { await load() }
                .environmentObject(session)
        }
    }

    private func iconButton(_ symbol: String, label: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 13))
                .foregroundStyle(theme.inkSecondary)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(Text(label))
    }

    @ViewBuilder
    private var list: some View {
        if !loaded {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Loading routines…").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
            }
            .padding(12)
        } else if mine.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "repeat")
                    .font(.system(size: 18))
                    .foregroundStyle(theme.inkSecondary.opacity(0.6))
                Text("No routines yet.")
                    .font(theme.font(13))
                    .foregroundStyle(theme.inkSecondary)
            }
            .frame(maxWidth: .infinity)
            .padding(20)
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(theme.hairline50, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        } else {
            VStack(spacing: 2) {
                ForEach(mine) { routine in row(routine) }
            }
        }
    }

    private func row(_ routine: Routine) -> some View {
        HStack(spacing: 10) {
            Button { openRoutine = routine } label: {
                VStack(alignment: .leading, spacing: 0) {
                    Text(verbatim: routine.name)
                        .font(theme.font(13))
                        .foregroundStyle(theme.ink)
                        .lineLimit(1)
                        .frame(height: 18)
                    Text(stateLabel(routine))
                        .font(theme.font(13))
                        .foregroundStyle(theme.inkSecondary)
                        .lineLimit(1)
                        .frame(height: 18)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("desktop-panel-routine.\(routine.name)")
            PanelSwitch(label: routine.enabled ? "Pause" : "Resume", isOn: routine.enabled,
                        disabled: toggling.contains(routine.id) || routine.schedule.type == .unknown) { on in
                Task { await toggle(routine, on: on) }
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .hoverEffect(.highlight)
    }

    private func stateLabel(_ routine: Routine) -> LocalizedStringKey {
        switch DesktopRoutineList.state(routine) {
        case .active: "Active"
        case .paused: "Paused"
        case .finished: "Finished"
        }
    }

    private func toggle(_ routine: Routine, on: Bool) async {
        toggling.insert(routine.id)
        defer { toggling.remove(routine.id) }
        if let saved = await session.setRoutineEnabled(routine, enabled: on),
           let index = routines.firstIndex(where: { $0.id == saved.id }) {
            routines[index] = saved
        }
    }

    private func load() async {
        let result = await session.loadRoutines()
        routines = result.routines
        loaded = true
    }
}
