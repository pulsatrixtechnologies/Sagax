// Bot replies, rendered.
//
// `Markdown.blocks` does the splitting; this draws each block and hands the
// inline run to Foundation, which knows emphasis, code spans, strikethrough
// and links. SwiftUI makes the links tappable on its own, which is most of
// why this is worth doing at all — a reply full of sources was previously a
// wall of bracketed URLs.
//
// Only bot messages get this. The desktop makes the same split: what you
// typed is shown as you typed it, because markdown you did not intend is
// worse than markdown you did.
import SwiftUI
import UIKit
import CompanionCore

private struct OptionalIdentifier: ViewModifier {
    @Environment(\.themePalette) var themePalette
    let identifier: String?

    func body(content: Content) -> some View {
        if let identifier {
            content.accessibilityIdentifier(identifier)
        } else {
            content
        }
    }
}

struct MarkdownText: View {
    @Environment(\.themePalette) var themePalette
    let source: String
    /// Draws a caret after the last block. The streaming bubble sets this so
    /// the live reply and the settled one are the same view with the same
    /// layout — a caret bolted on outside would put it on its own line the
    /// moment the reply ends in a list item.
    var caret: Bool = false
    /// Identifier for the first table's horizontal scroll view. Settled
    /// bubbles pass `message-<id>-scroll`. Streaming and file preview pass nil.
    var scrollIdentifier: String? = nil
    var openLink: ((URL) -> OpenURLAction.Result)?
    /// @mentions of these peers are tinted (MS21), as the desktop's
    /// `remarkMentions` does; links and code spans are left alone.
    var mentions: [MentionPeer] = []
    var mentionEveryone = false
    /// The message a picture written in the reply belongs to: a path on the
    /// computer loads through that message's file route (CA28).
    var attachmentScope: (threadId: String, messageId: String)?
    /// Pictures as their alt text (an email draft's body, as the desktop's
    /// EmailCard draws them).
    var picturesAsText = false

    /// Spoilers this reader has revealed, by their text.
    @State private var revealed: Set<String> = []
    /// The footnote a tapped reference opened.
    @State private var openFootnote: MarkdownFootnote?

    init(
        source: String,
        caret: Bool = false,
        scrollIdentifier: String? = nil,
        mentions: [MentionPeer] = [],
        mentionEveryone: Bool = false,
        attachmentScope: (threadId: String, messageId: String)? = nil,
        picturesAsText: Bool = false,
        openLink: ((URL) -> OpenURLAction.Result)? = nil
    ) {
        self.source = source
        self.caret = caret
        self.scrollIdentifier = scrollIdentifier
        self.mentions = mentions
        self.mentionEveryone = mentionEveryone
        self.attachmentScope = attachmentScope
        self.picturesAsText = picturesAsText
        self.openLink = openLink
    }

    /// Identifier prefix for the rich blocks of a settled bubble
    /// (`message-<id>-rich-<n>`); nil while streaming and in previews.
    private var richPrefix: String? {
        scrollIdentifier.map { $0.hasSuffix("-scroll") ? String($0.dropLast("-scroll".count)) + "-rich" : $0 + "-rich" }
    }

