// The conversation open on screen must still exist and still be listed
// (bug 2026-10-15, the desktop's src/lib/selection-fallback.ts): a room
// deleted on the server, or a conversation the person closes or hides
// while it is open, leaves the screen instead of staying with a composer
// that would write into it.
import Foundation

public enum OpenConversation {
    /// Whether the open chat's bot or room is still in the state.
    public static func present(_ chat: Chat, in state: CompanionState) -> Bool {
        switch chat {
        case let .bot(bot): return state.bots.contains { $0.id == bot.id }
        case let .room(room): return state.rooms.contains { $0.id == room.id }
        }
    }

    /// Whether `next` hides the open chat and `previous` did not: the person
    /// just closed or hid it, here or on another device. A direct
    /// conversation is hidden as either member of the pair (the viewer
    /// never hides themself), any other room by its id.
    public static func newlyHidden(_ chat: Chat, previous: SidebarHidden, next: SidebarHidden) -> Bool {
        hidden(chat, by: next.keys) && !hidden(chat, by: previous.keys)
    }

    static func hidden(_ chat: Chat, by keys: Set<String>) -> Bool {
        switch chat {
        case let .bot(bot):
            return keys.contains(SidebarHidden.key(.bot, bot.id))
        case let .room(room):
            if keys.contains(SidebarHidden.key(.group, room.id)) { return true }
            guard room.peopleDm == true else { return false }
            return (room.humanIds ?? []).contains { keys.contains(SidebarHidden.key(.person, $0)) }
        }
    }
}
