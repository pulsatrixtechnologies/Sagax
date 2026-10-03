// A fenced code block (`ChatMarkdown.tsx` CodeBlock). The phone keeps its
// look (reference 02): the language over the code on an inset panel,
// pushed sideways rather than wrapped. The desktop's toolbar lives in the
// long-press menu: Copy code, Save (the share sheet, as a snippet file named
// the desktop's way) and Wrap long lines. A block longer than 30 lines folds
// behind "Show all N lines" once the message is complete.
import SwiftUI
import CompanionCore

struct CodeBlockView: View {
    @Environment(\.themePalette) var themePalette
    let language: String?
    let code: String
    /// Still being written: never folds, so a growing block does not jump.
    var pending = false
    /// The streaming caret after the last character.
    var caret: Text = Text("")
    var identifier: String?

    @State private var wrap = false
    @State private var expanded = false
    @State private var share: RichShareItem?
    @StateObject private var feedback = RichCopyFeedback()

    private var lineCount: Int { CodeBlocks.countLines(code) }
    private var collapsible: Bool { !pending && lineCount > CodeBlocks.collapseLines }
    private var folded: Bool { collapsible && !expanded }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let language, !language.isEmpty {
                Text(verbatim: CodeBlocks.languageDisplayName(language))
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
            }
            codeText
                .frame(maxHeight: folded ? 352 : nil, alignment: .top)
                .clipped()
                .mask {
                    if folded {
                        LinearGradient(stops: [.init(color: .black, location: 0.8), .init(color: .clear, location: 1)], startPoint: .top, endPoint: .bottom)
                    } else {
                        Rectangle()
                    }
                }
            if collapsible {
                Button {
                    expanded.toggle()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        if expanded { Text("Collapse") } else { Text("Show all \(lineCount) lines") }
                    }
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(identifier.map { "\($0)-fold" } ?? "code-fold")
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Theme.parity(Color.secondary.opacity(0.14), Theme.inset))
        )
        .overlay(alignment: .topTrailing) {
            RichCopiedBadge(feedback: feedback, identifier: identifier.map { "\($0)-copied" } ?? "code-copied")
        }
        .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: 10, style: .continuous))
        .contextMenu {
            Button {
                feedback.copy("code", code)
            } label: {
                Label("Copy code", systemImage: "doc.on.doc")
            }
            Button {
                share = RichShareItem.writing(code, named: CodeBlocks.snippetFileName(language))
            } label: {
                Label("Save as file", systemImage: "square.and.arrow.down")
            }
            Button {
                wrap.toggle()
            } label: {
                if wrap {
                    Label("Disable line wrapping", systemImage: "arrow.left.and.right.text.vertical")
                } else {
                    Label("Wrap long lines", systemImage: "text.word.spacing")
                }
            }
        }
        .sheet(item: $share) { item in
            ActivityShareSheet(items: [item.url])
        }
        .accessibilityElement(children: .contain)
        .modifier(RichIdentifier(identifier: identifier))
    }

    @ViewBuilder
    private var codeText: some View {
        let text = (Text(verbatim: code) + caret)
            .font(Theme.Font.code)
            .lineSpacing(Theme.bodyLineSpacing)
            .textSelection(.enabled)
        if wrap {
            text.fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            // Horizontal scroll rather than wrapping: wrapped code is harder
            // to read than code you have to push sideways, and indentation
            // is most of what a snippet is saying.
            ScrollView(.horizontal, showsIndicators: false) { text }
        }
    }
}
