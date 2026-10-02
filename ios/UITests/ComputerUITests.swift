import XCTest

/// The computer view (references 13 and 11) against the parity fixture. The
/// fixture's computer double (ios/parity/fixture-server.mjs) plays the
/// desktop: it checks control with the real server and records every input
/// batch and clipboard write, which these tests read back from
/// `GET /__parity/computer`.
///
/// Start the fixture first (`node ios/parity/fixture-server.mjs`); without
/// `ios/parity/out/session.json` the tests skip. Two-finger scrolling has no
/// XCUITest gesture; its translation is covered in CompanionCore
/// (`ComputerInputTests`).
final class ComputerUITests: XCTestCase {
    private struct FixtureSession: Decodable {
        let endpoint: String
        let token: String
        let environmentId: String?
    }

    private struct Record: Decodable {
        struct Batch: Decodable {
            let events: [Event]
            let controlLeaseId: String?
        }
        struct Event: Decodable, Equatable {
            let type: String
            let dx: Int?
            let dy: Int?
            let button: String?
            let action: String?
            let count: Int?
            let key: String?
            let text: String?
        }
        let batches: [Batch]
        let clipboard: String
        let clipboardWrites: [String]

        var events: [Event] { batches.flatMap(\.events) }
    }

    private var session: FixtureSession!

    private func fixtureSession() throws -> FixtureSession {
        let file = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("parity/out/session.json")
        guard let data = try? Data(contentsOf: file) else {
            throw XCTSkip("parity fixture server is not running (\(file.path))")
        }
        return try JSONDecoder().decode(FixtureSession.self, from: data)
    }

    private func record(method: String = "GET") throws -> Record {
        var request = URLRequest(url: URL(string: "\(session.endpoint)/__parity/computer")!)
        request.httpMethod = method
        var result: Result<Data, Error>?
        let done = expectation(description: "record")
        URLSession.shared.dataTask(with: request) { data, _, error in
            result = error.map { .failure($0) } ?? .success(data ?? Data())
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 10)
        guard let data = try result?.get() else { throw XCTSkip("the fixture has no computer double") }
        do {
            return try JSONDecoder().decode(Record.self, from: data)
        } catch {
            throw XCTSkip("the fixture has no computer double (PARITY_COMPUTER_DOUBLE=0?)")
        }
    }

    /// Wait until the recorded events satisfy `check`.
    private func waitForEvents(_ what: String, timeout: TimeInterval = 10, _ check: ([Record.Event]) -> Bool) throws -> [Record.Event] {
        let deadline = Date().addingTimeInterval(timeout)
        var events: [Record.Event] = []
        while Date() < deadline {
            events = try record().events
            if check(events) { return events }
            Thread.sleep(forTimeInterval: 0.3)
        }
        XCTFail("\(what): got \(events)")
        return events
    }

