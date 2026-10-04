// iPad I3: the desktop transcript's metrics and the parts it draws its own
// way (ChatView.tsx `Bubble`, MessageActions.tsx, AttachmentGallery.tsx).
// The rows are still the phone's (MessageRow, TextBubble, MarkdownText,
// TranscriptAttachmentView): they read `\.desktopChatText` and, when it is
// set, wear these sizes and colours. Measured in
// ios/parity/desktop/refs/desktop-1366x1024-03-main.json and -21-chat-message-hover.json.
import SwiftUI
import UIKit
import CompanionCore

private struct DesktopChatTextKey: EnvironmentKey {
    static let defaultValue: DesktopTheme? = nil
}

private struct DesktopWideCapKey: EnvironmentKey {
    static let defaultValue: CGFloat? = nil
}

private struct DesktopMessageActionsKey: EnvironmentKey {
    static let defaultValue: DesktopMessageActions? = nil
}

extension EnvironmentValues {
    /// The desktop transcript's tokens; nil on the iPhone (the phone metrics).
    var desktopChatText: DesktopTheme? {
        get { self[DesktopChatTextKey.self] }
        set { self[DesktopChatTextKey.self] = newValue }
    }

    /// The wide bubble's cap (`min(94 %, 780, 100 % - 82)`), for tables,
    /// diagrams and rich fences.
    var desktopWideCap: CGFloat? {
        get { self[DesktopWideCapKey.self] }
        set { self[DesktopWideCapKey.self] = newValue }
    }

    /// The hover row of the message being drawn (set by MessageRow on iPad).
    var desktopMessageActions: DesktopMessageActions? {
        get { self[DesktopMessageActionsKey.self] }
        set { self[DesktopMessageActionsKey.self] = newValue }
    }
}

/// The transcript's numbers: 13/20 text, bubbles padded 12 x 7 with 18 pt
/// corners, 8 pt between paragraphs, 4 between list items, lists 20 in.
enum DesktopChatMetrics {
    static let textSize: CGFloat = 13
    static let lineHeight: CGFloat = 20
    static let bubbleRadius: CGFloat = 18
    static let bubblePadding = EdgeInsets(top: 7, leading: 12, bottom: 7, trailing: 12)
    static let paragraphGap: CGFloat = 8
    static let listItemGap: CGFloat = 4
    static let listIndent: CGFloat = 20
    static let rowGap: CGFloat = 12
    /// The attachment gallery: `w-[min(34rem,70vw)]`, 6 pt between rows.
    static let galleryWidth: CGFloat = 544
    static let imageMax: CGFloat = 288

    /// The line spacing that turns the face's natural line into 20 pt.
    static func lineSpacing(_ theme: DesktopTheme) -> CGFloat {
        max(0, lineHeight - theme.uiFont(textSize).lineHeight)
    }

    /// Half of it above and below a block, as CSS centres the line box.
    static func halfLeading(_ theme: DesktopTheme) -> CGFloat { lineSpacing(theme) / 2 }

    /// `min(80 %, 560, 100 % - 82)` of the transcript column.
    static func bubbleCap(column: CGFloat) -> CGFloat { max(120, min(column * 0.8, 560, column - 82)) }

    /// `min(94 %, 780, 100 % - 82)`.
    static func wideCap(column: CGFloat) -> CGFloat { max(120, min(column * 0.94, 780, column - 82)) }

    /// rich-blocks.ts `prefersWideBubble`: a table rule or a rich fence.
    static func prefersWide(_ text: String) -> Bool {
        text.range(of: #"(^|\n) {0,3}(?:`{3,}|~{3,})[ \t]*(?:email|mail|eml|widget|html-widget|artifact|chart|csv|tsv|mermaid)\b"#,
                   options: [.regularExpression, .caseInsensitive]) != nil
            || text.range(of: #"(^|\n)\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*(\n|$)"#, options: .regularExpression) != nil
    }
}

/// A text block at the desktop's line box: 20 pt lines, the half leading
/// above and below. Nothing on the phone.
struct DesktopLineBox: ViewModifier {
    let theme: DesktopTheme?

    func body(content: Content) -> some View {
        if let theme {
            content.padding(.vertical, DesktopChatMetrics.halfLeading(theme))
        } else {
            content
        }
    }
}

// MARK: - Hover actions

/// What a row's hover strip shows: the actions of its long-press menu and
/// the time. Built by MessageRow from its own `MessageActionSet`.
struct DesktopMessageActions {
    var copyText: String?
    var actions: MessageActionSet
    var at: Date
}

/// MessageActions.tsx: beside the bubble, bottom-aligned, a "⋯" (26 pt,
/// radius 6) that appears on hover; hovering it (or a tap, or a pinned
/// open) slides out Copy, raw markdown, Read aloud, Regenerate, Reply, Pin;
/// then the time, 11 pt tertiary. The user side is mirrored. Without a
/// pointer the same actions are the long-press menu.
struct DesktopMessageHoverStrip: View {
    @Environment(\.desktopTheme) private var theme
    let model: DesktopMessageActions
    let mine: Bool
    let hovering: Bool
    @State private var open = false
    @State private var overStrip = false

