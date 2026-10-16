import XCTest

/// The home's chrome in demo mode (JC, 2026-10-15): the Updates pill stays
/// at the bottom whatever opens over the home (Settings, Search, +, a new
/// bot), and on an iPad the avatar sits in the top trailing corner, away
/// from the window controls. Set SAGAX_SHOTS_DIR
/// (TEST_RUNNER_SAGAX_SHOTS_DIR) to also write PNGs.
final class HomeChromeLayoutUITests: XCTestCase {
    private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += [
            "-demo", "-demo-clock", "1791000000",
            "-companion.prefs.updatesButton", "YES",
        ]
        app.launch()
        XCTAssertTrue(app.buttons["updates-button"].waitForExistence(timeout: 20), "demo home with the Updates pill")
        // the demo's "needs you" island covers the iPhone's top row
        let deny = app.buttons["Deny"].firstMatch
        if deny.waitForExistence(timeout: 3), deny.isHittable {
            deny.tap()
            sleep(1)
        }
        return app
    }

    private func save(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["SAGAX_SHOTS_DIR"] {
            let device = isPad ? "ipad" : "iphone"
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(device)-\(name).png"))
        }
    }

    /// The pill, wherever it still shows, sits in the bottom half.
    private func assertPillAtBottom(_ app: XCUIApplication, _ context: String, file: StaticString = #filePath, line: UInt = #line) {
        let pill = app.buttons["updates-button"]
        guard pill.exists, !pill.frame.isEmpty else { return }
        let window = app.windows.firstMatch.frame
        XCTAssertGreaterThan(pill.frame.minY, window.midY, "\(context): the Updates pill left the bottom", file: file, line: line)
    }

    @MainActor
    func testTheAvatarSitsInTheRightCornerOnAnIPad() {
        let app = launch()
        let account = app.buttons["home-account"]
        XCTAssertTrue(account.waitForExistence(timeout: 10))
        let window = app.windows.firstMatch.frame
        if isPad {
            XCTAssertGreaterThan(account.frame.midX, window.midX, "iPad: avatar on the trailing side")
        } else {
            XCTAssertLessThan(account.frame.midX, window.midX, "iPhone: avatar stays leading")
        }
        XCTAssertLessThan(account.frame.midY, window.midY, "avatar at the top")
        assertPillAtBottom(app, "home")
        save("home")
    }

    @MainActor
    func testThePillStaysAtTheBottomUnderSearch() {
        let app = launch()
        app.buttons["home-search"].firstMatch.tap()
        sleep(2)
        save("search")
        assertPillAtBottom(app, "search")
    }

    @MainActor
    func testThePillStaysAtTheBottomUnderSettings() {
        let app = launch()
        app.buttons["home-account"].tap()
        let settings = app.buttons["account-menu.settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.tap()
        XCTAssertTrue(app.descendants(matching: .any)["settings-general"].waitForExistence(timeout: 10))
        sleep(2)
        save("settings")
        assertPillAtBottom(app, "settings")
    }

    @MainActor
    func testThePillStaysAtTheBottomUnderPlusAndNewBot() {
        let app = launch()
        app.buttons["home-plus"].tap()
        let newBot = app.buttons["plus-menu.new-bot"]
        XCTAssertTrue(newBot.waitForExistence(timeout: 5))
        save("plus")
        assertPillAtBottom(app, "plus menu")
        newBot.tap()
        sleep(2)
        save("new-bot")
        assertPillAtBottom(app, "new bot")
    }
}
