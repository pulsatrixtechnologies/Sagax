// The bot row menu's writes the home did not have yet (Sidebar.tsx
// `archiveBot`, `undoBotArchive`, the rename and the delete), and the room
// working folder of the Room sheet's Advanced tab (GroupView.tsx
// `RoomWorkingFolder`).
import CompanionCore
import Foundation

extension Session {
    /// Rename Bot: the desktop renames in place; here the same
    /// `PATCH /api/bots/:id/profile` as the profile's name field.
    @discardableResult
    func renameBot(_ bot: Bot, to draft: String) async -> Bool {
        let name = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name != bot.name else { return false }
        return await updateProfile(BotProfilePatch(name: String(name.prefix(100))), for: bot) != nil
    }

    /// Archive (`hidden: true`) or restore (`hidden: false`) a bot. Every
    /// conversation is kept; Archived bots in the account menu restores it.
    @discardableResult
    func setArchived(_ bot: Bot, archived: Bool) async -> Bool {
        guard let client = profileClient else { return false }
        do {
            applyProfileBot(try await client.patchBot(botId: bot.id, patch: BotPatch(hidden: archived)))
            return true
        } catch {
            actionError = error.localizedDescription
            return false
        }
    }

    /// Delete a bot and everything it keeps (`DELETE /api/bots/:id`).
    @discardableResult
    func deleteBot(_ bot: Bot) async -> Bool {
        guard let client = profileClient else { return false }
        do {
            try await client.deleteBot(botId: bot.id)
            applyBotDeleted(bot.id)
            return true
        } catch {
            actionError = error.localizedDescription
            return false
        }
    }

    /// The room's working folder; nil or blank is each bot's own.
    @discardableResult
    func setRoomFolder(_ room: Room, cwd: String?) async -> Bool {
        guard let client = settingsClient else { return false }
        do {
            applyRoom(try await client.setRoomFolder(groupId: room.id, cwd: cwd))
            return true
        } catch {
            actionError = error.localizedDescription
            return false
        }
    }
}
