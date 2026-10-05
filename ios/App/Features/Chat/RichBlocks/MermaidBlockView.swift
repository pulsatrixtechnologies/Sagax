// A ```mermaid fence (`ChatMarkdown.tsx` MermaidDiagram). The desktop draws
// the diagram with the mermaid library; the phone carries no diagram engine,
// so it shows what the desktop shows when a diagram cannot be drawn: the
// source under a "Mermaid diagram" header, with Copy, and says where the
// picture is.
import SwiftUI
import CompanionCore

struct MermaidBlockView: View {
    @Environment(\.themePalette) var themePalette
    let code: String
    var identifier: String?
    @StateObject private var feedback = RichCopyFeedback()

    var body: some View {
        RichBlockFrame(icon: "point.3.connected.trianglepath.dotted", title: String(localized: "Mermaid diagram"), identifier: identifier) {
            RichToolButton(
                icon: feedback.copied == nil ? "doc.on.doc" : "checkmark",
                label: feedback.copied == nil ? "Copy diagram source" : "Diagram source copied",
                identifier: identifier.map { "\($0)-copy" }
            ) {
                feedback.copy("source", code)
            }
            .modifier(RichLastCopied(text: feedback.lastText))
        } content: {
            VStack(alignment: .leading, spacing: 6) {
                Text("Open this conversation on your computer to see the diagram.")
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(verbatim: code)
                        .font(Theme.Font.code)
                        .lineSpacing(Theme.bodyLineSpacing)
                        .foregroundStyle(Theme.textPrimary)
                        .textSelection(.enabled)
                }
            }
            .padding(10)
        }
    }
}
