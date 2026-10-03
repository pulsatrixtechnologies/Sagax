// The composer's "/" menu (CO9, CO10, CO24), drawn above the field the way
// the desktop's ComposerCommandMenu.tsx is: Sagax's own commands, then the
// engine's (Claude Code, Codex) grouped Engine, Plugins, MCP (in a room:
// under each bot's name), each with its argument hint. What the chat cannot
// run stays listed, dimmed, with its reason. Layout-agnostic: the iPhone
// composer stacks it above the field; the iPad pill can float it.
import SwiftUI
import CompanionCore

struct ComposerCommandMenuView: View {
    @Environment(\.themePalette) var themePalette
    let items: [ComposerMenuItem]
    let loading: Bool
    let accent: Color
    /// Read the engine's list again (shown once a list was read).
    let refresh: (() -> Void)?
    let close: () -> Void
    let pick: (ComposerMenuItem) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        if index == 0 || items[index - 1].section != item.section {
                            sectionHeading(item)
                        }
                        row(item)
                    }
                }
                .padding(.bottom, 4)
            }
            .frame(maxHeight: 264)
        }
        .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.hairline, lineWidth: 0.8))
        .shadow(color: Color.black.opacity(Theme.palette.isDark ? 0.25 : 0.08), radius: 8, y: 3)
        .padding(.horizontal, 4)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Composer commands")
        .accessibilityIdentifier("slash-menu")
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text("Commands")
                .textCase(.uppercase)
                .font(.system(size: 10.5, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 4)
            if loading {
                Text("Loading engine commands…")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textTertiary)
                    .lineLimit(1)
            }
            if let refresh {
                Button(action: refresh) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(width: 26, height: 26)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Refresh engine commands")
            }
            Button(action: close) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textTertiary)
                    .frame(width: 26, height: 26)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close commands")
            .accessibilityIdentifier("slash-menu-close")
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func sectionHeading(_ item: ComposerMenuItem) -> some View {
        Group {
            if let bot = item.bot {
                Text(verbatim: bot.name)
            } else {
                Text(Self.groupTitle(item.group))
            }
        }
        .textCase(.uppercase)
        .font(.system(size: 10, weight: .semibold))
        .tracking(0.8)
        .foregroundStyle(Theme.textTertiary)
        .lineLimit(1)
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 2)
    }

    private func row(_ item: ComposerMenuItem) -> some View {
        let reason = item.unavailable.map(Self.reason)
        return Button {
            guard item.insertion != nil else { return }
            Haptics.selection()
            pick(item)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: Self.icon(item))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(accent)
                    .frame(width: 30, height: 30)
                    .background(accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(verbatim: item.label)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(accent)
                            .lineLimit(1)
                        if let hint = item.argumentHint {
                            Text(verbatim: hint)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(Theme.textTertiary)
                                .lineLimit(1)
                        }
                    }
                    Group {
                        if let reason { Text(reason) } else { Text(verbatim: item.description) }
                    }
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
            .opacity(reason == nil ? 1 : 0.55)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("slash-\(item.label)")
        .accessibilityHint(reason.map { Text($0) } ?? Text(verbatim: ""))
    }

    static func icon(_ item: ComposerMenuItem) -> String {
        switch item.kind {
        case let .sagax(command): return command == .goal ? "target" : "book"
        case .engine:
            switch item.group {
            case .plugins: return "puzzlepiece"
            case .mcp: return "powerplug"
            default: return "terminal"
            }
        }
    }

    static func groupTitle(_ group: ComposerMenuItem.Group) -> LocalizedStringKey {
        switch group {
        case .sagax: return "Sagax"
        case .engine: return "Engine"
        case .plugins: return "Plugins"
        case .mcp: return "MCP"
        }
    }

    static func reason(_ unavailable: HarnessCommandUnavailable) -> LocalizedStringKey {
        switch unavailable {
        case .interactive: return "Needs the engine's own terminal, so it cannot run from the chat"
        case .managed: return "Managed by Sagax: model, effort, conversations, approvals and MCP servers have their own settings"
        }
    }

    /// The descriptions of Sagax's own commands (`composer.command.*Desc`).
    static func description(_ command: SagaxSlashCommand) -> String {
        switch command {
        case .goal: return String(localized: "Keep a team working until the goal is complete")
        case .learn: return String(localized: "Draft a reusable skill from this conversation")
        case .setup: return String(localized: "Have this bot interview you and set itself up")
        }
    }
}
