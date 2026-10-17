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

/// Whether a bot conversation can be shown, by the same rule the bot uses to
/// project a thread (`Bot.projected(forThread:)`): a thread in its list, or
/// the thread it currently has selected, listed or not.
///
/// Bug 2026-10-16 (iOS 0.5.9 to 0.5.11, "a thread cannot be opened"): the
/// screen asked for the thread in the bot's list only. An organization
/// server can send a bot whose selected thread is the viewer's own while
/// its list leaves that thread out (a stream frame narrowed for the viewer,
/// an AI client's hidden conversation they opened), or no thread of the
/// viewer's at all (`threadId` empty). The tap pushed the chat and the
/// chat closed itself on its first frame: no request, no word, back home.
public enum BotThreadAvailability: Equatable, Sendable {
    /// The thread can be shown.
    case open
    /// The thread is not the bot's any more; `current` is the one it has.
    case moved(current: String)
    /// The bot is not in the state.
    case botMissing
    /// The bot is there, with no thread this person may open.
    case noThread

    public var isOpen: Bool { self == .open }

    public static func of(botId: String, threadId: String, in state: CompanionState) -> BotThreadAvailability {
        guard let live = state.bot(botId) else { return .botMissing }
        if !threadId.isEmpty, live.projected(forThread: threadId) != nil { return .open }
        return live.threadId.isEmpty ? .noThread : .moved(current: live.threadId)
    }

    /// What a just-opened bot chat should do: show, move to the bot's own
    /// thread, or ask the server again before saying anything. `checked`
    /// is true once the bots were reloaded from the server for this open.
    public static func step(for availability: BotThreadAvailability, checked: Bool) -> OpenStep {
        switch availability {
        case .open: return .show
        case let .moved(current): return .select(current)
        case .botMissing, .noThread: return checked ? .explain : .reload
        }
    }
}

/// The next step for a bot chat being opened (`BotThreadAvailability.step`).
public enum OpenStep: Equatable, Sendable {
    case show
    /// Land on this thread of the same bot instead (deleted or not listed).
    case select(String)
    /// Reload the bots from the server, then decide again.
    case reload
    /// Still not openable after a reload: say why, with Try again and Back.
    case explain
}