    var body: some View {
        let blocks = Markdown.blocks(source)
        // A fence the message has not closed is still being written: charts,
        // widgets and email cards wait for it (ChatMarkdown `pendingAt`).
        let openFence = RichBlocks.unclosedFenceOffset(source) >= 0
        let lastCode = blocks.lastIndex { if case .code = $0 { return true }; return false }
        VStack(alignment: .leading, spacing: Theme.Chat.paragraphSpacing) {
            let firstTable = blocks.firstIndex { if case .table = $0 { return true }; return false }
            ForEach(Array(blocks.enumerated()), id: \.offset) { item in
                view(
                    for: item.element,
                    tail: caret && item.offset == blocks.count - 1,
                    scrollIdentifier: item.offset == firstTable ? scrollIdentifier : nil,
                    pending: caret || (openFence && item.offset == lastCode),
                    identifier: richPrefix.map { "\($0)-\(item.offset)" }
                )
            }
        }
        .environment(\.openURL, OpenURLAction { url in
            switch url.scheme {
            case Self.spoilerScheme:
                let key = Self.spoilerKey(url)
                if revealed.contains(key) { revealed.remove(key) } else { revealed.insert(key) }
                return .handled
            case Markdown.footnoteScheme:
                let number = Int(url.absoluteString.dropFirst(Markdown.footnoteScheme.count + 1)) ?? 0
                openFootnote = footnotes(blocks).first { $0.number == number }
                return .handled
            default:
                return openLink?(url) ?? .systemAction(url)
            }
        })
        .alert(
            openFootnote.map { String(localized: "Footnote \($0.number)") } ?? "",
            isPresented: Binding(get: { openFootnote != nil }, set: { if !$0 { openFootnote = nil } }),
            presenting: openFootnote
        ) { _ in
            Button("OK", role: .cancel) {}
        } message: { note in
            Text(verbatim: renderedInline(note.text))
        }
    }

    private func footnotes(_ blocks: [MarkdownBlock]) -> [MarkdownFootnote] {
        for block in blocks { if case let .footnotes(notes) = block { return notes } }
        return []
    }

    /// A nested reply part (a callout's body) with this one's settings.
    private func nested(_ text: String) -> MarkdownText {
        MarkdownText(
            source: text, mentions: mentions, mentionEveryone: mentionEveryone,
            attachmentScope: attachmentScope, picturesAsText: picturesAsText, openLink: openLink
        )
    }

