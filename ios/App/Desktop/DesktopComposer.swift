// iPad I3: the desktop composer pill (Composer.tsx), measured in
// desktop-1366x1024-03-main.json: 46 tall with its ring, radius 22, padded
// 6 x 8; from the left, attach (28), the approval mode (32, Hand), where this
// conversation works (32, Sparkles for Auto), the field (13/20, 4 pt in),
// the model chip (13, chevron 14), dictation (28, ringed; hidden once there
// is text), voice (32) and, with text, send (32, accent). 4 pt between.
// Its two policy menus and the "/" menu float above it, as the desktop's
// popovers do, instead of pushing the transcript up.
import SwiftUI
import UIKit
import CompanionCore

/// Which popover of the pill is open.
enum DesktopComposerMenu: Equatable {
    case approval, place
}

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
    /// The slash or mention popup, floated above the pill's leading edge.
    let popup: AnyView?
    let attachPhotos: () -> Void
    let attachFiles: () -> Void
    let more: () -> Void
    let openModel: () -> Void
    let openAllowlist: () -> Void
    let toggleDictation: () -> Void
    let send: () -> Void
    let voice: () -> Void
    let hardwareReturn: () -> Void
    let draftChanged: (String, String) -> Void

    @State private var modelLabel: String?
    @State private var menu: DesktopComposerMenu? = DesktopComposerPill.parityMenu

    #if DEBUG
    static var parityMenu: DesktopComposerMenu? { DesktopChatParity.openMenu }
    #else
    static let parityMenu: DesktopComposerMenu? = nil
    #endif

    private var hasText: Bool { !draft.isEmpty }

    var body: some View {
        HStack(alignment: .bottom, spacing: 4) {
            attach
            if let bot, session.canAdminister {
                DesktopApprovalButton(bot: bot, open: menuBinding(.approval), openAllowlist: openAllowlist)
                DesktopPlaceButton(bot: bot, open: menuBinding(.place))
            }
            field
            if let modelLabel { modelChip(modelLabel) }
            if !hasText { dictationButton }
            voiceButton
            if canSend || busy { sendButton }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .frame(minHeight: 44)
        .background(theme.composer, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .padding(1)
        .overlay(
            RoundedRectangle(cornerRadius: 23, style: .continuous)
                .strokeBorder(theme.borderStrong, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.05), radius: 4, y: 2)
        .overlay(alignment: .topLeading) {
            if let popup, menu == nil {
                popup
                    .frame(width: 320)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, 8)
                    .alignmentGuide(.top) { d in d[.bottom] + 8 }
                    .transition(.opacity)
            }
        }
        .task(id: bot?.currentTaskModelSelection) { await loadModelLabel() }
        .onValueChange(of: hasText) { _ in menu = nil }
    }

    private func menuBinding(_ which: DesktopComposerMenu) -> Binding<Bool> {
        Binding(get: { menu == which }, set: { menu = $0 ? which : nil })
    }

    private var attach: some View {
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
                .contentShape(Circle())
        }
        .disabled(busy)
        .padding(.leading, 1)
        .padding(.bottom, 2)
        .hoverEffect(.highlight)
        .accessibilityLabel(Text("Attach a file"))
        .accessibilityIdentifier("desktop-composer-attach")
    }

    private var field: some View {
        TextField("", text: $draft, prompt: Text(prompt).foregroundColor(theme.inkSecondary), axis: .vertical)
            .lineLimit(1...6)
            .font(theme.font(DesktopChatMetrics.textSize))
            .lineSpacing(DesktopChatMetrics.lineSpacing(theme))
            .foregroundStyle(theme.ink)
            .tint(theme.focus)
            .padding(.horizontal, 4)
            .padding(.vertical, 6 + DesktopChatMetrics.halfLeading(theme))
            .frame(minHeight: 32)
            .focused(focused)
            .allowsHitTesting(!inputLocked)
            .accessibilityIdentifier("message-input")
            .onValueChangePair(of: draft) { old, new in draftChanged(old, new) }
            .onHardwareReturn(hardwareReturn)
    }

    private func modelChip(_ label: String) -> some View {
        Button(action: openModel) {
            HStack(spacing: 4) {
                Text(verbatim: label)
                    .font(theme.font(13))
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .medium))
                    .frame(width: 14, height: 14)
            }
            .foregroundStyle(theme.inkSecondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
            .frame(height: 27.5)
            .contentShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .padding(.bottom, 2.25)
        .accessibilityLabel(Text("Model: \(label)"))
        .accessibilityIdentifier("desktop-composer-model")
    }

    private var dictationButton: some View {
        Button(action: toggleDictation) {
            Image(systemName: "mic")
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(listening ? theme.danger : theme.inkSecondary)
                .frame(width: 28, height: 28)
                .overlay(Circle().strokeBorder(theme.hairline.opacity(0.6), lineWidth: 1))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .padding(.bottom, 2)
        .hoverEffect(.highlight)
        .accessibilityLabel(Text(listening ? "Stop dictation" : "Start dictation"))
    }

    private var voiceButton: some View {
        Button(action: voice) {
            Image(systemName: "waveform")
                .font(.system(size: 13, weight: .regular))
                .foregroundStyle(theme.inkTertiary)
                .frame(width: 32, height: 32)
                .background(theme.composer, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(Text("Voice mode"))
        .accessibilityIdentifier("desktop-composer-voice")
    }

    private var sendButton: some View {
        Button {
            Haptics.selection()
            send()
        } label: {
            Group {
                if busy {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 15, weight: .semibold))
                }
            }
            .foregroundStyle(theme.accentInk)
            .frame(width: 32, height: 32)
            .background(theme.accent, in: Circle())
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(!canSend)
        .accessibilityLabel(Text("Send"))
        .accessibilityIdentifier("desktop-composer-send")
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

// MARK: - Policy menus

/// The desktop's menu panel (`bg-elevated`, 0.5 pt border at 15 % ink,
/// radius 12, 6 pt in), floated 8 pt above its trigger's leading edge.
struct DesktopMenuPanel<Content: View>: View {
    @Environment(\.desktopTheme) private var theme
    let label: LocalizedStringKey
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 2) { content }
            .padding(6)
            .frame(width: 260, alignment: .leading)
            .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
            .shadow(color: .black.opacity(0.18), radius: 12, y: 6)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(label))
    }
}

