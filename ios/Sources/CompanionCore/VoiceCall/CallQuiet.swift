// While a conversation is on a live call, it does not also buzz: the person
// hears the bot, so a banner, a sound or a lock-screen alert for that same
// thread is noise (the desktop never notifies for the conversation on screen,
// and stands auto-speak down for the bot on a call). The call registers its
// thread here; the notification layer asks before delivering or presenting.
// Other conversations still notify as usual.
import Foundation

public final class CallQuiet: @unchecked Sendable {
    public static let shared = CallQuiet()

    private let lock = NSLock()
    private var threads: Set<String> = []

    public init() {}

    /// The call on this thread started (true) or ended (false).
    public func set(_ threadId: String, live: Bool) {
        lock.lock()
        defer { lock.unlock() }
        if live { threads.insert(threadId) } else { threads.remove(threadId) }
    }

    /// True when a notification for this thread must stay quiet.
    public func silences(threadId: String?) -> Bool {
        guard let threadId else { return false }
        lock.lock()
        defer { lock.unlock() }
        return threads.contains(threadId)
    }
}