    @ViewBuilder
    private func view(for block: MarkdownBlock, tail: Bool, scrollIdentifier: String?, pending: Bool, identifier: String?) -> some View {
        switch block {
        case let .paragraph(text):
            inline(text, tail: tail)
                .font(Theme.Font.body)
                .lineSpacing(Theme.bodyLineSpacing)
                .fixedSize(horizontal: false, vertical: true)
                // a paragraph holding spoilers or footnote marks is findable
                // (its taps are the block's actions); plain prose is untouched
                .modifier(RichIdentifier(identifier: text.contains("~~") || text.contains(Markdown.footnoteScheme) ? identifier : nil))

        case let .heading(level, text):
            // Three sizes, not six. A chat bubble is not a document, and an
            // h4 that looks exactly like body text is a heading that failed.
            inline(text, tail: tail)
                .font(.system(size: level <= 1 ? 17 : level == 2 ? 15.5 : 14, weight: .semibold))
                .lineSpacing(Theme.bodyLineSpacing)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)

        case let .bullet(indent, text):
            bullet(indent: indent, text: text, tail: tail)

        case let .ordered(indent, number, text):
            marker("\(number).", indent: indent, text: text, tail: tail)

        case let .task(indent, number, checked, text):
            taskRow(indent: indent, number: number, checked: checked, text: text, tail: tail)

        case let .table(table):
            RichTableView(
                table: table, tail: tail, scrollIdentifier: scrollIdentifier, identifier: identifier,
                inline: { inline($0, tail: $1) }, plain: renderedInline
            )

        case let .quote(text):
            HStack(alignment: .top, spacing: 8) {
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(Theme.parity(Color.secondary.opacity(0.4), Theme.hairline))
                    .frame(width: 3)
                inline(text, tail: tail)
                    .font(Theme.Font.body)
                    .lineSpacing(Theme.bodyLineSpacing)
                    .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
            }
            .fixedSize(horizontal: false, vertical: true)

        case let .code(language, text):
            fence(language: language, code: text, tail: tail, pending: pending, identifier: identifier)

        case .rule:
            Divider().padding(.vertical, 2)

        case let .callout(kind, title, text):
            CalloutView(kind: kind, title: title, identifier: identifier) {
                if !text.isEmpty {
                    nested(text)
                        .foregroundStyle(Theme.textPrimary)
                }
            }

        case let .image(image):
            if picturesAsText {
                inline(image.alt, tail: tail).font(Theme.Font.body)
            } else {
                MarkdownImageView(image: image, scope: attachmentScope, identifier: identifier)
            }

        case let .footnotes(notes):
            FootnotesView(notes: notes, inline: { inline($0) }, identifier: identifier)
        }
    }

    /// A fenced block, routed the way ChatMarkdown's `pre` does: mermaid to
    /// the diagram block, then email, widget, chart and CSV fences, and
    /// everything else to the code block.
    @ViewBuilder
    private func fence(language: String?, code: String, tail: Bool, pending: Bool, identifier: String?) -> some View {
        let lang = language ?? ""
        let kind = RichBlocks.fenceKind(lang)
        let email = kind == .email || kind == nil ? RichBlocks.parseEmailBlock(code, lang: lang) : nil
        let csv = kind == .csv && !pending ? MarkdownTable.delimited(code, language: lang) : nil
        if lang.trimmingCharacters(in: .whitespaces).lowercased() == "mermaid" {
            MermaidBlockView(code: code, identifier: identifier)
        } else if let email {
            EmailCardView(draft: email, pending: pending, identifier: identifier)
        } else if kind == .widget {
            WidgetFrameView(code: code, pending: pending, identifier: identifier)
        } else if kind == .chart {
            ChartBlockView(code: code, pending: pending, identifier: identifier, inline: { inline($0, tail: $1) }, plain: renderedInline)
        } else if let csv, !csv.headers.isEmpty {
            RichTableView(
                table: csv, tail: tail, literal: true, identifier: identifier,
                inline: { inline($0, tail: $1) }, plain: renderedInline
            )
        } else {
            CodeBlockView(language: language, code: code, pending: pending, caret: caretText(tail), identifier: identifier)
        }
    }

    private func taskRow(indent: Int, number: Int?, checked: Bool, text: String, tail: Bool) -> some View {
        let state = String(localized: checked ? "completed" : "not completed")
        let words = renderedInline(text)
        let label = words.isEmpty ? state : "\(state), \(words)"
        return HStack(alignment: .firstTextBaseline, spacing: 6) {
            if let number {
                Text("\(number).")
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                    .frame(minWidth: 16, alignment: .trailing)
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: checked ? "checkmark.square.fill" : "square")
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                inline(text, tail: tail).font(Theme.Font.body).lineSpacing(Theme.bodyLineSpacing)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(label)
        }
        .padding(.leading, CGFloat(indent) * Theme.Chat.bulletIndent)
        .fixedSize(horizontal: false, vertical: true)
    }

    /// The words VoiceOver should hear, with inline markers removed. The
    /// visible text still goes through Foundation so emphasis stays styled.
    private func renderedInline(_ text: String) -> String {
        if let attributed = try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            return String(attributed.characters)
        }
        return text
    }

    private func marker(_ symbol: String, indent: Int, text: String, tail: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text(symbol)
                .font(Theme.Font.body)
                .foregroundStyle(Theme.bulletDot)
                .frame(width: Theme.Chat.bulletIndent - 6, alignment: .trailing)
                .padding(.trailing, 6)
            inline(text, tail: tail)
                .font(Theme.Font.body)
                .lineSpacing(Theme.bodyLineSpacing)
        }
        .padding(.leading, CGFloat(indent) * Theme.Chat.bulletIndent)
        .fixedSize(horizontal: false, vertical: true)
    }

    /// A list item (reference 02): a 5 pt dot 5 pt in from the text column,
    /// centred on the first line's x-height, and the text 26 pt in. Wrapped
    /// lines align with the first.
    private func bullet(indent: Int, text: String, tail: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Circle()
                .fill(Theme.bulletDot)
                .frame(width: Theme.Chat.bulletDot, height: Theme.Chat.bulletDot)
                // dot bottom sits 0.9 pt above the baseline
                .alignmentGuide(.firstTextBaseline) { d in d.height + 0.9 }
                .padding(.leading, Theme.Chat.bulletDotInset)
                .padding(.trailing, Theme.Chat.bulletIndent - Theme.Chat.bulletDotInset - Theme.Chat.bulletDot)
                .accessibilityHidden(true)
            inline(text, tail: tail)
                .font(Theme.Font.body)
                .lineSpacing(Theme.bodyLineSpacing)
        }
        .padding(.leading, CGFloat(indent) * Theme.Chat.bulletIndent)
        .fixedSize(horizontal: false, vertical: true)
    }

    /// Inline markdown via Foundation. `.inlineOnlyPreservingWhitespace`
    /// because the blocks are already split — asking for `.full` here would
    /// have it re-interpret list markers this has already consumed.
    ///
    /// Falling back to the raw string on a parse failure is the point: a
    /// half-typed link mid-stream should show as the characters the model has
    /// sent so far, not vanish until it closes the bracket.
    private func inline(_ text: String, tail: Bool = false) -> Text {
        let rendered: Text
        if var attributed = try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            // Code spans: SF Mono 12 on the bubble itself, no chip.
            for run in attributed.runs where run.inlinePresentationIntent?.contains(.code) == true {
                attributed[run.range].font = Theme.Font.code
            }
            MentionTint.apply(to: &attributed, peers: mentions, everyone: mentionEveryone)
            styleFootnotes(&attributed)
            styleSpoilers(&attributed)
            rendered = Text(attributed)
        } else {
            rendered = Text(text)
        }
        return rendered + caretText(tail)
    }

    // MARK: Spoilers and footnote marks

    static let spoilerScheme = "sagax-spoiler"

    static func spoilerURL(_ key: String) -> URL? {
        var components = URLComponents()
        components.scheme = spoilerScheme
        components.path = key
        return components.url
    }

    static func spoilerKey(_ url: URL) -> String {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?.path ?? url.absoluteString
    }

    /// `~~text~~` in a bot reply is a spoiler (ChatMarkdown `Spoiler`), not
    /// a deletion: hidden behind a raised chip until tapped, then shown with
    /// a dotted underline and a small "Hide". Display only: the stored text,
    /// copies and the model's context keep the raw `~~text~~`.
    private func styleSpoilers(_ attributed: inout AttributedString) {
        let ranges = attributed.runs
            .filter { $0.inlinePresentationIntent?.contains(.strikethrough) == true }
            .map(\.range)
        guard !ranges.isEmpty else { return }
        for range in ranges.reversed() {
            let key = String(attributed[range].characters)
            guard let url = Self.spoilerURL(key) else { continue }
            var intent = attributed[range].inlinePresentationIntent ?? []
            intent.remove(.strikethrough)
            if revealed.contains(key) {
                attributed[range].inlinePresentationIntent = intent
                attributed[range].underlineStyle = Text.LineStyle(pattern: .dot, color: Theme.hairline)
                var hide = AttributedString(" " + String(localized: "Hide"))
                hide.link = url
                hide.font = .system(size: 11)
                attributed.insert(hide, at: range.upperBound)
            } else {
                // the words become figure spaces on a raised chip: nothing to
                // read until the tap, whatever colour the link takes
                var mask = AttributedString(String(repeating: "\u{2007}", count: max(2, key.count)))
                mask.link = url
                mask.backgroundColor = Theme.cardRaised
                mask.inlinePresentationIntent = intent
                if let font = attributed[range].font { mask.font = font }
                attributed.replaceSubrange(range, with: mask)
            }
        }
    }

    /// Footnote references (`[^id]`, rewritten by the splitter as links)
    /// read as small raised numbers.
    private func styleFootnotes(_ attributed: inout AttributedString) {
        for run in attributed.runs where run.link?.scheme == Markdown.footnoteScheme {
            attributed[run.range].font = .system(size: 10, weight: .medium)
            attributed[run.range].baselineOffset = 5
        }
    }

    /// A figure space then a block, so the caret sits off the last glyph
    /// rather than touching it. Empty when not streaming — an empty `Text`
    /// concatenated in costs nothing and keeps the callers branch-free.
    private func caretText(_ tail: Bool) -> Text {
        tail ? Text("\u{2007}▍").foregroundColor(Theme.parity(Color.secondary, Theme.textSecondary)) : Text("")
    }
}
