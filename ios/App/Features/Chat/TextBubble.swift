// A text message's bubble: markdown for bots, plain text and attachments
// for you, voice notes, generated images, diffs and webhook bodies.
import SwiftUI
import CompanionCore

struct TextBubble: View {
    @Environment(\.themePalette) var themePalette
    let message: Message
    let chat: Chat
    var tailed = true
    let openLink: (URL, Message) -> OpenURLAction.Result

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
                    ForEach(Array(shared.attachments.enumerated()), id: \.offset) { _, attachment in
                        TranscriptAttachmentView(
                            attachment: attachment,
                            threadId: chat.threadId,
                            messageId: message.id
                        )
                    }
                    if !shared.text.isEmpty {
                        Text(shared.text)
                            .font(Theme.Font.body)
                            .lineSpacing(Theme.bodyLineSpacing)
                            .foregroundStyle(BubbleColor.mineText)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } else {
                    MarkdownText(
                        source: message.text ?? "",
                        scrollIdentifier: "message-\(message.id)-scroll"
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
