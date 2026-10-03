import XCTest

/// The message actions of WP1 (feature parity matrix rows CO2, MS3-MS5, MS8,
/// MS9, MS19) on Ara's chat, against the parity fixture server: each test
/// drives the long-press menu and then reads the server's own state through
/// the API, so a menu item that only changed the screen fails.
///
/// Start the fixture first (`node ios/parity/fixture-server.mjs`) and pass
/// its session as TEST_RUNNER_PARITY_ENDPOINT / _TOKEN / _ENVIRONMENT, or
/// leave the `ios/parity/out/session.json` it writes; without either the
/// tests are skipped.
final class MessageActionsUITests: XCTestCase {
    private struct FixtureSession: Decodable {
        let endpoint: String
        let token: String
        let environmentId: String?
    }

    private struct WireMessage: Decodable {
        let id: String
        let role: String
        let kind: String
        let text: String?
        let parentId: String?
        let replyToId: String?
    }

    private struct Page: Decodable {
        let messages: [WireMessage]
        let activeLeafId: String?
    }

    private struct WireTask: Decodable {
        let threadId: String
        let pinnedMessageId: String?
    }

    private struct WireBot: Decodable {
        let id: String
        let name: String
        let threadId: String
        let pinnedMessageId: String?
        let busy: Bool?
        let tasks: [WireTask]?
    }

    private struct Fleet: Decodable { let bots: [WireBot] }

    private var fixture: FixtureSession!

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

    // MARK: - The server, read and written as a client would

