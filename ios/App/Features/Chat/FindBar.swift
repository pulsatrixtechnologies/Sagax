// Find in this conversation (feature parity matrix WP4, MS11), the phone's
// src/components/ChatFindBar.tsx: the query goes to the thread search 180 ms
// after the last keystroke, the first hit is landed on as soon as results
// arrive, Return / the down chevron step to the next hit and Shift-Return /
// the up chevron to the previous one (both wrap), Escape or × closes. Opened
// from the "+" sheet or ⌘F; on the iPhone it takes the header's place. The
// view takes its state and actions from `ChatFindModel` and decides nothing
// about layout, so the iPad's desktop chat can mount it under its header.
import SwiftUI
import CompanionCore

@MainActor
final class ChatFindModel: ObservableObject {
    @Published private(set) var isOpen = false
    @Published var query = ""
    @Published private(set) var hits: [SearchHit] = []
    @Published private(set) var index = 0
    @Published private(set) var loading = false
    /// Bumped on every open, so the field takes focus again.
    @Published private(set) var openCount = 0

    private var request = 0
    private var searchTask: Task<Void, Never>?
    private var landTask: Task<Void, Never>?

    func open() {
        isOpen = true
        openCount += 1
    }

    func close() {
        isOpen = false
        query = ""
        hits = []
        index = 0
        loading = false
        request += 1
        searchTask?.cancel()
        landTask?.cancel()
    }

    /// The query changed: search again after a pause, or clear.
    func queryChanged(threadId: String, session: Session) {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        request += 1
        let current = request
        searchTask?.cancel()
        guard !trimmed.isEmpty else {
            hits = []
            index = 0
            loading = false
            return
        }
        loading = true
        searchTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(FindInConversation.debounceMilliseconds) * 1_000_000)
            guard !Task.isCancelled else { return }
            do {
                let found = try await session.find(trimmed, inThread: threadId)
                guard let self, current == self.request else { return }
                self.hits = found
                self.index = 0
                self.loading = false
                // Jump to the first match as soon as a new result set arrives.
                if !found.isEmpty { self.land(0, session: session) }
            } catch {
                guard let self, current == self.request, !Task.isCancelled else { return }
                self.hits = []
                self.loading = false
                session.actionError = String(localized: "Search failed")
            }
        }
    }

    /// Step through the hits (`move`), wrapping at both ends.
    func move(_ delta: Int, session: Session) {
        guard let next = FindInConversation.step(index, by: delta, count: hits.count) else { return }
        land(next, session: session)
    }

    private func land(_ next: Int, session: Session) {
        guard hits.indices.contains(next) else { return }
        index = next
        let hit = hits[next]
        landTask?.cancel()
        landTask = Task {
            do { try await session.land(on: hit) }
            catch { if !Task.isCancelled { session.actionError = String(localized: "That message is unavailable") } }
        }
    }

    /// The line beside the field: searching, "2 of 5", or no results.
    var status: String {
        if loading { return String(localized: "Searching…") }
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return "" }
        return hits.isEmpty ? String(localized: "No results") : String(localized: "\(index + 1) of \(hits.count)")
    }
}

/// The bar itself: magnifier, field, position, previous, next, close.
struct ChatFindBar: View {
    @Environment(\.themePalette) var themePalette
    @ObservedObject var model: ChatFindModel
    let threadId: String
    @EnvironmentObject private var session: Session
    @FocusState private var focused: Bool
    /// iPad desktop shell: ChatFindBar.tsx's bar (pane fill, 12 pt corners,
    /// 37 tall, 13 pt field, 23 pt buttons).
    @Environment(\.desktopChatText) private var desktop

    var body: some View {
        if let desktop {
            desktopBody(desktop)
        } else {
            phoneBody
        }
    }

