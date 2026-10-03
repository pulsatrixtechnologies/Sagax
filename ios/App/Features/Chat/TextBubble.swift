// A text message's bubble: markdown for bots, plain text and attachments
// for you, voice notes, generated images, diffs and webhook bodies.
import SwiftUI
import CompanionCore

struct TextBubble: View {
    @Environment(\.themePalette) var themePalette
    let message: Message
    let chat: Chat
    var tailed = true
    /// View Source: the bot's markdown as written, monospaced (MS3).
    var showingSource = false
    let openLink: (URL, Message) -> OpenURLAction.Result
    @Environment(\.messageActions) private var context
    /// A long line of yours, opened with Show full message (MS19).
    @State private var expanded = false

    private var attachedContent: AttachedMessageContent {
        AttachedMessageContent.parse(message.text ?? "")
    }

    private var parsedDiff: (filename: String, diff: String)? {
        guard message.role != .user, let source = message.text else { return nil }
        let text = source.trimmingCharacters(in: .whitespacesAndNewlines)
        let diff: String
        if text.hasPrefix("```diff"), text.hasSuffix("```") {
            diff = String(text.dropFirst("```diff".count).dropLast(3))
                .trimmingCharacters(in: .whitespacesAndNewlines)
        } else if text.hasPrefix("diff --git ") {
            diff = text
        } else {
            return nil
        }
        let firstLine = diff.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? ""
        let filename = firstLine.split(separator: " ").last.map(String.init)?
            .replacingOccurrences(of: "b/", with: "") ?? "Git patch"
        return (filename, diff)
    }

    var body: some View {
        let mine = message.role == .user
        let customCard = parsedDiff != nil
        // rooms attribute each line to the member who said it
        let speaker = message.from
        // No face beside the bubble: the bot's face is in the header, and in
        // a room the name line says who spoke. The bubble sits at the edge.
        HStack(alignment: .bottom, spacing: 0) {
            if mine { Spacer(minLength: Theme.Chat.bubbleTrailingGap) }

            VStack(alignment: .leading, spacing: 4) {
                if let speaker, !mine {
                    Text(speaker.name)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.readable(MausPalette.color(speaker.color)))
                }
                // The message this one answers (MS8): tap to jump to it.
                if let targetId = message.replyToId, let target = context.lookup(targetId) {
                    ReplyQuote(
                        message: target,
                        fallbackName: chat.isBot ? chat.name : String(localized: "Bot"),
                        compact: true,
                        onJump: context.jump.map { jump in { jump(target.id) } }
                    )
                    .padding(.bottom, 4)
                    .accessibilityIdentifier("reply-quote-\(message.id)")
                }
                ForEach(message.voiceNotes) { note in
                    VoiceNoteBubble(note: note, tint: MausPalette.color(chat.color))
                }
                ForEach(message.generatedImages, id: \.path) { attachment in
                    TranscriptAttachmentView(
                        attachment: attachment, threadId: chat.threadId,
                        messageId: message.id, foreground: mine ? BubbleColor.mineText : BubbleColor.theirsText
                    )
                }
                // Bots get markdown, you do not — the same split the desktop
                // makes. Markdown you did not intend is worse than markdown
                // you did: a message about `**` should show the asterisks.
                if let diff = parsedDiff {
                    GitPRDiffCardView(filename: diff.filename, diffText: diff.diff)
                } else if let webhook = message.webhookContent {
                    WebhookMessageBody(content: webhook)
                } else if mine {
                    let shared = attachedContent
                    // Quotes this message carries (CO8): its own words, then
                    // the citations as chips.
                    let cited = Citations.split(shared.text)
                    ForEach(Array(shared.attachments.enumerated()), id: \.offset) { _, attachment in
                        TranscriptAttachmentView(
                            attachment: attachment,
                            threadId: chat.threadId,
                            messageId: message.id
                        )
                    }
                    if !cited.display.isEmpty {
                        let collapsible = MessageCollapse.isLong(cited.display)
                        Text(MentionTint.attributed(cited.display, peers: context.mentionPeers, everyone: context.mentionEveryone))
                            .font(Theme.Font.body)
                            .lineSpacing(Theme.bodyLineSpacing)
                            .foregroundStyle(BubbleColor.mineText)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                            .modifier(CollapsedText(collapsed: collapsible && !expanded))
                        // Sent into a running turn (MS20): the bot saw it
                        // before its next step, inside the same turn.
                        if message.steered == true {
                            Text("sent mid-turn")
                                .font(.system(size: 11))
                                .foregroundStyle(Theme.textTertiary)
                                .accessibilityHint(Text("Sent while the bot was working: it saw this before its next step, inside the same turn."))
                                .accessibilityIdentifier("steered-\(message.id)")
                        }
                        if collapsible {
                            Button { expanded.toggle() } label: {
                                if expanded { Text("Show less") } else { Text("Show full message") }
                            }
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textSecondary)
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("collapse-\(message.id)")
                        }
                    }
                    SentCitations(citations: cited.citations) { citation in
                        // `onNavigate`: only a message of this conversation.
                        guard citation.source.threadId == chat.threadId,
                              context.lookup(citation.source.messageId) != nil,
                              let jump = context.jump
                        else { return false }
                        jump(citation.source.messageId)
                        return true
                    }
                } else if showingSource, let source = message.text, !source.isEmpty {
                    RawMarkdownView(text: source)
                        .accessibilityIdentifier("raw-markdown-\(message.id)")
                } else {
                    MarkdownText(
                        source: message.text ?? "",
                        scrollIdentifier: "message-\(message.id)-scroll",
                        mentions: context.mentionPeers,
                        mentionEveryone: context.mentionEveryone,
                        attachmentScope: (chat.threadId, message.id)
                    ) { url in
                        openLink(url, message)
                    }
                        .foregroundStyle(BubbleColor.theirsText)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, customCard ? 0 : Theme.Chat.bubblePaddingH)
            .padding(.vertical, customCard ? 0 : Theme.Chat.bubblePaddingV)
            // No tail (reference 02): a #202020 card with 20 pt corners for
            // the bot, the same shape one step lighter for you.
            .background(
                Group {
                    if !customCard {
                        RoundedRectangle(cornerRadius: Theme.Metric.bubbleRadius, style: .continuous)
                            .fill(mine ? BubbleColor.mine : BubbleColor.theirs)
                    }
                }
            )

            if !mine { Spacer(minLength: Theme.Chat.bubbleTrailingGap) }
        }
    }
}

