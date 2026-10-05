import XCTest

/// WP13 of the iOS feature parity matrix: New bot's More options (rows NB2
/// starting role, NB3 team, NB4 title, description, instructions) against
/// the parity fixture. Each test creates the bot in the app, then reads it
/// back through the server's API, so a field that only changed the screen
/// fails.
///
/// Start the fixture with its imported preset ("Fixture Analyst"):
///
///   PARITY_PRESETS=1 node ios/parity/fixture-server.mjs &
///
/// The session comes from TEST_RUNNER_PARITY_ENDPOINT / _TOKEN /
/// _ENVIRONMENT or `ios/parity/out/session.json`; without one the tests skip.
final class NewBotUITests: XCTestCase {
    private struct FixtureSession: Decodable {
        let endpoint: String
        let token: String
        let environmentId: String?
    }

    private var fixture: FixtureSession!
    private var made: [String] = []

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        if let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"] {
            fixture = FixtureSession(endpoint: endpoint, token: token, environmentId: env["PARITY_ENVIRONMENT"].flatMap { $0.isEmpty ? nil : $0 })
            return
        }
        let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("parity/out/session.json")
        guard let data = try? Data(contentsOf: file) else { throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN") }
        fixture = try JSONDecoder().decode(FixtureSession.self, from: data)
    }

    override func tearDownWithError() throws {
        for id in made { try api("DELETE", "/api/bots/\(id)", allowFailure: true) }
    }

    // MARK: API

    @discardableResult
    private func api(_ method: String, _ path: String, allowFailure: Bool = false) throws -> Any? {
        var request = URLRequest(url: try XCTUnwrap(URL(string: fixture.endpoint + path)))
        request.httpMethod = method
        request.timeoutInterval = 60
        request.setValue("Bearer \(fixture.token)", forHTTPHeaderField: "Authorization")
        let done = expectation(description: "\(method) \(path)")
        var result: (Data?, URLResponse?) = (nil, nil)
        URLSession.shared.dataTask(with: request) { data, response, _ in
            result = (data, response)
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 70)
        let status = (result.1 as? HTTPURLResponse)?.statusCode ?? 0
        if !allowFailure {
            XCTAssertTrue((200...299).contains(status), "\(method) \(path) -> \(status)")
        }
        guard let data = result.0, !data.isEmpty else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    /// The bot the app made, once the server has it; remembered for cleanup.
    private func serverBot(named name: String) throws -> [String: Any] {
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline {
            let bots = (try api("GET", "/api/bots") as? [String: Any])?["bots"] as? [[String: Any]] ?? []
            if let bot = bots.first(where: { $0["name"] as? String == name }) {
                if let id = bot["id"] as? String { made.append(id) }
                return bot
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        XCTFail("the server never had \(name)")
        return [:]
    }

    private func soul(_ bot: [String: Any]) throws -> String? {
        let id = try XCTUnwrap(bot["id"] as? String)
        return (try api("GET", "/api/bots/\(id)/soul") as? [String: Any])?["soul"] as? String
    }

    // MARK: App

    @MainActor
    private func launch() -> XCUIApplication {
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
        return app
    }

    @MainActor
    private func openCreateFromPlus(_ app: XCUIApplication) {
        app.buttons["home-plus"].tap()
        let item = app.buttons["plus-menu.new-bot"]
        XCTAssertTrue(item.waitForExistence(timeout: 5))
        item.tap()
        XCTAssertTrue(app.buttons["create-bot-submit"].waitForExistence(timeout: 5))
    }

    /// More options sits below the editor's first screen: scroll to it.
    @MainActor
    private func openMoreOptions(_ app: XCUIApplication) {
        let row = app.buttons["create-bot-more-options"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        let sheet = app.otherElements["create-bot-sheet"].firstMatch
        for _ in 0..<4 where !row.isHittable {
            sheet.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
                .press(forDuration: 0.05, thenDragTo: sheet.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45)))
        }
        XCTAssertTrue(row.isHittable, "More options is reachable by scrolling")
        row.tap()
        XCTAssertTrue(app.buttons["create-bot-options-done"].waitForExistence(timeout: 5))
    }

    /// A menu's item: the hittable button with that label (the home behind
    /// the sheet may carry the same words).
    @MainActor
    private func menuItem(_ label: String, in app: XCUIApplication) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline {
            let matches = app.buttons.matching(NSPredicate(format: "label == %@", label)).allElementsBoundByIndex
            if let item = matches.last(where: { $0.isHittable }) { return item }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return nil
    }

    @MainActor
    private func field(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    /// Select the field's text with the edit menu's Select All, then type
    /// over it (deleting from wherever the caret lands is unreliable).
    @MainActor
    private func replace(_ element: XCUIElement, with text: String, in app: XCUIApplication) {
        element.tap()
        let current = (element.value as? String) ?? ""
        if !current.isEmpty {
            element.press(forDuration: 1.0)
            let selectAll = app.menuItems["Select All"].firstMatch
            if selectAll.waitForExistence(timeout: 3) {
                selectAll.tap()
                // Clear first: typing over a long selection while the field
                // shrinks can drop keys.
                element.typeText(XCUIKeyboardKey.delete.rawValue)
                _ = element.waitForExistence(timeout: 1)
            } else {
                element.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 2))
            }
        }
        element.typeText(text)
        XCTAssertEqual(element.value as? String, text)
    }

    @MainActor
    private func createWithKeyboardReturn(_ app: XCUIApplication) {
        let key = app.keyboards.buttons.matching(NSPredicate(format: "label ==[c] 'done' OR identifier ==[c] 'done' OR label ==[c] 'return'")).firstMatch
        XCTAssertTrue(key.waitForExistence(timeout: 5), "the keyboard's return key")
        key.tap()
        XCTAssertTrue(waitForDisappearance(app.buttons["create-bot-submit"], timeout: 15))
    }

    private func waitForDisappearance(_ element: XCUIElement, timeout: TimeInterval = 8) -> Bool {
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element)
        return XCTWaiter().wait(for: [gone], timeout: timeout) == .completed
    }

    // MARK: Tests

    /// NB2 + NB3 + NB4: a preset fills the form, the person picks a team and
    /// edits the fields, and the server's bot has every one of them plus the
    /// preset it was made from.
    @MainActor
    func testAPresetFillsTheFormAndTheBotKeepsTeamAndEdits() throws {
        let app = launch()
        openCreateFromPlus(app)
        openMoreOptions(app)

        app.buttons["create-bot-starting-role"].tap()
        let preset = try XCTUnwrap(menuItem("Fixture Analyst", in: app), "the fixture's imported preset is offered")
        preset.tap()
        XCTAssertTrue(app.descendants(matching: .any)["create-bot-preset-summary"].waitForExistence(timeout: 5))
        XCTAssertEqual(field("create-bot-title", in: app).value as? String, "Data analyst")

        app.buttons["create-bot-team"].tap()
        try XCTUnwrap(menuItem("Administration", in: app)).tap()

        replace(field("create-bot-title", in: app), with: "Numbers lead", in: app)
        replace(field("create-bot-description", in: app), with: "Edited on the phone.", in: app)
        app.buttons["create-bot-options-done"].tap()

        // The preset named the bot "Analyst"; the person renames it.
        let name = app.textFields["create-bot-name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        XCTAssertEqual(name.value as? String, "Analyst")
        replace(name, with: "Nova Preset UI", in: app)
        createWithKeyboardReturn(app)

        let bot = try serverBot(named: "Nova Preset UI")
        XCTAssertEqual(bot["title"] as? String, "Numbers lead")
        XCTAssertEqual(bot["description"] as? String, "Edited on the phone.")
        XCTAssertEqual(bot["section"] as? String, "Administration")
        XCTAssertEqual(bot["color"] as? String, "purple", "the preset's look")
        XCTAssertEqual((bot["installedPackage"] as? [String: Any])?["presetKey"] as? String, "analyst")
        XCTAssertEqual(try soul(bot), "Placeholder: cite every figure.")
    }

    /// NB3 from a team's header, NB2 built-in role, NB4 instructions edited:
    /// the bot starts in that team with the role's title and the edited
    /// instructions, and no preset.
    @MainActor
    func testNewBotHereStartsInTheTeamWithABuiltInRole() throws {
        let app = launch()
        let header = app.descendants(matching: .any)["section.Administration"].firstMatch
        XCTAssertTrue(header.waitForExistence(timeout: 20))
        header.press(forDuration: 1.2)
        let here = app.buttons["section-new-bot"]
        XCTAssertTrue(here.waitForExistence(timeout: 5))
        here.tap()
        XCTAssertTrue(app.buttons["create-bot-submit"].waitForExistence(timeout: 5))
        openMoreOptions(app)

        XCTAssertTrue(app.buttons["create-bot-team"].label.contains("Administration"), app.buttons["create-bot-team"].label)
        app.buttons["create-bot-starting-role"].tap()
        try XCTUnwrap(menuItem("Researcher", in: app)).tap()
        XCTAssertEqual(field("create-bot-title", in: app).value as? String, "Researcher")
        replace(field("create-bot-instructions", in: app), with: "Placeholder: brief first.", in: app)
        app.buttons["create-bot-options-done"].tap()

        let name = app.textFields["create-bot-name"]
        XCTAssertEqual(name.value as? String, "Scout")
        replace(name, with: "Nova Role UI", in: app)
        createWithKeyboardReturn(app)

        let bot = try serverBot(named: "Nova Role UI")
        XCTAssertEqual(bot["title"] as? String, "Researcher")
        XCTAssertEqual(bot["description"] as? String, "Digs through the web and your files, and comes back with a sourced brief.")
        XCTAssertEqual(bot["section"] as? String, "Administration")
        XCTAssertNil(bot["installedPackage"] as? [String: Any])
        XCTAssertEqual(try soul(bot), "Placeholder: brief first.")
    }
}
