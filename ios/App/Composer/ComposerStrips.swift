// The strips the composer stacks above its field (feature parity package
// WP3), each the phone's drawing of a desktop composer part:
// - SuggestionStrip: "@" bots (and @everyone) and "#" threads
//   (Composer.tsx mention popup, CO11, CO12, RM9);
// - BusySendChooserView: after / steer / parallel (BusySendChooser.tsx, CO15);
// - FailedSendBanner: "Not sent" with Retry (Composer.tsx:904, CO17);
// - PastedTextChip: a long paste held as a chip (ComposerAttachments.tsx, CO5).
// None of them knows the screen it sits on, so the iPad pill reuses them.
import SwiftUI
import CompanionCore

// MARK: - "@" and "#"

struct SuggestionStrip: View {
    @Environment(\.themePalette) var themePalette

    enum Item: Identifiable, Hashable {
        case mention(MentionChoice)
        case thread(ThreadRefCandidate, showsBot: Bool)

        var id: String {
            switch self {
            case let .mention(choice): return "mention:\(choice.id)"
            case let .thread(thread, _): return "thread:\(thread.id)"
            }
        }
    }

    let items: [Item]
    let pick: (Item) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(items) { item in
                    Button {
                        Haptics.selection()
                        pick(item)
                    } label: {
                        chip(item)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier(identifier(item))
                }
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 2)
        }
        .scrollClipDisabledCompat()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("suggestion-strip")
    }

    @ViewBuilder
    private func chip(_ item: Item) -> some View {
        HStack(spacing: 6) {
            switch item {
            case let .mention(choice):
                if choice.isEveryone {
                    Image(systemName: "person.2.fill")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                } else {
                    Circle()
                        .fill(MausPalette.color(choice.color ?? ""))
                        .frame(width: 9, height: 9)
                }
                Text(verbatim: "@\(choice.name)")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textPrimary)
                Text(choice.isEveryone ? "Group chat" : "Agent")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textSecondary)
            case let .thread(thread, showsBot):
                Image(systemName: "number")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Theme.textSecondary)
                Text(verbatim: thread.title.trimmingCharacters(in: .whitespaces))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textPrimary)
                if showsBot {
                    Text(verbatim: thread.botName)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
        }
        .lineLimit(1)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Theme.cardRaised, in: Capsule())
        .overlay(Capsule().stroke(Theme.hairline, lineWidth: 0.5))
    }

    private func identifier(_ item: Item) -> String {
        switch item {
        case let .mention(choice): return "suggestion-@\(choice.name)"
        case let .thread(thread, _): return "suggestion-#\(thread.title.trimmingCharacters(in: .whitespaces))"
        }
    }
}

// MARK: - Busy send

struct BusySendChooserView: View {
    @Environment(\.themePalette) var themePalette
    let name: String
    let highlighted: BusySendMode
    let pick: (BusySendMode) -> Void
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("\(name) is working. What should this message do?")
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                Button(action: close) {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Theme.textTertiary)
                        .frame(width: 26, height: 26)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Keep editing")
                .accessibilityIdentifier("busy-send-close")
            }
            ForEach(BusySendChoice.order, id: \.self) { mode in
                let active = mode == highlighted
                Button {
                    Haptics.selection()
                    pick(mode)
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: Self.icon(mode))
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(active ? Theme.accent : Theme.textSecondary)
                            .frame(width: 18)
                            .padding(.top, 1)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(Self.label(mode))
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(Theme.textPrimary)
                            Text(Self.hint(mode))
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.textSecondary)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(active ? Theme.accent.opacity(0.10) : Color.clear)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(active ? Theme.accent.opacity(0.5) : Color.clear, lineWidth: 1)
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("busy-send-\(mode.rawValue)")
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
        .padding(8)
        .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.hairline, lineWidth: 0.6))
        .padding(.horizontal, 4)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("busy-send-chooser")
    }

    static func icon(_ mode: BusySendMode) -> String {
        switch mode {
        case .steer: return "arrow.turn.down.right"
        case .parallel: return "arrow.triangle.branch"
        case .after: return "clock"
        }
    }

    static func label(_ mode: BusySendMode) -> LocalizedStringKey {
        switch mode {
        case .steer: return "Add to the current task"
        case .parallel: return "New task in parallel"
        case .after: return "After this one"
        }
    }

    static func hint(_ mode: BusySendMode) -> LocalizedStringKey {
        switch mode {
        case .steer: return "Joins the work in progress"
        case .parallel: return "Runs now on its own, answers here"
        case .after: return "Waits for the current work to finish"
        }
    }
}

// MARK: - Failed send

struct FailedSendBanner: View {
    @Environment(\.themePalette) var themePalette
    let failure: FailedSend
    let retrying: Bool
    let retry: () -> Void
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Theme.danger)
            VStack(alignment: .leading, spacing: 1) {
                Group {
                    if let quote = failure.quote {
                        Text("Not sent: “\(quote)”")
                    } else {
                        Text("Not sent: “\(String(localized: "attachment"))”")
                    }
                }
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                Text(verbatim: failure.error)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 4)
            if retrying {
                ProgressView().controlSize(.small)
            } else {
                Button("Retry", action: retry)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.danger)
                    .accessibilityIdentifier("failed-send-retry")
            }
            Button(action: dismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(width: 26, height: 26)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss failed message")
            .accessibilityIdentifier("failed-send-dismiss")
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .padding(.vertical, 7)
        .background(Theme.danger.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.danger.opacity(0.3), lineWidth: 0.6))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("failed-send")
    }
}

// MARK: - Long paste

struct PastedTextChip: View {
    @Environment(\.themePalette) var themePalette
    let paste: PastedText
    let display: () -> Void
    let remove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text("PASTED")
                    .font(.system(size: 9.5, weight: .bold))
                    .tracking(0.6)
                    .foregroundStyle(Theme.textTertiary)
                Spacer(minLength: 0)
                Button(action: remove) {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(width: 20, height: 20)
                        .background(Theme.card, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove pasted text")
            }
            Text(verbatim: String(paste.text.prefix(400)))
                .font(.system(size: 10.5, design: .monospaced))
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(4)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(verbatim: paste.summary)
                .font(.system(size: 10.5))
                .foregroundStyle(Theme.textTertiary)
            Button(action: display) {
                Label("Display in chat box", systemImage: "text.bubble")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Theme.accent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 5)
                    .background(Theme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
        }
        .padding(8)
        .frame(width: 200, alignment: .leading)
        .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.hairline))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("paste-chip")
    }
}
