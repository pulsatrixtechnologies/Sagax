import XCTest

/// Fresh topic on return (Session+FreshTopic.swift), in the demo: since
/// 2026-10-28 nothing moves on screen for it (one conversation); `-fresh-topic`
/// draws the return the rule would make after the threshold. Set SAGAX_SHOTS_DIR
/// (TEST_RUNNER_SAGAX_SHOTS_DIR) to also write PNGs, prefixed by
/// SAGAX_SHOTS_PREFIX.
final class FreshTopicUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func save(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        let environment = ProcessInfo.processInfo.environment
        if let dir = environment["SAGAX_SHOTS_DIR"] {
            let prefix = environment["SAGAX_SHOTS_PREFIX"].map { "\($0)-" } ?? ""
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(prefix)\(name).png"))
        }
    }

    @MainActor
    private func open(fresh: Bool) -> XCUIApplication {
        let app = XCUIApplication()
        // no pairing left by an earlier run: the demo opens only unpaired
        app.launchArguments += ["-reset-pairings", "-demo", "-AppleLanguages", "(fr)", "-AppleLocale", "fr_CA", "-companion.prefs.language", "fr"]
        if fresh { app.launchArguments += ["-fresh-topic"] }
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["demo-banner"].firstMatch.waitForExistence(timeout: 30), "demo home")
        let row = app.buttons["chat-row.demo-pixel"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        if !app.buttons["chat-name"].waitForExistence(timeout: 3) { row.tap() }
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 10))
        return app
    }

    @MainActor
    func testTheChatBeforeAReturn() {
        _ = open(fresh: false)
        save("1-live-topic")
    }

    // 2026-10-28 (one conversation, the reference design): a fresh topic on
    // return is invisible. The next message starts a fresh engine context;
    // the conversation stays one timeline on screen, nothing folds.
    @MainActor
    func testAReturnKeepsTheConversationOnScreen() {
        let app = open(fresh: true)
        XCTAssertFalse(app.buttons["chat.freshTopic.earlier"].waitForExistence(timeout: 2), "no Earlier topics line")
        XCTAssertFalse(app.descendants(matching: .any)["chat.freshTopic"].firstMatch.exists, "no empty chat")
        XCTAssertTrue(app.buttons["chat-name"].exists)
        save("2-fresh-topic")
    }
}
