// iPad I3 (first version): the desktop chat in the shell's content column.
// It is the phone's `ChatView` (transcript, cards, composer state, sending:
// one implementation), told by `\.desktopChat` to wear the desktop's chrome:
// the floating bot pill centred at the top with the round Export and panel
// buttons on the right (`ChatView.tsx` header), the transcript in a column
// of at most 960, bubbles capped at 560, and the composer pill (attach,
// field, model chip, dictation, voice) docked 16 pt above the bottom.
// Measured in desktop-1366x1024-03-main.json.
import SwiftUI
import UIKit
import CompanionCore

/// What the shell tells a chat drawn in its content column.
struct DesktopChatChrome {
    /// The bot panel is open (its own top bar then holds Export and Close).
    var panelOpen: Bool
    /// The panel is docked beside the chat (1024 pt and wider).
    var panelDocked: Bool
    /// The Inspector is open beside the chat.
    var inspectorOpen = false
    var togglePanel: () -> Void
    var showPanel: (BotPanelTab) -> Void
    /// The command allowlist, in the panel's Advanced > Permissions.
    var showAllowlist: () -> Void = {}
    var toggleInspector: () -> Void = {}
    var openModelPicker: () -> Void = {}
}

private struct DesktopChatKey: EnvironmentKey {
    static let defaultValue: DesktopChatChrome? = nil
}

private struct DesktopBubbleCapKey: EnvironmentKey {
    static let defaultValue: CGFloat? = nil
}

extension EnvironmentValues {
    /// Set by the desktop shell; nil on the iPhone (and the iPad's phone UI).
    var desktopChat: DesktopChatChrome? {
        get { self[DesktopChatKey.self] }
        set { self[DesktopChatKey.self] = newValue }
    }

    /// The desktop's bubble cap (`min(80 %, 560)`); nil keeps the phone's.
    var desktopBubbleCap: CGFloat? {
        get { self[DesktopBubbleCapKey.self] }
        set { self[DesktopBubbleCapKey.self] = newValue }
    }
}

// MARK: - Column

/// The content column's chat: ChatView in its own navigation stack (its
/// computer and profile pushes), with the desktop chrome on.
struct DesktopChatColumn: View {
    @EnvironmentObject private var model: DesktopShellModel
    @Environment(\.desktopTheme) private var theme
    let chat: Chat
    /// The Inspector beside (or over) the chat.
    @State private var inspectorOpen = DesktopChatColumn.parityInspector

    static let inspectorWidth: CGFloat = 460

    var body: some View {
        GeometryReader { geometry in
            // The window is this column plus the sidebar (and a docked panel):
            // the Inspector docks from 1024, as the bot panel does.
            let window = geometry.size.width + DesktopShellRules.sidebarWidth + (model.panelOpen && model.panelDocked ? model.panelWidth : 0)
            let docksInspector = inspectorOpen && window >= DesktopShellRules.dockMinWidth
            let chatWidth = geometry.size.width - (docksInspector ? Self.inspectorWidth : 0)
            HStack(spacing: 0) {
                chatStack(width: chatWidth, totalWidth: geometry.size.width)
                    .frame(width: chatWidth)
                if docksInspector {
                    AnyView(DesktopInspectorPanel(threadId: chat.threadId) { toggleInspector() })
                        .frame(width: Self.inspectorWidth)
                        .transition(.move(edge: .trailing))
                }
            }
            .overlay(alignment: .trailing) {
                if inspectorOpen && !docksInspector {
                    // below 1024 the Inspector covers the whole window row
                    // (InspectorPanel.tsx `max-lg:absolute inset-0`)
                    AnyView(DesktopInspectorPanel(threadId: chat.threadId) { toggleInspector() })
                        .frame(width: window)
                        .transition(.move(edge: .trailing))
                }
            }
        }
        .onValueChange(of: model.panelOpen) { open in
            if open { inspectorOpen = false }
        }
        .onValueChange(of: model.inspectorRequest) { _ in
            if !inspectorOpen { toggleInspector() }
        }
    }

