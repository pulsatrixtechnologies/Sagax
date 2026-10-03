// The reply quote (CO2, MS8) and the pinned message banner (MS9), drawn
// like the desktop's `ReplyQuote.tsx` and `PinnedBanner` with Theme tokens.
// Neither knows where it sits: the iPhone puts the quote strip above the
// composer and the banner under the header, the iPad desktop layout puts
// them where its shell does.
import SwiftUI
import CompanionCore

extension ReplyPreview.Author {
    /// "You", the speaker's name, or "Assistant", in the reader's language.
    var displayName: String {
        switch self {
        case .you: String(localized: "You")
        case let .named(name): name
        case .assistant: String(localized: "Assistant")
        }
    }
}

/// "Replying to {name}" over a one-line snippet, a 2 pt accent rule on the
/// leading edge. `onJump` makes it a button to the quoted message, `onClear`
/// adds the X that cancels a reply being written.
struct ReplyQuote: View {
    @Environment(\.themePalette) var themePalette
    let message: Message
    var fallbackName: String?
    /// The small version inside a bubble.
    var compact = false
    var onJump: (() -> Void)?
    var onClear: (() -> Void)?

    private var author: String {
        ReplyPreview.author(of: message, fallbackName: fallbackName).displayName
    }

    private var snippet: String {
        ReplyPreview.snippet(
            ReplyPreview.source(of: message),
            imageLabel: String(localized: "[image]"),
            fileLabel: String(localized: "[file]")
        )
    }

    var body: some View {
        HStack(spacing: 8) {
            if let onJump {
                Button(action: onJump) { content }
                    .buttonStyle(.plain)
                    .accessibilityHint(Text("Jump to original message"))
            } else {
                content
            }
            if let onClear {
                Button(action: onClear) {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(width: 24, height: 24)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Cancel reply"))
                .accessibilityIdentifier("reply-cancel")
            }
        }
        .padding(.leading, 10)
        .padding(.trailing, onClear == nil ? 10 : 4)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Theme.inset.opacity(0.7))
        )
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(Theme.accent.opacity(0.6))
                .frame(width: 2)
        }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var content: some View {
        HStack(spacing: 8) {
            Image(systemName: "arrowshape.turn.up.left")
                .font(.system(size: compact ? 11 : 13, weight: .medium))
                .foregroundStyle(Theme.accent)
            VStack(alignment: .leading, spacing: 1) {
                Text("Replying to \(author)")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Theme.accent)
                    .lineLimit(1)
                Text(snippet)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// The one pinned message, above the transcript: a pin, the sender, one
/// line; tap to jump, X to unpin (when the pairing may unpin).
struct PinnedMessageBanner: View {
    @Environment(\.themePalette) var themePalette
    let preview: PinnedPreview
    let onJump: () -> Void
    var onUnpin: (() -> Void)?

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "pin.fill")
                .font(.system(size: 11))
                .foregroundStyle(Theme.accent)
            Button(action: onJump) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(preview.author.displayName)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.accent)
                        .lineLimit(1)
                        .fixedSize()
                    Text(preview.text)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(Text("Jump to the pinned message"))
            .accessibilityIdentifier("pinned-banner")
            if let onUnpin {
                Button(action: onUnpin) {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(width: 24, height: 24)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Unpin message"))
                .accessibilityIdentifier("pinned-unpin")
            }
        }
        .padding(.leading, 12)
        .padding(.trailing, onUnpin == nil ? 12 : 6)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Theme.bg)
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Theme.accent.opacity(0.07))
                )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(Theme.accent.opacity(0.25), lineWidth: 1)
        )
    }
}
