// A draft another screen prepares for a conversation's composer, unsent:
// the bot panel's Tasks "Answer" leaves "About the task ...: " there. The
// chat showing that thread takes it once (on appear, on a thread change, or
// as soon as it is set while the chat is already on screen).
import CompanionCore
import Foundation

@MainActor
final class ComposerPrefill: ObservableObject {
    static let shared = ComposerPrefill()

    /// Per thread id, the text waiting for its composer.
    @Published private(set) var pending: [String: String] = [:]

    func set(_ text: String, threadId: String) {
        pending[threadId] = text
    }

    /// The draft for this thread, once.
    func take(threadId: String) -> String? {
        pending.removeValue(forKey: threadId)
    }
}