    private func toggleInspector() {
        withAnimation(.easeOut(duration: 0.2)) {
            inspectorOpen.toggle()
            if inspectorOpen, model.panelOpen { model.togglePanel() }
        }
    }

    private func chatStack(width: CGFloat, totalWidth: CGFloat) -> some View {
        // the transcript column: px-5 inside the content, at most 960
        let column = min(DesktopShellRules.chatColumn, width - 40)
        return NavigationStack {
            AnyView(ChatView(chat: chat))
        }
        .environment(\.desktopChatText, theme)
        .environment(\.desktopBubbleCap, DesktopChatMetrics.bubbleCap(column: column))
        .environment(\.desktopWideCap, DesktopChatMetrics.wideCap(column: column))
        .environment(\.desktopChat, DesktopChatChrome(
            panelOpen: model.panelOpen && chat.isBot,
            // the shell docks the panel at 1024: this column is then
            // the window less the sidebar and the panel
            panelDocked: model.panelOpen && model.panelDocked,
            inspectorOpen: inspectorOpen,
            togglePanel: { model.togglePanel() },
            showPanel: { tab in model.showPanel(tab) },
            showAllowlist: { model.showPanel(.more, section: .permissions) },
            toggleInspector: { toggleInspector() },
            openModelPicker: { model.modelPickerOpen = true }
        ))
    }

    #if DEBUG
    static var parityInspector: Bool { ParityLaunch.current?.iPadScreen == .inspector }
    #else
    static let parityInspector = false
    #endif
}

// MARK: - ChatView's desktop chrome

extension ChatView {
    /// The header slot: the desktop's floating pill and buttons, or the
    /// phone's top bar (and the find bar on both).
    var chatHeaderSlot: some View {
        Group {
            if let desktop = desktopChat {
                // the find bar opens under the header (ChatView.tsx), 20 in
                AnyView(VStack(spacing: 0) {
                    DesktopChatHeader(chat: current, chrome: desktop, export: exportConversation, copyMarkdown: copyConversationMarkdown) { openProfile() }
                        .frame(height: 52, alignment: .top)
                    if finder.isOpen && session.surfaceGate.allows(.findInConversation) {
                        ChatFindBar(model: finder, threadId: threadId)
                            .padding(.horizontal, 20)
                            .transition(.opacity)
                    }
                })
                .chatFindShortcut { openFind() }
            } else {
                AnyView(headerOrFindBar)
            }
        }
    }

    /// The composer slot: the desktop pill, or the phone's composer.
    var composerSlot: some View {
        Group {
            if desktopChat != nil {
                AnyView(desktopComposer)
            } else {
                AnyView(composer)
            }
        }
    }

    /// Behind the transcript: the desktop's glow, or the phone's ground.
    var chatBackground: some View {
        Group {
            if desktopChat != nil {
                AnyView(DesktopAppGlow())
            } else {
                AnyView(Theme.bg.ignoresSafeArea())
            }
        }
    }

    /// The desktop field's placeholder ("Message Ara").
    var desktopPrompt: String {
        if sendingMessage { return String(localized: "Sending…") }
        if dictation.isListening { return String(localized: "Listening…") }
        // Composer.tsx: an open approval holds the conversation
        if !dockApprovals.isEmpty { return String(localized: "Answer the approval above to continue") }
        return String(localized: "Message \(PeopleDirectory.shared.name(current, session: session))")
    }

    /// Export conversation > Copy as Markdown.
    func copyConversationMarkdown() {
        Task {
            if let url = await session.export(threadId: current.threadId, format: "markdown"),
               let text = try? String(contentsOf: url, encoding: .utf8) {
                PlatformBridge.copyToPasteboard(text)
            }
        }
    }

