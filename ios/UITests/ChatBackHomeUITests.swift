import XCTest

/// Back from a chat lands on a home that is drawn (TestFlight build 81,
/// 2026-10-27): the Back button or the edge swipe once left the whole app on
/// an empty dark screen, and only a relaunch brought the home back.
///
/// Against the parity fixture server, like ParityChatUITests: start it first
/// (`node ios/parity/fixture-server.mjs`) and pass its session as
/// TEST_RUNNER_PARITY_ENDPOINT / _TOKEN / _ENVIRONMENT, or leave the
/// `ios/parity/out/session.json` it writes in place; without either the test
/// is skipped.
final class ChatBackHomeUITests: XCTestCase {
    private struct FixtureSession: Decodable {
        let endpoint: String
        let token: String
        let environmentId: String?
    }

    @MainActor
    func testBackButtonReturnsToAVisibleHome() throws {
        let app = try launchHome()
        for round in 1...2 {
            try openFirstChat(in: app)
            let back = app.buttons["Back"].firstMatch
            XCTAssertTrue(back.waitForExistence(timeout: 5))
            back.tap()
            assertHomeVisible(in: app, label: "Back button, round \(round)")
        }
    }

    @MainActor
    func testEdgeSwipeReturnsToAVisibleHome() throws {
        let app = try launchHome()
        for round in 1...2 {
            try openFirstChat(in: app)
            let header = app.buttons["chat-name"]
            for _ in 0..<2 {
                let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.008, dy: 0.5))
                let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5))
                start.press(forDuration: 0.25, thenDragTo: end, withVelocity: XCUIGestureVelocity(400), thenHoldForDuration: 0.2)
                if !header.waitForExistence(timeout: 3) { break }
            }
            assertHomeVisible(in: app, label: "edge swipe, round \(round)")
        }
    }

    /// The keyboard was up in the chat (the composer focused): its system
    /// window must never be left painted over the app on the way back.
    @MainActor
    func testBackAfterTypingReturnsToAVisibleHome() throws {
        let app = try launchHome()
        for round in 1...2 {
            try openFirstChat(in: app)
            let input = app.descendants(matching: .any).matching(identifier: "message-input").firstMatch
            XCTAssertTrue(input.waitForExistence(timeout: 10))
            input.tap()
            input.typeText("hi")
            attach("typing, round \(round)", app)
            app.buttons["Back"].firstMatch.tap()
            assertHomeVisible(in: app, label: "Back after typing, round \(round)")
        }
    }

    /// The desktop skin (Midnight), the one the TestFlight report wore.
    @MainActor
    func testBackOnTheDesktopSkinReturnsToAVisibleHome() throws {
        let app = try launchHome(extra: ["-paritySkin", "midnight"])
        for round in 1...2 {
            try openFirstChat(in: app)
            app.buttons["Back"].firstMatch.tap()
            assertHomeVisible(in: app, label: "Midnight Back button, round \(round)")
        }
    }

    /// The demo (no fixture, any build configuration, Release included):
    /// its terms of use first, as on a real account, then a chat and back.
    @MainActor
    func testDemoBackReturnsToAVisibleHome() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = [
            "-demo",
            "-companion.prefs.rosterDensity", "standard",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
        ]
        app.launch()
        let accept = app.buttons["terms-accept"]
        if accept.waitForExistence(timeout: 15) {
            accept.tap()
            let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: accept)
            XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 10), .completed, "the terms sheet closed")
        }
        XCTAssertTrue(firstRow(in: app).waitForExistence(timeout: 20), "the demo lists its chats")
        for round in 1...2 {
            try openFirstChat(in: app)
            app.buttons["Back"].firstMatch.tap()
            assertHomeVisible(in: app, label: "demo Back button, round \(round)")
        }
        try openFirstChat(in: app)
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.008, dy: 0.5))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5))
        start.press(forDuration: 0.25, thenDragTo: end, withVelocity: XCUIGestureVelocity(400), thenHoldForDuration: 0.2)
        if app.buttons["chat-name"].waitForExistence(timeout: 3) {
            start.press(forDuration: 0.25, thenDragTo: end, withVelocity: XCUIGestureVelocity(400), thenHoldForDuration: 0.2)
        }
        assertHomeVisible(in: app, label: "demo edge swipe")
    }

    // MARK: - Harness

    @MainActor
    private func launchHome(extra: [String] = []) throws -> XCUIApplication {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let session = try fixtureSession()
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", session.endpoint,
            "-parityToken", session.token,
            "-parityScreen", "01-home",
            "-companion.prefs.rosterDensity", "standard",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
        ] + extra
        if let environment = session.environmentId { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(firstRow(in: app).waitForExistence(timeout: 30), "the home lists the fixture's chats")
        return app
    }

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

    private func firstRow(in app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'chat-row.'")).firstMatch
    }

    @MainActor
    private func openFirstChat(in app: XCUIApplication) throws {
        let row = firstRow(in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        // the first tap may only put away the "needs you" island
        if !app.buttons["chat-name"].waitForExistence(timeout: 3) { row.tap() }
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 10), "the chat opened")
        attach("chat open", app)
    }

    /// The home is back and drawn: its avatar and rows can be hit, and the
    /// screen is not one flat colour.
    @MainActor
    private func assertHomeVisible(in app: XCUIApplication, label: String) {
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.buttons["chat-name"])
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 10), .completed, "\(label): the chat left")
        let account = app.buttons["home-account"]
        XCTAssertTrue(account.waitForExistence(timeout: 10), "\(label): the home's avatar is back")
        // let the pop settle before reading what is drawn
        Thread.sleep(forTimeInterval: 1.5)
        XCTAssertTrue(account.isHittable, "\(label): the home's avatar can be tapped")
        XCTAssertTrue(firstRow(in: app).isHittable, "\(label): a chat row can be tapped")
        let shot = app.screenshot()
        attach("home after \(label)", app, shot: shot)
        XCTAssertGreaterThan(Self.distinctColours(in: shot.image), 20, "\(label): the screen is not one flat colour")
    }

    /// Colours seen on a coarse grid of the screenshot: a drawn home shows
    /// over a hundred, the empty screen of the report exactly one.
    private static func distinctColours(in image: UIImage) -> Int {
        guard let cg = image.cgImage else { return 0 }
        let width = 40, height = 80
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        guard let context = CGContext(
            data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return 0 }
        context.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
        var seen = Set<UInt32>()
        // the bitmap's first row is the top of the screen: between the
        // status bar (the top 8 rows of 80) and the home indicator (the
        // bottom 8), where an empty screen is one colour
        for y in 8..<(height - 8) {
            for x in 0..<width {
                let i = (y * width + x) * 4
                // quantised, so antialiasing of one edge does not count much
                let key = (UInt32(pixels[i] >> 4) << 8) | (UInt32(pixels[i + 1] >> 4) << 4) | UInt32(pixels[i + 2] >> 4)
                seen.insert(key)
            }
        }
        return seen.count
    }

    @MainActor
    private func attach(_ name: String, _ app: XCUIApplication, shot: XCUIScreenshot? = nil) {
        let attachment = XCTAttachment(screenshot: shot ?? app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["SAGAX_SHOTS"], !dir.isEmpty {
            let safe = name.replacingOccurrences(of: " ", with: "-").replacingOccurrences(of: ",", with: "")
            try? (shot ?? app.screenshot()).pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(safe).png"))
        }
    }
}
