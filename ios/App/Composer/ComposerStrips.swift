// The strips the composer stacks above its field (feature parity package
// WP3), each the phone's drawing of a desktop composer part:
// - SuggestionStrip: "@" bots (and @everyone) and "#" threads
//   (Composer.tsx mention popup, CO11, CO12, RM9);
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
    /// Space before the first chip and after the last, inside the scroll
    /// view (the phone composer's margin when it bleeds to the edges).
    var edgeInset: CGFloat = 4
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
            .padding(.horizontal, edgeInset)
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
                } else if choice.isPerson {
                    Image(systemName: "person.fill")
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
                Text(choice.isEveryone ? "Group chat" : choice.isPerson ? "Person · Gets a notification" : "Agent")
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
