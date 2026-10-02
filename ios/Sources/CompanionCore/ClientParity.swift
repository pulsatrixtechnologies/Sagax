import Foundation

// Client calls for the visual-parity screens, against routes the server
// already has. Which of them a paired phone may reach is the server's call
// (server/request-auth.ts CLIENT_ALLOW for a server-paired phone,
// companion/src/routes.ts for the desktop sidecar); a refused route surfaces
// as `APIError.status` with the server's own sentence.
public extension CompanionClient {
    // MARK: Bots

    /// `DELETE /api/bots/:id`. The server lets an organization member delete
    /// only a bot they own; an admin any.
    func deleteBot(botId: String) async throws {
        try await send(deleteBotRequest(botId: botId))
    }

    /// `PATCH /api/bots/:id` with the fields set in `patch`.
    func patchBot(botId: String, patch: BotPatch) async throws -> Bot {
        try await send(patchBotRequest(botId: botId, patch: patch), as: BotResponse.self).bot
    }

    /// Pin or unpin on the home row.
    func setPinned(botId: String, pinned: Bool) async throws -> Bot {
        try await patchBot(botId: botId, patch: BotPatch(pinned: pinned))
    }

    /// `GET /api/bots/:id/soul`: the bot's standing instructions.
    func soul(botId: String) async throws -> BotSoul {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(makeRequest("GET", "/api/bots/\(botId)/soul"), as: BotSoul.self)
    }

    /// `GET /api/bots/:id/command-allowlist`: the saved exact-command rules.
    func commandAllowlist(botId: String) async throws -> CommandAllowlist {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(makeRequest("GET", "/api/bots/\(botId)/command-allowlist"), as: CommandAllowlist.self)
    }

    // MARK: Thread files

    /// `GET /api/threads/:id/files`: newest first.
    func threadFiles(threadId: String) async throws -> [ThreadFile] {
        guard Self.validRouteID(threadId) else { throw APIError.badURL }
        return try await send(makeRequest("GET", "/api/threads/\(threadId)/files"), as: ThreadFilesResponse.self).files
    }

    /// The authenticated request for one file's bytes. `preview` asks for an
    /// inline image (the server refuses it for anything else).
    func threadFileRequest(threadId: String, fileId: String, preview: Bool) throws -> URLRequest {
        guard Self.validRouteID(threadId), Self.validThreadFileID(fileId) else { throw APIError.badURL }
        return try makeRequest(
            "GET",
            "/api/threads/\(threadId)/files/\(fileId)",
            query: preview ? [URLQueryItem(name: "preview", value: "1")] : []
        )
    }

    /// A thumbnail's or a file's bytes.
    func threadFileData(threadId: String, fileId: String, preview: Bool = true) async throws -> Data {
        let (data, response) = try await perform(threadFileRequest(threadId: threadId, fileId: fileId, preview: preview))
        try Self.check(response, data)
        return data
    }

    // MARK: Account and settings

    /// `GET /api/auth/session`.
    func authSession() async throws -> AuthSession {
        try await send(makeRequest("GET", "/api/auth/session"), as: AuthSession.self)
    }

    /// `GET /api/usage` for the current month. `budgetPercent` is nil when
    /// the server sets no budget.
    func usage() async throws -> UsageSummary {
        try await send(makeRequest("GET", "/api/usage"), as: UsageSummary.self)
    }

    /// `GET /api/me/preferences` (organization servers).
    func preferences() async throws -> UserPreferences {
        try await send(makeRequest("GET", "/api/me/preferences"), as: UserPreferences.self)
    }

    /// `PUT /api/me/preferences`: replaces the person's record with these keys.
    func putPreferences(_ preferences: [String: String]) async throws -> UserPreferences {
        try await send(
            makeRequest("PUT", "/api/me/preferences", encodedBody: UserPreferencesBody(preferences: preferences)),
            as: UserPreferences.self
        )
    }

    /// `GET /api/me/server-environment`.
    func serverEnvironment() async throws -> ServerEnvironmentStatus {
        try await send(makeRequest("GET", "/api/me/server-environment"), as: ServerEnvironmentStatus.self)
    }

    /// `POST /api/me/server-environment/reset` with the required confirmation.
    /// Erases `/workspace`; callers confirm with the person first.
    func resetServerEnvironment() async throws -> ServerEnvironmentStatus {
        try await send(
            makeRequest("POST", "/api/me/server-environment/reset", encodedBody: ServerEnvironmentResetBody()),
            as: ServerEnvironmentStatus.self
        )
    }

    /// `GET /api/mcp/servers`.
    func mcpServers() async throws -> MCPServersResponse {
        try await send(makeRequest("GET", "/api/mcp/servers"), as: MCPServersResponse.self)
    }

    // MARK: Routines

    /// One routine's run history, newest first. The server returns every
    /// run with the routines; the filter is local.
    func routineRuns(routineId: String) async throws -> [RoutineRun] {
        try await routines().runs.forRoutine(routineId)
    }

    // MARK: Request builders (tested without a network)

    func deleteBotRequest(botId: String) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try makeRequest("DELETE", "/api/bots/\(botId)")
    }

    func patchBotRequest(botId: String, patch: BotPatch) throws -> URLRequest {
        guard Self.validRouteID(botId), !patch.isEmpty else { throw APIError.badURL }
        return try makeRequest("PATCH", "/api/bots/\(botId)", encodedBody: patch)
    }
}

extension CompanionClient {
    /// The server's file ids are 24 lowercase hex characters.
    static func validThreadFileID(_ value: String) -> Bool {
        value.utf8.count == 24 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
}
