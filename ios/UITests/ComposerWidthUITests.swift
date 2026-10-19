import XCTest

/// The phone composer spans the screen like the reference chat bar (JC,
/// 2026-10-18): 12 pt from each edge of the safe area, the field taking
/// everything after the "+", and the quick-reply row above it scrolling from
/// edge to edge, its first chip on the bar's leading edge and its last one
/// whole once scrolled to the end.
///
/// Runs against the bundled StorePreview fleet: no paired computer, and the
/// preview has no API client, so nothing here can be sent anywhere.
final class ComposerWidthUITests: XCTestCase {
    /// Mirrors `Theme.Chat.composerMargin` and the send capsule's inset in
    /// the field (`ChatComposer`, 9.3 pt).
    private let margin: CGFloat = 12
    private let capsuleInset: CGFloat = 9.3
    private let tolerance: CGFloat = 1

    @MainActor
    func testPortraitBarAndChipsSpanTheScreen() {
        let app = openChat()
        checkBar(in: app, label: "portrait, keyboard closed")
        openKeyboard(in: app)
        checkBar(in: app, label: "portrait, keyboard open")
        checkChips(in: app, label: "portrait")
    }

    @MainActor
    func testLandscapeBarSpansTheSafeArea() throws {
        // A landscape iPad is 768 pt or wider: the desktop shell and its
        // pill, not this composer.
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom == .pad, "the iPad turns into the desktop shell")
        let app = openChat()
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        // the rotation settles before the frames are read
        let plus = app.buttons["composer-plus"]
        XCTAssertTrue(plus.waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 1)
        // A simulator booted without its window (simctl, as on the build
        // Mac) may refuse the turn: say so rather than pass in portrait.
        let window = app.windows.firstMatch.frame
        try XCTSkipUnless(window.width > window.height, "the simulator did not turn to landscape")
        checkBar(in: app, label: "landscape, keyboard closed")
        openKeyboard(in: app)
        checkBar(in: app, label: "landscape, keyboard open")
        checkChips(in: app, label: "landscape")
    }

    @MainActor
    func testLargeTextKeepsTheBarWide() {
        let app = openChat(extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityL"])
        checkBar(in: app, label: "large text, keyboard closed")
        openKeyboard(in: app)
        checkBar(in: app, label: "large text, keyboard open")
        checkChips(in: app, label: "large text")
    }

    /// The skin that follows the system: light on a light simulator, dark
    /// on a dark one (the default skin is always dark).
    @MainActor
    func testSystemSkinFollowsTheAppearance() {
        let app = openChat(extra: ["-paritySkin", "system"])
        checkBar(in: app, label: "system skin, keyboard closed")
        openKeyboard(in: app)
        checkBar(in: app, label: "system skin, keyboard open")
        checkChips(in: app, label: "system skin")
    }

    // MARK: - Checks

    /// The "+" sits `margin` in from the leading edge, the field ends
    /// `margin` in from the trailing one (symmetric in landscape, where the
    /// sensor housing's inset adds the same amount on both sides).
    @MainActor
    private func checkBar(in app: XCUIApplication, label: String) {
        let plus = app.buttons["composer-plus"]
        let voice = app.buttons.matching(NSPredicate(format: "identifier IN %@", ["composer-voice", "composer-send"])).firstMatch
        XCTAssertTrue(plus.waitForExistence(timeout: 5), label)
        XCTAssertTrue(voice.waitForExistence(timeout: 5), label)
        recordScreenshot("composer \(label)", in: app)
        let window = app.windows.firstMatch.frame
        let leading = plus.frame.minX - window.minX
        let fieldEnd = voice.frame.maxX + capsuleInset
        let trailing = window.maxX - fieldEnd
        let phone = UIDevice.current.userInterfaceIdiom == .phone
        if phone {
            XCTAssertEqual(leading, trailing, accuracy: tolerance, "\(label): margins should match (\(leading) vs \(trailing))")
            if window.width < window.height {
                XCTAssertEqual(leading, margin, accuracy: tolerance, "\(label): leading margin")
                XCTAssertEqual(trailing, margin, accuracy: tolerance, "\(label): trailing margin")
            } else {
                XCTAssertGreaterThanOrEqual(leading, margin - tolerance, label)
            }
        } else {
            // iPad phone UI (under 768 pt, so narrower than the 760 pt
            // cap): the same 12 pt on both sides as on the iPhone
            XCTAssertEqual(leading, trailing, accuracy: tolerance, "\(label): centred")
            if window.width <= 760 {
                XCTAssertEqual(leading, margin, accuracy: tolerance, "\(label): leading margin")
            }
        }
    }

    /// The row scrolls edge to edge: its scroll view spans the bar's
    /// container, the first chip lines up with the "+", and the last chip
    /// ends whole, `margin` from the edge, once scrolled to the end.
    @MainActor
    private func checkChips(in app: XCUIApplication, label: String) {
        let row = app.scrollViews["composer-chips"]
        XCTAssertTrue(row.waitForExistence(timeout: 5), "\(label): quick replies above the field")
        let chips = row.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'composer-chip.'"))
        XCTAssertGreaterThan(chips.count, 1, label)
        let plus = app.buttons["composer-plus"]
        let first = chips.element(boundBy: 0)
        XCTAssertEqual(first.frame.minX, plus.frame.minX, accuracy: tolerance, "\(label): first chip on the bar's edge")
        let window = app.windows.firstMatch.frame
        if UIDevice.current.userInterfaceIdiom == .phone, window.width < window.height {
            XCTAssertEqual(row.frame.minX, window.minX, accuracy: tolerance, "\(label): row starts at the screen edge")
            XCTAssertEqual(row.frame.maxX, window.maxX, accuracy: tolerance, "\(label): row ends at the screen edge")
        }
        // When every chip fits, nothing scrolls and this only checks that
        // the last one ends whole inside the margin.
        row.swipeLeft()
        row.swipeLeft()
        Thread.sleep(forTimeInterval: 0.8)
        let last = chips.element(boundBy: chips.count - 1)
        recordScreenshot("chips \(label), scrolled to the end", in: app)
        XCTAssertLessThanOrEqual(last.frame.maxX, row.frame.maxX - margin + tolerance, "\(label): last chip whole")
        XCTAssertGreaterThanOrEqual(last.frame.minX, row.frame.minX, "\(label): last chip on screen")
    }

    // MARK: - Launch

    @MainActor
    private func openKeyboard(in app: XCUIApplication) {
        let input = app.descendants(matching: .any).matching(identifier: "message-input").firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "the keyboard should open")
        Thread.sleep(forTimeInterval: 0.8)
    }

    @MainActor
    private func openChat(extra: [String] = []) -> XCUIApplication {
        continueAfterFailure = true
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = [
            "-store-preview",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
        ] + extra
        app.launch()
        // General: nobody working and no approval waiting, so the quick
        // replies show (a bot row can sit under the approval island)
        let general = app.buttons["chat-row.preview-general-channel"]
        if !general.waitForExistence(timeout: 10) {
            // a prewarmed scene restored without the preview arguments
            app.terminate()
            app.launch()
        }
        XCTAssertTrue(general.waitForExistence(timeout: 10))
        // the first tap may only put away the "needs you" island
        general.tap()
        if !app.buttons["composer-plus"].waitForExistence(timeout: 3) { general.tap() }
        XCTAssertTrue(app.buttons["composer-plus"].waitForExistence(timeout: 10))
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
