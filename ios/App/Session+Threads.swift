// Threads and folders (matrix package WP5): the writes behind the shared
// thread and folder menus. Each mirrors one desktop store action
// (src/state/store.tsx) and folds the computer's answer into the state, or
// refreshes when the route answers no bot. A failure leaves its sentence in
// `actionError` for the caller to show.
import CompanionCore
import Foundation

@MainActor
private var threadTitleFeatureByConnection: [String: Bool] = [:]

extension Session {
    private var threadsClient: CompanionClient? { settingsClient }

    private func fail(_ error: Error) {
        actionError = error.localizedDescription
    }

    /// Whether this computer generates thread titles (the desktop's
    /// `llmThreadTitlesEnabled`). Read once per pairing; off when unknown.
    func threadTitlesEnabled() async -> Bool {
        guard let client = threadsClient, let id = connection?.id else { return false }
        if let known = threadTitleFeatureByConnection[id] { return known }
        let enabled = (try? await client.threadTitleFeature().enabled) ?? false
        threadTitleFeatureByConnection[id] = enabled
        return enabled
    }

    // MARK: Threads

    /// TH3: the bot's own engine names the thread. The title arrives with
    /// the bot event; a refresh makes sure the list has it.
    func regenerateTitle(_ task: BotTask, for bot: Bot) async -> Bool {
        guard let client = threadsClient else { return false }
        do {
            try await client.regenerateTaskTitle(botId: bot.id, threadId: task.threadId)
            await refresh()
            return true
        } catch { fail(error); return false }
    }

    /// TH5: file a thread in a folder, or take it out with nil. The row
    /// moves at once and moves back if the computer refuses.
    func moveTask(_ task: BotTask, for bot: Bot, toFolder folderId: String?) async -> Bool {
        guard let client = threadsClient else { return false }
        let before = state.bot(bot.id)
        if var moved = before, let index = moved.tasks?.firstIndex(where: { $0.threadId == task.threadId }) {
            moved.tasks?[index].projectId = folderId
            applyProfileBot(moved)
        }
        do {
            try await client.moveTask(botId: bot.id, threadId: task.threadId, toFolder: folderId)
            await refresh()
            return true
        } catch {
            if var back = state.bot(bot.id), let index = back.tasks?.firstIndex(where: { $0.threadId == task.threadId }) {
                back.tasks?[index].projectId = task.projectId
                applyProfileBot(back)
            }
            fail(error)
            return false
        }
    }

    /// A new thread, filed in `folder` when given (the folder row's "+").
    func createTask(for bot: Bot, inFolder folder: BotProject?) async -> Bot? {
        guard let client = threadsClient else { return nil }
        do {
            let updated = try await client.createTask(botId: bot.id, inFolder: folder?.id)
            applyProfileBot(updated)
            return updated
        } catch { fail(error); return nil }
    }

    /// SB14: the bot menu's "Mark as Unread".
    func markUnread(_ bot: Bot) async -> Bool {
        guard let client = threadsClient else { return false }
        if var marked = state.bot(bot.id) {
            marked.unread = true
            applyProfileBot(marked)
        }
        do {
            try await client.markUnread(botId: bot.id)
            return true
        } catch {
            if var back = state.bot(bot.id) {
                back.unread = bot.unread
                applyProfileBot(back)
            }
            fail(error)
            return false
        }
    }

    // MARK: Folders

    /// SB19: a new folder; answers the folder so the caller can use it.
    func createFolder(for bot: Bot, name: String, emoji: String?) async -> BotProject? {
        guard let client = threadsClient else { return nil }
        do {
            let created = try await client.createFolder(botId: bot.id, name: name, emoji: emoji)
            applyProfileBot(created.bot)
            return created.project
        } catch { fail(error); return nil }
    }

    /// SB19: rename a folder or change its icon (`emoji: .some(nil)`
    /// resets the default icon).
    func updateFolder(_ folder: BotProject, for bot: Bot, name: String?, emoji: String??) async -> Bool {
        guard let client = threadsClient else { return false }
        do {
            applyProfileBot(try await client.updateFolder(botId: bot.id, folderId: folder.id, name: name, emoji: emoji))
            return true
        } catch { fail(error); return false }
    }

    /// SB19: the folder goes, its threads stay (out of any folder).
    func deleteFolder(_ folder: BotProject, for bot: Bot) async -> Bool {
        guard let client = threadsClient else { return false }
        do {
            applyProfileBot(try await client.deleteFolder(botId: bot.id, folderId: folder.id))
            return true
        } catch { fail(error); return false }
    }

    /// SB20: save a new folder order (each of the bot's folders once).
    func reorderFolders(for bot: Bot, ids: [String]) async -> Bool {
        guard let client = threadsClient else { return false }
        guard ids != bot.folders.map(\.id) else { return true }
        do {
            applyProfileBot(try await client.reorderFolders(botId: bot.id, folderIds: ids))
            return true
        } catch { fail(error); return false }
    }

    /// The folder menu's "Mark folder as read" (src/lib/folder-read.ts):
    /// one read per unread thread, in order, keeping what already landed.
    func markFolderRead(_ folder: BotProject, for bot: Bot) async -> Bool {
        guard let client = threadsClient else { return false }
        let threads = (state.bot(bot.id) ?? bot).folderUnreadThreadIds(folder.id)
        do {
            for threadId in threads {
                try await client.markRead(botId: bot.id, threadId: threadId)
            }
            await refresh()
            return true
        } catch {
            fail(error)
            await refresh()
            return false
        }
    }
}
