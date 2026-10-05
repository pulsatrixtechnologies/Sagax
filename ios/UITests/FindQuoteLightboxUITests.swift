import XCTest

/// WP4 of the feature parity matrix on Ara's chat, against the parity
/// fixture server: find in conversation (MS11), jump to latest (MS14), quote
/// a selection as a citation (CO8) and the conversation-wide lightbox
/// (CA31). Each test acts in the app and checks the server's own answer
/// (search hits, the sent message), so a control that only changed the
/// screen fails.
///
/// Start the fixture first (`node ios/parity/fixture-server.mjs`) and pass
/// its session as TEST_RUNNER_PARITY_ENDPOINT / _TOKEN / _ENVIRONMENT, or
/// leave the `ios/parity/out/session.json` it writes; without either the
/// tests are skipped.
final class FindQuoteLightboxUITests: XCTestCase {
    private struct FixtureSession: Decodable {
        let endpoint: String
        let token: String
        let environmentId: String?
    }

    private struct WireMessage: Decodable {
        let id: String
        let role: String
        let text: String?
        let parentId: String?
    }

    private struct Page: Decodable {
        let messages: [WireMessage]
        let activeLeafId: String?
    }

    private struct WireBot: Decodable {
        let id: String
        let name: String
        let threadId: String
    }

    private struct Fleet: Decodable { let bots: [WireBot] }
    private struct Hit: Decodable { let messageId: String }
    private struct Hits: Decodable { let hits: [Hit] }

    private struct CitedSource: Decodable { let ownerType: String; let ownerId: String; let threadId: String; let messageId: String }
    private struct Cited: Decodable { let kind: String; let quote: String; let comment: String?; let source: CitedSource }

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

    // MARK: - The server

    private func request(_ method: String, _ path: String) throws -> Data {
        var request = URLRequest(url: URL(string: fixture.endpoint + path)!)
        request.httpMethod = method
        request.setValue("Bearer \(fixture.token)", forHTTPHeaderField: "Authorization")
        let done = expectation(description: "\(method) \(path)")
        var result: Result<Data, Error> = .failure(URLError(.unknown))
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error { result = .failure(error) }
            else if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                result = .failure(NSError(domain: "fixture", code: http.statusCode))
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

    private func activePath(_ threadId: String) throws -> [WireMessage] {
        let page = try JSONDecoder().decode(Page.self, from: request("GET", "/api/threads/\(threadId)/messages?limit=200"))
        let byId = Dictionary(page.messages.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        guard var cursor = page.activeLeafId.flatMap({ byId[$0] }) else { return page.messages }
        var path = [cursor]
        while let parent = cursor.parentId, let next = byId[parent] { path.insert(next, at: 0); cursor = next }
        return path
    }

    private func search(_ query: String, threadId: String) throws -> [Hit] {
        let q = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        return try JSONDecoder().decode(Hits.self, from: request("GET", "/api/search?q=\(q)&limit=100&threadId=\(threadId)")).hits
    }

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

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ id: String, timeout: TimeInterval = 15) {
        let target = element(app, id)
        XCTAssertTrue(target.waitForExistence(timeout: timeout), "\(id) on screen")
        target.tap()
    }

    private func attach(_ name: String, _ app: XCUIApplication) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// A message row is in view (not merely built in the eager stack).
    @MainActor
    private func inView(_ app: XCUIApplication, _ messageId: String) -> Bool {
        let row = element(app, "message-\(messageId)")
        guard row.exists else { return false }
        let frame = row.frame, screen = app.windows.firstMatch.frame
        return frame.maxY > screen.minY + 60 && frame.minY < screen.maxY - 120
    }

    // MARK: - MS11, MS14

    /// "+" > Find in conversation: the server's hits for the thread, the
    /// first landed on, Next / Previous wrap and land; the transcript stays
    /// where the reader is, and Jump to latest takes it back to the end.
    @MainActor
    func testFindStepsThroughTheServersHitsAndJumpReturnsToTheEnd() throws {
        let app = try launchChat()
        let bot = try ara()
        let hits = try search("captures", threadId: bot.threadId)
        XCTAssertGreaterThanOrEqual(hits.count, 2, "the fixture's Ara thread mentions captures twice")
        let latest = try XCTUnwrap(activePath(bot.threadId).last)

        XCTAssertFalse(element(app, "jump-to-latest").exists, "at the end, no jump button")
        tap(app, "composer-plus")
        tap(app, "plus-find")
        let field = element(app, "chat-find-field")
        XCTAssertTrue(field.waitForExistence(timeout: 5), "the find bar replaces the header")
        XCTAssertFalse(app.buttons["chat-name"].isHittable)
        field.typeText("captures")
        let status = element(app, "chat-find-status")
        eventually("first of the hits") { (status.label) == "1 of \(hits.count)" }
        eventually("landed on the first hit") { inView(app, hits[0].messageId) }
        attach("Find: first hit", app)

        tap(app, "chat-find-next")
        eventually("second hit") { status.label == "2 of \(hits.count)" }
        eventually("landed on the second hit") { inView(app, hits[1].messageId) }
        tap(app, "chat-find-previous")
        eventually("back to the first") { status.label == "1 of \(hits.count)" }
        tap(app, "chat-find-previous")
        eventually("wraps to the last") { status.label == "\(hits.count) of \(hits.count)" }

        field.typeText("zzqqxx")
        eventually("no results") { status.label == "No results" }

        tap(app, "chat-find-close")
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 5), "the header is back")

