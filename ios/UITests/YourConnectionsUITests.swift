import XCTest

/// Manage > Your connections (P2-4, #218): the person's own MCP servers
/// and GitHub account on an organization server, read and revoked from the
/// phone. A server is added for the person through the API, then the phone
/// switches it off and removes it; each write is read back from
/// `GET /api/me/connections`.
///
///   PARITY_ORG=1 PARITY_ORG_PHONE=1 node ios/parity/fixture-server.mjs &
///   TEST_RUNNER_PARITY_ENDPOINT=... TEST_RUNNER_PARITY_TOKEN=... \
///   TEST_RUNNER_PARITY_ENVIRONMENT=... xcodebuild test \
///     -only-testing:SagaxUITests/YourConnectionsUITests ...
///
/// Skipped without a fixture, or on a server that is not an organization's.
final class YourConnectionsUITests: XCTestCase {
    private var endpoint = ""
    private var token = ""
    private var arguments: [String] = []
    private let server = "lot2-notes"

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"], !token.isEmpty else {
            throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN")
        }
        self.endpoint = endpoint
        self.token = token
        guard api("GET", "/api/me/connections").0 == 200 else {
            throw XCTSkip("an organization fixture (PARITY_ORG=1 PARITY_ORG_PHONE=1) has the person's own connections")
        }
        arguments = ["-parityEndpoint", endpoint, "-parityToken", token, "-parityScreen", "15-plugins"]
        if let environment = env["PARITY_ENVIRONMENT"], !environment.isEmpty {
            arguments += ["-parityEnvironment", environment]
        }
    }

    @discardableResult
    private func api(_ method: String, _ path: String, body: [String: Any]? = nil) -> (Int, [String: Any]) {
        var request = URLRequest(url: URL(string: endpoint + path)!, timeoutInterval: 30)
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
        _ = done.wait(timeout: .now() + 40)
        return result
    }

    private func mine() -> [String: Any]? {
        (api("GET", "/api/me/connections").1["servers"] as? [[String: Any]])?.first { $0["name"] as? String == server }
    }

    private func eventually(_ timeout: TimeInterval = 10, _ check: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if check() { return true }
            Thread.sleep(forTimeInterval: 0.3)
        }
        return check()
    }

    private func element(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    @MainActor
    func testYourConnectionsListsTheServerSwitchesItOffAndRemovesIt() throws {
        api("DELETE", "/api/me/mcp/servers/\(server)")
        let added = api("POST", "/api/me/mcp/servers", body: ["name": server, "url": "https://example.com/mcp", "auth": "none"])
        XCTAssertTrue((200...299).contains(added.0), "the person's server is added (\(added.0))")
        addTeardownBlock { _ = self.api("DELETE", "/api/me/mcp/servers/\(self.server)") }

        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = arguments
        app.launch()
        let manage = element("connect-apps-manage", in: app)
        XCTAssertTrue(manage.waitForExistence(timeout: 20))
        manage.tap()

        let row = element("your-connections-server.\(server)", in: app)
        for _ in 0..<8 where !(row.exists && row.isHittable) { app.swipeUp() }
        XCTAssertTrue(row.waitForExistence(timeout: 10), "Manage > Your connections lists the person's server")
        XCTAssertTrue(element("your-connections-github", in: app).exists, "and the GitHub account")

        let toggle = element("your-connections-toggle.\(server)", in: app)
        XCTAssertTrue(toggle.exists)
        if toggle.switches.firstMatch.exists { toggle.switches.firstMatch.tap() } else { toggle.tap() }
        XCTAssertTrue(eventually { self.mine()?["enabled"] as? Bool == false }, "switched off on the server")

        let remove = element("your-connections-remove.\(server)", in: app)
        XCTAssertTrue(remove.exists)
        remove.tap()
        let confirm = app.buttons.matching(NSPredicate(format: "label == 'Remove' AND identifier != %@", "your-connections-remove.\(server)")).firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "Remove asks first")
        confirm.tap()
        XCTAssertTrue(eventually { self.mine() == nil }, "removed on the server")
        XCTAssertTrue(eventually { !row.exists }, "and from the list")
    }
}
