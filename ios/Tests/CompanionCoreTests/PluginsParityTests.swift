import Foundation
import XCTest
@testable import CompanionCore

/// WP9 (PL1, PL2, PL4, PL6-PL9): the desktop panel's rules, the gate, and
/// the requests the phone sends.
final class PluginsParityTests: XCTestCase {
    private let client = CompanionClient(connection: Connection(name: "Test", host: "127.0.0.1", port: 8810), token: "t")

    private func card(_ slug: String, noAuth: Bool? = nil, blurb: String = "") -> ConnectorCard {
        ConnectorCard(slug: slug, label: slug.capitalized, blurb: blurb, logo: nil, domain: nil, noAuth: noAuth)
    }

    private func status(_ connected: Bool, pending: Bool? = nil, status: String? = nil, accounts: [ConnectorAccount]? = nil) -> ConnectorStatus {
        ConnectorStatus(connected: connected, pending: pending, status: status, accounts: accounts)
    }

    // MARK: Action label (connectorActionLabel)

    func testActionLabelFollowsTheDesktopOrder() {
        func label(_ phase: ConnectorInventoryPhase = .ready, busy: Bool = false, included: Bool = false, canContinue: Bool = false,
                   pending: Bool = false, hasAccounts: Bool = false, failed: Bool = false) -> ConnectorAction? {
            ConnectedAppsRules.action(phase: phase, busy: busy, included: included, canContinue: canContinue,
                                      pending: pending, hasAccounts: hasAccounts, failed: failed)
        }
        XCTAssertNil(label(busy: true, included: true))
        XCTAssertEqual(label(.loading, included: true), .included)
        XCTAssertEqual(label(.loading), .checking)
        XCTAssertEqual(label(.error, pending: true), .unavailable)
        XCTAssertEqual(label(canContinue: true, pending: true), .continueSetup)
        XCTAssertEqual(label(pending: true, hasAccounts: true), .checkStatus)
        XCTAssertEqual(label(hasAccounts: true, failed: true), .addAccount)
        XCTAssertEqual(label(failed: true), .retry)
        XCTAssertEqual(label(), .connect)
    }

    func testIncludedIsNoAuthOrConnectedWithoutAccounts() {
        XCTAssertTrue(ConnectedAppsRules.isIncluded(card("hn", noAuth: true), nil))
        XCTAssertTrue(ConnectedAppsRules.isIncluded(card("calc"), status(true, accounts: [])))
        XCTAssertFalse(ConnectedAppsRules.isIncluded(card("calc"), status(true, pending: true)))
        XCTAssertFalse(ConnectedAppsRules.isIncluded(card("calc"), status(true, status: "EXPIRED")))
        XCTAssertFalse(ConnectedAppsRules.isIncluded(card("gmail"), status(true, accounts: [ConnectorAccount(id: "a", alias: nil, status: "ACTIVE")])))
        XCTAssertTrue(ConnectedAppsRules.isFailed(status(false, status: "Failed")))
        XCTAssertFalse(ConnectedAppsRules.isFailed(status(false, status: "INITIATED")))
    }

    // MARK: Marketplace / Connected (PL2)

    func testConnectedViewAndSearchAndCount() {
        let cards = [card("gmail", blurb: "Email"), card("slack", blurb: "Chat"), card("notion")]
        let statuses = [
            "gmail": status(true, accounts: [ConnectorAccount(id: "w", alias: "Work", status: "ACTIVE")]),
            "notion": status(false, accounts: [ConnectorAccount(id: "p", alias: nil, status: "INITIATED")]),
            "slack": status(false),
        ]
        XCTAssertEqual(ConnectedAppsRules.visibleCards(cards, search: "", tab: .marketplace, statuses: statuses).map(\.slug), ["gmail", "slack", "notion"])
        XCTAssertEqual(ConnectedAppsRules.visibleCards(cards, search: "", tab: .connected, statuses: statuses).map(\.slug), ["gmail", "notion"])
        XCTAssertEqual(ConnectedAppsRules.visibleCards(cards, search: "CHAT", tab: .marketplace, statuses: statuses).map(\.slug), ["slack"])
        XCTAssertEqual(ConnectedAppsRules.connectedCount(statuses), 2)
    }

