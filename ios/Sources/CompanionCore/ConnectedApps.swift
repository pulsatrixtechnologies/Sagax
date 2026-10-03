import Foundation

// Plugins on the phone (iOS parity matrix rows PL1, PL2, PL4, PL6-PL9): the
// rules of the desktop's Connected apps panel (src/components/PluginsPanel.tsx),
// its MCP servers tab read-only (McpServersPanel.tsx) and the person's own
// claude.ai connectors (HarnessConnectorsSection.tsx), so the phone decides
// exactly what the desktop decides. Which pairing sees what is SurfaceGate's.

// MARK: - Connected apps

/// Where the account inventory stands (`ConnectorInventoryPhase`).
public enum ConnectorInventoryPhase: Hashable, Sendable {
    case loading, ready, error
}

/// Marketplace / Connected, the panel's two views (PL2).
public enum ConnectorsTab: String, CaseIterable, Hashable, Sendable {
    case marketplace, connected
}

/// The label on a card's button (`connectorActionLabel`).
public enum ConnectorAction: Hashable, Sendable {
    case included, checking, unavailable, continueSetup, checkStatus, addAccount, retry, connect
}

public enum ConnectedAppsRules {
    /// `connectorActionLabel`: nil while the card is busy (a spinner shows).
    public static func action(
        phase: ConnectorInventoryPhase,
        busy: Bool,
        included: Bool,
        canContinue: Bool,
        pending: Bool,
        hasAccounts: Bool,
        failed: Bool
    ) -> ConnectorAction? {
        if busy { return nil }
        if included { return .included }
        switch phase {
        case .loading: return .checking
        case .error: return .unavailable
        case .ready: break
        }
        if canContinue { return .continueSetup }
        if pending { return .checkStatus }
        if hasAccounts { return .addAccount }
        if failed { return .retry }
        return .connect
    }

    /// An expired or failed authorization (`/^(expired|failed)$/i`).
    public static func isFailed(_ status: ConnectorStatus?) -> Bool {
        guard let value = status?.status?.lowercased() else { return false }
        return value == "expired" || value == "failed"
    }

    /// A no-auth toolkit, or one connected with no account and nothing in
    /// flight: there is no OAuth to run, it ships included.
    public static func isIncluded(_ card: ConnectorCard, _ status: ConnectorStatus?) -> Bool {
        if card.noAuth == true { return true }
        guard let status, status.connected else { return false }
        return (status.accounts ?? []).isEmpty && status.pending != true && !isFailed(status)
    }

    /// Counts toward "Connected N" and shows under Connected.
    public static func isConnected(_ status: ConnectorStatus?) -> Bool {
        guard let status else { return false }
        return status.connected || !(status.accounts ?? []).isEmpty
    }

    /// The search (label, slug and blurb, any case), then the view.
    public static func visibleCards(
        _ cards: [ConnectorCard],
        search: String,
        tab: ConnectorsTab,
        statuses: [String: ConnectorStatus]
    ) -> [ConnectorCard] {
        let needle = search.lowercased()
        return cards.filter { card in
            guard needle.isEmpty || "\(card.label) \(card.slug) \(card.blurb)".lowercased().contains(needle) else { return false }
            return tab == .marketplace || isConnected(statuses[card.slug])
        }
    }

    public static func connectedCount(_ statuses: [String: ConnectorStatus]) -> Int {
        statuses.values.filter { isConnected($0) }.count
    }

    /// `mergeCompleteConnectorStatus`: a full inventory clears what it no
    /// longer lists, but only when the server actually knew (an unreadable
    /// credential store must never turn a connected app into Connect).
    public static func mergeComplete(
        current: [String: ConnectorStatus],
        incoming: [String: ConnectorStatus],
        authoritative: Bool
    ) -> [String: ConnectorStatus] {
        var next = current
        if authoritative {
            for (slug, state) in current where incoming[slug] == nil {
                guard state.connected || !(state.accounts ?? []).isEmpty else { continue }
                next[slug] = ConnectorStatus(connected: false, pending: false, status: "not_connected", accounts: [])
            }
        }
        for (slug, state) in incoming { next[slug] = state }
        return next
    }

    /// `managedConnectorUnavailableReason`: toolkits the managed broker
    /// cannot offer (shared/connector-availability.ts).
    public static func managedUnavailable(mode: String?, slug: String) -> Bool {
        guard mode == "managed" else { return false }
        return ["twitter", "x"].contains(slug.trimmingCharacters(in: .whitespaces).lowercased())
    }

