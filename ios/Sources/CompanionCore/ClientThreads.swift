import Foundation

// Client calls for threads and folders (matrix package WP5), the same
// routes and bodies the desktop store sends (src/state/store.tsx:
// createProject, updateProject, deleteProject, reorderProjects,
// regenerateTaskTitle, updateTask {projectId}, markUnread, newTask
// {projectId}). Folder writes pass the sidecar (companion/src/routes.ts)
// and an admin server session; a client session gets the server's refusal.

/// `POST /api/bots/:id/projects` answers the folder and the bot.
public struct CreatedFolder: Decodable, Sendable {
    public var project: BotProject
    public var bot: Bot
}

/// `GET /api/config`, only the switch that turns on generated titles. A
/// missing block means off, as on the desktop (`llmThreadTitlesEnabled`).
public struct ThreadTitleFeature: Decodable, Equatable, Sendable {
    struct Features: Decodable, Equatable, Sendable {
        var llmThreadTitles: Bool?
    }
    var features: Features?

    public var enabled: Bool { features?.llmThreadTitles == true }
}

/// The body of a folder edit. Name and emoji are both optional; an emoji
/// of JSON null resets the default icon, so it is encoded explicitly.
struct FolderPatchBody: Encodable {
    var name: String?
    var emoji: String??

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(name, forKey: .name)
        if let emoji {
            if let value = emoji { try container.encode(value, forKey: .emoji) }
            else { try container.encodeNil(forKey: .emoji) }
        }
    }

    enum CodingKeys: String, CodingKey { case name, emoji }
}

/// The body of a thread move: JSON null takes it out of every folder.
struct TaskFolderBody: Encodable {
    var projectId: String?

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        if let projectId { try container.encode(projectId, forKey: .projectId) }
        else { try container.encodeNil(forKey: .projectId) }
    }

    enum CodingKeys: String, CodingKey { case projectId }
}

public extension CompanionClient {
    // MARK: Folders (SB19, SB20)

    func createFolder(botId: String, name: String, emoji: String?) async throws -> CreatedFolder {
        try await send(createFolderRequest(botId: botId, name: name, emoji: emoji), as: CreatedFolder.self)
    }

    /// Rename a folder or change its icon. `emoji: .some(nil)` resets the
    /// default icon; `nil` leaves the icon alone.
    func updateFolder(botId: String, folderId: String, name: String?, emoji: String??) async throws -> Bot {
        try await send(updateFolderRequest(botId: botId, folderId: folderId, name: name, emoji: emoji), as: BotResponse.self).bot
    }

    /// The folder goes; its threads move out of it and keep their history.
    func deleteFolder(botId: String, folderId: String) async throws -> Bot {
        try await send(deleteFolderRequest(botId: botId, folderId: folderId), as: BotResponse.self).bot
    }

    /// Save the folder order. The server wants each of the bot's folders
    /// exactly once.
    func reorderFolders(botId: String, folderIds: [String]) async throws -> Bot {
        try await send(reorderFoldersRequest(botId: botId, folderIds: folderIds), as: BotResponse.self).bot
    }

    // MARK: Threads (TH3, TH5, SB14)

    /// Move a thread into a folder, or out of every folder with nil.
    func moveTask(botId: String, threadId: String, toFolder folderId: String?) async throws {
        try await send(moveTaskRequest(botId: botId, threadId: threadId, folderId: folderId))
    }

    /// Ask the bot's own engine for a new title. The server answers once the
    /// title is saved; the bot event carries it to every client.
    func regenerateTaskTitle(botId: String, threadId: String) async throws {
        try await send(regenerateTaskTitleRequest(botId: botId, threadId: threadId))
    }

    /// A new thread, filed in a folder when one is given.
    func createTask(botId: String, inFolder folderId: String?) async throws -> Bot {
        try await send(createTaskRequest(botId: botId, folderId: folderId), as: BotResponse.self).bot
    }

    /// The bot menu's "Mark as Unread": `PATCH /api/bots/:id {unread: true}`.
    func markUnread(botId: String) async throws {
        try await send(markUnreadRequest(botId: botId))
    }

    /// Whether this computer generates thread titles.
    func threadTitleFeature() async throws -> ThreadTitleFeature {
        try await send(makeRequest("GET", "/api/config"), as: ThreadTitleFeature.self)
    }

    // MARK: Request builders (tested without a network)

    func createFolderRequest(botId: String, name: String, emoji: String?) throws -> URLRequest {
        guard Self.validRouteID(botId), let name = FolderFields.name(name) else { throw APIError.badURL }
        return try makeRequest("POST", "/api/bots/\(botId)/projects", encodedBody: FolderPatchBody(name: name, emoji: .some(emoji)))
    }

    func updateFolderRequest(botId: String, folderId: String, name: String?, emoji: String??) throws -> URLRequest {
        guard Self.validRouteID(botId), Self.validRouteID(folderId) else { throw APIError.badURL }
        var body = FolderPatchBody(name: nil, emoji: emoji)
        if let name {
            guard let valid = FolderFields.name(name) else { throw APIError.badURL }
            body.name = valid
        }
        guard body.name != nil || body.emoji != nil else { throw APIError.badURL }
        return try makeRequest("PATCH", "/api/bots/\(botId)/projects/\(folderId)", encodedBody: body)
    }

    func deleteFolderRequest(botId: String, folderId: String) throws -> URLRequest {
        guard Self.validRouteID(botId), Self.validRouteID(folderId), folderId != "order" else { throw APIError.badURL }
        return try makeRequest("DELETE", "/api/bots/\(botId)/projects/\(folderId)")
    }

    func reorderFoldersRequest(botId: String, folderIds: [String]) throws -> URLRequest {
        guard Self.validRouteID(botId), Set(folderIds).count == folderIds.count else { throw APIError.badURL }
        return try makeRequest("PATCH", "/api/bots/\(botId)/projects/order", body: ["projectIds": folderIds])
    }

    func moveTaskRequest(botId: String, threadId: String, folderId: String?) throws -> URLRequest {
        guard Self.validRouteID(botId), Self.validRouteID(threadId) else { throw APIError.badURL }
        if let folderId, !Self.validRouteID(folderId) { throw APIError.badURL }
        return try makeRequest("PATCH", "/api/bots/\(botId)/tasks/\(threadId)", encodedBody: TaskFolderBody(projectId: folderId))
    }

    func regenerateTaskTitleRequest(botId: String, threadId: String) throws -> URLRequest {
        guard Self.validRouteID(botId), Self.validRouteID(threadId) else { throw APIError.badURL }
        return try makeRequest("POST", "/api/bots/\(botId)/tasks/\(threadId)/title")
    }

    func createTaskRequest(botId: String, folderId: String?) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        var body: [String: Any] = [:]
        if let folderId {
            guard Self.validRouteID(folderId) else { throw APIError.badURL }
            body["projectId"] = folderId
        }
        return try makeRequest("POST", "/api/bots/\(botId)/tasks", body: body)
    }

    func markUnreadRequest(botId: String) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try makeRequest("PATCH", "/api/bots/\(botId)", body: ["unread": true])
    }
}
