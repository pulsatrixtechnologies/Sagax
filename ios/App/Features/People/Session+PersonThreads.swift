// Threads in a conversation between two people (#262): the writes a bot's
// thread menu has and a room's had not (archive, snooze), and the people a
// room's "@" offers (#274). PersonThreads.swift holds the rules.
import CompanionCore
import Foundation

extension Session {
    /// Archive or restore a thread of a person's conversation.
    @discardableResult
    func setPersonThreadArchived(_ task: BotTask, in room: Room, archived: Bool) async -> Bool {
        guard let client = settingsClient else { return false }
        if archived, task.isWorking {
            actionError = String(localized: "This thread can't be archived while it's working.")
            return false
        }
        // The desktop sends Date.now(); the server takes any epoch number.
        let stamp: Double? = archived ? (Date().timeIntervalSince1970 * 1000).rounded() : nil
        do {
            try await client.patchRoomTask(groupId: room.id, threadId: task.threadId, archivedAt: .some(stamp))
            await refresh()
            return true
        } catch {
            actionError = error.localizedDescription
            return false
        }
    }

    /// Snooze (`until` in ms, 0 until new activity) or wake (nil) a thread
    /// of a person's conversation.
    @discardableResult
    func snoozePersonThread(_ task: BotTask, in room: Room, until: Double?) async -> Bool {
        guard let client = settingsClient else { return false }
        do {
            try await client.patchRoomTask(groupId: room.id, threadId: task.threadId, snoozedUntil: .some(until))
            await refresh()
            return true
        } catch {
            actionError = error.localizedDescription
            return false
        }
    }
}

/// The people of a room the "@" strip offers (#274): everyone in it but the
/// viewer, by their directory name. A tag notifies them like a direct message.
@MainActor
enum PersonMentions {
    static func people(in chat: Chat, session: Session) -> [MentionChoice] {
        guard case let .room(room) = chat, room.peopleDm != true, room.dm != true else { return [] }
        let me = session.roomViewer.actorId.lowercased()
        let directory = PeopleDirectory.shared.directory
        return (room.humanIds ?? []).compactMap { id in
            guard id.lowercased() != me else { return nil }
            let name = People.label(directory?.person(id), fallback: "")
            guard !name.isEmpty else { return nil }
            return MentionChoice(id: id, name: name, isPerson: true)
        }
    }
}