/// The desktop's `RawMarkdownView`: the source as written, monospaced, on an
/// inset panel, selectable.
struct RawMarkdownView: View {
    @Environment(\.themePalette) var themePalette
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 12.5, design: .monospaced))
            .lineSpacing(3)
            .foregroundStyle(Theme.textPrimary)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Theme.inset.opacity(0.5))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(Theme.hairline.opacity(0.3), lineWidth: 1)
            )
    }
}

/// A long line of yours folded to the desktop's 160 pt behind a fade.
private struct CollapsedText: ViewModifier {
    let collapsed: Bool

    func body(content: Content) -> some View {
        if collapsed {
            content
                .frame(maxHeight: CGFloat(MessageCollapse.collapsedHeight), alignment: .top)
                .clipped()
                .mask(
                    LinearGradient(
                        stops: [.init(color: .black, location: 0.6), .init(color: .clear, location: 1)],
                        startPoint: .top, endPoint: .bottom
                    )
                )
        } else {
            content
        }
    }
}

/// @mentions of known peers, tinted as the desktop's `.mention-highlight`:
/// the peer's colour as a soft background and an underline.
enum MentionTint {
    static func apply(to attributed: inout AttributedString, peers: [MentionPeer], everyone: Bool) {
        guard !peers.isEmpty || everyone else { return }
        let plain = String(attributed.characters)
        guard plain.contains("@") else { return }
        for range in Mentions.ranges(in: plain, peers: peers, everyone: everyone) {
            let start = attributed.characters.index(attributed.characters.startIndex, offsetBy: range.start)
            let end = attributed.characters.index(start, offsetBy: range.end - range.start)
            let span = start..<end
            // Links and code keep their own look, as the remark plugin skips them.
            if attributed[span].runs.contains(where: { $0.link != nil || $0.inlinePresentationIntent?.contains(.code) == true }) {
                continue
            }
            let color = range.colorName.map(MausPalette.color) ?? Theme.textSecondary
            attributed[span].backgroundColor = color.opacity(0.24)
            attributed[span].underlineStyle = Text.LineStyle(pattern: .solid, color: color)
        }
    }

    static func attributed(_ text: String, peers: [MentionPeer], everyone: Bool) -> AttributedString {
        var attributed = AttributedString(text)
        apply(to: &attributed, peers: peers, everyone: everyone)
        return attributed
    }
}
