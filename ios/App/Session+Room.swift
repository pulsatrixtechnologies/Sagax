// Rooms (matrix package WP11): the writes behind the Room info sheet and the
// room row menu. Each mirrors one desktop store action (src/state/store.tsx
// `patchGroup`, `deleteGroup`) or panel call (GroupMemoryTab,
// GroupPeoplePicker) and folds the computer's answer into the state. A
// failure leaves its sentence in `actionError` for the caller to show.
import CompanionCore
import Foundation

extension Session {
    /// Who the room rules judge: the signed-in person.
    var roomViewer: RoomViewer { RoomViewer(account: account) }

    /// What the Room info sheet may offer for this room on this pairing.
    func roomAccess(_ room: Room) -> RoomInfoAccess {
        RoomInfoAccess(room: room, gate: surfaceGate, viewer: roomViewer, bots: state.bots)
    }

    /// `patchGroup`: true when the computer kept it.
    @discardableResult
    func patchRoom(_ room: Room, _ patch: RoomPatch) async -> Bool {
        guard let client = settingsClient else { return false }
        do {
            applyRoom(try await client.patchRoom(groupId: room.id, patch: patch))
            return true
        } catch {
            actionError = error.localizedDescription
            return false
        }
    }

    /// `deleteGroup`: the room, its messages and threads go; its bots stay.
    func deleteRoom(_ room: Room) async -> Bool {
        guard let client = settingsClient else { return false }
        do {
            try await client.deleteRoom(groupId: room.id)
            applyRoomDeleted(room.id)
            return true
        } catch {
            actionError = error.localizedDescription
            return false
        }
    }

    func roomMemory(_ room: Room) async throws -> GroupMemoryView {
        guard let client = settingsClient else { throw APIError.transport(String(localized: "Not connected")) }
        return try await client.groupMemory(groupId: room.id)
    }

    func saveRoomMemory(_ room: Room, text: String? = nil, expectedHash: String? = nil, enabled: Bool? = nil) async throws -> GroupMemoryView {
        guard let client = settingsClient else { throw APIError.transport(String(localized: "Not connected")) }
        return try await client.saveGroupMemory(groupId: room.id, text: text, expectedHash: expectedHash, enabled: enabled)
    }

    /// The organization's people, for the people picker; empty on failure
    /// (the desktop's `useOrgDirectory`).
    func orgDirectory() async -> OrgDirectory {
        guard let client = settingsClient else { return OrgDirectory(people: []) }
        return (try? await client.orgDirectory()) ?? OrgDirectory(people: [])
    }
}
