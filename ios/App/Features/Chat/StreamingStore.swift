// The reply as it streams, kept apart from the rest of the session.
//
// `Session.state` is still the one fold (CompanionCore's `CompanionState`):
// every `content.delta` lands there, synchronously, as before. What changed
// is who hears about it. A token used to publish the whole session, so every
// view holding `@EnvironmentObject var session` (the chat, each message row,
// the home underneath it) rebuilt once per token. Now a token is folded
// quietly and announced at most once per display frame, and only to this
// store and to the code that subscribes to `Session.statePublisher`. The
// views that draw live text in a chat (the streaming bubble, the scroll
// follow, a call's card) observe this store. With no chat on screen the
// session still publishes once per frame, for the home's Updates pill.
import SwiftUI
import UIKit

/// The live answer and reasoning per thread, mirrored from `CompanionState`.
@MainActor
final class StreamingStore: ObservableObject {
    @Published private(set) var text: [String: String] = [:]
    @Published private(set) var reasoning: [String: String] = [:]

    /// Copy the fold's live text. Assigns only what changed, so a frame that
    /// touched neither (a presence ping, a read receipt) publishes nothing.
    func sync(text: [String: String], reasoning: [String: String]) {
        if self.text != text { self.text = text }
        if self.reasoning != reasoning { self.reasoning = reasoning }
    }
}

/// Runs an action at most once per display frame, on the frame after the
/// first request. Driven by `CADisplayLink`, so it follows the screen: 120 Hz
/// on a ProMotion iPhone, 60 Hz elsewhere, slower when the system throttles.
/// The link is paused between bursts and costs nothing while nothing streams.
///
/// A display link does not fire while the app is in the background or the
/// screen is locked, which is exactly when a voice call still needs every
/// token: outside the foreground the action runs immediately instead.
@MainActor
final class FrameCoalescer {
    private let action: () -> Void
    private var link: CADisplayLink?

    init(_ action: @escaping () -> Void) {
        self.action = action
    }

    func request() {
        guard UIApplication.shared.applicationState == .active else {
            link?.isPaused = true
            action()
            return
        }
        if let link {
            link.isPaused = false
            return
        }
        let link = CADisplayLink(target: Target(owner: self), selector: #selector(Target.tick))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 120, preferred: 120)
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    fileprivate func tick() {
        link?.isPaused = true
        action()
    }

    deinit {
        link?.invalidate()
    }

    /// The display link retains its target; this keeps it from retaining
    /// the coalescer.
    private final class Target: NSObject {
        weak var owner: FrameCoalescer?
        init(owner: FrameCoalescer) { self.owner = owner }
        @objc func tick() {
            MainActor.assumeIsolated { owner?.tick() }
        }
    }
}

/// Calls `grew` each time a thread's live answer gets longer, from a view that
/// observes the store instead of the screen that owns the scroll position.
struct LiveStreamFollower: View {
    @ObservedObject var store: StreamingStore
    let threadId: String
    let grew: (Int) -> Void

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
            .onValueChange(of: store.text[threadId]?.count ?? 0) { length in
                grew(length)
            }
    }
}

/// The chat composer's text, observed only by the composer (`composerSlot`).
@MainActor
final class ComposerDraftModel: ObservableObject {
    @Published var text = ""
}

/// Re-renders its content, and only its content, when `model` publishes.
struct ObservingView<Model: ObservableObject, Content: View>: View {
    @ObservedObject var model: Model
    @ViewBuilder let content: () -> Content

    var body: some View { content() }
}