    func testCompleteMergeClearsOnlyOnAnAuthoritativeAnswer() {
        let current = ["gmail": status(true, accounts: [ConnectorAccount(id: "w", alias: nil, status: "ACTIVE")]), "slack": status(false)]
        let ignorant = ConnectedAppsRules.mergeComplete(current: current, incoming: [:], authoritative: false)
        XCTAssertEqual(ignorant["gmail"]?.connected, true)
        let sure = ConnectedAppsRules.mergeComplete(current: current, incoming: [:], authoritative: true)
        XCTAssertEqual(sure["gmail"]?.connected, false)
        XCTAssertEqual(sure["gmail"]?.status, "not_connected")
        XCTAssertEqual(sure["slack"]?.status, nil, "a service that was never connected is left as it was")
    }

    func testPollingStopsOnConnectedFailedOrAfter24Tries() {
        XCTAssertFalse(ConnectedAppsRules.stopsPolling(tries: 1, status: status(false, pending: true, status: "INITIATED")))
        XCTAssertTrue(ConnectedAppsRules.stopsPolling(tries: 1, status: status(true, pending: false)))
        XCTAssertFalse(ConnectedAppsRules.stopsPolling(tries: 1, status: status(true, pending: true)))
        XCTAssertTrue(ConnectedAppsRules.stopsPolling(tries: 1, status: status(false, status: "expired")))
        XCTAssertTrue(ConnectedAppsRules.stopsPolling(tries: 24, status: nil))
    }

    func testManagedUnavailableAliasAndPartialCatalog() {
        XCTAssertTrue(ConnectedAppsRules.managedUnavailable(mode: "managed", slug: "Twitter"))
        XCTAssertFalse(ConnectedAppsRules.managedUnavailable(mode: "self-hosted", slug: "twitter"))
        XCTAssertTrue(ConnectedAppsRules.requiresAccountAlias("An account alias is required: the existing connection is not replaced"))
        XCTAssertFalse(ConnectedAppsRules.requiresAccountAlias("network down"))
        XCTAssertTrue(ConnectedAppsRules.isPartial(ConnectorCatalogPagination(items: 10, totalItems: 20, stalled: false)))
        XCTAssertTrue(ConnectedAppsRules.isPartial(ConnectorCatalogPagination(items: 10, stalled: true, reason: "page-stuck")))
        XCTAssertFalse(ConnectedAppsRules.isPartial(ConnectorCatalogPagination(items: 10, totalItems: 10, stalled: false)))
        XCTAssertFalse(ConnectedAppsRules.isPartial(nil))
    }

    func testCatalogDecodesNoAuthAndPagination() throws {
        let json = #"{"configured":true,"mode":"managed","source":"api","cards":[{"slug":"hn","label":"Hacker News","blurb":"","logo":null,"noAuth":true,"domain":null}],"pagination":{"items":1,"totalItems":3,"stalled":true,"complete":false,"reason":"http-error"}}"#
        let catalog = try JSONDecoder().decode(ConnectorCatalog.self, from: Data(json.utf8))
        XCTAssertEqual(catalog.cards.first?.noAuth, true)
        XCTAssertEqual(catalog.pagination?.totalItems, 3)
        XCTAssertEqual(catalog.pagination?.reason, "http-error")
    }

    // MARK: Per-bot allow (PL6)

