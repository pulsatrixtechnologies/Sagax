// A message, plain, with the system's own selection on it.
//
// The bubble itself cannot offer drag-to-select: long-press there already
// opens the reactions menu, and SwiftUI gives that gesture to whichever of
// the two asks last. So selecting part of a reply happens here instead —
// the same move Telegram and WhatsApp make, and for the same reason.
//
// Quote as a citation (feature parity matrix WP4, CO8), the phone's
// src/components/CitationUI.tsx: a selection here offers Cite (in the edit
// menu and under the text), which opens the comment editor; Save puts the
// quote in the composer as a chip that travels with the next message, the
// way the desktop's selection toolbar does. A selection over 12,000
// characters offers "Shorten selection" instead. The chips (composer and
// sent message) open the citation's details: the quote, the comment, Edit
// comment or Go to source, Close.
import SwiftUI
import UIKit
import CompanionCore

// MARK: - Where a citation goes

/// Puts a citation into this conversation's composer. Set by the chat
/// screen; nil where nothing can be sent (no Cite then).
struct CitationComposerKey: EnvironmentKey {
    static let defaultValue: ((CitationAttachment) -> Void)? = nil
}

extension EnvironmentValues {
    var citeIntoComposer: ((CitationAttachment) -> Void)? {
        get { self[CitationComposerKey.self] }
        set { self[CitationComposerKey.self] = newValue }
    }
}

/// The message a selection is taken from, and where the citation goes.
struct CitationTarget {
    let source: CitationSource
    let add: (CitationAttachment) -> Void

    init?(chat: Chat, message: Message, add: ((CitationAttachment) -> Void)?) {
        guard let add else { return nil }
        let owner: CitationSource.OwnerType
        switch chat {
        case .bot: owner = .bot
        case .room: owner = .group
        }
        source = CitationSource(ownerType: owner, ownerId: chat.id, threadId: chat.threadId, messageId: message.id)
        self.add = add
    }
}

/// Citations waiting to go with the next message, per thread (the
/// desktop's draft attachments of kind "citation").
@MainActor
final class CitationDrafts: ObservableObject {
    @Published private var byThread: [String: [CitationAttachment]] = [:]

    func citations(_ threadId: String) -> [CitationAttachment] { byThread[threadId] ?? [] }

    func add(_ citation: CitationAttachment) {
        byThread[citation.source.threadId, default: []].append(citation)
    }

    func replace(_ citation: CitationAttachment, threadId: String) {
        byThread[threadId] = citations(threadId).map { $0.id == citation.id ? citation : $0 }
    }

    func remove(_ id: String, threadId: String) {
        byThread[threadId]?.removeAll { $0.id == id }
        if byThread[threadId]?.isEmpty == true { byThread[threadId] = nil }
    }

    /// Sent: these leave with the words.
    func clear(_ ids: [String], threadId: String) {
        byThread[threadId]?.removeAll { ids.contains($0.id) }
        if byThread[threadId]?.isEmpty == true { byThread[threadId] = nil }
    }
}

// MARK: - The sheet

struct SelectableTextSheet: View {
    @Environment(\.themePalette) var themePalette
    let text: String
    /// Where Cite sends the selection; nil hides Cite.
    var citation: CitationTarget?
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false
    /// The selected range in UTF-16 units, as the desktop counts.
    @State private var selection = NSRange(location: 0, length: 0)
    @State private var editing: CitationAttachment?

    private var selector: CitationTextSelector? {
        Citations.selector(in: text, start: selection.location, end: selection.location + selection.length)
    }