    private func request(_ method: String, _ path: String, body: [String: Any]? = nil) throws -> Data {
        var request = URLRequest(url: URL(string: fixture.endpoint + path)!)
        request.httpMethod = method
        request.setValue("Bearer \(fixture.token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let done = expectation(description: "\(method) \(path)")
        var result: Result<Data, Error> = .failure(URLError(.unknown))
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error { result = .failure(error) }
            else if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                result = .failure(NSError(domain: "fixture", code: http.statusCode, userInfo: [
                    NSLocalizedDescriptionKey: String(data: data ?? Data(), encoding: .utf8) ?? "",
                ]))
            } else { result = .success(data ?? Data()) }
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 20)
        return try result.get()
    }

    private func ara() throws -> WireBot {
        let fleet = try JSONDecoder().decode(Fleet.self, from: request("GET", "/api/bots"))
        return try XCTUnwrap(fleet.bots.first { $0.name == "Ara" }, "the fixture seeds Ara")
    }

    private func page(_ threadId: String) throws -> Page {
        try JSONDecoder().decode(Page.self, from: request("GET", "/api/threads/\(threadId)/messages?limit=100"))
    }

    /// The messages on the active branch, oldest first.
    private func activePath(_ page: Page) -> [WireMessage] {
        let byId = Dictionary(page.messages.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        guard var cursor = page.activeLeafId.flatMap({ byId[$0] }) else { return page.messages }
        var path = [cursor]
        while let parent = cursor.parentId, let next = byId[parent] { path.insert(next, at: 0); cursor = next }
        return path
    }

    /// Polls the server until `check` holds (the event stream and the engine
    /// answer on their own schedule).
    private func eventually(_ what: String, timeout: TimeInterval = 45, _ check: () throws -> Bool) rethrows {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try check() { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        XCTFail("timed out waiting for: \(what)")
    }

    // MARK: - The app

    @MainActor
    private func launchChat() throws -> XCUIApplication {
        continueAfterFailure = false
        fixture = try fixtureSession()
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", fixture.endpoint,
            "-parityToken", fixture.token,
            "-parityScreen", "02-chat",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.prefs.islandIntro", "never",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
        ]
        if let environment = fixture.environmentId { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 20))
        return app
    }

    /// Long-press a message row and pick a menu item.
    @MainActor
    private func menu(_ app: XCUIApplication, on messageId: String, pick item: String) {
        let row = app.descendants(matching: .any).matching(identifier: "message-\(messageId)").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "row \(messageId) on screen")
        row.press(forDuration: 1.0)
        let button = app.buttons[item]
        XCTAssertTrue(button.waitForExistence(timeout: 5), "\(item) in the menu")
        button.tap()
    }

    @MainActor
    private func type(_ app: XCUIApplication, _ text: String) {
        let input = app.descendants(matching: .any).matching(identifier: "message-input").firstMatch
        input.tap()
        input.typeText(text)
        let send = app.buttons["composer-send"]
        XCTAssertTrue(send.waitForExistence(timeout: 5))
        send.tap()
    }

    // MARK: - Tests

    /// Reply: the quote strip above the composer, the send carries
    /// `replyToId` to the server, and the new bubble shows the quote.
    @MainActor
    func testReplyStoresReplyToIdAndQuotesInTheBubble() throws {
        let app = try launchChat()
        let bot = try ara()
        let target = try XCTUnwrap(activePath(page(bot.threadId)).last { $0.role == "bot" && $0.kind == "text" })

        menu(app, on: target.id, pick: "Reply")
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "reply-strip").firstMatch.waitForExistence(timeout: 5), "quote strip above the composer")
        attach("Reply strip", app)
        let words = "Réponse citée \(Int(Date().timeIntervalSince1970))"
        type(app, words)

        var stored: WireMessage?
        try eventually("the reply stored with replyToId") {
            stored = try page(bot.threadId).messages.first { $0.text == words }
            return stored != nil
        }
        XCTAssertEqual(stored?.replyToId, target.id)
        XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "reply-strip").firstMatch.exists, "the strip leaves with the send")
        let quote = app.descendants(matching: .any).matching(identifier: "reply-quote-\(stored!.id)").firstMatch
        XCTAssertTrue(quote.waitForExistence(timeout: 15), "the quote inside the sent bubble")
        attach("Quote in the bubble", app)
    }

    /// Cancel reply: the X clears the strip and the send goes without a quote.
    @MainActor
    func testCancelledReplySendsWithoutQuote() throws {
        let app = try launchChat()
        let bot = try ara()
        let target = try XCTUnwrap(activePath(page(bot.threadId)).last { $0.role == "bot" && $0.kind == "text" })
        menu(app, on: target.id, pick: "Reply")
        let cancel = app.buttons["reply-cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 5))
        cancel.tap()
        XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "reply-strip").firstMatch.exists)
        let words = "Sans citation \(Int(Date().timeIntervalSince1970))"
        type(app, words)
        var stored: WireMessage?
        try eventually("the send stored") {
            stored = try page(bot.threadId).messages.first { $0.text == words }
            return stored != nil
        }
        XCTAssertNil(stored?.replyToId)
    }

    /// Regenerate: on the newest reply, forks the last user line with the
    /// same words; the server holds a second copy of it and a new answer.
    @MainActor
    func testRegenerateProducesANewAnswer() throws {
        let app = try launchChat()
        let bot = try ara()
        let before = try page(bot.threadId)
        let path = activePath(before)
        let lastReply = try XCTUnwrap(path.last { $0.role == "bot" && $0.kind == "text" })
        let lastUser = try XCTUnwrap(path.last { $0.role == "user" && $0.kind == "text" })
        let known = Set(before.messages.map(\.id))

        menu(app, on: lastReply.id, pick: "Regenerate")
        try eventually("a forked user line and a new answer on the active branch") {
            let now = try page(bot.threadId)
            let fresh = activePath(now).filter { !known.contains($0.id) }
            return fresh.contains { $0.role == "user" && $0.text == lastUser.text }
                && fresh.contains { $0.role == "bot" && $0.kind == "text" && !($0.text ?? "").isEmpty }
        }
        attach("Regenerated", app)
        // The old answer stays reachable: the version switcher shows 2 of 2.
        XCTAssertTrue(app.staticTexts["2 of 2"].waitForExistence(timeout: 15), "the fork's version switcher")
    }

    /// Pin: the banner under the header, the thread's pinnedMessageId on
    /// the server; its X unpins on the server too.
    @MainActor
    func testPinStoresPinnedMessageAndUnpinClearsIt() throws {
        let app = try launchChat()
        let bot = try ara()
        let target = try XCTUnwrap(activePath(page(bot.threadId)).last { $0.role == "user" && $0.kind == "text" })

        menu(app, on: target.id, pick: "Pin")
        let banner = app.buttons["pinned-banner"]
        XCTAssertTrue(banner.waitForExistence(timeout: 10), "pinned banner under the header")
        attach("Pinned banner", app)
        try eventually("pinnedMessageId stored on the thread") {
            let live = try ara()
            let task = live.tasks?.first { $0.threadId == live.threadId }
            return (task?.pinnedMessageId ?? live.pinnedMessageId) == target.id
        }

        app.buttons["pinned-unpin"].tap()
        XCTAssertTrue(banner.waitForNonExistence(timeout: 10), "banner gone")
        try eventually("pin cleared on the server") {
            let live = try ara()
            let task = live.tasks?.first { $0.threadId == live.threadId }
            return (task?.pinnedMessageId ?? live.pinnedMessageId) == nil
        }
    }

    /// View Source: the reply as its markdown source, then back.
    @MainActor
    func testViewSourceTogglesTheRawMarkdown() throws {
        let app = try launchChat()
        let bot = try ara()
        let target = try XCTUnwrap(activePath(page(bot.threadId)).last { $0.role == "bot" && $0.kind == "text" })
        menu(app, on: target.id, pick: "View Source")
        let raw = app.descendants(matching: .any).matching(identifier: "raw-markdown-\(target.id)").firstMatch
        XCTAssertTrue(raw.waitForExistence(timeout: 5), "raw markdown view")
        attach("View source", app)
        menu(app, on: target.id, pick: "Hide Source")
        XCTAssertTrue(raw.waitForNonExistence(timeout: 5))
    }

    /// Read Aloud: the item turns into Stop Speaking while the reply is read,
    /// and back to Read Aloud once stopped. The fixture's computer has no
    /// voice, so the phone's voice reads it; the simulator may finish that at
    /// once, in which case the menu must already offer Read Aloud again
    /// (never a Stop stuck on a reply that is silent).
    @MainActor
    func testSpeakTurnsIntoStop() throws {
        let app = try launchChat()
        let bot = try ara()
        let target = try XCTUnwrap(activePath(page(bot.threadId)).last { $0.role == "bot" && $0.kind == "text" })
        menu(app, on: target.id, pick: "Read Aloud")
        let row = app.descendants(matching: .any).matching(identifier: "message-\(target.id)").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.press(forDuration: 1.0)
        let stop = app.buttons["Stop Speaking"]
        let read = app.buttons["Read Aloud"]
        XCTAssertTrue(stop.waitForExistence(timeout: 5) || read.exists, "the speak item in the menu")
        if stop.exists {
            attach("Speaking", app)
            stop.tap()
            XCTAssertTrue(row.waitForExistence(timeout: 10))
            row.press(forDuration: 1.0)
        }
        XCTAssertTrue(read.waitForExistence(timeout: 5), "stopped: Read Aloud again")
        XCTAssertFalse(stop.exists)
        attach("Stopped", app)
    }

    /// A long line of yours collapses behind Show full message.
    @MainActor
    func testLongUserMessageCollapses() throws {
        fixture = try fixtureSession()
        // A turn left running by an earlier test would hold or steer the
        // line; post it to an idle thread so it lands as a plain message.
        try eventually("Ara idle", timeout: 90) { try ara().busy != true }
        let bot = try ara()
        let stamp = Int(Date().timeIntervalSince1970)
        let long = (1...12).map { "Ligne \($0) d'un long message collé \(stamp)." }.joined(separator: "\n")
        _ = try request("POST", "/api/bots/\(bot.id)/messages", body: ["text": long, "threadId": bot.threadId])
        var stored: WireMessage?
        try eventually("the long line stored") {
            stored = try page(bot.threadId).messages.first { $0.text == long }
            return stored != nil
        }
        let app = try launchChat()
        let toggle = app.buttons["collapse-\(stored!.id)"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 15), "Show full message under a long line")
        XCTAssertEqual(toggle.label, "Show full message")
        toggle.tap()
        XCTAssertEqual(app.buttons["collapse-\(stored!.id)"].label, "Show less")
        attach("Expanded", app)
    }

    @MainActor
    private func attach(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