    @MainActor
    private func launch() throws -> XCUIApplication {
        continueAfterFailure = false
        session = try fixtureSession()
        _ = try record(method: "DELETE")
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", session.endpoint,
            "-parityToken", session.token,
            // In control with the keyboard up, as in reference 13.
            "-parityScreen", "13-computer",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.prefs.islandIntro", "never",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
        ]
        if let environment = session.environmentId { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["computer-trackpad"].waitForExistence(timeout: 30))
        // Taking control syncs the pointer to the centre.
        _ = try waitForEvents("pointer sync on take") { $0.contains { $0.type == "moveTo" } }
        _ = try record(method: "DELETE")
        return app
    }

    @MainActor
    func testTrackpadGesturesSendPointerEvents() throws {
        let app = try launch()
        let pad = app.descendants(matching: .any)["computer-trackpad"]

        pad.tap()
        _ = try waitForEvents("tap is a left click") {
            $0.contains { $0.type == "button" && $0.button == "left" && $0.action == "click" && $0.count == nil }
        }

        _ = try record(method: "DELETE")
        pad.doubleTap()
        _ = try waitForEvents("double tap is a double click") {
            $0.contains { $0.type == "button" && $0.button == "left" && $0.action == "click" && $0.count == 2 }
        }

        _ = try record(method: "DELETE")
        pad.twoFingerTap()
        _ = try waitForEvents("two-finger tap is a right click") {
            $0.contains { $0.type == "button" && $0.button == "right" && $0.action == "click" }
        }

        // One finger to the right and down: relative moves, nothing clicked.
        _ = try record(method: "DELETE")
        let start = pad.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.3))
        start.press(forDuration: 0.05, thenDragTo: pad.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.7)))
        let moves = try waitForEvents("pan moves the pointer") { events in
            events.filter { $0.type == "move" }.reduce(0) { $0 + ($1.dx ?? 0) } > 50
        }
        XCTAssertFalse(moves.contains { $0.type == "button" }, "a pan does not click: \(moves)")
        XCTAssertGreaterThan(moves.filter { $0.type == "move" }.reduce(0) { $0 + ($1.dy ?? 0) }, 0)

        // Touch and hold, then drag: down, moves, up, in that order.
        _ = try record(method: "DELETE")
        pad.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.5))
            .press(forDuration: 0.8, thenDragTo: pad.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.5)))
        let drag = try waitForEvents("long press and drag") { events in
            events.contains { $0.action == "up" }
        }
        let down = drag.firstIndex { $0.type == "button" && $0.action == "down" }
        let up = drag.firstIndex { $0.type == "button" && $0.action == "up" }
        XCTAssertNotNil(down)
        if let down, let up {
            XCTAssertLessThan(down, up)
            XCTAssertTrue(drag[down..<up].contains { $0.type == "move" }, "moves while held: \(drag)")
        }
    }

    @MainActor
    func testTypingStreamsTextAndKeys() throws {
        let app = try launch()
        app.typeText("hi there")
        _ = try waitForEvents("typed text") { events in
            events.filter { $0.type == "text" }.compactMap(\.text).joined() == "hi there"
        }
        _ = try record(method: "DELETE")
        app.typeText("\n")
        app.typeText(XCUIKeyboardKey.delete.rawValue)
        _ = try waitForEvents("return and backspace") { events in
            events.contains { $0.type == "key" && $0.key == "Return" } && events.contains { $0.type == "key" && $0.key == "BackSpace" }
        }
    }

    @MainActor
    func testClipboardGoesBothWays() throws {
        let app = try launch()
        UIPasteboard.general.string = "texte du téléphone"
        let clipboard = app.buttons["computer-clipboard"]
        XCTAssertTrue(clipboard.waitForExistence(timeout: 5))

        clipboard.tap()
        app.buttons["Send clipboard to computer"].tap()
        // iOS asks before an app reads what another app copied.
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow Paste"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        let deadline = Date().addingTimeInterval(10)
        while Date() < deadline, try record().clipboardWrites.isEmpty { Thread.sleep(forTimeInterval: 0.3) }
        XCTAssertEqual(try record().clipboardWrites, ["texte du téléphone"])

        clipboard.tap()
        app.buttons["Copy computer clipboard"].tap()
        let notice = app.staticTexts["computer-notice"]
        XCTAssertTrue(notice.waitForExistence(timeout: 10))
        XCTAssertEqual(notice.label, "Copied the computer's clipboard.")
    }

    /// Release control: input then needs control again, and the menu says so.
    @MainActor
    func testReleaseThenTakeControlFromTheMenu() throws {
        let app = try launch()
        // The trackpad toast covers the menu button for its first seconds.
        let toast = app.descendants(matching: .any)["computer-toast"]
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: toast)
        wait(for: [gone], timeout: 10)
        let more = app.buttons["computer-more"]
        more.tap()
        app.buttons["Release control"].tap()
        // Without control a tap asks first instead of clicking.
        app.descendants(matching: .any)["computer-trackpad"].tap()
        let take = app.alerts.buttons["Take control"]
        XCTAssertTrue(take.waitForExistence(timeout: 5))
        take.tap()
        XCTAssertTrue(app.descendants(matching: .any)["computer-toast"].waitForExistence(timeout: 10))
        _ = try waitForEvents("pointer sync on retake") { $0.contains { $0.type == "moveTo" } }
    }

    /// Opt-in, against a real desktop: the fixture started with
    /// `PARITY_COMPUTER_DOUBLE=0`, Ara's computer set to a running Local VM
    /// with a terminal focused, and `TEST_RUNNER_PARITY_REAL_COMPUTER=1`.
    /// The phone clicks and types a shell line; the caller checks the file
    /// it writes inside the VM (and takes a screenshot of the desktop).
    @MainActor
    func testRealDesktopReceivesAClickAndTyping() throws {
        guard ProcessInfo.processInfo.environment["PARITY_REAL_COMPUTER"] == "1" else {
            throw XCTSkip("set TEST_RUNNER_PARITY_REAL_COMPUTER=1 with a real Local VM behind the fixture")
        }
        continueAfterFailure = false
        session = try fixtureSession()
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", session.endpoint, "-parityToken", session.token, "-parityScreen", "13-computer",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        if let environment = session.environmentId { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        let pad = app.descendants(matching: .any)["computer-trackpad"]
        XCTAssertTrue(pad.waitForExistence(timeout: 30))
        Thread.sleep(forTimeInterval: 3)
        pad.tap()
        Thread.sleep(forTimeInterval: 1.5)
        app.typeText("echo sagax-phone-e2e > /tmp/sagax-e2e.txt\n")
        Thread.sleep(forTimeInterval: 4)
        XCTAssertFalse(app.staticTexts["computer-notice"].exists, "no refusal: \(app.staticTexts["computer-notice"].label)")
    }
}