    private var tooLong: Bool {
        guard let selector else { return false }
        return Citations.jsLength(selector.text) > Citations.maxQuoteLength
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                // The raw text, not the rendered markdown: what gets copied
                // should be what the bot actually wrote, backticks and all.
                SelectableTextView(
                    text: text,
                    selection: $selection,
                    citeTitle: citation == nil ? nil : (tooLong ? String(localized: "Shorten selection") : String(localized: "Cite")),
                    citeEnabled: !tooLong,
                    cite: startCitation
                )
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .accessibilityHint("Touch and hold to select part of this message")
                .accessibilityIdentifier("selectable-text")
            }
            .navigationTitle("Select Text")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        UIPasteboard.general.string = text
                        Haptics.selection()
                        withAnimation(.snappy) { copied = true }
                    } label: {
                        Label(copied ? "Copied" : "Copy All",
                              systemImage: copied ? "checkmark" : "doc.on.doc")
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                Group {
                    if citation != nil, selector != nil {
                        Button(action: startCitation) {
                            Label(tooLong ? "Shorten selection" : "Cite", systemImage: "quote.opening")
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(tooLong ? Theme.destructiveMenu : Theme.textPrimary)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                                .background(Theme.card, in: Capsule())
                                .overlay(Capsule().strokeBorder(Theme.hairline))
                        }
                        .buttonStyle(.plain)
                        .disabled(tooLong)
                        .accessibilityLabel(Text(tooLong ? "Selection is too long to cite" : "Cite selected text"))
                        .accessibilityIdentifier("cite-selection")
                    } else {
                        Text("Touch and hold the text to select part of it.")
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(.bar)
            }
        }
        .sheet(item: $editing) { draft in
            CitationEditorView(citation: draft, onCancel: { editing = nil }) { saved in
                editing = nil
                citation?.add(saved)
                Haptics.selection()
                dismiss()
            }
        }
    }

    private func startCitation() {
        guard let target = citation, let selector, !tooLong,
              let made = Citations.attachment(source: target.source, selector: selector)
        else { return }
        editing = made
    }
}

/// A read-only UITextView: the system's selection handles, with the
/// selected range reported back and Cite added to the edit menu.
private struct SelectableTextView: UIViewRepresentable {
    let text: String
    @Binding var selection: NSRange
    let citeTitle: String?
    let citeEnabled: Bool
    let cite: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = true
        view.dataDetectorTypes = []
        view.delegate = context.coordinator
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.parent = self
        if view.text != text {
            view.text = text
        }
        view.font = UIFont.preferredFont(forTextStyle: .body)
        view.textColor = UIColor(Theme.textPrimary)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        let width = proposal.width ?? UIScreen.main.bounds.width - 32
        let size = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: size.height)
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: SelectableTextView

        init(_ parent: SelectableTextView) { self.parent = parent }

        func textViewDidChangeSelection(_ textView: UITextView) {
            let range = textView.selectedRange
            if parent.selection != range { parent.selection = range }
        }

        func textView(_ textView: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
            guard let title = parent.citeTitle, range.length > 0 else { return nil }
            let action = UIAction(
                title: title,
                image: UIImage(systemName: "quote.opening"),
                attributes: parent.citeEnabled ? [] : [.disabled]
            ) { [weak self] _ in self?.parent.cite() }
            return UIMenu(children: suggestedActions + [action])
        }
    }
}

// MARK: - The comment editor (CitationEditor)

struct CitationEditorView: View {
    @Environment(\.themePalette) var themePalette
    let citation: CitationAttachment
    let onCancel: () -> Void
    let onSave: (CitationAttachment) -> Void
    @State private var comment: String
    @FocusState private var focused: Bool

    init(citation: CitationAttachment, onCancel: @escaping () -> Void, onSave: @escaping (CitationAttachment) -> Void) {
        self.citation = citation
        self.onCancel = onCancel
        self.onSave = onSave
        _comment = State(initialValue: citation.comment ?? "")
    }

    private var tooLong: Bool { Citations.jsLength(comment) > Citations.maxCommentLength }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            CitationQuoteBox(quote: citation.quote, maxHeight: 144)
            TextField(String(localized: "Add an optional comment…"), text: $comment, axis: .vertical)
                .lineLimit(3...8)
                .font(.system(size: 15))
                .foregroundStyle(Theme.textPrimary)
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(Theme.inset, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(focused ? Theme.accent : Theme.hairline)
                )
                .focused($focused)
                .accessibilityLabel(Text("Comment on selected text"))
                .accessibilityIdentifier("citation-comment")
            if tooLong {
                Text("Comments can contain up to \(Citations.maxCommentLength.formatted()) characters.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.destructiveMenu)
            }
            HStack(spacing: 10) {
                Spacer()
                Button("Cancel", action: onCancel)
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.cancelAction)
                    .accessibilityIdentifier("citation-cancel")
                Button("Save") {
                    guard let saved = Citations.withComment(citation, comment) else { return }
                    onSave(saved)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .disabled(tooLong)
                .keyboardShortcut(.defaultAction)
                .accessibilityIdentifier("citation-save")
            }
            .controlSize(.regular)
        }
        .padding(16)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Theme.bg.ignoresSafeArea())
        .presentationDetents([.medium, .large])
        .onAppear { focused = true }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Comment on citation"))
        .accessibilityIdentifier("citation-editor")
    }
}