    var body: some View {
        let expanded = open || overStrip || model.actions.speaking || model.actions.showingSource
        HStack(spacing: 2) {
            if mine {
                time
                if expanded { buttons.transition(.opacity) }
                ellipsis
            } else {
                ellipsis
                if expanded { buttons.transition(.opacity) }
                time
            }
        }
        .padding(.bottom, 2)
        .opacity(hovering || expanded ? 1 : 0)
        .onHover { overStrip = $0 }
        .animation(.easeOut(duration: 0.2), value: expanded)
        .accessibilityHidden(!(hovering || expanded))
    }

    private var ellipsis: some View {
        DesktopActionButton(systemImage: "ellipsis", label: "Message actions", active: open) { open.toggle() }
            .accessibilityIdentifier("desktop-message-actions")
    }

    private var time: some View {
        Text(model.at, format: .dateTime.hour().minute())
            .font(theme.font(11))
            .monospacedDigit()
            .foregroundStyle(theme.inkTertiary)
            .padding(.bottom, 4)
            .padding(.horizontal, 6)
    }

    @ViewBuilder
    private var buttons: some View {
        let a = model.actions
        HStack(spacing: 2) {
            if let text = model.copyText, !text.isEmpty {
                DesktopActionButton(systemImage: "doc.on.doc", label: "Copy message") { PlatformBridge.copyToPasteboard(text) }
            }
            if let toggle = a.toggleSource {
                DesktopActionButton(systemImage: "chevron.left.forwardslash.chevron.right",
                                    label: a.showingSource ? "Hide Source" : "Show raw markdown", active: a.showingSource, action: toggle)
            }
            if let speak = a.speak {
                DesktopActionButton(systemImage: a.speaking ? "stop.fill" : "speaker.wave.2",
                                    label: a.speaking ? "Stop Speaking" : "Read Aloud", active: a.speaking, action: speak)
            }
            if let regenerate = a.regenerate {
                DesktopActionButton(systemImage: "arrow.clockwise", label: "Regenerate response", action: regenerate)
            }
            if let reply = a.reply {
                DesktopActionButton(systemImage: "arrowshape.turn.up.left", label: "Reply to message", action: reply)
            }
            if let pin = a.togglePin {
                DesktopActionButton(systemImage: a.pinned ? "pin.slash" : "pin", label: a.pinned ? "Unpin" : "Pin message", action: pin)
            }
        }
    }
}

/// `rounded-md p-1.5`: a 14 pt glyph in a 26 pt square, raised on hover.
struct DesktopActionButton: View {
    @Environment(\.desktopTheme) private var theme
    let systemImage: String
    let label: LocalizedStringKey
    var active = false
    let action: () -> Void
    @State private var hovered = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(active || hovered ? theme.ink : theme.inkSecondary)
                .frame(width: 26, height: 26)
                .background(active || hovered ? theme.raised : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
        .accessibilityLabel(Text(label))
    }
}

// MARK: - Attachments

/// AttachmentGallery.tsx: the pictures first (one column for one, two
/// otherwise, at most 288 tall, 16 pt corners), then the file chips, all in
/// a column of at most 544, 6 pt apart.
struct DesktopAttachmentGallery: View {
    let images: [DisplayedMessageAttachment]
    let files: [DisplayedMessageAttachment]
    let threadId: String
    let messageId: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if images.count == 1, let image = images.first {
                TranscriptAttachmentView(attachment: image, threadId: threadId, messageId: messageId)
            } else if !images.isEmpty {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], alignment: .leading, spacing: 8) {
                    ForEach(images, id: \.path) { image in
                        TranscriptAttachmentView(attachment: image, threadId: threadId, messageId: messageId)
                    }
                }
            }
            ForEach(files, id: \.path) { file in
                TranscriptAttachmentView(attachment: file, threadId: threadId, messageId: messageId)
            }
        }
        .frame(maxWidth: DesktopChatMetrics.galleryWidth, alignment: .leading)
        .padding(.bottom, 6)
    }
}

/// AttachedFileChip: 1 pt ring (hairline at 25 %), 12 pt corners, a 14 pt
/// document glyph, the name 12 pt ink, a 13 pt download glyph; 40 tall.
struct DesktopFileChip: View {
    @Environment(\.desktopTheme) private var theme
    let name: String
    let loading: Bool

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "doc.text")
                .font(.system(size: 12, weight: .regular))
                .frame(width: 14, height: 14)
                .foregroundStyle(theme.inkSecondary)
            Text(verbatim: name)
                .font(theme.font(12))
                .foregroundStyle(theme.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            if loading {
                ProgressView().controlSize(.mini)
            } else {
                Image(systemName: "arrow.down.to.line")
                    .font(.system(size: 11, weight: .regular))
                    .frame(width: 13, height: 13)
                    .foregroundStyle(theme.inkSecondary)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(minHeight: 40)
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.25), lineWidth: 1))
        .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
