// Rooms (matrix WP11): the requests behind the Room info sheet and the room
// row menu, each the one the desktop sends (src/state/store.tsx
// `patchGroup` / `deleteGroup`, src/lib/group-memory.ts, GroupPeoplePicker).
// Both gates pass them for the pairings that draw them: companion `ALLOWED`
// (PATCH a room, GET/PUT its memory) and server `CLIENT_ALLOW` (PATCH,
// DELETE, memory, the organization directory).
import Foundation

private struct GroupMemoryBody: Encodable {
    var text: String?
    var expectedHash: String?
    var enabled: Bool?
}

public extension CompanionClient {
    // MARK: Patch and delete

    func patchRoomRequest(groupId: String, patch: RoomPatch) throws -> URLRequest {
        guard Self.validRouteID(groupId) else { throw APIError.badURL }
        return try makeRequest("PATCH", "/api/groups/\(groupId)", encodedBody: patch)
    }

    /// `patchGroup`: the room as the computer kept it.
    func patchRoom(groupId: String, patch: RoomPatch) async throws -> Room {
        try await send(patchRoomRequest(groupId: groupId, patch: patch), as: GroupResponse.self).group
    }

    func deleteRoomRequest(groupId: String) throws -> URLRequest {
        guard Self.validRouteID(groupId) else { throw APIError.badURL }
        return try makeRequest("DELETE", "/api/groups/\(groupId)")
    }

    /// `deleteGroup`: the room, its messages and threads; its bots stay.
    func deleteRoom(groupId: String) async throws {
        try await send(deleteRoomRequest(groupId: groupId))
    }

    // MARK: Memory

    func groupMemoryRequest(groupId: String) throws -> URLRequest {
        guard Self.validRouteID(groupId) else { throw APIError.badURL }
        return try makeRequest("GET", "/api/groups/\(groupId)/memory")
    }

    func groupMemory(groupId: String) async throws -> GroupMemoryView {
        try await send(groupMemoryRequest(groupId: groupId), as: GroupMemoryView.self)
    }

    func saveGroupMemoryRequest(groupId: String, text: String? = nil, expectedHash: String? = nil, enabled: Bool? = nil) throws -> URLRequest {
        guard Self.validRouteID(groupId) else { throw APIError.badURL }
        return try makeRequest(
            "PUT", "/api/groups/\(groupId)/memory",
            encodedBody: GroupMemoryBody(text: text, expectedHash: expectedHash, enabled: enabled)
        )
    }

    /// The owner's edit (`{text, expectedHash}`), overwrite (`{text}`) or
    /// switch (`{enabled}`). A 409 is `GroupMemoryConflict`.
    func saveGroupMemory(groupId: String, text: String? = nil, expectedHash: String? = nil, enabled: Bool? = nil) async throws -> GroupMemoryView {
        do {
            return try await send(
                saveGroupMemoryRequest(groupId: groupId, text: text, expectedHash: expectedHash, enabled: enabled),
                as: GroupMemoryView.self
            )
        } catch let APIError.status(code, _) where code == 409 {
            throw GroupMemoryConflict()
        }
    }

    // MARK: People (organization server)

    func orgDirectoryRequest() throws -> URLRequest {
        try makeRequest("GET", "/api/org/directory")
    }

    func orgDirectory() async throws -> OrgDirectory {
        try await send(orgDirectoryRequest(), as: OrgDirectory.self)
    }
}
