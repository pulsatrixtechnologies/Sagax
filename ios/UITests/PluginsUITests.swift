import XCTest

/// Connect apps (#203, #206, #207, #218; matrix DC35 to DC39): the main view,
/// Manage, an app's and a server's page, Providers, against the
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
        // Settings > Connect apps (#203, #218)
        XCTAssertTrue(app.element("connect-apps-manage").waitForExistence(timeout: 20), app.debugDescription)
        return app
    }

    /// Scrolls the list to a row and opens it.
    @MainActor
    private func open(_ identifier: String, in app: XCUIApplication) {
        let row = app.element(identifier)
        for _ in 0..<8 where !(row.exists && row.isHittable) {
            // Manage shows the first installed plugins, then Show all
            let showAll = app.element("connect-apps-show-all")
            if !row.exists, showAll.exists, showAll.isHittable, showAll.label.hasPrefix("Show all") { showAll.tap(); continue }
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

    // MARK: Connect apps

    /// The main view: one row per app with Add or Connect, a section per
    /// category, and "N connected >" to Manage (#203, #218).
    /// "Bot templates" beside the search (ConnectAppsView): Connect apps
    /// closes, then the new bot sheet opens (Templates is off on the fixture).
    @MainActor
    func testBotTemplatesBesideTheSearchOpensTheNewBotSheet() {
        let app = launch()
        let button = app.element("connect-apps-bot-templates")
        XCTAssertTrue(button.waitForExistence(timeout: 10), "Bot templates beside the search")
        ParityShots.save("Connect apps Bot templates", app)
        button.tap()
        XCTAssertTrue(app.element("create-bot-sheet").waitForExistence(timeout: 10), "the new bot sheet")
        XCTAssertFalse(app.element("connect-apps-manage").exists, "Connect apps closed")
        ParityShots.save("Bot templates opens New bot", app)
    }

    @MainActor
    func testTheMainViewListsAppsAndCountsWhatIsConnected() {
        let app = launch()
        XCTAssertTrue(app.element("connect-apps-chips").exists)
        let manage = app.element("connect-apps-manage")
        XCTAssertTrue(manage.label.contains("connected"), manage.label)
        XCTAssertTrue(app.element("connect-apps-action.app:notion").waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertEqual(app.element("connect-apps-action.app:notion").label, "Connect")
        XCTAssertFalse(app.element("connect-apps-action.app:gmail").exists, "a connected app shows its status, no button")
    }

    /// Manage > Installed > the app's page: Disconnect revokes exactly one
    /// account.
    @MainActor
    func testManageOpensTheAppPageWhereOneAccountDisconnects() throws {
        let before = gmailAccounts()
        guard before.count >= 2, let last = before.last?["id"] as? String else {
            throw XCTSkip("the lab's second Gmail account was already disconnected by an earlier run")
        }
        let app = launch()
        app.element("connect-apps-manage").tap()
        open("connect-apps-installed.app:gmail", in: app)
        let account = app.element("connect-apps-account.\(last)")
        XCTAssertTrue(account.waitForExistence(timeout: 15), app.debugDescription)
        account.swipeLeft()
        let disconnect = app.buttons["Disconnect"].firstMatch
        XCTAssertTrue(disconnect.waitForExistence(timeout: 5))
        disconnect.tap()
        XCTAssertTrue(eventually(15) {
            (self.broker["removed"] as? [[String: Any]] ?? []).contains { $0["id"] as? String == last }
        })
        XCTAssertEqual(gmailAccounts().count, before.count - 1)
    }

    /// Connect asks for an account label, then authorizes with it.
    @MainActor
    func testConnectingAsksForALabelAndAuthorizes() {
        let app = launch()
        let action = app.element("connect-apps-action.app:notion")
        XCTAssertTrue(action.waitForExistence(timeout: 15))
        action.tap()
        let field = app.alerts.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.typeText("Travail")
        app.alerts.buttons["Connect"].tap()
        XCTAssertTrue(eventually(15) {
            (self.broker["authorizes"] as? [[String: Any]] ?? []).contains {
                $0["slug"] as? String == "notion" && $0["alias"] as? String == "Travail"
            }
        })
        app.activate()
    }

    // MARK: MCP servers

    /// A server's page: Sign in runs the real OAuth flow in the system sheet
    /// and the server reaches connected.
    @MainActor
    func testMcpServerSignInFromItsPage() {
        api("POST", "/api/mcp/servers/oauthdocs/oauth/disconnect", body: [:])
        let app = launch()
        app.element("connect-apps-manage").tap()
        open("connect-apps-installed.mcp:oauthdocs", in: app)
        let signIn = app.element("connect-apps-sign-in")
        XCTAssertTrue(signIn.waitForExistence(timeout: 15), app.debugDescription)
        signIn.tap()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let proceed = springboard.buttons["Continue"]
        XCTAssertTrue(proceed.waitForExistence(timeout: 15))
        proceed.tap()
        XCTAssertTrue(eventually(60) {
            let servers = self.api("GET", "/api/mcp/servers").1["servers"] as? [[String: Any]] ?? []
            return servers.first { $0["name"] as? String == "oauthdocs" }?["auth"] as? String == "connected"
        })
        api("POST", "/api/mcp/servers/oauthdocs/oauth/disconnect", body: [:])
    }

    // MARK: Claude connectors

    /// PL7: the person's claude.ai answer, Manage, and the admin switch.
    @MainActor
    func testClaudeConnectorsShowTheAnswerAndTheAdminSwitch() {
        // Manage > Providers (#207)
        let app = launch()
        app.element("connect-apps-manage").tap()
        let tabs = app.segmentedControls.firstMatch
        XCTAssertTrue(tabs.waitForExistence(timeout: 10))
        tabs.buttons["Providers"].tap()
        XCTAssertTrue(app.element("harness-connectors-manage").waitForExistence(timeout: 30), app.debugDescription)
        let empty = app.element("harness-connectors-empty")
        let unavailable = app.element("harness-connectors-unavailable")
        XCTAssertTrue(eventually(100) { empty.exists || unavailable.exists })

        let toggle = app.element("harness-connectors-allow.toggle")
        for _ in 0..<6 where !(toggle.exists && toggle.isHittable) { app.swipeUp() }
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), app.debugDescription)
        let enabled = api("GET", "/api/me/harness-connectors").1["enabled"] as? Bool ?? true
        toggle.tap()
        XCTAssertTrue(eventually(150) { (self.api("GET", "/api/me/harness-connectors").1["enabled"] as? Bool) == !enabled })
        api("PUT", "/api/harness-connectors/settings", body: ["claudeAi": enabled])
    }
}

private extension XCUIApplication {
    func element(_ identifier: String) -> XCUIElement {
        descendants(matching: .any).matching(identifier: identifier).firstMatch
    }
}