    private func desktopBody(_ theme: DesktopTheme) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .regular))
                .frame(width: 15, height: 15)
                .foregroundStyle(theme.inkSecondary)
                .accessibilityHidden(true)
            TextField(String(localized: "Find in this conversation"), text: $model.query)
                .font(theme.font(13))
                .foregroundStyle(theme.ink)
                .tint(theme.focus)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focused)
                .onSubmit {
                    model.move(1, session: session)
                    focused = true
                }
                .padding(.horizontal, 4)
                .accessibilityLabel(Text("Find in this conversation"))
                .accessibilityIdentifier("chat-find-field")
            Text(verbatim: model.status)
                .font(theme.font(11.5).monospacedDigit())
                .foregroundStyle(theme.inkSecondary)
                .lineLimit(1)
                .frame(minWidth: 58, alignment: .trailing)
                .accessibilityIdentifier("chat-find-status")
            DesktopFindButton(systemImage: "chevron.up", label: "Previous result") { model.move(-1, session: session) }
                .disabled(model.hits.isEmpty)
                .keyboardShortcut(.return, modifiers: .shift)
                .accessibilityIdentifier("chat-find-previous")
            DesktopFindButton(systemImage: "chevron.down", label: "Next result") { model.move(1, session: session) }
                .disabled(model.hits.isEmpty)
                .accessibilityIdentifier("chat-find-next")
            DesktopFindButton(systemImage: "xmark", label: "Close find") { model.close() }
                .keyboardShortcut(.cancelAction)
                .accessibilityIdentifier("chat-find-close")
        }
        .padding(.horizontal, 9)
        .frame(height: 37)
        .background(theme.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(focused || Self.parityFocus ? theme.focus : theme.hairline.opacity(0.5), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.12), radius: 6, y: 3)
        .onValueChange(of: model.query) { _ in model.queryChanged(threadId: threadId, session: session) }
        .onValueChange(of: model.openCount, initial: true) { _ in focused = !Self.parityFocus }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("chat-find-bar")
    }

    #if DEBUG
    private static var parityFocus: Bool { DesktopChatParity.findLooksFocused }
    #else
    private static let parityFocus = false
    #endif

    private var phoneBody: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .accessibilityHidden(true)
            TextField(String(localized: "Find in this conversation"), text: $model.query)
                .font(.system(size: 16))
                .foregroundStyle(Theme.textPrimary)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($focused)
                .onSubmit {
                    model.move(1, session: session)
                    // Return keeps the field, as on the desktop.
                    focused = true
                }
                .accessibilityLabel(Text("Find in this conversation"))
                .accessibilityIdentifier("chat-find-field")
            Text(verbatim: model.status)
                .font(.system(size: 12.5).monospacedDigit())
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
                .fixedSize()
                .accessibilityIdentifier("chat-find-status")
            findButton("chevron.up", label: "Previous result", id: "chat-find-previous") { model.move(-1, session: session) }
                .disabled(model.hits.isEmpty)
                .keyboardShortcut(.return, modifiers: .shift)
            findButton("chevron.down", label: "Next result", id: "chat-find-next") { model.move(1, session: session) }
                .disabled(model.hits.isEmpty)
            findButton("xmark", label: "Close find", id: "chat-find-close") { model.close() }
                .keyboardShortcut(.cancelAction)
        }
        .padding(.leading, 14)
        .padding(.trailing, 6)
        .frame(height: Theme.Metric.glassLarge)
        .themeGlass(Capsule())
        .chatGlassRim(Capsule())
        .onValueChange(of: model.query) { _ in model.queryChanged(threadId: threadId, session: session) }
        .onValueChange(of: model.openCount, initial: true) { _ in focused = true }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("chat-find-bar")
    }

    private func findButton(_ systemImage: String, label: LocalizedStringKey, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.textPrimary)
                .frame(width: 34, height: 34)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
        .accessibilityIdentifier(id)
    }
}

/// `rounded-md p-1`: a 15 pt glyph in a 23 pt square.
private struct DesktopFindButton: View {
    @Environment(\.desktopTheme) private var theme
    let systemImage: String
    let label: LocalizedStringKey
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(theme.inkSecondary)
                .frame(width: 23, height: 23)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(Text(label))
    }
}

extension View {
    /// ⌘F opens the find bar, as on the desktop.
    func chatFindShortcut(_ open: @escaping () -> Void) -> some View {
        background {
            Button("Find in conversation", action: open)
                .keyboardShortcut("f", modifiers: .command)
                .opacity(0)
                .frame(width: 0, height: 0)
                .accessibilityHidden(true)
        }
    }
}

// MARK: - The chat screen's WP4 hooks

extension ChatView {
    /// The header, or the find bar in its place while finding (iPhone: the
    /// find bar "over the header"). ⌘F opens it from either.
    @ViewBuilder
    var headerOrFindBar: some View {
        Group {
            if finder.isOpen, session.surfaceGate.allows(.findInConversation) {
                ChatFindBar(model: finder, threadId: threadId)
                    .padding(.horizontal, Theme.Metric.screenEdge)
                    .padding(.top, 6)
                    .frame(maxWidth: CompanionLayout.headerWidth)
                    .frame(maxWidth: .infinity)
                    .transition(.opacity)
            } else {
                headerBar
            }
        }
        .chatFindShortcut { openFind() }
    }

    func openFind() {
        guard session.surfaceGate.allows(.findInConversation) else { return }
        withAnimation(.easeInOut(duration: 0.15)) { finder.open() }
    }

    /// Cite (CO8): the quote joins this thread's next message, and the
    /// field takes the caret, as the desktop's `focusComposer`.
    var citeIntoComposer: ((CitationAttachment) -> Void)? {
        guard session.surfaceGate.allows(.citationQuote) else { return nil }
        let drafts = citations
        return { citation in
            drafts.add(citation)
            Task { @MainActor in
                // after the selection sheet has gone
                try? await Task.sleep(nanoseconds: 450_000_000)
                composerFocused = true
            }
        }
    }

    /// Every picture of this conversation, for the lightbox (CA31).
    var conversationGallery: ConversationGalleryContext {
        ConversationGalleryContext(threadId: threadId, images: ConversationGallery.images(in: messages))
    }
}
