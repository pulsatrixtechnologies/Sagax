// Find in this conversation (feature parity matrix MS11): the thread-scoped
// search the desktop's find bar asks for (src/components/ChatFindBar.tsx).
import Foundation

extension CompanionClient {
    /// `GET /api/search?q=&limit=100&threadId=`: matches in one thread only.
    public func search(_ query: String, threadId: String, limit: Int = FindInConversation.limit) async throws -> [SearchHit] {
        try await send(findRequest(query, threadId: threadId, limit: limit), as: SearchResponse.self).hits
    }

    func findRequest(_ query: String, threadId: String, limit: Int = FindInConversation.limit) throws -> URLRequest {
        try makeRequest("GET", "/api/search", query: [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "threadId", value: threadId),
        ])
    }
}
