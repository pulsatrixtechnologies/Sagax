import XCTest

/// One conversation per bot (threads hidden; CompanionCore/SingleStream.swift,
/// THE rule shared with the server and the desktop), on the bundled
/// ThreadPreview fleet: Pepper opens at her newest topic (Triage iCloud),
/// the earlier topic (Triage Gmail) is drawn above it under a quiet time
/// line, nothing is folded or empty, and her job and run threads never take
/// the conversation's place. Set SAGAX_SHOTS_DIR (TEST_RUNNER_SAGAX_SHOTS_DIR)
/// to also write PNGs, prefixed by SAGAX_SHOTS_PREFIX.
final class UnifiedConversationUITests: XCTestCase {
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
    func testTheBotOpensAtItsOneConversationWithTheEarlierTopicAbove() {
        // threads hidden; whatever thread an earlier run left Pepper on, her
        // row opens her one conversation
        let app = ThreadPreview.launch(["-threads-hidden", "-AppleLanguages", "(fr)", "-AppleLocale", "fr_CA"])
        ThreadPreview.openPepper(in: app)
        // the newest topic is live…
        XCTAssertTrue(ThreadPreview.showsThread("Triage iCloud", in: app, timeout: 10), "the conversation opens at its newest topic")
        // …and the earlier one is drawn above it, under a quiet time line
        let earlier = app.descendants(matching: .any)["chat.earlierTopic"].firstMatch
        XCTAssertTrue(earlier.waitForExistence(timeout: 10), "the earlier topic above the live one")
        XCTAssertTrue(app.descendants(matching: .any)["chat.topicDivider"].firstMatch.waitForExistence(timeout: 5), "the time line between the topics")
        // never a fold, never an empty chat
        XCTAssertFalse(app.buttons["chat.freshTopic.earlier"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["chat.freshTopic"].firstMatch.exists)
        // no thread chrome: no thread button in the header, no All threads
        XCTAssertFalse(app.buttons["chat-threads"].exists)
        save("1-one-conversation")
    }

    @MainActor
    func testComingBackAfterAWhileKeepsTheTimelineOnScreen() {
        // the fresh topic drafted on return (Session+FreshTopic.swift) is
        // invisible: the next message starts a fresh context, nothing moves
        let app = ThreadPreview.launch(["-threads-hidden", "-fresh-topic", "-AppleLanguages", "(fr)", "-AppleLocale", "fr_CA"])
        ThreadPreview.openPepper(in: app)
        XCTAssertTrue(ThreadPreview.showsThread("Triage iCloud", in: app, timeout: 10))
        XCTAssertFalse(app.buttons["chat.freshTopic.earlier"].waitForExistence(timeout: 2), "no fold over the conversation")
        XCTAssertFalse(app.descendants(matching: .any)["chat.freshTopic"].firstMatch.exists, "no empty chat")
        XCTAssertTrue(app.descendants(matching: .any)["chat.earlierTopic"].firstMatch.waitForExistence(timeout: 10))
        save("2-back-after-a-while")
    }
}