    /// `hasUsableConnectedApps`: only worth naming the bots without apps
    /// once an app is actually connected and the answer is confirmed.
    public static func hasUsableConnectedApps(
        configured: Bool,
        phase: ConnectorInventoryPhase,
        stale: Bool,
        statuses: [String: ConnectorStatus]
    ) -> Bool {
        configured && phase == .ready && !stale && statuses.values.contains { $0.connected }
    }

    /// `botsMissingConnectedApps`: bots whose own switch is off on an engine
    /// that could mount the tools. Hidden bots are left out.
    public static func botsMissingConnectedApps(_ bots: [Bot], instances: [Instance]) -> [Bot] {
        bots.filter { bot in
            bot.hidden != true && bot.composio == false
                && instances.first { $0.instanceId == bot.modelSelection.instanceId }?.capabilities?.composioMcp == true
        }
    }

    /// The server's "add a label" refusal (`requiresAccountAlias`).
    public static func requiresAccountAlias(_ message: String) -> Bool {
        message.range(of: "account alias.*existing connection.*not replaced", options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// The panel polls one app every five seconds after Connect, until it
    /// connects, fails or 24 tries pass.
    public static let pollInterval: TimeInterval = 5
    public static func stopsPolling(tries: Int, status: ConnectorStatus?) -> Bool {
        if tries >= 24 { return true }
        if let status, status.connected, status.pending != true { return true }
        return isFailed(status)
    }

    /// Whether the marketplace heading adds the partial-catalog note.
    public static func isPartial(_ pagination: ConnectorCatalogPagination?) -> Bool {
        guard let pagination else { return false }
        if pagination.stalled { return true }
        if let total = pagination.totalItems { return pagination.items < total }
        return false
    }

    /// The server's own account-id rule (`/api/connectors/:slug/accounts/:id`).
    public static func validAccountID(_ value: String) -> Bool {
        guard let first = value.utf8.first, value.utf8.count <= 128 else { return false }
        func alnum(_ c: UInt8) -> Bool { (48...57).contains(c) || (65...90).contains(c) || (97...122).contains(c) }
        return alnum(first) && value.utf8.allSatisfy { alnum($0) || $0 == 95 || $0 == 45 }
    }
}

// MARK: - The person's claude.ai connectors (PL7)

public struct HarnessConnectorsAnswer: Decodable, Hashable, Sendable {
    public struct Connector: Decodable, Hashable, Identifiable, Sendable {
        public var name: String
        /// connected, needs_auth, failed, unknown.
        public var status: String
        public var id: String { name }
    }

    public struct Claude: Decodable, Hashable, Sendable {
        public var available: Bool
        /// disabled, managed_policy, no_engine, not_signed_in, not_operator, key, unknown.
        public var reason: String?
        public var connectors: [Connector]

        public init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            available = try values.decodeIfPresent(Bool.self, forKey: .available) ?? false
            reason = try values.decodeIfPresent(String.self, forKey: .reason)
            connectors = try values.decodeIfPresent([Connector].self, forKey: .connectors) ?? []
        }

        private enum CodingKeys: String, CodingKey { case available, reason, connectors }
    }

    public struct Codex: Decodable, Hashable, Sendable {
        public var available: Bool
    }

    public var manageUrl: String
    public var canManage: Bool
    public var enabled: Bool
    public var claude: Claude
    public var codex: Codex

    /// Where "Manage on claude.ai" goes: the server's address when it is an
    /// https page, the connectors page otherwise.
    public var manageLink: URL {
        if let url = URL(string: manageUrl), url.scheme == "https", url.host != nil { return url }
        return URL(string: "https://claude.ai/customize/connectors")!
    }
}

// MARK: - MCP servers (PL8, PL9)

/// `GET /api/mcp/servers/:name/oauth/status`.
public struct MCPSignInStatus: Decodable, Hashable, Sendable {
    public var auth: String?
    public var pending: Bool?
    public var authError: String?
}

/// What the line under a URL server says (`McpAuthLine`).
public enum MCPAuthLine: Hashable, Sendable {
    case connected(issuer: String)
    case error(detail: String?)
    case required(issuer: String, detail: String?)
    case expired(detail: String?)
}

public enum MCPServerRules {
    /// The desktop waits ten minutes for a sign-in, polling every two seconds.
    public static let signInWait: TimeInterval = 10 * 60
    public static let signInPoll: TimeInterval = 2

