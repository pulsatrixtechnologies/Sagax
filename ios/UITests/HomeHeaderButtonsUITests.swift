import XCTest

/// The home header's three round buttons (account, Search, +) are one
/// component: same diameter, same row. Runs against the parity fixture:
///
///   node ios/parity/fixture-server.mjs &
///   TEST_RUNNER_PARITY_ENDPOINT=... TEST_RUNNER_PARITY_TOKEN=... \
///   xcodebuild test -only-testing:SagaxUITests/HomeHeaderButtonsUITests ...
final class HomeHeaderButtonsUITests: XCTestCase {
    @MainActor
    func testSearchAndPlusHaveTheSameSizeAndRow() throws {
        let env = ProcessInfo.processInfo.environment
        guard let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"], !token.isEmpty else {
            throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN")
        }
        // the iPad's home is the desktop-style sidebar, with its own buttons
        if UIDevice.current.userInterfaceIdiom == .pad { throw XCTSkip("phone home header only") }
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = [
            "-parityEndpoint", endpoint, "-parityToken", token, "-parityScreen", "01-home",
            "-companion.prefs.rosterDensity", "standard",
            "-companion.prefs.rosterChromeAtTop", "YES",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
        ]
        app.launch()
        let plus = app.buttons["home-plus"]
        let search = app.buttons["home-search"]
        let account = app.buttons["home-account"]
        XCTAssertTrue(plus.waitForExistence(timeout: 30))
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        // the iPad's home is the desktop-style sidebar: no header avatar
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        if !isPad { XCTAssertTrue(account.waitForExistence(timeout: 10)) }
        if let shot = ProcessInfo.processInfo.environment["HEADER_SHOT"] {
            try? app.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: shot))
        }
        XCTAssertEqual(plus.frame.width, search.frame.width, accuracy: 0.5)
        XCTAssertEqual(plus.frame.height, search.frame.height, accuracy: 0.5)
        XCTAssertEqual(plus.frame.width, plus.frame.height, accuracy: 0.5, "a circle")
        XCTAssertEqual(plus.frame.midY, search.frame.midY, accuracy: 0.5)
        if !isPad {
            XCTAssertEqual(account.frame.width, search.frame.width, accuracy: 0.5)
            XCTAssertEqual(account.frame.midY, search.frame.midY, accuracy: 0.5)
        }
    }
}
