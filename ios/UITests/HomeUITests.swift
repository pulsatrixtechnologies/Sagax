import XCTest

/// The standard home (01, 18) and its sheets (17, 19, 20) against the parity
/// fixture server: every action here is a real request to a real server.
///
/// Start the fixture first and pass its session to the test runner:
///
///   node ios/parity/fixture-server.mjs &
///   TEST_RUNNER_PARITY_ENDPOINT=... TEST_RUNNER_PARITY_TOKEN=... \
///   TEST_RUNNER_PARITY_ENVIRONMENT=... xcodebuild test \
///     -only-testing:SagaxCompanionUITests/HomeUITests ...
///
/// Without those variables the tests skip.
final class HomeUITests: XCTestCase {
    private var arguments: [String] = []

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"] else {
            throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN")
        }
        arguments = ["-parityEndpoint", endpoint, "-parityToken", token, "-parityScreen", "01-home"]
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
        XCTAssertTrue(app.buttons["home-plus"].waitForExistence(timeout: 20))
        XCTAssertTrue(pinned("Ara", in: app).waitForExistence(timeout: 20))
        return app
    }

    private func pinned(_ name: String, in app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'pinned.' AND label CONTAINS %@", name)).firstMatch
    }

    private func row(_ name: String, in app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'chat-row.' AND label CONTAINS %@", name)).firstMatch
    }

    @MainActor
    func testPinAndUnpinMoveABotBetweenTheRowAndItsSection() {
        let app = launch()
        let helios = pinned("Helios", in: app)
        XCTAssertTrue(helios.exists)
        helios.press(forDuration: 1.2)
        let unpin = app.buttons["Unpin"]
        XCTAssertTrue(unpin.waitForExistence(timeout: 5))
        unpin.tap()
        XCTAssertTrue(row("Helios", in: app).waitForExistence(timeout: 10))
        XCTAssertFalse(pinned("Helios", in: app).exists)

        // Still unpinned after a relaunch: the server kept it.
        let again = launch()
        let heliosRow = row("Helios", in: again)
        XCTAssertTrue(heliosRow.waitForExistence(timeout: 10))
        heliosRow.press(forDuration: 1.2)
        let pin = again.buttons["Pin"]
        XCTAssertTrue(pin.waitForExistence(timeout: 5))
        pin.tap()
        // Back in the pinned row, which the long press scrolled away from.
        XCTAssertTrue(waitForDisappearance(row("Helios", in: again)))
        again.scrollViews["roster-list"].firstMatch.swipeDown()
        again.scrollViews["roster-list"].firstMatch.swipeDown()
        XCTAssertTrue(pinned("Helios", in: again).waitForExistence(timeout: 10))
    }

    @MainActor
    func testSectionsCollapseAndStayCollapsed() {
        let app = launch()
        let header = app.buttons["section.Administration"]
        XCTAssertTrue(header.waitForExistence(timeout: 10))
        XCTAssertTrue(row("Aurora", in: app).exists)
        header.tap()
        XCTAssertTrue(waitForDisappearance(row("Aurora", in: app)))

        let again = launch()
        let header2 = again.buttons["section.Administration"]
        XCTAssertTrue(header2.waitForExistence(timeout: 10))
        XCTAssertFalse(row("Aurora", in: again).exists)
        header2.tap()
        XCTAssertTrue(row("Aurora", in: again).waitForExistence(timeout: 5))
    }

    @MainActor
    func testSearchFindsBotsGroupsAndMessagesWithTheFilter() {
        let app = launch()
        app.buttons["home-search"].tap()
        let field = app.textFields["search-field"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        // Empty: every bot and group chat.
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'search-row.' AND label CONTAINS 'Peer Managers'")).firstMatch.waitForExistence(timeout: 5))
        field.typeText("gabarit")
        // A message hit from /api/search.
        let hit = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'search-hit.'")).firstMatch
        XCTAssertTrue(hit.waitForExistence(timeout: 10))
        // Messages off in the filter: the hit goes.
        app.buttons["search-filter"].tap()
        let messages = app.buttons["Messages"]
        XCTAssertTrue(messages.waitForExistence(timeout: 5))
        messages.tap()
        XCTAssertTrue(waitForDisappearance(hit))
        // Names filter too.
        field.tap()
        field.typeText(XCUIKeyboardKey.delete.rawValue.repeated(7) + "Hel")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'search-row.' AND label CONTAINS 'Helix'")).firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'search-row.' AND label CONTAINS 'Aurora'")).firstMatch.exists)
        // Opening a result opens the chat.
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'search-row.' AND label CONTAINS 'Helix'")).firstMatch.tap()
        XCTAssertTrue(waitForDisappearance(app.otherElements["search-sheet"]))
        XCTAssertFalse(app.buttons["home-plus"].isHittable)
    }

    @MainActor
    func testNewGroupChatNeedsTwoBotsThenANameAndOpensTheRoom() {
        let app = launch()
        app.buttons["home-plus"].tap()
        let item = app.buttons["plus-menu.new-group"]
        XCTAssertTrue(item.waitForExistence(timeout: 5))
        item.tap()
        let next = app.buttons["new-group-next"]
        XCTAssertTrue(next.waitForExistence(timeout: 5))
        let field = app.textFields["new-group-search"]
        field.typeText("Ori")
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'new-group-row.' AND label CONTAINS 'Orion'")).firstMatch.tap()
        next.tap()
        // One bot is not a group: still on the first step.
        XCTAssertFalse(app.textFields["new-group-name"].exists)
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'new-group-row.' AND label CONTAINS 'Liora'")).firstMatch.tap()
        next.tap()
        let name = app.textFields["new-group-name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.typeText("UI Test Room")
        app.buttons["new-group-create"].tap()
        // The room opens.
        XCTAssertTrue(waitForDisappearance(app.otherElements["new-group-sheet"], timeout: 10))
        XCTAssertTrue(app.staticTexts["UI Test Room"].waitForExistence(timeout: 10))
    }

    @MainActor
    func testCreateBotWaitsForANameThenCreatesWithTheChosenLook() {
        let app = launch()
        app.buttons["home-plus"].tap()
        let item = app.buttons["plus-menu.new-bot"]
        XCTAssertTrue(item.waitForExistence(timeout: 5))
        item.tap()
        let create = app.buttons["create-bot-submit"]
        XCTAssertTrue(create.waitForExistence(timeout: 5))
        create.tap()
        // No name, no bot: the sheet is still there.
        XCTAssertTrue(app.otherElements["create-bot-sheet"].exists || create.exists)
        app.buttons["Shape"].tap()
        XCTAssertTrue(app.buttons["cloud"].waitForExistence(timeout: 5))
        app.buttons["cloud"].tap()
        app.buttons["teal"].tap()
        let name = app.textFields["create-bot-name"]
        name.tap()
        // Return creates: the keyboard covers the Create capsule.
        name.typeText("Nova UI\n")
        XCTAssertTrue(waitForDisappearance(create, timeout: 15))
        XCTAssertTrue(app.staticTexts["Nova UI"].waitForExistence(timeout: 10))
    }

    private func waitForDisappearance(_ element: XCUIElement, timeout: TimeInterval = 8) -> Bool {
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element)
        return XCTWaiter().wait(for: [gone], timeout: timeout) == .completed
    }
}

private extension String {
    func repeated(_ count: Int) -> String { String(repeating: self, count: count) }
}
