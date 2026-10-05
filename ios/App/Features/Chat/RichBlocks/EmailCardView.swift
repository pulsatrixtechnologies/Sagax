// An email the bot drafted (`EmailCard.tsx`), shown the way a mail client
// would: header rows, a formatted body, and the three things a person does
// with a draft here: copy it, copy it with formatting for a rich editor, or
// open it in their mail app. There is no send: nothing leaves the phone
// unless the person sends it from Mail.
import SwiftUI
import UIKit
import CompanionCore

struct EmailCardView: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.openURL) private var openURL
    let draft: EmailDraft
    var pending = false
    var identifier: String?
    @StateObject private var feedback = RichCopyFeedback()
    @State private var notice = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "envelope")
                    .accessibilityHidden(true)
                Text("Email draft")
                    .fontWeight(.medium)
                    .foregroundStyle(Theme.textPrimary)
                Spacer(minLength: 4)
                if pending {
                    Text("Still being written…").font(.system(size: 11))
                }
            }
            .font(.system(size: 12))
            .foregroundStyle(Theme.textSecondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Theme.cardRaised.opacity(0.3))
            hairline
            VStack(alignment: .leading, spacing: 0) {
                if let from = draft.from { header("From", from) }
                if !draft.to.isEmpty { header("To", draft.to.joined(separator: ", ")) }
                if !draft.cc.isEmpty { header("Cc", draft.cc.joined(separator: ", ")) }
                if !draft.bcc.isEmpty { header("Bcc", draft.bcc.joined(separator: ", ")) }
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text("Subject")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(width: 64, alignment: .leading)
                    if draft.subject.isEmpty {
                        Text("(no subject)").font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                    } else {
                        Text(verbatim: draft.subject)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.vertical, 4)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
            hairline
            MarkdownText(source: draft.body, picturesAsText: true)
                .font(.system(size: 13))
                .foregroundStyle(Theme.textPrimary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
            hairline
            footer
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Theme.cardRaised.opacity(0.2))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.card))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hairline.opacity(0.4), lineWidth: 0.5))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Email draft: \(draft.subject.isEmpty ? String(localized: "(no subject)") : draft.subject)"))
        .modifier(RichIdentifier(identifier: identifier))
    }

    private var hairline: some View {
        Rectangle().fill(Theme.hairline.opacity(0.3)).frame(height: 0.5)
    }

    private func header(_ label: LocalizedStringKey, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 64, alignment: .leading)
            Text(verbatim: value)
                .font(.system(size: 12.5))
                .foregroundStyle(Theme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 4)
    }

    private var footer: some View {
        let mailto = RichBlocks.emailMailtoURL(draft)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                button(feedback.copied == "plain" ? "Copied" : "Copy", icon: feedback.copied == "plain" ? "checkmark" : "doc.on.doc", id: "copy") {
                    feedback.copy("plain", RichBlocks.emailPlainText(draft))
                }
                button(feedback.copied == "rich" ? "Copied" : "Copy as rich text", icon: feedback.copied == "rich" ? "checkmark" : "doc.richtext", id: "copy-rich") {
                    feedback.copy("rich", RichBlocks.emailPlainBody(draft.body), html: richHTML())
                }
                Button {
                    if !mailto.bodyIncluded && !draft.body.isEmpty {
                        feedback.copy("rich-body", RichBlocks.emailPlainBody(draft.body))
                        notice = true
                    }
                    if let url = URL(string: mailto.url) { openURL(url) }
                } label: {
                    Label("Open in mail app", systemImage: "arrow.up.forward.app")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.accentInk)
                        .padding(.horizontal, 10)
                        .frame(minHeight: 32)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Theme.accent))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(identifier.map { "\($0)-open" } ?? "email-open")
            }
            if notice {
                Text("The body is too long for a mail link, so it was copied: paste it into the draft.")
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier.map { "\($0)-actions" } ?? "email-actions")
    }

    private func button(_ title: LocalizedStringKey, icon: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.system(size: 12))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .padding(.horizontal, 10)
                .frame(minHeight: 32)
                .background(RoundedRectangle(cornerRadius: 8).fill(Theme.card))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.hairline.opacity(0.4), lineWidth: 0.5))
        }
        .buttonStyle(.plain)
        .modifier(RichLastCopied(text: feedback.lastText))
        .accessibilityIdentifier(identifier.map { "\($0)-\(id)" } ?? "email-\(id)")
    }

    /// The body as HTML for a rich editor, built from Foundation's own
    /// Markdown parse: our attributes and escaped text, never model markup.
    private func richHTML() -> String {
        let escape: (String) -> String = { value in
            value.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
                .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
                .replacingOccurrences(of: "'", with: "&#39;")
        }
        let subject = draft.subject.isEmpty ? "" : "<p><strong>\(escape(draft.subject))</strong></p>"
        var body = ""
        if let attributed = try? NSAttributedString(
            markdown: Data(draft.body.utf8),
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ), let data = try? attributed.data(
            from: NSRange(location: 0, length: attributed.length),
            documentAttributes: [.documentType: NSAttributedString.DocumentType.html, .characterEncoding: String.Encoding.utf8.rawValue]
        ), let html = String(data: data, encoding: .utf8) {
            body = html
        } else {
            body = draft.body.components(separatedBy: "\n\n").map { "<p>\(escape($0))</p>" }.joined()
        }
        return "<meta charset=\"utf-8\">\(subject)\(body)"
    }
}
