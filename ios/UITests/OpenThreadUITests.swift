import XCTest

/// Bug 2026-10-16 (iOS 0.5.9 to 0.5.11, JC: "I cannot open a chat"): a tap
/// pushed the chat and it closed itself on its first frame, with no request
/// and no word, when the bot's selected thread was outside its thread list.
///
/// The first two tests run on the bundled OpenThreadPreview fleet (no
/// server): Scout as usual, Ghost with its thread outside its list (what an
/// organization server can send), Viewer with no thread of the person's.
///
/// The last one creates a bot, edits it and opens it against a real server
/// (the parity fixture, organization mode is JC's case):
///
///   PARITY_ORG=1 PARITY_ORG_PHONE=1 node ios/parity/fixture-server.mjs &
///   TEST_RUNNER_PARITY_ENDPOINT=... TEST_RUNNER_PARITY_TOKEN=... \
///   TEST_RUNNER_PARITY_ENVIRONMENT=... xcodebuild test \
///     -only-testing:SagaxUITests/OpenThreadUITests ...
///
/// Without that session (or `ios/parity/out/session.json`) it skips.
final class OpenThreadUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    // MARK: Preview fleet

    @MainActor
    private func launchPreview() -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = [
            "-store-preview", "-open-thread-preview",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
            "-companion.prefs.rosterDensity", "standard",
        ]
        app.launch()
        // The first launch after an install can restore a prewarmed scene
        // without the preview arguments: restart that wrong route, once.
        if !app.buttons["chat-row.preview-scout"].waitForExistence(timeout: 10) {
            app.terminate()
            app.launch()
        }
        XCTAssertTrue(app.buttons["chat-row.preview-scout"].waitForExistence(timeout: 20))
        return app
    }

    @MainActor
    private func assertChatOpen(_ greeting: String, in app: XCUIApplication, _ message: String) {
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 10), message)
        XCTAssertTrue(app.staticTexts[greeting].waitForExistence(timeout: 5), message)
        // still there a moment later: the chat did not close itself
        Thread.sleep(forTimeInterval: 1.5)
        XCTAssertTrue(app.buttons["chat-name"].exists, "\(message): the chat closed itself")
    }

    @MainActor
    private func backHome(_ app: XCUIApplication) {
        let back = app.buttons["Back"].firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 5))
        back.tap()
        XCTAssertTrue(app.buttons["home-plus"].waitForExistence(timeout: 10))
    }

    /// Ghost's selected thread is not in its list: it opens, and stays open.
    @MainActor
    func testABotWhoseThreadIsOutsideItsListOpens() {
        let app = launchPreview()
        app.buttons["chat-row.preview-scout"].tap()
        assertChatOpen("Hi, I'm Scout.", in: app, "an ordinary bot")
        backHome(app)

        app.buttons["chat-row.preview-ghost"].tap()
        assertChatOpen("Hi, I'm Ghost.", in: app, "a bot whose thread is outside its list")
        backHome(app)
    }

    /// Viewer has no thread of the person's: after asking again (no server
    /// in the preview), the chat says so, with Try again and Back.
    @MainActor
    func testABotWithNoThreadOfYoursExplainsAndOffersTryAgainAndBack() {
        let app = launchPreview()
        app.buttons["chat-row.preview-viewer"].tap()
        let problem = app.descendants(matching: .any)["open-problem"].firstMatch
        XCTAssertTrue(problem.waitForExistence(timeout: 10), "an explanation, not a silent return home")
        XCTAssertTrue(app.staticTexts["This conversation can't be opened"].exists)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Open problem"
        attachment.lifetime = .keepAlways
        add(attachment)

        let retry = app.buttons["open-problem-retry"]
        XCTAssertTrue(retry.exists)
        retry.tap()
        XCTAssertTrue(problem.waitForExistence(timeout: 10), "still explained after Try again")

        app.buttons["open-problem-back"].tap()
        XCTAssertTrue(app.buttons["chat-row.preview-viewer"].waitForExistence(timeout: 10))
    }

    // MARK: Real server: create, edit, open

    private struct FixtureSession: Decodable {
        let endpoint: String
        let token: String
        let environmentId: String?
    }

    private func fixtureSession() throws -> FixtureSession {
        let env = ProcessInfo.processInfo.environment
        if let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"] {
            return FixtureSession(endpoint: endpoint, token: token, environmentId: env["PARITY_ENVIRONMENT"].flatMap { $0.isEmpty ? nil : $0 })
        }
        let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("parity/out/session.json")
        guard let data = try? Data(contentsOf: file) else {
            throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN")
        }
        return try JSONDecoder().decode(FixtureSession.self, from: data)
    }

    @discardableResult
    private func api(_ fixture: FixtureSession, _ method: String, _ path: String, body: [String: Any]? = nil) throws -> Any? {
        var request = URLRequest(url: try XCTUnwrap(URL(string: fixture.endpoint + path)))
        request.httpMethod = method
        request.timeoutInterval = 60
        request.setValue("Bearer \(fixture.token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let done = expectation(description: "\(method) \(path)")
        var result: (Data?, URLResponse?) = (nil, nil)
        URLSession.shared.dataTask(with: request) { data, response, _ in
            result = (data, response)
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 70)
        let status = (result.1 as? HTTPURLResponse)?.statusCode ?? 0
        XCTAssertTrue((200...299).contains(status), "\(method) \(path) -> \(status)")
        guard let data = result.0, !data.isEmpty else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    private func serverBotId(_ fixture: FixtureSession, named name: String) throws -> String? {
        let bots = (try api(fixture, "GET", "/api/bots?messages=0") as? [String: Any])?["bots"] as? [[String: Any]] ?? []
        return bots.first { $0["name"] as? String == name }?["id"] as? String
    }

    /// JC's session on GOX: edits two bots, creates one from the phone, then
    /// opens it from the home. Each open shows the chat and keeps it.
    @MainActor
    func testCreateEditThenOpenFromTheHome() throws {
        let fixture = try fixtureSession()
        let name = "Probe \(Int(Date().timeIntervalSince1970) % 100_000)"
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", fixture.endpoint, "-parityToken", fixture.token, "-parityScreen", "01-home",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.prefs.rosterDensity", "standard",
        ]
        if let environment = fixture.environmentId { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(app.buttons["home-plus"].waitForExistence(timeout: 30))

        // New bot from the + menu; Create opens its chat.
        app.buttons["home-plus"].tap()
        let item = app.buttons["plus-menu.new-bot"]
        XCTAssertTrue(item.waitForExistence(timeout: 5))
        item.tap()
        let field = app.textFields["create-bot-name"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        if let current = field.value as? String, !current.isEmpty {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 2))
        }
        field.typeText(name)
        // With the keyboard up, Create rides above it.
        let aboveKeyboard = app.buttons["create-bot-submit-keyboard"]
        (aboveKeyboard.exists && aboveKeyboard.isHittable ? aboveKeyboard : app.buttons["create-bot-submit"]).tap()
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 20), "Create opens the new chat")
        Thread.sleep(forTimeInterval: 1.5)
        XCTAssertTrue(app.buttons["chat-name"].exists, "the new chat closed itself")
        backHome(app)

        // Edit it on the server (the PATCH the phone's pin sends): its frame
        // reaches the phone narrowed for this person.
        let id = try XCTUnwrap(try serverBotId(fixture, named: name), "the server has the new bot")
        defer { _ = try? api(fixture, "DELETE", "/api/bots/\(id)") }
        try api(fixture, "PATCH", "/api/bots/\(id)", body: ["pinned": true])
        try api(fixture, "PATCH", "/api/bots/\(id)", body: ["pinned": false])

        let row = app.buttons["chat-row.\(id)"]
        XCTAssertTrue(row.waitForExistence(timeout: 20), "the new bot is on the home")
        row.tap()
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 10), "the new bot opens from the home")
        Thread.sleep(forTimeInterval: 1.5)
        XCTAssertTrue(app.buttons["chat-name"].exists, "the chat closed itself")
        XCTAssertFalse(app.descendants(matching: .any)["open-problem"].exists)
        backHome(app)

        // A new thread made on the server (another device), then the bot
        // opened again: it lands on a thread the phone can show.
        try api(fixture, "POST", "/api/bots/\(id)/tasks", body: ["title": "From elsewhere"])
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 10), "opens after a thread made elsewhere")
        Thread.sleep(forTimeInterval: 1.5)
        XCTAssertTrue(app.buttons["chat-name"].exists, "the chat closed itself")
    }
}
