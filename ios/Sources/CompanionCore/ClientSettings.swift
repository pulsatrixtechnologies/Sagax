import Foundation

// Client calls for the Settings sheet, Account, Bot Computer and Plugins
// (iOS parity 12, 14, 15, 16, 21). Routes and payloads:
// docs/ios-companion.md "Visual parity routes". Which of them a paired phone
// may reach is the server's call; a refusal surfaces as `APIError.status`
// with the server's own sentence.
public extension CompanionClient {
    // MARK: Account

    /// `GET /api/auth/session`, read for the account card.
    func accountIdentity() async throws -> AccountIdentity {
        try await send(makeRequest("GET", "/api/auth/session"), as: AccountIdentity.self)
    }

    /// `DELETE /api/me` with the confirmation. A personal computer answers
    /// 400 `personal_server`; an organization server whose Perspicax cannot
    /// delete accounts yet answers 501 `perspicax_deletion_unavailable`.
    func deleteAccount() async throws -> AccountDeletionOutcome {
        let (data, response) = try await perform(deleteAccountRequest())
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            let body = try? JSONDecoder().decode(APIErrorWithCode.self, from: data)
            switch (http.statusCode, body?.code) {
            case (400, "personal_server"): return .personalServer
            case (501, _), (_, "perspicax_deletion_unavailable"): return .unavailable(body?.error)
            default: throw APIError.status(code: http.statusCode, message: body?.error)
            }
        }
        return .deleted
    }

    // MARK: Bot settings

    /// `GET /api/settings/bot`.
    func botSettings() async throws -> BotSettingsResponse {
        try await send(makeRequest("GET", "/api/settings/bot"), as: BotSettingsResponse.self)
    }

    /// `PUT /api/settings/bot` with only the fields set.
    func updateBotSettings(_ patch: BotSettingsPatch) async throws -> BotSettingsResponse {
        try await send(updateBotSettingsRequest(patch), as: BotSettingsResponse.self)
    }

    /// `GET /api/auto-review/rules`.
    func autoReviewRules() async throws -> AutoReviewRules {
        try await send(makeRequest("GET", "/api/auto-review/rules"), as: AutoReviewRules.self)
    }

    /// `DELETE /api/auto-review/rules/:id`: the list without that rule.
    func deleteAutoReviewRule(id: String) async throws -> AutoReviewRules {
        try await send(deleteAutoReviewRuleRequest(id: id), as: AutoReviewRules.self)
    }

    // MARK: Bot computer

    /// `GET /api/computer/status`.
    func computerStatus() async throws -> ComputerStatus {
        try await send(makeRequest("GET", "/api/computer/status"), as: ComputerStatus.self)
    }

    /// `POST /api/computer/update`: rebuilds from the latest image, keeps files.
    func updateComputer() async throws -> ComputerStatus {
        try await send(makeRequest("POST", "/api/computer/update", encodedBody: EmptyJSONBody()), as: ComputerStatus.self)
    }

    /// `POST /api/computer/reset` with the required confirmation.
    func resetComputer() async throws -> ComputerStatus {
        try await send(makeRequest("POST", "/api/computer/reset", encodedBody: ConfirmBody()), as: ComputerStatus.self)
    }

    // MARK: Plugins

    /// `GET /api/plugins/search?q=&cursor=`.
    func searchPlugins(query: String = "", cursor: String? = nil) async throws -> PluginSearchPage {
        try await send(searchPluginsRequest(query: query, cursor: cursor), as: PluginSearchPage.self)
    }

    /// `GET /api/plugins/installed`.
    func installedPlugins() async throws -> InstalledPlugins {
        try await send(makeRequest("GET", "/api/plugins/installed"), as: InstalledPlugins.self)
    }

    /// `POST /api/plugins/install`. With a sign-in to run, the answer carries
    /// the authorization URL for `returnTo`.
    func installPlugin(id: String, trust: Bool = false, returnTo: String? = PluginSignIn.returnTo) async throws -> PluginInstallResult {
        try await send(installPluginRequest(id: id, trust: trust, returnTo: returnTo), as: PluginInstallResult.self)
    }

    /// `POST /api/mcp/servers/:name/oauth/start` for a server already added.
    func startPluginSignIn(serverName: String) async throws -> URL {
        struct Started: Decodable { var authorizationUrl: String? }
        let started = try await send(startPluginSignInRequest(serverName: serverName), as: Started.self)
        guard let url = started.authorizationUrl.flatMap(URL.init(string:)) else { throw APIError.transport("The server did not start a sign-in.") }
        return url
    }

    // MARK: Request builders (tested without a network)

    func deleteAccountRequest() throws -> URLRequest {
        try makeRequest("DELETE", "/api/me", encodedBody: ConfirmBody())
    }

    func updateBotSettingsRequest(_ patch: BotSettingsPatch) throws -> URLRequest {
        guard !patch.isEmpty else { throw APIError.badURL }
        return try makeRequest("PUT", "/api/settings/bot", encodedBody: patch)
    }

    func deleteAutoReviewRuleRequest(id: String) throws -> URLRequest {
        // `cmd.<botId>.<ruleId>`: word characters, dashes and dots only.
        guard !id.isEmpty, id.count <= 300,
              id.unicodeScalars.allSatisfy({ CharacterSet.alphanumerics.contains($0) || "._-".unicodeScalars.contains($0) })
        else { throw APIError.badURL }
        return try makeRequest("DELETE", "/api/auto-review/rules/\(id)")
    }

    func searchPluginsRequest(query: String, cursor: String?) throws -> URLRequest {
        var items: [URLQueryItem] = []
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { items.append(URLQueryItem(name: "q", value: String(trimmed.prefix(100)))) }
        if let cursor, !cursor.isEmpty { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try makeRequest("GET", "/api/plugins/search", query: items)
    }

    func installPluginRequest(id: String, trust: Bool, returnTo: String?) throws -> URLRequest {
        guard !id.isEmpty, id.count <= 300 else { throw APIError.badURL }
        let origin = returnTo == nil ? nil : PluginSignIn.callbackOrigin(for: connection)
        return try makeRequest("POST", "/api/plugins/install", encodedBody: PluginInstallBody(
            id: id, trust: trust ? true : nil, returnTo: returnTo, callbackOrigin: origin
        ))
    }

    func startPluginSignInRequest(serverName: String) throws -> URLRequest {
        guard Self.validRouteID(serverName) else { throw APIError.badURL }
        return try makeRequest("POST", "/api/mcp/servers/\(serverName)/oauth/start", encodedBody: OAuthStartBody(
            returnTo: PluginSignIn.returnTo, callbackOrigin: PluginSignIn.callbackOrigin(for: connection)
        ))
    }
}
