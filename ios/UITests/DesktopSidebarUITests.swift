import XCTest

/// The iPad desktop sidebar (I2) against the parity fixture server: the row
/// and section menus, a bot dragged onto another team (DD1), the rail, and
/// the ⌘ keys (KB1, KB2). Each write is checked on the server (`/api/bots`,
/// `/api/sidebar-sections`) and put back through the API.
///
///   node ios/parity/fixture-server.mjs &
///   TEST_RUNNER_PARITY_ENDPOINT=... TEST_RUNNER_PARITY_TOKEN=... \
///   xcodebuild test -only-testing:SagaxUITests/DesktopSidebarUITests \
///     -destination 'platform=iOS Simulator,name=<an iPad>' ...
///
/// Skipped on an iPhone (the desktop shell is iPad only) and without a fixture.
final class DesktopSidebarUITests: XCTestCase {
    private var endpoint = ""
    private var token = ""
    private var environment: String?

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"], !token.isEmpty else {
            throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN")
        }
        guard UIDevice.current.userInterfaceIdiom == .pad else {
            throw XCTSkip("the desktop sidebar is the iPad's")
        }
        self.endpoint = endpoint
        self.token = token
        environment = env["PARITY_ENVIRONMENT"].flatMap { $0.isEmpty ? nil : $0 }
    }

    // MARK: Launch

    @MainActor
    private func launch() -> XCUIApplication {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", endpoint, "-parityToken", token, "-parityIPadScreen", "main",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.prefs.islandIntro", "never",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
            "-companion.sidebarPrefs.parity-harness", "{}",
        ]
        if let environment { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(app.buttons["desktop-sidebar-account"].waitForExistence(timeout: 30), "the desktop shell")
        return app
    }

    // MARK: API

    @discardableResult
    private func api(_ method: String, _ path: String, _ body: [String: Any]? = nil) throws -> Any? {
        var request = URLRequest(url: try XCTUnwrap(URL(string: endpoint + path)))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
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
        wait(for: [done], timeout: 20)
        let status = (result.1 as? HTTPURLResponse)?.statusCode ?? 0
        XCTAssertTrue((200...299).contains(status), "\(method) \(path) -> \(status)")
        guard let data = result.0, !data.isEmpty else { return nil }
        return try JSONSerialization.jsonObject(with: data)
    }

    private func bots() throws -> [[String: Any]] {
        (try api("GET", "/api/bots") as? [String: Any])?["bots"] as? [[String: Any]] ?? []
    }

    private func bot(named name: String) throws -> [String: Any] {
        try XCTUnwrap(try bots().first { $0["name"] as? String == name }, "no bot named \(name)")
    }

    private func eventually(_ what: String, timeout: TimeInterval = 15, _ check: () throws -> Bool) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try check() { return }
            Thread.sleep(forTimeInterval: 0.4)
        }
        XCTFail("never happened: \(what)")
    }

    // MARK: Helpers

    @MainActor
    private func row(_ id: String, in app: XCUIApplication) -> XCUIElement {
        let element = app.buttons["desktop-row.\(id)"].firstMatch
        let list = app.scrollViews.firstMatch
        for step in 0..<10 where !element.waitForExistence(timeout: 1) || !element.isHittable {
            if step < 5 { list.swipeUp() } else { list.swipeDown() }
        }
        XCTAssertTrue(element.waitForExistence(timeout: 10), "row \(id)")
        return element
    }

    @MainActor
    private func tapMenuItem(_ label: String, in app: XCUIApplication) {
        let item = app.buttons[label].firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 5), "menu item \(label)")
        item.tap()
    }

    // MARK: Tests

    /// A long press on a row opens the bot menu: Pin pins it on the server
    /// and the tile's own menu unpins it; Move to files it in another team.
    @MainActor
    func testBotMenuPinsAndMovesToATeam() throws {
        let helix = try bot(named: "Helix")
        let helixId = try XCTUnwrap(helix["id"] as? String)
        let originalSection = helix["section"] as? String ?? ""
        let target = try XCTUnwrap(try bots().compactMap { $0["section"] as? String }.first { !$0.isEmpty && $0 != originalSection })
        defer {
            _ = try? api("PATCH", "/api/bots/\(helixId)", ["pinned": false])
            if !originalSection.isEmpty { _ = try? api("POST", "/api/sidebar-sections", ["name": originalSection, "botIds": [helixId]]) }
        }
        let app = launch()

        row(helixId, in: app).press(forDuration: 1.2)
        tapMenuItem("Pin", in: app)
        try eventually("Helix pinned on the server") { try bot(named: "Helix")["pinned"] as? Bool == true }
        let tile = app.buttons["desktop-pinned.\(helixId)"].firstMatch
        XCTAssertTrue(tile.waitForExistence(timeout: 10), "Helix's pinned tile")

        tile.press(forDuration: 1.2)
        tapMenuItem("Unpin", in: app)
        try eventually("Helix unpinned") { try bot(named: "Helix")["pinned"] as? Bool != true }

        row(helixId, in: app).press(forDuration: 1.2)
        tapMenuItem("Move to", in: app)
        tapMenuItem(target, in: app)
        try eventually("Helix filed in \(target)") { try bot(named: "Helix")["section"] as? String == target }
    }

    /// DD1: a row dragged onto another section's header files the bot there
    /// (`POST /api/sidebar-sections`), as the desktop's drop does.
    @MainActor
    func testDraggingABotOntoAnotherSectionFilesIt() throws {
        let aurora = try bot(named: "Aurora")
        let auroraId = try XCTUnwrap(aurora["id"] as? String)
        let originalSection = try XCTUnwrap(aurora["section"] as? String)
        let target = try XCTUnwrap(try bots().compactMap { $0["section"] as? String }.first { !$0.isEmpty && $0 != originalSection })
        defer { _ = try? api("POST", "/api/sidebar-sections", ["name": originalSection, "botIds": [auroraId]]) }
        let app = launch()

        let source = row(auroraId, in: app)
        let header = app.buttons["desktop-section-header.section:\(target)"].firstMatch
        XCTAssertTrue(header.waitForExistence(timeout: 10), "the \(target) header")
        source.press(forDuration: 1.0, thenDragTo: header)
        try eventually("Aurora filed in \(target)", timeout: 20) { try bot(named: "Aurora")["section"] as? String == target }
    }

    /// The section menu's Rename team renames it on the server.
    @MainActor
    func testSectionMenuRenamesTheTeamOnTheServer() throws {
        let aurora = try bot(named: "Aurora")
        let team = try XCTUnwrap(aurora["section"] as? String)
        let renamed = "\(team) bis"
        defer {
            let encoded = renamed.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? renamed
            _ = try? api("PATCH", "/api/sidebar-sections?section=\(encoded)", ["name": team])
        }
        let app = launch()

        let header = app.buttons["desktop-section-header.section:\(team)"].firstMatch
        XCTAssertTrue(header.waitForExistence(timeout: 10))
        header.press(forDuration: 1.2)
        tapMenuItem("Rename team", in: app)
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        let field = alert.textFields.firstMatch
        field.tap()
        field.typeText(" bis")
        alert.buttons["Save"].firstMatch.tap()
        try eventually("the team renamed") { try bot(named: "Aurora")["section"] as? String == renamed }
    }

    /// Collapse folds the sidebar to the rail and Expand brings it back;
    /// ⌘1 and ⌘⇧] select bots in the roster's order.
    @MainActor
    func testRailAndKeyboardShortcuts() throws {
        let visible = try bots().filter { $0["hidden"] as? Bool != true }
        let first = try XCTUnwrap(visible.first?["id"] as? String)
        let second = try XCTUnwrap(visible.dropFirst().first?["id"] as? String)
        let app = launch()

        app.buttons["desktop-sidebar-collapse"].firstMatch.tap()
        XCTAssertTrue(app.buttons["desktop-sidebar-expand"].waitForExistence(timeout: 5), "the rail")
        app.buttons["desktop-sidebar-expand"].firstMatch.tap()
        XCTAssertTrue(app.buttons["desktop-sidebar-collapse"].waitForExistence(timeout: 5), "the full sidebar")

        app.typeKey("1", modifierFlags: .command)
        try eventually("bot 1 selected") { self.isSelected(first, in: app) }
        app.typeKey("]", modifierFlags: [.command, .shift])
        try eventually("bot 2 selected") { self.isSelected(second, in: app) }
    }

    @MainActor
    private func isSelected(_ id: String, in app: XCUIApplication) -> Bool {
        let tile = app.buttons["desktop-pinned.\(id)"].firstMatch
        if tile.exists { return tile.isSelected }
        let row = app.buttons["desktop-row.\(id)"].firstMatch
        return row.exists && row.isSelected
    }
}
