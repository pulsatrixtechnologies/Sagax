import XCTest

/// The chat screen (reference 02) against the parity fixture server: a real
/// server on throwaway data with the repository's fake engine, so a send
/// gets a real streamed reply and nothing reaches a provider.
///
/// Start the fixture first (`node ios/parity/fixture-server.mjs`); it writes
/// `ios/parity/out/session.json`, which this test reads from the host. Without
/// that file the test is skipped.
final class ParityChatUITests: XCTestCase {
    private struct FixtureSession: Decodable {
        let endpoint: String
        let token: String
        let environmentId: String?
    }

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

    @MainActor
    private func launchChat() throws -> XCUIApplication {
        continueAfterFailure = false
        let session = try fixtureSession()
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", session.endpoint,
            "-parityToken", session.token,
            "-parityScreen", "02-chat",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.prefs.islandIntro", "never",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
        ]
        if let environment = session.environmentId { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 20))
        return app
    }

    /// Typing turns the white capsule into send; the fake engine's reply
    /// streams back into the transcript.
    @MainActor
    func testSendStreamsAReply() throws {
        let app = try launchChat()
        XCTAssertTrue(app.buttons["composer-voice"].exists, "an empty composer offers voice mode")
        let input = app.descendants(matching: .any).matching(identifier: "message-input").firstMatch
        input.tap()
        input.typeText("Bonjour Ara")
        let send = app.buttons["composer-send"]
        XCTAssertTrue(send.waitForExistence(timeout: 5), "text turns the capsule into send")
        send.tap()
        let reply = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "hello from fake claude")).firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 45))
        XCTAssertTrue(app.buttons["composer-voice"].waitForExistence(timeout: 5), "sent: back to voice")
        attach("Reply streamed from the fake engine", app)
    }

    /// The name capsule opens the profile; the computer circle the computer;
    /// the white capsule voice mode.
    @MainActor
    func testTopBarAndVoiceOpenTheirScreens() throws {
        let app = try launchChat()

        app.buttons["chat-name"].tap()
        XCTAssertTrue(app.staticTexts["profile-name"].waitForExistence(timeout: 10), "profile screen")
        attach("Profile from the name capsule", app)
        app.buttons["profile-back"].tap()
        XCTAssertTrue(app.buttons["header-computer"].waitForExistence(timeout: 10))

        app.buttons["header-computer"].tap()
        // the computer view's own bar, titled with the bot (no frame yet on the fixture)
        XCTAssertTrue(app.navigationBars["Ara"].waitForExistence(timeout: 10), "computer view")
        attach("Computer view", app)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.buttons["composer-voice"].waitForExistence(timeout: 10))

        app.buttons["composer-voice"].tap()
        let close = app.buttons["Close Walkie"]
        XCTAssertTrue(close.waitForExistence(timeout: 10), "voice mode (Walkie)")
        attach("Voice mode from the white capsule", app)
        close.tap()
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 10))
    }

    /// Threads and slash commands moved into the "+" sheet; threads also
    /// sit behind a touch and hold on the name.
    @MainActor
    func testPlusSheetCarriesThreadsAndSlashCommands() throws {
        let app = try launchChat()

        app.buttons["composer-plus"].tap()
        let commands = app.buttons["plus-commands"]
        XCTAssertTrue(commands.waitForExistence(timeout: 5))
        commands.tap()
        XCTAssertTrue(app.staticTexts["/diff"].waitForExistence(timeout: 5), "slash command HUD")
        attach("Slash commands from the + sheet", app)

        app.buttons["composer-plus"].tap()
        let threads = app.buttons["plus-tasks"]
        XCTAssertTrue(threads.waitForExistence(timeout: 5))
        threads.tap()
        XCTAssertTrue(app.buttons["new-thread"].waitForExistence(timeout: 10), "thread picker")
        attach("Threads from the + sheet", app)
        app.swipeDown(velocity: .fast)

        let name = app.buttons["chat-name"]
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        name.press(forDuration: 1.0)
        let menuThreads = app.buttons["Threads"]
        XCTAssertTrue(menuThreads.waitForExistence(timeout: 5), "touch and hold menu")
        menuThreads.tap()
        XCTAssertTrue(app.buttons["new-thread"].waitForExistence(timeout: 10))
    }

    @MainActor
    private func attach(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