        // Reading an old message: Jump to latest is offered and goes home.
        XCTAssertFalse(inView(app, latest.id), "the landing left the end")
        let jump = element(app, "jump-to-latest")
        XCTAssertTrue(jump.waitForExistence(timeout: 5), "Jump to latest while reading scrollback")
        attach("Jump to latest", app)
        jump.tap()
        eventually("the newest message is in view") { inView(app, latest.id) }
        eventually("the button goes once at the end") { !element(app, "jump-to-latest").exists }
    }

    /// Scrolling up by hand stops the follow and offers the button too.
    @MainActor
    func testScrollingUpOffersJumpToLatest() throws {
        let app = try launchChat()
        let latest = try XCTUnwrap(activePath(try ara().threadId).last)
        XCTAssertFalse(element(app, "jump-to-latest").exists)
        app.swipeDown()
        app.swipeDown()
        let jump = element(app, "jump-to-latest")
        XCTAssertTrue(jump.waitForExistence(timeout: 5))
        jump.tap()
        eventually("back at the end") { inView(app, latest.id) && !element(app, "jump-to-latest").exists }
    }

    // MARK: - CO8

    /// Select Text > select a word > Cite > comment > Save: a chip waits in
    /// the composer, the send carries the desktop's citation block (quote,
    /// comment, source message), and the bubble shows the chip, not the
    /// marker.
    @MainActor
    func testCiteSendsTheDesktopCitationBlock() throws {
        let app = try launchChat()
        let bot = try ara()
        let source = try XCTUnwrap(activePath(bot.threadId).last { $0.role == "user" }, "Ara's thread has a line of yours")

        let row = element(app, "message-\(source.id)")
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        row.press(forDuration: 1.0)
        let select = app.buttons["Select Text"]
        XCTAssertTrue(select.waitForExistence(timeout: 5))
        select.tap()
        let text = app.textViews.firstMatch
        XCTAssertTrue(text.waitForExistence(timeout: 5))
        text.doubleTap()
        let cite = element(app, "cite-selection")
        XCTAssertTrue(cite.waitForExistence(timeout: 5), "Cite once something is selected")
        attach("Selection and Cite", app)
        cite.tap()
        let comment = element(app, "citation-comment")
        XCTAssertTrue(comment.waitForExistence(timeout: 5), "the comment editor")
        let note = "pourquoi \(Int(Date().timeIntervalSince1970) % 100_000)"
        comment.tap()
        comment.typeText(note)
        tap(app, "citation-save")
        XCTAssertTrue(element(app, "composer-citations").waitForExistence(timeout: 8), "the chip waits in the composer")
        attach("Citation chip in the composer", app)

        let words = "Voir la citation \(Int(Date().timeIntervalSince1970) % 100_000)"
        let input = element(app, "message-input")
        input.tap()
        input.typeText(words)
        tap(app, "composer-send")

        var sent: WireMessage?
        try eventually("the message reached the server") {
            sent = try activePath(bot.threadId).last { $0.role == "user" && ($0.text ?? "").hasPrefix(words) }
            return sent != nil
        }
        let body = try XCTUnwrap(sent?.text)
        XCTAssertTrue(body.contains("\n\n<!--omb-citation-v1:"), body)
        XCTAssertTrue(body.contains("-->\n> Quoted message:\n> "), body)
        XCTAssertTrue(body.hasSuffix("\n\nComment:\n\(note)"), body)
        let marker = try XCTUnwrap(body.range(of: #"<!--omb-citation-v1:([A-Za-z0-9_-]+)-->"#, options: .regularExpression))
        var encoded = String(body[marker]).replacingOccurrences(of: "<!--omb-citation-v1:", with: "").replacingOccurrences(of: "-->", with: "")
            .replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while encoded.count % 4 != 0 { encoded += "=" }
        let cited = try JSONDecoder().decode(Cited.self, from: XCTUnwrap(Data(base64Encoded: encoded)))
        XCTAssertEqual(cited.kind, "citation")
        XCTAssertEqual(cited.comment, note)
        XCTAssertEqual(cited.source.ownerType, "bot")
        XCTAssertEqual(cited.source.ownerId, bot.id)
        XCTAssertEqual(cited.source.threadId, bot.threadId)
        XCTAssertEqual(cited.source.messageId, source.id)
        XCTAssertFalse(cited.quote.trimmingCharacters(in: .whitespaces).isEmpty)
        XCTAssertTrue((source.text ?? "").contains(cited.quote), "the quote is from the source message")

        XCTAssertFalse(element(app, "composer-citations").exists, "the chip left with the send")
        let sentRow = element(app, "message-\(try XCTUnwrap(sent).id)")
        XCTAssertTrue(sentRow.waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "omb-citation")).firstMatch.exists, "no marker on screen")
        let chip = sentRow.descendants(matching: .any).matching(identifier: "citation-chip").firstMatch
        XCTAssertTrue(chip.waitForExistence(timeout: 5), "the sent bubble shows the citation")
        chip.tap()
        XCTAssertTrue(element(app, "citation-go-to-source").waitForExistence(timeout: 5))
        attach("Citation details", app)
        tap(app, "citation-go-to-source")
        eventually("the source message is in view") { inView(app, source.id) }
    }

    // MARK: - CA31

    /// One tap on a picture opens the lightbox on it with the conversation's
    /// three pictures; the arrows step through all of them and wrap.
    @MainActor
    func testLightboxPagesThroughTheConversationsPictures() throws {
        let app = try launchChat()
        let image = app.buttons["Image: parity-media-3.png"]
        // Bring the picture well inside the transcript, clear of the header
        // and the composer.
        let screen = app.windows.firstMatch.frame
        for _ in 0..<12 {
            let frame = image.frame
            if image.exists, frame.minY > screen.minY + 160, frame.maxY < screen.maxY - 200 { break }
            if image.exists, frame.minY > screen.midY { app.swipeUp(velocity: .slow) } else { app.swipeDown(velocity: .slow) }
        }
        XCTAssertTrue(image.waitForExistence(timeout: 10))
        let loaded = NSPredicate(format: "value == %@", "Loaded")
        expectation(for: loaded, evaluatedWith: image)
        waitForExpectations(timeout: 15)
        image.tap()
        let position = element(app, "lightbox-position")
        let opened = position.waitForExistence(timeout: 10)
        attach("After tapping the picture", app)
        XCTAssertTrue(opened, "the lightbox")
        XCTAssertEqual(position.label, "3 of 3", "opened on the tapped picture, the last of three")
        XCTAssertTrue(element(app, "lightbox-image").waitForExistence(timeout: 10), "the picture loaded")
        attach("Lightbox 3 of 3", app)
        tap(app, "lightbox-next")
        eventually("wraps to the first") { position.label == "1 of 3" }
        tap(app, "lightbox-next")
        eventually("second") { position.label == "2 of 3" }
        tap(app, "lightbox-previous")
        eventually("back to the first") { position.label == "1 of 3" }
        app.swipeLeft()
        eventually("swipe pages too") { position.label == "2 of 3" }
        tap(app, "lightbox-close")
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 5))
    }
}