    func testBotsMissingAppsAreOffOnACapableVisibleEngine() throws {
        let instances = try JSONDecoder().decode(InstanceList.self, from: Data(#"""
        {"instances":[
          {"instanceId":"claude","driverKind":"claudeAgent","snapshot":{"state":"available"},"models":{"default":"m","options":[]},"capabilities":{"composioMcp":true}},
          {"instanceId":"plain","driverKind":"openai","snapshot":{"state":"available"},"models":{"default":"m","options":[]},"capabilities":{}}
        ]}
        """#.utf8)).instances
        func bot(_ id: String, instance: String, composio: Bool?, hidden: Bool? = nil) -> Bot {
            var bot = Bot(id: id, threadId: "t-\(id)", name: id, title: "", description: "", notifications: true, color: "blue",
                          unread: false, modelSelection: ModelSelection(instanceId: instance, model: "m"), createdAt: 0)
            bot.composio = composio
            bot.hidden = hidden
            return bot
        }
        let bots = [
            bot("off", instance: "claude", composio: false),
            bot("on", instance: "claude", composio: nil),
            bot("plain", instance: "plain", composio: false),
            bot("hidden", instance: "claude", composio: false, hidden: true),
        ]
        XCTAssertEqual(ConnectedAppsRules.botsMissingConnectedApps(bots, instances: instances).map(\.id), ["off"])
        XCTAssertTrue(ConnectedAppsRules.hasUsableConnectedApps(configured: true, phase: .ready, stale: false, statuses: ["gmail": status(true)]))
        XCTAssertFalse(ConnectedAppsRules.hasUsableConnectedApps(configured: true, phase: .ready, stale: true, statuses: ["gmail": status(true)]))
    }

    func testAllowAppsPatchCarriesOnlyComposio() throws {
        let request = try client.patchBotRequest(botId: "b1", patch: BotPatch(composio: true))
        XCTAssertEqual(request.httpMethod, "PATCH")
        XCTAssertEqual(request.url?.path, "/api/bots/b1")
        let body = try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]
        XCTAssertEqual(body?.count, 1)
        XCTAssertEqual(body?["composio"] as? Bool, true)
        XCTAssertFalse(BotPatch(composio: false).isEmpty)
    }

    // MARK: Gate

    func testGateMatchesTheSidecarAndClientRoutes() {
        let sidecar = SurfaceGate(scope: .sidecar)
        let client = SurfaceGate(scope: .serverClient)
        let admin = SurfaceGate(scope: .serverAdmin)
        let olderSidecar = SurfaceGate(scope: .sidecar, sidecarRoutes: [])
        for feature: SurfaceFeature in [.connectedApps, .mcpServers] {
            XCTAssertTrue(sidecar.allows(feature))
            XCTAssertFalse(client.allows(feature))
            XCTAssertTrue(admin.allows(feature))
        }
        XCTAssertTrue(sidecar.allows(.harnessConnectors))
        XCTAssertFalse(olderSidecar.allows(.harnessConnectors))
        XCTAssertTrue(client.allows(.harnessConnectors))
        XCTAssertTrue(admin.allows(.harnessConnectors))
        for feature: SurfaceFeature in [.connectedAppsPerBot, .harnessConnectorsSetting] {
            XCTAssertFalse(sidecar.allows(feature))
            XCTAssertFalse(client.allows(feature))
            XCTAssertTrue(admin.allows(feature))
        }
    }

    // MARK: Requests

    func testDisconnectAndStatusRequests() throws {
        let delete = try client.disconnectConnectorAccountRequest(slug: "gmail", accountId: "ca_Work-1")
        XCTAssertEqual(delete.httpMethod, "DELETE")
        XCTAssertEqual(delete.url?.path, "/api/connectors/gmail/accounts/ca_Work-1")
        XCTAssertThrowsError(try client.disconnectConnectorAccountRequest(slug: "gmail", accountId: "../x"))
        XCTAssertThrowsError(try client.disconnectConnectorAccountRequest(slug: "gmail", accountId: "_lead"))
        XCTAssertThrowsError(try client.disconnectConnectorAccountRequest(slug: "a/b", accountId: "x"))

        let poll = try client.connectorStatusesRequest(services: ["gmail", "bad slug", "slack"])
        XCTAssertEqual(poll.url?.path, "/api/connectors")
        XCTAssertEqual(URLComponents(url: poll.url!, resolvingAgainstBaseURL: false)?.queryItems, [URLQueryItem(name: "services", value: "gmail,slack")])
        XCTAssertThrowsError(try client.connectorStatusesRequest(services: []))

        let harness = try client.harnessConnectorsRequest(refresh: true)
        XCTAssertEqual(harness.url?.path, "/api/me/harness-connectors")
        XCTAssertEqual(harness.url?.query, "refresh=1")
        XCTAssertEqual(harness.timeoutInterval, 90)
        XCTAssertNil(try client.harnessConnectorsRequest(refresh: false).url?.query)
    }

    // MARK: Claude connectors (PL7)

    func testHarnessAnswerDecodesAndFallsBackToTheConnectorsPage() throws {
        let json = #"{"manageUrl":"javascript:alert(1)","canManage":false,"enabled":true,"claude":{"available":true,"connectors":[{"name":"Gmail","status":"connected"},{"name":"Drive","status":"needs_auth"}]},"codex":{"available":false,"reason":"no"}}"#
        let answer = try JSONDecoder().decode(HarnessConnectorsAnswer.self, from: Data(json.utf8))
        XCTAssertEqual(answer.claude.connectors.map(\.status), ["connected", "needs_auth"])
        XCTAssertEqual(answer.manageLink.absoluteString, "https://claude.ai/customize/connectors")
        XCTAssertFalse(answer.codex.available)
        let unavailable = try JSONDecoder().decode(HarnessConnectorsAnswer.self, from: Data(#"{"manageUrl":"https://claude.ai/x","canManage":true,"enabled":false,"claude":{"available":false,"reason":"not_signed_in"},"codex":{"available":true}}"#.utf8))
        XCTAssertEqual(unavailable.claude.reason, "not_signed_in")
        XCTAssertTrue(unavailable.claude.connectors.isEmpty)
        XCTAssertEqual(unavailable.manageLink.absoluteString, "https://claude.ai/x")
    }

    // MARK: MCP servers (PL8, PL9)

    func testMCPAuthLineAndSignInPoll() throws {
        let json = #"{"servers":[{"name":"docs","type":"http","url":"https://mcp.example.com/mcp","headerKeys":["Authorization"],"enabled":true,"auth":"required","authIssuer":"login.example.com"},{"name":"notes","command":"npx","args":["-y","notes"],"envKeys":["TOKEN"],"enabled":false},{"name":"old","type":"http","url":"https://old.example.com/mcp","headerKeys":[],"enabled":true,"auth":"expired","authError":"refresh refused"}]}"#
        let servers = try JSONDecoder().decode(MCPServersResponse.self, from: Data(json.utf8)).servers
        XCTAssertEqual(MCPServerRules.authLine(servers[0]), .required(issuer: "login.example.com", detail: nil))
        XCTAssertNil(MCPServerRules.authLine(servers[1]))
        XCTAssertEqual(MCPServerRules.authLine(servers[2]), .expired(detail: "refresh refused"))
        XCTAssertEqual(MCPServerRules.detailLine(servers[1]), "npx -y notes")
        XCTAssertEqual(servers[1].envKeys, ["TOKEN"])
        XCTAssertTrue(MCPServerRules.needsSignIn(servers[0]))
        XCTAssertFalse(MCPServerRules.needsSignIn(servers[1]))
        XCTAssertTrue(MCPServerRules.needsSignIn(servers[2]))

        XCTAssertEqual(MCPServerRules.poll(MCPSignInStatus(auth: "required", pending: true)), .keepWaiting)
        XCTAssertEqual(MCPServerRules.poll(MCPSignInStatus(auth: "connected", pending: false)), .connected)
        XCTAssertEqual(MCPServerRules.poll(MCPSignInStatus(auth: "error", pending: false, authError: "denied")), .stopped(error: "denied"))
    }
}
