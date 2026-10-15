import XCTest

/// Chat widgets (`show_widget`, message kind "widget") against the parity
/// fixture's widget lab (`PARITY_WIDGETS=1 node ios/parity/fixture-server.mjs`,
/// ios/parity/widget-lab.mjs): every sample the server's own fixtures hold,
/// drawn as cards; a required choice stops a confirm in place; a pick and a
/// confirm go to the real send route and fold the card into its settled line;
/// "Show all" unfolds a list; a tree this build cannot read shows its text.
///
/// The session comes from TEST_RUNNER_PARITY_ENDPOINT / _TOKEN / _ENVIRONMENT
/// or `ios/parity/out/session.json`; without the widget lab the tests are
/// skipped. With TEST_RUNNER_SAGAX_SHOTS each step is also saved as a PNG.
final class ChatWidgetsUITests: XCTestCase {
    private struct FixtureSession: Decodable {
        let endpoint: String
        let token: String
        let environmentId: String?
    }

    private struct WireBot: Decodable { let name: String }
    private struct Fleet: Decodable { let bots: [WireBot] }

    private func fixtureSession() throws -> FixtureSession {
        let env = ProcessInfo.processInfo.environment
        if let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"] {
            return FixtureSession(endpoint: endpoint, token: token, environmentId: env["PARITY_ENVIRONMENT"].flatMap { $0.isEmpty ? nil : $0 })
        }
        let file = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("parity/out/session.json")
        guard let data = try? Data(contentsOf: file) else {
            throw XCTSkip("parity fixture server is not running (\(file.path))")
        }
        return try JSONDecoder().decode(FixtureSession.self, from: data)
    }

    private func requireWidgetLab(_ fixture: FixtureSession) throws {
        var request = URLRequest(url: URL(string: fixture.endpoint + "/api/bots")!)
        request.setValue("Bearer \(fixture.token)", forHTTPHeaderField: "Authorization")
        let done = expectation(description: "fleet")
        var names: [String] = []
        URLSession.shared.dataTask(with: request) { data, _, _ in
            names = (data.flatMap { try? JSONDecoder().decode(Fleet.self, from: $0) }?.bots ?? []).map(\.name)
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 30)
        guard names.contains("Widget Lab") else { throw XCTSkip("the fixture runs without PARITY_WIDGETS=1") }
    }

    @MainActor
    private func launch(language: String = "fr") throws -> XCUIApplication {
        continueAfterFailure = false
        let fixture = try fixtureSession()
        try requireWidgetLab(fixture)
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", fixture.endpoint,
            "-parityToken", fixture.token,
            "-parityScreen", "02-chat",
            "-parityChat", "Widget Lab",
            "-AppleLanguages", "(\(language))", "-AppleLocale", language == "fr" ? "fr_CA" : "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
        ]
        if let environment = fixture.environmentId { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 30))
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    /// Scroll the transcript until the element is on screen.
    @MainActor
    @discardableResult
    private func reveal(_ app: XCUIApplication, _ id: String, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        let target = element(app, id)
        _ = target.waitForExistence(timeout: 3)
        let window = app.windows.firstMatch.frame
        let top = window.minY + 110
        let bottom = window.maxY - 160
        for _ in 0..<40 {
            guard target.exists else {
                app.swipeDown(velocity: .slow)
                continue
            }
            let frame = target.frame
            if target.isHittable && frame.minY >= top - 10 && (frame.maxY <= bottom || frame.height > bottom - top) {
                return target
            }
            let delta = max(-260, min(260, (top + bottom) / 2 - frame.midY))
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            let end = start.withOffset(CGVector(dx: 0, dy: delta))
            start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        XCTAssertTrue(target.exists && target.isHittable, "\(id) on screen", file: file, line: line)
        return target
    }

    /// Scroll so the top of a card sits under the top bar, for a picture of it.
    @MainActor
    private func frame(_ app: XCUIApplication, _ id: String) {
        let target = reveal(app, id)
        let top = app.windows.firstMatch.frame.minY + 120
        let delta = max(-300, min(300, top - target.frame.minY))
        if abs(delta) > 20 {
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            start.press(forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: 0, dy: delta)), withVelocity: .slow, thenHoldForDuration: 0.3)
        }
    }

    @MainActor
    func testEverySampleDrawsAsACard() throws {
        let app = try launch()
        // the last widget, a choice list, sits over the composer (the other
        // test answers it on the server, so it may already be its settled line)
        XCTAssertTrue(reveal(app, "message-widget-dinnerChoice").exists)
        ParityShots.save("widgets-01-choice", app)
        frame(app, "message-widget-routineForm")
        XCTAssertTrue(element(app, "widget-widget-routineForm-button-confirm").exists)
        XCTAssertTrue(element(app, "widget-day-mon").exists)
        ParityShots.save("widgets-02-routine-form", app)
        frame(app, "message-widget-bookCall")
        ParityShots.save("widgets-03-book-call", app)
        frame(app, "message-widget-pullRequests")
        XCTAssertTrue(element(app, "widget-widget-pullRequests-row-n2").exists)
        ParityShots.save("widgets-04-pull-requests", app)
        frame(app, "message-widget-buildStatus")
        ParityShots.save("widgets-05-build-status", app)
        frame(app, "message-widget-emailDraft")
        ParityShots.save("widgets-06-email", app)
        frame(app, "message-widget-spendTable")
        XCTAssertTrue(element(app, "widget-table").exists)
        frame(app, "message-widget-tokenChart")
        XCTAssertTrue(element(app, "widget-chart").exists)
        ParityShots.save("widgets-07-table-chart", app)
        frame(app, "message-widget-kitchenSink")
        ParityShots.save("widgets-08-kitchen-sink", app)
        // Show all (3) unfolds the list past its limit of 2
        frame(app, "message-widget-sources")
        let more = reveal(app, "widget-widget-sources-show-all")
        XCTAssertTrue(more.label.contains("3"), more.label)
        ParityShots.save("widgets-09-sources-folded", app)
        more.tap()
        XCTAssertFalse(element(app, "widget-widget-sources-show-all").waitForExistence(timeout: 2))
        // a settled widget is one line, with its card behind Details
        reveal(app, "widget-details-widget-settled").tap()
        ParityShots.save("widgets-10-settled-details", app)
        // a tree from the future draws what it knows; a broken one, its text
        XCTAssertTrue(reveal(app, "message-widget-future").exists)
        XCTAssertTrue(reveal(app, "message-widget-broken").exists)
    }

    @MainActor
    func testARequiredChoiceStopsConfirmThenAPickSends() throws {
        let app = try launch()
        let card = reveal(app, "message-widget-dinnerChoice")
        XCTAssertTrue(card.exists)
        reveal(app, "widget-widget-dinnerChoice-button-confirm").tap()
        // the problem line, in the card, in French
        let problem = element(app, "widget-problem")
        XCTAssertTrue(problem.waitForExistence(timeout: 5))
        XCTAssertTrue(problem.label.contains("est requis"), problem.label)
        ParityShots.save("widgets-11-required", app)
        // pick the pizza row, then confirm: the real route takes it and the card folds
        let rows = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "widget-widget-dinnerChoice-choice-"))
        XCTAssertGreaterThanOrEqual(rows.count, 3)
        rows.element(boundBy: 2).tap()
        XCTAssertFalse(problem.waitForExistence(timeout: 1))
        ParityShots.save("widgets-12-picked", app)
        reveal(app, "widget-widget-dinnerChoice-button-confirm").tap()
        let line = element(app, "widget-details-widget-dinnerChoice")
        XCTAssertTrue(line.waitForExistence(timeout: 15))
        ParityShots.save("widgets-13-sent", app)
    }
}