/// One menu row: a 16 pt glyph, the label 13/18 ink, the detail 12/16
/// tertiary, a check on the current choice.
struct DesktopMenuRow: View {
    @Environment(\.desktopTheme) private var theme
    let systemImage: String
    let title: Text
    var detail: Text? = nil
    var selected = false
    let action: () -> Void
    @State private var hovered = false

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .regular))
                    .frame(width: 16, height: 16)
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 0) {
                    title
                        .font(theme.font(13))
                        .frame(minHeight: 18)
                    if let detail {
                        detail
                            .font(theme.font(12))
                            .foregroundStyle(theme.inkTertiary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 4)
                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .semibold))
                        .frame(width: 14, height: 14)
                        .padding(.top, 2)
                }
            }
            .foregroundStyle(theme.ink)
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(hovered ? theme.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
    }
}

/// A 32 pt round trigger with a 16 pt glyph at 80 %.
private struct DesktopPillTrigger: View {
    @Environment(\.desktopTheme) private var theme
    let systemImage: String
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .regular))
                .opacity(0.8)
                .foregroundStyle(active ? theme.ink : theme.inkSecondary)
                .frame(width: 32, height: 32)
                .background(active ? theme.control : .clear, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
    }
}

/// ApprovalModeSelector: Ask for approval, Auto-accept edits, Approve for
/// me, then Command allowlist.
struct DesktopApprovalButton: View {
    @EnvironmentObject private var session: Session
    let bot: Bot
    @Binding var open: Bool
    let openAllowlist: () -> Void

    var body: some View {
        let level = ApprovalLevel.of(approvalMode: bot.approvalMode, autoApprove: bot.autoApprove)
        DesktopPillTrigger(systemImage: Self.icon(level), active: open) { open.toggle() }
            .accessibilityLabel(Text("\(String(localized: Self.labelResource(level))) for \(bot.name)"))
            .accessibilityIdentifier("desktop-composer-approval")
            .overlay(alignment: .topLeading) {
                if open {
                    DesktopMenuPanel(label: "Approval mode") {
                        ForEach(ApprovalLevel.offered, id: \.self) { option in
                            DesktopMenuRow(systemImage: Self.icon(option), title: Text(Self.label(option)),
                                           detail: Text(Self.detail(option)), selected: option == level) {
                                open = false
                                guard option != level else { return }
                                Task { await session.updateApprovalMode(option, for: bot) }
                            }
                        }
                        DesktopMenuRow(systemImage: "checklist", title: Text("Command allowlist")) {
                            open = false
                            openAllowlist()
                        }
                    }
                    .fixedSize()
                    .alignmentGuide(.top) { d in d[.bottom] + 8 }
                    .offset(x: 1)
                    .accessibilityIdentifier("desktop-approval-menu")
                }
            }
    }

    static func icon(_ level: ApprovalLevel) -> String {
        switch level {
        case .ask: "hand.raised"
        case .edits: "square.and.pencil"
        case .auto: "checkmark.shield"
        case .full: "exclamationmark.triangle"
        case .custom: "gearshape"
        }
    }

