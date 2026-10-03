// What a transcript row needs from the conversation around it to offer the
// message actions (WP1), handed down through the environment so every place
// that draws a `MessageRow` (the transcript, a folded assistant turn, the
// iPad's desktop chat later) gets the same behaviour without new parameters.
import SwiftUI
import CompanionCore

struct MessageActionContext {
    /// Start a reply to this message (quote strip above the composer).
    var reply: ((Message) -> Void)?
    /// Scroll the conversation to a message (reply quote, pinned banner).
    var jump: ((String) -> Void)?
    /// A message of this conversation by id, for the quote in a bubble.
    var lookup: (String) -> Message? = { _ in nil }
    /// The newest bot text line, when Regenerate may run on it now.
    var regenerableMessageId: String?
    /// The pinned message of the shown conversation.
    var pinnedMessageId: String?
    /// Names an @mention may tint, and whether @everyone counts (rooms).
    var mentionPeers: [MentionPeer] = []
    var mentionEveryone = false
}

private struct MessageActionContextKey: EnvironmentKey {
    static let defaultValue = MessageActionContext()
}

extension EnvironmentValues {
    var messageActions: MessageActionContext {
        get { self[MessageActionContextKey.self] }
        set { self[MessageActionContextKey.self] = newValue }
    }
}
