// Opening a bot chat that the phone cannot show from what it holds.
//
// Bug 2026-10-16 (iOS 0.5.9 to 0.5.11, JC: "I cannot open a chat"): a tap
// pushed the chat and the chat closed itself on its first frame, before any
// request, because the bot's selected thread was missing from its thread
// list. An organization server sends exactly that: a bot narrowed for the
// viewer can carry their own thread outside the list (an AI client's hidden
// conversation they opened), or no thread of theirs yet (`threadId` empty,
// a bot shared after the phone loaded). Nothing said why; back home.
//
// Now the rule is the bot's own (`BotThreadAvailability`): its selected
// thread always opens. A thread the bot no longer has lands on the bot's
// current one. A missing bot or a missing thread of yours asks the server
// again (the bot list starts the person's own thread), and only then says
// so here, with Try again and Back, never silently.
import SwiftUI
import CompanionCore

extension ChatView {
    /// The chat, or why it cannot be shown, or a short check while the
    /// server is asked again.
    @ViewBuilder
    var openContent: some View {
        if let problem = openProblem {
            ChatOpenProblemView(
                problem: problem,
                name: chat.name,
                showsBack: desktopChat == nil,
                retry: retryOpen,
                back: { dismiss() }
            )
        } else if selectedThreadWasRemoved {
            ChatOpenProblemView(
                problem: nil,
                name: chat.name,
                showsBack: desktopChat == nil,
                retry: retryOpen,
                back: { dismiss() }
            )
        } else {
            layout
        }
    }

    /// Settle what this bot chat shows before loading it. True when the
    /// thread can be shown now; false when the screen moved to another
    /// thread (the task runs again for it) or explains why it cannot.
    func resolveOpenThread() async -> Bool {
        while let availability = threadAvailability {
            switch BotThreadAvailability.step(for: availability, checked: openChecked) {
            case .show:
                openProblem = nil
                return true
            case let .select(threadId):
                // The thread is gone: the bot's current one, as a thread
                // chip does, rather than nowhere.
                selectedThreadId = threadId
                return false
            case .reload:
                openChecked = true
                await session.reloadConversations()
                if Task.isCancelled { return false }
            case .explain:
                openProblem = availability
                return false
            }
        }
        return true
    }

    /// The thread on screen left the state: leave only once the server
    /// agrees. A thread that is back (or the bot's, after all) stays.
    func confirmRemoval() async {
        await session.reloadConversations()
        guard !Task.isCancelled, let availability = threadAvailability, !availability.isOpen else { return }
        if case let .moved(current) = availability, desktopChat != nil {
            // the iPad's column has nowhere to go back to
            selectedThreadId = current
            return
        }
        dismiss()
    }

    /// Try again: forget the last answer and run the opening once more.
    func retryOpen() {
        openProblem = nil
        openChecked = false
        openAttempt += 1
    }
}

/// Why a bot chat cannot be opened, in words, with what to do about it.
/// `problem` nil: the server is being asked again.
struct ChatOpenProblemView: View {
    @Environment(\.themePalette) var themePalette
    let problem: BotThreadAvailability?
    let name: String
    let showsBack: Bool
    let retry: () -> Void
    let back: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                if showsBack {
                    GlassCircleButton(systemImage: "chevron.left", accessibilityLabel: "Back", action: back)
                        .accessibilityIdentifier("open-problem-back-chevron")
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 18)
            .padding(.top, 6)
            .frame(height: ChatView.topBarHeight)

            Spacer(minLength: 0)
            content
                .padding(.horizontal, 32)
                .frame(maxWidth: 420)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden(true)
        .background(SwipeBackBridge())
    }

    @ViewBuilder
    private var content: some View {
        if let problem {
            VStack(spacing: 14) {
                Image(systemName: "exclamationmark.bubble")
                    .font(.system(size: 34, weight: .regular))
                    .foregroundStyle(Theme.warning)
                    .accessibilityHidden(true)
                Text(title(problem))
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .multilineTextAlignment(.center)
                Text(detail(problem))
                    .font(.subheadline)
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                VStack(spacing: 10) {
                    Button(action: retry) {
                        Label("Try again", systemImage: "arrow.clockwise")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .accessibilityIdentifier("open-problem-retry")
                    if showsBack {
                        Button(action: back) {
                            Text("Back to bots").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                        .accessibilityIdentifier("open-problem-back")
                    }
                }
                .padding(.top, 8)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("open-problem")
        } else {
            VStack(spacing: 12) {
                ProgressView()
                Text("Opening \(name)…")
                    .font(.subheadline)
                    .foregroundStyle(Theme.textSecondary)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("open-checking")
        }
    }

    private func title(_ problem: BotThreadAvailability) -> String {
        switch problem {
        case .botMissing: String(localized: "\(name) is not available")
        default: String(localized: "This conversation can't be opened")
        }
    }

    private func detail(_ problem: BotThreadAvailability) -> String {
        switch problem {
        case .botMissing:
            String(localized: "The server no longer lists this bot for you. It may have been deleted, or your access changed.")
        default:
            String(localized: "The server has no conversation of yours with \(name) yet. Try again to start one, or check your access on your computer.")
        }
    }
}