    public static func authLine(_ server: MCPServerListing) -> MCPAuthLine? {
        guard let url = server.url, let auth = server.auth, auth != "none" else { return nil }
        let issuer = server.authIssuer ?? URL(string: url)?.host ?? url
        switch auth {
        case "connected": return .connected(issuer: issuer)
        case "error": return .error(detail: server.authError)
        case "expired": return .expired(detail: server.authError)
        default: return .required(issuer: issuer, detail: server.authError)
        }
    }

    /// Sign in (required) or Sign in again (expired), only for a URL server.
    public static func needsSignIn(_ server: MCPServerListing) -> Bool {
        server.isRemote && (server.auth == "required" || server.auth == "expired")
    }

    /// The monospaced line: the address, or the command and its arguments.
    public static func detailLine(_ server: MCPServerListing) -> String {
        if let url = server.url { return url }
        return ([server.command ?? ""] + (server.args ?? [])).joined(separator: " ")
    }

    /// The waiting ends when the server connects or stops waiting itself.
    public enum Poll: Hashable, Sendable { case keepWaiting, connected, stopped(error: String?) }
    public static func poll(_ status: MCPSignInStatus) -> Poll {
        if status.auth == "connected" { return .connected }
        if status.pending != true { return .stopped(error: status.authError) }
        return .keepWaiting
    }
}

// MARK: - Client

public extension CompanionClient {
    /// `GET /api/connectors?services=a,b`: one or a few apps, for the poll
    /// after Connect and the refresh after a disconnect.
    func connectorStatuses(services: [String]) async throws -> ConnectorStatuses {
        try await send(connectorStatusesRequest(services: services), as: ConnectorStatuses.self)
    }

    /// `DELETE /api/connectors/:slug/accounts/:id` (PL4): revokes that one account.
    func disconnectConnectorAccount(slug: String, accountId: String) async throws {
        try await send(disconnectConnectorAccountRequest(slug: slug, accountId: accountId))
    }

    /// `GET /api/me/harness-connectors[?refresh=1]` (PL7). Asking Claude Code
    /// can take a while: the desktop waits up to 90 seconds.
    func harnessConnectors(refresh: Bool = false) async throws -> HarnessConnectorsAnswer {
        try await send(harnessConnectorsRequest(refresh: refresh), as: HarnessConnectorsAnswer.self)
    }

    /// `PUT /api/harness-connectors/settings {claudeAi}`: admin only.
    func setHarnessConnectorsEnabled(_ enabled: Bool) async throws {
        try await send(makeRequest("PUT", "/api/harness-connectors/settings", body: ["claudeAi": enabled]))
    }

    /// `GET /api/mcp/servers[?reprobe=1]` (PL8).
    func mcpServers(reprobe: Bool) async throws -> MCPServersResponse {
        try await send(
            makeRequest("GET", "/api/mcp/servers", query: reprobe ? [URLQueryItem(name: "reprobe", value: "1")] : []),
            as: MCPServersResponse.self
        )
    }

    /// `GET /api/mcp/servers/:name/oauth/status` (PL9).
    func mcpSignInStatus(serverName: String) async throws -> MCPSignInStatus {
        guard Self.validRouteID(serverName) else { throw APIError.badURL }
        return try await send(makeRequest("GET", "/api/mcp/servers/\(serverName)/oauth/status"), as: MCPSignInStatus.self)
    }

    // MARK: Request builders (tested without a network)

    func connectorStatusesRequest(services: [String]) throws -> URLRequest {
        let slugs = services.filter { slug in
            !slug.isEmpty && slug.utf8.allSatisfy { (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 95 || $0 == 45 }
        }
        guard !slugs.isEmpty else { throw APIError.badURL }
        return try makeRequest("GET", "/api/connectors", query: [URLQueryItem(name: "services", value: slugs.joined(separator: ","))])
    }

    func disconnectConnectorAccountRequest(slug: String, accountId: String) throws -> URLRequest {
        guard Self.validRouteID(slug), ConnectedAppsRules.validAccountID(accountId) else { throw APIError.badURL }
        return try makeRequest("DELETE", "/api/connectors/\(slug)/accounts/\(accountId)")
    }

    func harnessConnectorsRequest(refresh: Bool) throws -> URLRequest {
        var request = try makeRequest("GET", "/api/me/harness-connectors", query: refresh ? [URLQueryItem(name: "refresh", value: "1")] : [])
        request.timeoutInterval = 90
        return request
    }
}
