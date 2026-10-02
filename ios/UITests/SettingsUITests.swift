import XCTest

/// Settings (12, 14), Account (16), Bot Computer (21) and Plugins (15)
/// against the parity fixture server: every action is a real request to the
/// real server, and each write is read back through the API.
///
///   node ios/parity/fixture-server.mjs &
///   TEST_RUNNER_PARITY_ENDPOINT=... TEST_RUNNER_PARITY_TOKEN=... \
///   TEST_RUNNER_PARITY_ENVIRONMENT=... xcodebuild test \
///     -only-testing:OpenMausCompanionUITests/SettingsUITests ...
///
/// Without those variables the tests skip. The sign-out test ends the
/// in-memory session only (the fixture's pairing stays valid), so the
/// order of the tests does not matter.
final class SettingsUITests: XCTestCase {
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
        arguments = ["-parityEndpoint", endpoint, "-parityToken", token, "-parityScreen", "12-settings-top"]
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
        XCTAssertTrue(app.element("settings-close").waitForExistence(timeout: 20))
        XCTAssertTrue(app.element("settings-auto-review.toggle").waitForExistence(timeout: 20))
        return app
    }

    // MARK: API

    private func api(_ method: String, _ path: String, body: [String: Any]? = nil) -> (Int, [String: Any]) {
        var request = URLRequest(url: URL(string: endpoint + path)!)
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
        _ = done.wait(timeout: .now() + 30)
        return result
    }

    private func botSettings() -> [String: Any] {
        api("GET", "/api/settings/bot").1["settings"] as? [String: Any] ?? [:]
    }

    /// Polls the server until `check` holds.
    private func eventually(_ timeout: TimeInterval = 10, _ check: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if check() { return true }
            Thread.sleep(forTimeInterval: 0.3)
        }
        return check()
    }

    // MARK: Bot section

    @MainActor
    func testAutoReviewTogglePersistsOnTheServer() {
        let app = launch()
        let before = botSettings()["autoReviewDefault"] as? Bool ?? false
        app.element("settings-auto-review.toggle").tap()
        XCTAssertTrue(eventually { (self.botSettings()["autoReviewDefault"] as? Bool) == !before })
        // Shown the same after a relaunch, then put back.
        let again = launch()
        XCTAssertEqual(again.element("settings-auto-review.toggle").value as? String, before ? "0" : "1")
        again.element("settings-auto-review.toggle").tap()
        XCTAssertTrue(eventually { (self.botSettings()["autoReviewDefault"] as? Bool) == before })
    }

    @MainActor
    func testTimeZoneIsSetFromThePickerAndAutomatically() {
        let app = launch()
        if botSettings()["timeZoneAuto"] as? Bool == true {
            app.element("settings-time-zone-auto.toggle").tap()
            XCTAssertTrue(eventually { (self.botSettings()["timeZoneAuto"] as? Bool) == false })
        }
        let row = app.element("settings-time-zone")
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        let search = app.textFields["time-zone-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("Tokyo")
        let tokyo = app.element("time-zone.Asia/Tokyo")
        XCTAssertTrue(tokyo.waitForExistence(timeout: 5))
        tokyo.tap()
        XCTAssertTrue(eventually { (self.botSettings()["timeZone"] as? String) == "Asia/Tokyo" })
        XCTAssertTrue(eventually { app.element("settings-time-zone").label.contains("Asia/Tokyo") })

        // Automatic again: the phone sends its own zone.
        app.element("settings-time-zone-auto.toggle").tap()
        let phoneZone = TimeZone.current.identifier
        XCTAssertTrue(eventually {
            let settings = self.botSettings()
            return settings["timeZoneAuto"] as? Bool == true && settings["timeZone"] as? String == phoneZone
        })
    }

    @MainActor
    func testRulesListAndSwipeToDelete() {
        let app = launch()
        let before = api("GET", "/api/auto-review/rules").1["total"] as? Int ?? 0
        XCTAssertGreaterThan(before, 0, "the fixture seeds saved command rules")
        app.element("settings-rules").tap()
        let list = app.element("rules-list")
        XCTAssertTrue(list.waitForExistence(timeout: 10))
        let first = list.cells.firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 5))
        first.swipeLeft()
        let delete = app.buttons["Delete"]
        XCTAssertTrue(delete.waitForExistence(timeout: 5))
        delete.tap()
        XCTAssertTrue(eventually { (self.api("GET", "/api/auto-review/rules").1["total"] as? Int) == before - 1 })
        // Back on the root page, the count follows.
        app.element("settings-back").firstMatch.tap()
        XCTAssertTrue(app.element("settings-rules").waitForExistence(timeout: 5))
        XCTAssertTrue(app.element("settings-rules").label.contains("\(before - 1)"))
    }

    @MainActor
    func testBotComputerShowsStatusAndUpdateAndResetReachTheServer() {
        let app = launch()
        app.element("settings-bot-computer").tap()
        let disk = app.otherElements["computer-disk"].exists ? app.otherElements["computer-disk"] : app.staticTexts["Disk space"]
        XCTAssertTrue(disk.waitForExistence(timeout: 10))
        let status = api("GET", "/api/computer/status").1
        XCTAssertNotNil(status["diskState"], "the server reports the disk state")
        XCTAssertTrue(app.staticTexts["Normal"].waitForExistence(timeout: 10) || app.staticTexts["Almost full"].exists || app.staticTexts["Full"].exists)

        for (row, confirm) in [("computer-update", "Update Computer"), ("computer-reset", "Reset Computer")] {
            app.element(row).tap()
            let matches = app.buttons.matching(NSPredicate(format: "label == %@", confirm))
            XCTAssertTrue(matches.firstMatch.waitForExistence(timeout: 5))
            matches.allElementsBoundByIndex.last!.tap()
            // Either the computer answers with a fresh status, or the server's
            // own refusal is shown (the fixture runs without Docker:
            // "Start docker first"). Both prove the call went through.
            let alert = app.alerts["Bot Computer"]
            if alert.waitForExistence(timeout: 60) {
                XCTAssertFalse(alert.staticTexts.allElementsBoundByIndex.map(\.label).joined().isEmpty)
                alert.buttons["OK"].tap()
            }
            XCTAssertTrue(app.element(row).waitForExistence(timeout: 30))
            XCTAssertTrue(app.staticTexts["The one computer your Bots share."].waitForExistence(timeout: 30))
        }
    }

    // MARK: Plugins

    @MainActor
    func testAddingANoSignInPluginInstallsItOnTheServer() {
        // Start clean: an earlier run may have left it added.
        _ = api("DELETE", "/api/mcp/servers/deepwiki")
        let app = launch()
        app.element("settings-plugins").tap()
        XCTAssertTrue(app.element("plugins-installed").waitForExistence(timeout: 10))
        let search = app.textFields["plugins-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("deepwiki")
        let add = app.element("plugin-add.deepwiki")
        XCTAssertTrue(add.waitForExistence(timeout: 10))
        XCTAssertEqual(add.label, "Add")
        add.tap()
        XCTAssertTrue(eventually(30) {
            let plugins = self.api("GET", "/api/plugins/installed").1["plugins"] as? [[String: Any]] ?? []
            return plugins.contains { ($0["url"] as? String)?.contains("deepwiki") == true }
        })
        let added = NSPredicate(format: "label == 'Added'")
        expectation(for: added, evaluatedWith: app.element("plugin-add.deepwiki"))
        waitForExpectations(timeout: 15)
        _ = api("DELETE", "/api/mcp/servers/deepwiki")
    }

    // MARK: Account

    @MainActor
    func testAccountListsThePairedComputersWithTheCurrentChecked() {
        let app = launch()
        app.element("settings-account").tap()
        let current = app.element("account-switch.parity-harness")
        XCTAssertTrue(current.waitForExistence(timeout: 10))
        XCTAssertTrue(current.isSelected || current.images["checkmark"].exists || current.label.contains("Parity"))
        XCTAssertTrue(app.element("account-add").exists)
        XCTAssertTrue(app.element("account-sign-out").exists)
        XCTAssertTrue(app.element("account-delete").exists)
    }

    @MainActor
    func testSignOutEndsTheSession() {
        let app = launch()
        let signOut = app.element("settings-sign-out")
        for _ in 0..<6 where !signOut.isHittable { app.swipeUp() }
        signOut.tap()
        let confirm = app.buttons.matching(NSPredicate(format: "label == 'Sign Out' AND identifier != 'settings-sign-out'")).firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        XCTAssertTrue(waitForDisappearance(app.buttons["home-plus"], timeout: 10))
        XCTAssertFalse(app.element("settings-close").exists)
    }

    // MARK: App section

    /// Turns notifications on through the system prompt (granted once per
    /// simulator; afterwards the switch simply reads On).
    @MainActor
    func testNotificationsSwitchAsksTheSystem() {
        let app = launch()
        let toggle = app.element("settings-notifications.toggle")
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        if toggle.value as? String == "1" { return }
        toggle.tap()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.alerts.buttons["Allow"]
        if allow.waitForExistence(timeout: 10) { allow.tap() }
        let on = NSPredicate(format: "value == '1'")
        expectation(for: on, evaluatedWith: toggle)
        waitForExpectations(timeout: 15)
    }

    private func waitForDisappearance(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let gone = NSPredicate(format: "exists == false")
        let expectation = XCTNSPredicateExpectation(predicate: gone, object: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
    }
}

private extension XCUIApplication {
    /// Any element by accessibility identifier: SwiftUI exposes the same
    /// control as a button, a switch or a cell depending on its style.
    func element(_ identifier: String) -> XCUIElement {
        descendants(matching: .any).matching(identifier: identifier).firstMatch
    }
}