    /// Export conversation > Download as .md: the file, to the share sheet.
    func exportConversation() {
        Task {
            if let url = await session.export(threadId: current.threadId, format: "markdown") {
                shareFile = ShareFile(url: url)
            }
        }
    }

    /// The desktop composer: the pill (Desktop/DesktopComposer.swift) in a
    /// dock as wide as the transcript column, 16 pt above the bottom; its
    /// "/" and @ popups float above it.
    var desktopComposer: some View {
        VStack(spacing: 6) {
            composerAccessories
            AnyView(DesktopComposerPill(
                draft: $draft,
                prompt: desktopPrompt,
                focused: $composerFocused,
                canSend: canSend,
                busy: preparingAttachments || sendingMessage,
                listening: dictation.isListening,
                inputLocked: dictation.isListening || dictation.isStarting || preparingAttachments || sendingMessage,
                bot: current.isBot ? session.state.bot(current.id)?.projected(forThread: threadId) : nil,
                popup: desktopComposerPopup,
                attachPhotos: { showingPhotoPicker = true },
                attachFiles: { showingFileImporter = true },
                more: {
                    dictation.stop()
                    composerFocused = false
                    withAnimation(.snappy(duration: 0.28)) { showingPlus.toggle() }
                },
                openModel: { desktopChat?.openModelPicker() },
                openAllowlist: { desktopChat?.showAllowlist() },
                toggleDictation: {
                    composerFocused = false
                    dictation.toggle(capturing: draft)
                },
                send: { submit() },
                voice: startVoiceMode,
                hardwareReturn: { submit(busyMode: openBusyChoice) },
                draftChanged: { old, new in
                    withAnimation(.easeInOut(duration: 0.15)) { draftChanged(from: old, to: new) }
                }
            ))
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 16)
        .frame(maxWidth: DesktopShellRules.chatColumn + 40)
        .frame(maxWidth: .infinity)
        .task(id: commandLoadKey) { await loadCommands() }
        .task(id: heldSends.isEmpty) {
            if !heldSends.isEmpty { await power.load(botIds: [], threadId: nil, groupId: nil, session: session) }
        }
    }

    /// The "/" menu or the @ / # suggestions, for the pill to float.
    var desktopComposerPopup: AnyView? {
        let menuItems = slashMenuItems
        if slashContext != nil, !menuItems.isEmpty || power.loadingCommands {
            return AnyView(ComposerCommandMenuView(
                items: menuItems,
                loading: power.loadingCommands,
                accent: desktopChatText?.accent ?? MausPalette.color(current.color),
                refresh: nil,
                close: closeCommandMenu,
                pick: pickCommand
            ))
        }
        let suggestions = suggestionItems
        if !suggestions.isEmpty {
            return AnyView(SuggestionStrip(items: suggestions, pick: pickSuggestion))
        }
        return nil
    }
}

// MARK: - Header

