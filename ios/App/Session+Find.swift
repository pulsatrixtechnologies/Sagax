// Find in this conversation (feature parity matrix WP4, MS11): the thread
// search behind the find bar and landing on a hit, as the desktop's
// ChatFindBar and `landOnSearchHit` (src/lib/focus-message.ts) do. The chat
// on screen already shows the hit's thread, so no task switch happens here;
// a hit off the active branch moves the branch first.
import CompanionCore
import Foundation

extension Session {
    /// `GET /api/search?q=&limit=100&threadId=`. Throws so the bar can say
    /// "Search failed" instead of "No results".
    func find(_ query: String, inThread threadId: String) async throws -> [SearchHit] {
        guard let client = settingsClient else { throw APIError.transport(String(localized: "Search failed")) }
        return try await client.search(query, threadId: threadId)
    }

    /// Scroll the conversation to a hit: its branch made active when it is
    /// off the shown one, the page around it loaded, then focused.
    func land(on hit: SearchHit) async throws {
        guard let client = settingsClient else { throw APIError.transport(String(localized: "That message is unavailable")) }
        if !hit.onActivePath, let botId = hit.botId, state.bot(botId) != nil {
            // The hit is then outside the shown branch, so `jump` loads the
            // page around it, and that page carries the new active leaf.
            _ = try await client.setActiveBranch(botId: botId, messageId: hit.messageId, threadId: hit.threadId)
        }
        await jump(to: hit.messageId, inThread: hit.threadId)
    }
}
