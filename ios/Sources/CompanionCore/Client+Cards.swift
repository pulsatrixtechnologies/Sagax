// The interactive cards' requests (feature parity package WP2): the approval
// dock's answers, the option card's dismiss, the credential card's resume and
// dismiss, the connector card's authorize, status, resume and dismiss, and a
// parallel task's Stop. Each path is the one the desktop renderer calls and
// passes both gates (companion `ALLOWED`, server `CLIENT_ALLOW`); the server
// still decides who may (owner, admin) in its handlers.
import Foundation

private struct ConnectorCardAuthorization: Decodable { let url: String }

/// `GET .../connector-cards/:m/status`.
public struct ConnectorCardStatus: Decodable, Hashable, Sendable {
    public var connected: Bool
    public var pending: Bool?
    public var status: String?
}

extension CompanionClient {
    /// One dock answer: `always` keeps a provider's allow for its session,
    /// `rememberCommand` saves the exact command (owner or admin).
    @discardableResult
    public func respond(threadId: String, decision: ApprovalDecision) async throws -> String? {
        var body: [String: Any] = ["requestId": decision.requestId, "behavior": decision.behavior]
        if let message = decision.message { body["message"] = message }
        if let hash = decision.reviewedSha256 { body["reviewedSha256"] = hash }
        if decision.always { body["always"] = true }
        if decision.rememberCommand { body["rememberCommand"] = true }
        let (data, response) = try await perform(try makeRequest("POST", "/api/threads/\(threadId)/respond", body: body))
        try Self.check(response, data)
        struct Outcome: Decodable { let outcome: String? }
        return (try? JSONDecoder().decode(Outcome.self, from: data))?.outcome
    }

    /// A first-run option card put away (`PATCH /api/bots/:id/cards/:m`).
    public func dismissCard(botId: String, messageId: String) async throws {
        try await send(try makeRequest("PATCH", "/api/bots/\(botId)/cards/\(messageId)", body: ["dismissed": true]))
    }

    /// Stop one parallel task (`POST /api/bots/:id/parallel/:t/stop`).
    public func stopParallelTask(botId: String, threadId: String) async throws {
        guard Self.validRouteID(botId), Self.validRouteID(threadId) else { throw APIError.badURL }
        try await send(try makeRequest("POST", "/api/bots/\(botId)/parallel/\(threadId)/stop", body: [:]))
    }

    /// Stop a room's running turn (the dock's "Cancel turn" in a room).
    public func cancelRoomTurn(groupId: String) async throws {
        guard Self.validRouteID(groupId) else { throw APIError.badURL }
        try await send(try makeRequest("POST", "/api/groups/\(groupId)/interrupt", body: [:]))
    }

    // MARK: Credential card

    /// The task waiting on a credential: resume it after the key was saved
    /// or declined and resuming failed ("Try again").
    public func resumeSecretCard(botId: String, messageId: String, threadId: String) async throws {
        try await send(try makeRequest(
            "POST", "/api/bots/\(botId)/secret-cards/\(messageId)/resume", body: ["threadId": threadId]
        ))
    }

    /// "Not now": continue without the credential.
    public func dismissSecretCard(botId: String, messageId: String, threadId: String) async throws {
        try await send(try makeRequest(
            "POST", "/api/bots/\(botId)/secret-cards/\(messageId)/dismiss", body: ["threadId": threadId]
        ))
    }

    // MARK: Connector card

    /// Start connecting the card's app: the computer marks the card
    /// authorizing and hands back the provider's sign-in page (HTTPS only),
    /// which the phone opens and never stores.
    public func authorizeConnectorCard(botId: String, messageId: String, threadId: String) async throws -> URL {
        let response = try await send(
            try makeRequest(
                "POST", "/api/bots/\(botId)/connector-cards/\(messageId)/authorize", body: ["threadId": threadId]
            ),
            as: ConnectorCardAuthorization.self
        )
        guard let url = URL(string: response.url), url.scheme == "https", url.host != nil else {
            throw APIError.badURL
        }
        return url
    }

    /// Ask the computer whether the app is connected yet. A connected card
    /// resumes the paused task on the computer's side.
    public func connectorCardStatus(botId: String, messageId: String, threadId: String) async throws -> ConnectorCardStatus {
        try await send(
            try makeRequest(
                "GET", "/api/bots/\(botId)/connector-cards/\(messageId)/status",
                query: [URLQueryItem(name: "threadId", value: threadId)]
            ),
            as: ConnectorCardStatus.self
        )
    }

    /// "Continue task" once every app of the request is connected.
    public func resumeConnectorCard(botId: String, messageId: String, threadId: String) async throws {
        try await send(try makeRequest(
            "POST", "/api/bots/\(botId)/connector-cards/\(messageId)/resume", body: ["threadId": threadId]
        ))
    }

    /// "Not now".
    public func dismissConnectorCard(botId: String, messageId: String, threadId: String) async throws {
        try await send(try makeRequest(
            "POST", "/api/bots/\(botId)/connector-cards/\(messageId)/dismiss", body: ["threadId": threadId]
        ))
    }
}
