// iPad I4/I4b: the bot panel (`BotSettingsDialog.tsx`), docked at the
// trailing edge from 1024 pt, over the leading edge below
// (`max-lg:absolute`). Its tabs are the current desktop's
// (`bot-settings/panel-tabs.ts`): Details (Coding, Activity, Routines),
// Library (Files, Skills, Plugins: BotPanelLibrary.swift), Computer, More (every other section
// behind a searchable list). The name, label and description are edited
// where they show, under the mascot (`InlineEditableText.tsx`). Which tabs
// and sections a pairing shows is `DesktopPanelTab` / `DesktopPanelSection`
// (CompanionCore), from `SurfaceGate`.
//
// Sizes from desktop-1366x1024-33-panel-details.json: top bar 48 with 36 pt
// round buttons at y 6 (Back on a More section; Export, Inspector when the
// Appearance switch shows it, Close), the 112x119 mascot button at y 72 (it
// opens the character editor), the name 17/24 medium in a 28 pt button at
// y 211, the label 12.5/16 at y 241, the description 11.5/16 at y 263, tabs
// 13/20 at y 299 (px 6, py 4, radius 6, selected `elevated-hover`), the body
// from y 347, 16 pt in. Everything below the top bar scrolls as one column.
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
    /// A name, label or description field is open: Escape cancels it, not the panel.
    @State private var inlineEditing = false
    /// Appearance > Show the Inspector button (`sagax-show-inspector-button`, off by default).
    @AppStorage(DesktopInspectorButton.key) private var showInspector = false

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var tabs: [DesktopPanelTab] { DesktopPanelTab.visible(gate: session.surfaceGate, slack: slackURL != nil) }
    private var tab: DesktopPanelTab { tabs.contains(model.panelTab) ? model.panelTab : .details }

    var body: some View {
        VStack(spacing: 0) {
            AnyView(topBar)
            ScrollView {
                VStack(spacing: 0) {
                    AnyView(BotPanelIdentity(bot: current, editing: $inlineEditing))
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
            Rectangle().fill(theme.hairlineWeak).frame(width: 1)
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
            if tab == .more, model.panelSection != nil {
                DesktopRoundButton(systemImage: "chevron.left", label: "Back") { model.panelSection = nil }
                    .accessibilityIdentifier("desktop-panel-back")
            }
            Spacer(minLength: 0)
            DesktopRoundButton(systemImage: "square.and.arrow.up", label: "Export conversation", active: exportOpen, icon: .share) { exportOpen.toggle() }
                .overlay(alignment: .topTrailing) {
                    if exportOpen { exportMenu }
                }
                .zIndex(1)
            if showInspector, session.surfaceGate.allows(.inspector) {
                DesktopRoundButton(systemImage: "ladybug", label: "Inspector") { model.requestInspector() }
                    .accessibilityIdentifier("desktop-panel-inspector")
            }
            DesktopRoundButton(systemImage: "sidebar.right", label: "Close", icon: .panelRight) { model.togglePanel() }
                .keyboardShortcut(inlineEditing ? KeyboardShortcut("w", modifiers: [.command, .control, .option, .shift]) : KeyboardShortcut(.escape, modifiers: []))
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
        // the More tab opens on its list
        if item == .more { model.panelSection = nil }
        model.panelTab = item
    }

    @ViewBuilder
    private var tabBody: some View {
        switch tab {
        case .details:
            AnyView(BotPanelDetails(bot: current))
        case .library:
            AnyView(BotPanelLibrary(bot: current, docked: docked))
        case .computer:
            AnyView(BotPanelComputer(bot: current))
        case .more:
            AnyView(BotPanelMore(bot: current, slackURL: slackURL))
        }
    }
}

// MARK: - Identity

/// The Appearance switch that shows the Inspector button in the chat's and
/// the panel's top bars (`src/lib/inspector-preferences.ts`): off by default.
enum DesktopInspectorButton {
    static let key = "sagax-show-inspector-button"
}

/// The 112 pt mascot (the Edit avatar button, 112x119 at y 72), then the
/// name (17/24 medium), the label (12.5/16, "Add a label" when empty) and
/// the description (11.5/16), each edited where it shows.
private struct BotPanelIdentity: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot
    @Binding var editing: Bool

    @StateObject private var owlHandle = OwlMascotHandle()
    @State private var open: Field?

    private enum Field { case name, label, description }

    var body: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.15)) { model.avatarEditorOpen.toggle() }
            } label: {
                BotMascotView(bot: bot, size: 112, state: MausState.forChat(.bot(bot), in: session.state), animated: true, owlHandle: owlHandle)
                    .frame(width: 112, height: 112)
                    .frame(width: 112, height: 119, alignment: .top)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.top, 24)
            .accessibilityLabel(Text("Edit avatar"))
            .accessibilityIdentifier("desktop-panel-avatar")
            PanelInlineText(value: bot.name, placeholder: nil, label: "Edit name", size: 17, lineHeight: 24, weight: .medium,
                            limit: 100, required: true, isEditing: binding(.name)) { save(name: $0) }
                .padding(.top, 20)
                .accessibilityIdentifier("desktop-panel-name")
            PanelInlineText(value: bot.title, placeholder: "Add a label", label: "Edit label", size: 12.5, lineHeight: 16,
                            muted: true, limit: 200, isEditing: binding(.label)) { save(title: $0) }
                .padding(.top, 2)
                .accessibilityIdentifier("desktop-panel-title")
            PanelInlineText(value: bot.description, placeholder: "One line on what this bot is for", label: "Description",
                            size: 11.5, lineHeight: 16, muted: true, limit: 4000, isEditing: binding(.description)) { save(description: $0) }
                .padding(.top, 2)
                .accessibilityIdentifier("desktop-panel-blurb")
        }
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity)
        .onValueChange(of: model.avatarMove) { move in
            if let move { owlHandle.flourish(move) }
        }
        .onValueChange(of: open) { field in editing = field != nil }
    }

    /// One field open at a time.
    private func binding(_ field: Field) -> Binding<Bool> {
        Binding(get: { open == field }, set: { on in
            if on { open = field } else if open == field { open = nil }
        })
    }

    private func save(name: String? = nil, title: String? = nil, description: String? = nil) {
        var patch = BotProfilePatch()
        patch.name = name
        patch.title = title
        patch.description = description
        let target = bot
        Task { _ = await session.updateProfile(patch, for: target) }
    }
}