    static func label(_ level: ApprovalLevel) -> LocalizedStringKey {
        switch level {
        case .ask: "Ask for approval"
        case .edits: "Auto-accept edits"
        case .auto: "Approve for me"
        case .full: "Full access"
        case .custom: "Custom (config.toml)"
        }
    }

    static func labelResource(_ level: ApprovalLevel) -> String.LocalizationValue {
        switch level {
        case .ask: "Ask for approval"
        case .edits: "Auto-accept edits"
        case .auto: "Approve for me"
        case .full: "Full access"
        case .custom: "Custom (config.toml)"
        }
    }

    static func detail(_ level: ApprovalLevel) -> LocalizedStringKey {
        switch level {
        case .ask: "Requests approval for commands and file changes"
        case .edits: "Approves file edits automatically; other actions can still require approval"
        case .auto: "Uses the provider's automatic review to approve routine actions and ask about others"
        case .full: "Runs commands and edits files without asking. Use only with bots you trust."
        case .custom: "Uses permissions defined in config.toml"
        }
    }
}

/// PlaceChip: follow the bot's Works on, or pin this conversation to the
/// Cloud computer, a Local VM or This computer.
struct DesktopPlaceButton: View {
    @EnvironmentObject private var session: Session
    let bot: Bot
    @Binding var open: Bool

    var body: some View {
        let surface = session.state.bot(bot.id)?.tasks?.first { $0.threadId == bot.threadId }?.surface
        let effective = WorkPlace.effective(botComputer: bot.computer, taskSurface: surface)
        let botDefault = bot.computer ?? "auto"
        DesktopPillTrigger(systemImage: Self.icon(effective), active: open) { open.toggle() }
            .disabled(effective == "off")
            .accessibilityLabel(Text("Where this conversation works: \(Self.label(effective))"))
            .accessibilityIdentifier("desktop-composer-place")
            .overlay(alignment: .topLeading) {
                if open {
                    DesktopMenuPanel(label: "Where this conversation works") {
                        DesktopMenuRow(systemImage: Self.icon(botDefault), title: Text("Follow this bot's setting"),
                                       detail: Text("Currently \(Self.label(botDefault))"), selected: surface == nil) {
                            choose(nil, current: surface)
                        }
                        ForEach(WorkPlace.offered, id: \.self) { place in
                            DesktopMenuRow(systemImage: Self.icon(place.rawValue), title: Text(Self.label(place.rawValue)),
                                           detail: Text(Self.detail(place)), selected: surface == place.rawValue) {
                                choose(place, current: surface)
                            }
                        }
                    }
                    .fixedSize()
                    .alignmentGuide(.top) { d in d[.bottom] + 8 }
                    .accessibilityIdentifier("desktop-place-menu")
                }
            }
    }

    private func choose(_ place: WorkPlace?, current: String?) {
        open = false
        guard place?.rawValue != current else { return }
        Task { await session.updateSurface(place, for: bot) }
    }

    static func icon(_ place: String) -> String {
        switch place {
        case "cloud": "cloud"
        case "vm": "macwindow"
        case "local": "laptopcomputer"
        case "browser": "globe"
        case "off": "nosign"
        default: "sparkles"
        }
    }

    static func label(_ place: String) -> String {
        switch place {
        case "cloud": String(localized: "Cloud computer")
        case "vm": String(localized: "Local VM")
        case "local": String(localized: "This computer")
        case "browser": String(localized: "Browser")
        case "off": String(localized: "Off")
        default: String(localized: "Auto")
        }
    }

    static func detail(_ place: WorkPlace) -> LocalizedStringKey {
        switch place {
        case .cloud: "Hosted desktop"
        case .vm: "Isolated local desktop"
        case .local: "Your screen and apps"
        case .browser: "Browser"
        }
    }
}

// MARK: - Session

extension Session {
    /// The composer's approval mode for this conversation (`updateTask`).
    func updateApprovalMode(_ level: ApprovalLevel, for bot: Bot) async {
        guard let client = profileClient else { return }
        do {
            applyProfileBot(try await client.updateApprovalMode(botId: bot.id, threadId: bot.threadId, mode: level))
        } catch {
            if !Task.isCancelled { actionError = error.localizedDescription }
        }
    }

    /// Pin this conversation to a place, or follow the bot again (nil).
    func updateSurface(_ place: WorkPlace?, for bot: Bot) async {
        guard let client = profileClient else { return }
        do {
            applyProfileBot(try await client.updateSurface(botId: bot.id, threadId: bot.threadId, place: place))
        } catch {
            if !Task.isCancelled { actionError = error.localizedDescription }
        }
    }
}