/// "Quoted message" and the quote, on an inset panel.
struct CitationQuoteBox: View {
    @Environment(\.themePalette) var themePalette
    let quote: String
    var maxHeight: CGFloat = 224

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                Text("Quoted message")
                    .textCase(.uppercase)
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(0.4)
                    .foregroundStyle(Theme.textSecondary)
                Text(verbatim: quote)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
        }
        .frame(maxHeight: maxHeight)
        .fixedSize(horizontal: false, vertical: true)
        .background(Theme.inset, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

// MARK: - The chip (CitationBadge)

/// A citation as a chip: in the composer (with remove and Edit comment) or
/// under a sent message (with Go to source). Tap opens the details.
struct CitationChip: View {
    @Environment(\.themePalette) var themePalette
    let citation: CitationAttachment
    var onChange: ((CitationAttachment) -> Void)?
    var onRemove: (() -> Void)?
    /// Scroll to the quoted message; false when it is not in this conversation.
    var onNavigate: (() -> Bool)?
    @State private var showingDetails = false

    private var folded: String {
        citation.quote.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
    }

    var body: some View {
        HStack(spacing: 4) {
            Button { showingDetails = true } label: {
                HStack(spacing: 6) {
                    Image(systemName: "quote.opening")
                        .font(.system(size: 11, weight: .semibold))
                        .accessibilityHidden(true)
                    Text(verbatim: folded)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .font(.system(size: 12))
                .foregroundStyle(Theme.accentText)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .frame(maxWidth: 256, alignment: .leading)
                .background(Theme.accent.opacity(0.10), in: Capsule())
                .overlay(Capsule().strokeBorder(Theme.accent.opacity(0.30)))
                .fixedSize(horizontal: false, vertical: true)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Open citation: \(String(citation.quote.prefix(80)))"))
            .accessibilityIdentifier("citation-chip")
            if let onRemove {
                Button(action: onRemove) {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(width: 22, height: 22)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Remove citation"))
                .accessibilityIdentifier("citation-remove")
            }
        }
        .sheet(isPresented: $showingDetails) {
            CitationDetailsView(citation: citation, onChange: onChange, onNavigate: onNavigate)
        }
    }
}

/// The citation's details: quote, comment, and what can be done with it.
struct CitationDetailsView: View {
    @Environment(\.themePalette) var themePalette
    let citation: CitationAttachment
    var onChange: ((CitationAttachment) -> Void)?
    var onNavigate: (() -> Bool)?
    @Environment(\.dismiss) private var dismiss
    @State private var editing = false
    @State private var unavailable = false

    var body: some View {
        if editing, let onChange {
            CitationEditorView(citation: citation, onCancel: { editing = false }) { saved in
                onChange(saved)
                dismiss()
            }
        } else {
            VStack(alignment: .leading, spacing: 10) {
                CitationQuoteBox(quote: citation.quote)
                if let comment = citation.comment {
                    (Text("Comment:").fontWeight(.semibold) + Text(verbatim: " \(comment)"))
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textPrimary)
                }
                if unavailable {
                    Text("Source unavailable or changed. The saved quote is still available.")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.warning)
                        .accessibilityIdentifier("citation-unavailable")
                }
                HStack(spacing: 10) {
                    Spacer()
                    if let onNavigate {
                        Button("Go to source") {
                            if onNavigate() { dismiss() } else { unavailable = true }
                        }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("citation-go-to-source")
                    }
                    if onChange != nil {
                        Button("Edit comment") { editing = true }
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("citation-edit-comment")
                    }
                    Button("Close") { dismiss() }
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.accent)
                        .keyboardShortcut(.cancelAction)
                        .accessibilityIdentifier("citation-close")
                }
            }
            .padding(16)
            .frame(maxHeight: .infinity, alignment: .top)
            .background(Theme.bg.ignoresSafeArea())
            .presentationDetents([.medium, .large])
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Citation details"))
            .accessibilityIdentifier("citation-details")
        }
    }
}

/// A sent message's citations, under its words (`SentCitations`).
struct SentCitations: View {
    let citations: [CitationAttachment]
    let onNavigate: (CitationAttachment) -> Bool

    var body: some View {
        if !citations.isEmpty {
            FlowChips {
                ForEach(citations) { citation in
                    CitationChip(citation: citation, onNavigate: { onNavigate(citation) })
                }
            }
            .padding(.top, 4)
        }
    }
}

/// Chips that wrap onto as many lines as they need.
private struct FlowChips<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        // A plain vertical stack: one chip per line reads well at phone
        // width and never overflows the bubble.
        VStack(alignment: .leading, spacing: 6) { content }
    }
}
