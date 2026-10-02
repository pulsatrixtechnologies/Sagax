import XCTest

/// Runs against the bundled ThreadPreview fleet: no paired computer, and the
/// preview has no API client, so nothing typed here can be sent anywhere.
final class ComposerReturnUITests: XCTestCase {
    /// Messages behaviour: the software keyboard's Return breaks the line and
    /// the arrow button on the chat bar is the only send.
    @MainActor
    func testKeyboardReturnInsertsANewlineInsteadOfSending() {
        let app = launchPreview()
        app.buttons["threads-toggle.preview-pepper"].tap()
        let gmail = app.buttons["thread.preview-gmail"]
        XCTAssertTrue(gmail.waitForExistence(timeout: 5))
        gmail.tap()

        let input = app.descendants(matching: .any).matching(identifier: "message-input").firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap()
        input.typeText("first line")

        let keys = app.keyboards.buttons
        let returnKey = keys.matching(NSPredicate(format: "label ==[c] 'return'")).firstMatch
        XCTAssertTrue(returnKey.waitForExistence(timeout: 5), "the keyboard should offer a plain return key")
        XCTAssertFalse(keys.matching(NSPredicate(format: "label ==[c] 'send'")).firstMatch.exists,
                       "the keyboard must not carry a second send key")
        returnKey.tap()
        input.typeText("second line")

        XCTAssertEqual(input.value as? String, "first line\nsecond line")
        recordScreenshot("Two-line draft after tapping the keyboard's return", in: app)
    }

    @MainActor
    private func launchPreview() -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = [
            "-store-preview", "-threads-preview",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.prefs.islandIntro", "never",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
            // The compact list: its rows carry the threads toggle. The
            // install default is the standard home (HomeUITests).
            "-companion.prefs.rosterDensity", "compact"
        ]
        app.launch()
        // The first launch after an install can restore a prewarmed scene
        // without the preview arguments (an empty, unpaired home: "Connect
        // computer" before the parity home, "No bots yet" since). Restart
        // only that wrong route, once.
        let pepper = app.buttons["threads-toggle.preview-pepper"]
        if !pepper.waitForExistence(timeout: 10) {
            app.terminate()
            app.launch()
        }
        XCTAssertTrue(pepper.waitForExistence(timeout: 10))
        return app
    }

    @MainActor
    private func recordScreenshot(_ name: String, in app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