/// The bot pill (41 tall, radius full, card fill, hairline ring, mascot 24,
/// name 14 medium) centred at y 7.5, and 36 pt round buttons 20 pt from the
/// trailing edge at y 10: Export, then the panel toggle. With the panel
/// docked open, the panel's own top bar holds them.
struct DesktopChatHeader: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let chat: Chat
    let chrome: DesktopChatChrome
    let export: () -> Void
    let copyMarkdown: () -> Void
    let openProfile: () -> Void
    @State private var exportOpen = DesktopChatHeader.parityExport

    var body: some View {
        ZStack(alignment: .top) {
            Button(action: openProfile) {
                HStack(spacing: 8) {
                    ChatAvatarView(chat: chat, size: 24, state: MausState.forChat(chat, in: session.state), background: theme.chrome)
                        .frame(width: 24, height: 24)
                    Text(verbatim: PeopleDirectory.shared.name(chat, session: session))
                        .font(theme.font(14, .medium))
                        .foregroundStyle(theme.ink)
                        .lineLimit(1)
                }
                .padding(.leading, 8)
                .padding(.trailing, 14)
                .frame(height: 41)
                .background(theme.chrome, in: Capsule())
                .overlay(Capsule().strokeBorder(theme.hairlineWeak, lineWidth: 1))
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .frame(maxWidth: 360)
            .padding(.top, 7.5)
            .accessibilityLabel(Text(chat.isBot ? "Open \(chat.name)'s profile" : chat.name))
            .accessibilityIdentifier("desktop-chat-pill")

            if !(chrome.panelOpen && chrome.panelDocked) {
                HStack(spacing: 8) {
                    Spacer(minLength: 0)
                    DesktopRoundButton(systemImage: "square.and.arrow.up", label: "Export conversation", active: exportOpen) { exportOpen.toggle() }
                        .overlay(alignment: .topTrailing) {
                            if exportOpen { exportMenu }
                        }
                        .zIndex(1)
                    if chat.isBot {
                        DesktopRoundButton(systemImage: "ladybug", label: "Inspector", active: chrome.inspectorOpen, action: chrome.toggleInspector)
                            .accessibilityIdentifier("desktop-inspector-toggle")
                        DesktopRoundButton(systemImage: "sidebar.right", label: "Open agent profile", action: chrome.togglePanel)
                            .keyboardShortcut(".", modifiers: .command)
                            .accessibilityIdentifier("desktop-panel-toggle")
                    }
                }
                .padding(.top, 10)
                .padding(.trailing, 20)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

extension DesktopChatHeader {
    /// ChatView.tsx's export menu: "Export Conversation", Copy as Markdown,
    /// Download as .md; 4 pt under the button, its trailing edge aligned.
    var exportMenu: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Export Conversation")
                .font(theme.font(12))
                .foregroundStyle(theme.inkSecondary)
                .padding(.horizontal, 14)
                .padding(.top, 10)
                .padding(.bottom, 4)
            DesktopMenuRow(systemImage: "doc.on.doc", title: Text("Copy as Markdown")) {
                exportOpen = false
                copyMarkdown()
            }
            DesktopMenuRow(systemImage: "arrow.down.to.line", title: Text("Download as .md")) {
                exportOpen = false
                export()
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
        .accessibilityIdentifier("desktop-export-menu")
    }

    #if DEBUG
    static var parityExport: Bool { ParityLaunch.current?.iPadScreen == .chatExportMenu }
    #else
    static let parityExport = false
    #endif
}

/// A 36 pt round chrome button: card fill, hairline ring, 18 pt glyph.
struct DesktopRoundButton: View {
    @Environment(\.desktopTheme) private var theme
    let systemImage: String
    let label: LocalizedStringKey
    var active = false
    /// The renderer's own lucide glyph (18 pt, stroke 1.75) instead of the symbol.
    var icon: DesktopIcon? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            glyph
                .foregroundStyle(theme.ink)
                .frame(width: 36, height: 36)
                .background(active ? theme.raised : theme.chrome, in: Circle())
                .overlay(Circle().strokeBorder(theme.hairlineWeak, lineWidth: 1))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(Text(label))
    }

    @ViewBuilder
    private var glyph: some View {
        if let icon {
            DesktopIconView(icon: icon, size: 18, strokeWidth: 1.75)
        } else {
            Image(systemName: systemImage).font(.system(size: 15, weight: .regular))
        }
    }
}

/// The engines' model catalogue, read once per pairing for the composer chips.
@MainActor
final class DesktopModelCatalog {
    static let shared = DesktopModelCatalog()
    private var cached: (connection: String?, instances: [Instance])?

    func instances(_ session: Session) async -> [Instance] {
        let connection = session.connection?.id
        if let cached, cached.connection == connection, !cached.instances.isEmpty { return cached.instances }
        // quietly: a chip that cannot load stays hidden, never an alert
        guard !session.isDemo, let client = session.profileClient else { return [] }
        let loaded = (try? await client.instances()) ?? []
        cached = (connection, loaded)
        return loaded
    }
}
