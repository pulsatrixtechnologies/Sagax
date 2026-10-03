import XCTest

/// WP9: Plugins > Connected apps (PL1, PL2, PL4, PL6), MCP servers with a
/// real sign-in (PL8, PL9) and the claude.ai connectors (PL7), against the
/// parity fixture's plugins lab (`PARITY_PLUGINS=1`, ios/parity/plugin-lab.mjs).
/// Every action is a real request to the real server; each result is read
/// back through the API or the lab's record of the connected-apps broker.
///
///   PARITY_PLUGINS=1 node ios/parity/fixture-server.mjs &
///   TEST_RUNNER_PARITY_ENDPOINT=... TEST_RUNNER_PARITY_TOKEN=... \
///   TEST_RUNNER_PARITY_ENVIRONMENT=... xcodebuild test \
///     -only-testing:SagaxUITests/PluginsUITests ...
///
/// The fixture pairs with the admin scope, so every row the gate allows on
/// an admin pairing shows; the sidecar and client-session gates are unit
/// tested (PluginsParityTests).
final class PluginsUITests: XCTestCase {
    private var arguments: [String] = []
    private var endpoint = ""
    private var token = ""

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"] else {
            throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN")
        }
        self.endpoint = endpoint
        self.token = token
        guard api("GET", "/__parity/plugins").0 == 200 else {
            throw XCTSkip("start the fixture with PARITY_PLUGINS=1 for the plugins lab")
        }
        arguments = ["-parityEndpoint", endpoint, "-parityToken", token, "-parityScreen", "15-plugins"]
        if let environment = env["PARITY_ENVIRONMENT"], !environment.isEmpty {
            arguments += ["-parityEnvironment", environment]
        }
    }

    @MainActor
    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(app.element("plugins-installed").waitForExistence(timeout: 20))
        return app
    }

    /// Scrolls Plugins down to a Connections row and opens it.
    @MainActor
    private func open(_ identifier: String, in app: XCUIApplication) {
        let row = app.element(identifier)
        for _ in 0..<6 where !(row.exists && row.isHittable) {
            app.swipeUp()
        }
        XCTAssertTrue(row.waitForExistence(timeout: 10), app.debugDescription)
        row.tap()
    }

    // MARK: API

    @discardableResult
    private func api(_ method: String, _ path: String, body: [String: Any]? = nil) -> (Int, [String: Any]) {
        var request = URLRequest(url: URL(string: endpoint + path)!, timeoutInterval: 140)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        let done = DispatchSemaphore(value: 0)
        var result: (Int, [String: Any]) = (0, [:])
        URLSession.shared.dataTask(with: request) { data, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
            result = (status, json)
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 150)
        return result
    }

    private var broker: [String: Any] { api("GET", "/__parity/plugins").1["broker"] as? [String: Any] ?? [:] }

    private func gmailAccounts() -> [[String: Any]] {
        let services = api("GET", "/api/connectors/connected").1["services"] as? [String: Any]
        return (services?["gmail"] as? [String: Any])?["accounts"] as? [[String: Any]] ?? []
    }

    private func eventually(_ timeout: TimeInterval = 10, _ check: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if check() { return true }
            Thread.sleep(forTimeInterval: 0.3)
        }
        return check()
    }

    // MARK: Connected apps

    /// PL1, PL2, PL4: Marketplace lists the catalog, Connected only what has
    /// an account (with the count), and Disconnect revokes exactly one account.
    @MainActor
    func testConnectedViewAndDisconnectingOneAccount() throws {
        let before = gmailAccounts()
        guard before.count >= 2, let last = before.last?["id"] as? String else {
            throw XCTSkip("the lab's second Gmail account was already disconnected by an earlier run")
        }
        let app = launch()
        open("plugins-connected-apps", in: app)
        XCTAssertTrue(app.element("connected-apps-row.slack").waitForExistence(timeout: 15))
        XCTAssertTrue(app.element("connected-apps-row.gmail").exists)
        XCTAssertEqual(app.element("connected-apps-action.hackernews").label, "Included")
        XCTAssertEqual(app.element("connected-apps-action.gmail").label, "Add account")

        let connected = app.element("connected-apps-tab.connected")
        XCTAssertTrue(connected.label.contains("1"), connected.label)
        connected.tap()
        XCTAssertTrue(eventually { !app.element("connected-apps-row.slack").exists })
        XCTAssertTrue(app.element("connected-apps-row.gmail").exists)

        let disconnect = app.element("connected-apps-disconnect.\(last)")
        XCTAssertTrue(disconnect.waitForExistence(timeout: 5))
        disconnect.tap()
        let confirm = app.buttons.matching(identifier: "connected-apps-disconnect-confirm").firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()

        XCTAssertTrue(eventually(15) {
            (self.broker["removed"] as? [[String: Any]] ?? []).contains { $0["id"] as? String == last }
        })
        XCTAssertEqual(gmailAccounts().count, before.count - 1)
        XCTAssertTrue(eventually(10) { !app.element("connected-apps-disconnect.\(last)").exists })
    }

    /// PL1 (Connect with a label): the authorize carries the alias, the page
    /// opens in the browser and the card waits on it with Continue.
    @MainActor
    func testConnectingAskForALabelAndAuthorizes() {
        let app = launch()
        open("plugins-connected-apps", in: app)
        let action = app.element("connected-apps-action.notion")
        XCTAssertTrue(action.waitForExistence(timeout: 15))
        XCTAssertEqual(action.label, "Connect")
        action.tap()
        let alias = app.textFields["connected-apps-alias.notion"]
        XCTAssertTrue(alias.waitForExistence(timeout: 5))
        alias.tap()
        XCTAssertTrue(app.element("connected-apps-alias-continue.notion").exists)
        // Return submits, as Continue does (the keyboard covers the pill).
        alias.typeText("Travail\n")

        XCTAssertTrue(eventually(15) {
            (self.broker["authorizes"] as? [[String: Any]] ?? []).contains {
                $0["slug"] as? String == "notion" && $0["alias"] as? String == "Travail"
            }
        })
        // The sign-in page opened outside the app; come back to it.
        app.activate()
        let pending = app.element("connected-apps-action.notion")
        XCTAssertTrue(eventually(15) { pending.label == "Continue" }, pending.label)
    }

    /// PL6: a bot whose own switch is off is named, and Allow turns it on.
    @MainActor
    func testAllowingConnectedAppsForABot() throws {
        let lab = api("GET", "/__parity/plugins").1
        let botId = try XCTUnwrap(lab["botId"] as? String)
        api("PATCH", "/api/bots/\(botId)", body: ["composio": false])
        let app = launch()
        open("plugins-connected-apps", in: app)
        let allow = app.element("connected-apps-allow.\(botId)")
        XCTAssertTrue(allow.waitForExistence(timeout: 15), app.debugDescription)
        allow.tap()
        XCTAssertTrue(eventually(10) {
            let bots = self.api("GET", "/api/bots").1["bots"] as? [[String: Any]] ?? []
            return bots.first { $0["id"] as? String == botId }?["composio"] as? Bool == true
        })
        XCTAssertTrue(eventually(10) { !app.element("connected-apps-allow.\(botId)").exists })
        api("PATCH", "/api/bots/\(botId)", body: ["composio": false])
    }

    // MARK: MCP servers

    /// PL8, PL9: the read-only list, and Sign in runs the real OAuth flow in
    /// the system sheet; the row follows the server's status to connected.
    @MainActor
    func testMcpServerSignInReachesConnected() {
        api("POST", "/api/mcp/servers/oauthdocs/oauth/disconnect", body: [:])
        let app = launch()
        open("plugins-mcp-servers", in: app)
        XCTAssertTrue(app.element("mcp-row.docs-wiki").waitForExistence(timeout: 20))
        let signIn = app.element("mcp-sign-in.oauthdocs")
        for _ in 0..<6 where !(signIn.exists && signIn.isHittable) { app.swipeUp() }
        XCTAssertTrue(signIn.waitForExistence(timeout: 10), app.debugDescription)
        signIn.tap()

        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let proceed = springboard.buttons["Continue"]
        XCTAssertTrue(proceed.waitForExistence(timeout: 15))
        proceed.tap()

        XCTAssertTrue(eventually(60) {
            let servers = self.api("GET", "/api/mcp/servers").1["servers"] as? [[String: Any]] ?? []
            return servers.first { $0["name"] as? String == "oauthdocs" }?["auth"] as? String == "connected"
        })
        let line = app.element("mcp-auth.oauthdocs")
        XCTAssertTrue(eventually(30) { line.exists && line.label.contains("Signed in") }, line.label)
        XCTAssertFalse(app.element("mcp-sign-in.oauthdocs").exists)
        api("POST", "/api/mcp/servers/oauthdocs/oauth/disconnect", body: [:])
    }

    // MARK: Claude connectors

    /// PL7: the person's claude.ai answer, Manage, and the admin switch.
    @MainActor
    func testClaudeConnectorsShowTheAnswerAndTheAdminSwitch() {
        let app = launch()
        open("plugins-harness-connectors", in: app)
        XCTAssertTrue(app.element("harness-connectors-manage").waitForExistence(timeout: 10))
        let empty = app.element("harness-connectors-empty")
        let unavailable = app.element("harness-connectors-unavailable")
        XCTAssertTrue(eventually(100) { empty.exists || unavailable.exists })

        let toggle = app.element("harness-connectors-allow.toggle")
        XCTAssertTrue(toggle.waitForExistence(timeout: 10))
        let enabled = api("GET", "/api/me/harness-connectors").1["enabled"] as? Bool ?? true
        toggle.tap()
        XCTAssertTrue(eventually(20) { (self.api("GET", "/api/me/harness-connectors").1["enabled"] as? Bool) == !enabled })
        api("PUT", "/api/harness-connectors/settings", body: ["claudeAi": enabled])
    }
}

private extension XCUIApplication {
    func element(_ identifier: String) -> XCUIElement {
        descendants(matching: .any).matching(identifier: identifier).firstMatch
    }
}
