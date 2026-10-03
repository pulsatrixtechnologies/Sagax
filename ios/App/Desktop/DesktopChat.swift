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
    var togglePanel: () -> Void
    var showPanel: (BotPanelTab) -> Void
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
    let chat: Chat

    var body: some View {
        GeometryReader { geometry in
            NavigationStack {
                AnyView(ChatView(chat: chat))
            }
            .environment(\.desktopChat, DesktopChatChrome(
                panelOpen: model.panelOpen && chat.isBot,
                // the shell docks the panel at 1024: this column is then
                // the window less the sidebar and the panel
                panelDocked: model.panelOpen && geometry.size.width + DesktopShellRules.sidebarWidth + DesktopShellRules.panelWidth >= DesktopShellRules.dockMinWidth,
                togglePanel: { model.togglePanel() },
                showPanel: { tab in
                    model.panelTab = tab
                    if !model.panelOpen { model.togglePanel() }
                }
            ))
        }
    }
}

// MARK: - ChatView's desktop chrome

extension ChatView {
    /// The header slot: the desktop's floating pill and buttons, or the
    /// phone's top bar (and the find bar on both).
    var chatHeaderSlot: some View {
        Group {
            if let desktop = desktopChat, !(finder.isOpen && session.surfaceGate.allows(.findInConversation)) {
                AnyView(DesktopChatHeader(chat: current, chrome: desktop, export: exportConversation) { openProfile() })
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

    /// Export conversation (the desktop header's first button): Markdown,
    /// handed to the share sheet.
    func exportConversation() {
        Task {
            if let url = await session.export(threadId: current.threadId, format: "markdown") {
                shareFile = ShareFile(url: url)
            }
        }
    }

    /// The desktop composer: a 46 pt pill (radius 23, `composer` fill, 30 %
    /// ink ring) in a dock as wide as the transcript column, 16 pt above the
    /// bottom.
    var desktopComposer: some View {
        VStack(spacing: 6) {
            composerAccessories
            AnyView(DesktopComposerPill(
                draft: $draft,
                prompt: composerPrompt,
                focused: $composerFocused,
                canSend: canSend,
                busy: preparingAttachments || sendingMessage,
                listening: dictation.isListening,
                inputLocked: dictation.isListening || dictation.isStarting || preparingAttachments || sendingMessage,
                bot: current.isBot ? session.state.bot(current.id) : nil,
                attachPhotos: { showingPhotoPicker = true },
                attachFiles: { showingFileImporter = true },
                more: {
                    dictation.stop()
                    composerFocused = false
                    withAnimation(.snappy(duration: 0.28)) { showingPlus.toggle() }
                },
                openModel: { desktopChat?.showPanel(.more) },
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
        .padding(.top, 8)
        .padding(.bottom, 16)
        .frame(maxWidth: DesktopShellRules.chatColumn + 40)
        .frame(maxWidth: .infinity)
        .task(id: commandLoadKey) { await loadCommands() }
        .task(id: heldSends.isEmpty) {
            if !heldSends.isEmpty { await power.load(botIds: [], threadId: nil, groupId: nil, session: session) }
        }
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
    let openProfile: () -> Void

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
                    DesktopRoundButton(systemImage: "square.and.arrow.up", label: "Export conversation", action: export)
                    if chat.isBot {
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

/// A 36 pt round chrome button: card fill, hairline ring, 18 pt glyph.
struct DesktopRoundButton: View {
    @Environment(\.desktopTheme) private var theme
    let systemImage: String
    let label: LocalizedStringKey
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(theme.ink)
                .frame(width: 36, height: 36)
                .background(theme.chrome, in: Circle())
                .overlay(Circle().strokeBorder(theme.hairlineWeak, lineWidth: 1))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(Text(label))
    }
}

// MARK: - Composer pill

/// The pill's contents, from left: attach (28), the field (13/20), the model
/// chip (13, chevron 14), dictation (28, ringed) and the voice / send circle
/// (32, raised).
struct DesktopComposerPill: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @Binding var draft: String
    let prompt: String
    var focused: FocusState<Bool>.Binding
    let canSend: Bool
    let busy: Bool
    let listening: Bool
    let inputLocked: Bool
    let bot: Bot?
    let attachPhotos: () -> Void
    let attachFiles: () -> Void
    let more: () -> Void
    let openModel: () -> Void
    let toggleDictation: () -> Void
    let send: () -> Void
    let voice: () -> Void
    let hardwareReturn: () -> Void
    let draftChanged: (String, String) -> Void

    @State private var modelLabel: String?

    var body: some View {
        HStack(alignment: .bottom, spacing: 4) {
            Menu {
                Button(action: attachPhotos) { Label("Photo library", systemImage: "photo.on.rectangle") }
                Button(action: attachFiles) { Label("Files", systemImage: "folder") }
                Divider()
                Button(action: more) { Label("More", systemImage: "ellipsis.circle") }
            } label: {
                Image(systemName: "paperclip")
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(theme.inkSecondary)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .disabled(busy)
            .padding(.leading, 9)
            .padding(.bottom, 9)
            .accessibilityLabel(Text("Attach a file"))
            .accessibilityIdentifier("desktop-composer-attach")

            TextField("", text: $draft, prompt: Text(prompt).foregroundColor(theme.inkSecondary), axis: .vertical)
                .lineLimit(1...8)
                .font(theme.font(13))
                .foregroundStyle(theme.ink)
                .tint(theme.focus)
                .padding(.leading, 6)
                .padding(.vertical, 13)
                .focused(focused)
                .allowsHitTesting(!inputLocked)
                .accessibilityIdentifier("message-input")
                .onValueChangePair(of: draft) { old, new in draftChanged(old, new) }
                .onHardwareReturn(hardwareReturn)

            if let modelLabel {
                Button(action: openModel) {
                    HStack(spacing: 4) {
                        Text(verbatim: modelLabel)
                            .font(theme.font(13))
                            .lineLimit(1)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 10, weight: .semibold))
                    }
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 6)
                    .frame(height: 28)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .padding(.bottom, 9)
                .accessibilityLabel(Text("Model: \(modelLabel)"))
                .accessibilityIdentifier("desktop-composer-model")
            }

            Button(action: toggleDictation) {
                Image(systemName: "mic")
                    .font(.system(size: 14, weight: .regular))
                    .foregroundStyle(listening ? theme.danger : theme.inkSecondary)
                    .frame(width: 28, height: 28)
                    .overlay(Circle().strokeBorder(theme.hairline.opacity(0.6), lineWidth: 1))
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .disabled(busy)
            .padding(.bottom, 9)
            .accessibilityLabel(Text(listening ? "Stop dictation" : "Start dictation"))

            Button {
                Haptics.selection()
                canSend ? send() : voice()
            } label: {
                Group {
                    if busy {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: canSend ? "arrow.up" : "waveform")
                            .font(.system(size: canSend ? 14 : 13, weight: canSend ? .semibold : .regular))
                    }
                }
                .foregroundStyle(canSend ? theme.accentInk : theme.inkTertiary)
                .frame(width: 32, height: 32)
                .background(canSend ? theme.accent : theme.raised, in: Circle())
                .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .padding(.leading, 4)
            .padding(.trailing, 7)
            .padding(.bottom, 7)
            .accessibilityLabel(Text(canSend ? "Send" : "Voice mode"))
            .accessibilityIdentifier("desktop-composer-send")
        }
        .frame(minHeight: 46)
        .background(theme.composer, in: RoundedRectangle(cornerRadius: 23, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 23, style: .continuous)
                .strokeBorder(theme.borderStrong, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.05), radius: 4, y: 2)
        .task(id: bot?.currentTaskModelSelection) { await loadModelLabel() }
    }

    /// The bot's model by its catalogue label ("Claude Sonnet 5").
    private func loadModelLabel() async {
        guard let selection = bot?.currentTaskModelSelection, session.canAdminister else { modelLabel = nil; return }
        let instances = await DesktopModelCatalog.shared.instances(session)
        let instance = instances.first { $0.instanceId == selection.instanceId }
        let modelId = selection.model.isEmpty ? (instance?.models.default ?? "") : selection.model
        let label = instance?.models.options.first { $0.id == modelId }?.label ?? modelId
        modelLabel = label.isEmpty ? nil : label
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
        let loaded = await session.modelInstances()
        cached = (connection, loaded)
        return loaded
    }
}
