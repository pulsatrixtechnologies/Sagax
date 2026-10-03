import XCTest

/// Threads and folders (matrix package WP5) against the parity fixture
/// server: every menu entry is driven in the app, and the server's own
/// answer (`GET /api/bots`, `/api/config`) proves it landed.
///
///   PARITY_THREAD_TITLES=1 PARITY_OUT=/tmp/wp5 node ios/parity/fixture-server.mjs &
///   TEST_RUNNER_PARITY_ENDPOINT=... TEST_RUNNER_PARITY_TOKEN=... \
///   TEST_RUNNER_PARITY_ENVIRONMENT=... xcodebuild test \
///     -only-testing:SagaxUITests/ThreadFoldersUITests ...
///
/// Without PARITY_THREAD_TITLES the regenerate step checks that the entry is
/// hidden instead. Without the fixture variables the tests skip.
final class ThreadFoldersUITests: XCTestCase {
    private var endpoint = ""
    private var token = ""
    private var environment: String?

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"] else {
            throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN")
        }
        self.endpoint = endpoint
        self.token = token
        environment = env["PARITY_ENVIRONMENT"].flatMap { $0.isEmpty ? nil : $0 }
    }

    // MARK: Launch

    @MainActor
    private func launch(screen: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", endpoint, "-parityToken", token, "-parityScreen", screen,
            "-companion.prefs.rosterDensity", "standard",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.prefs.islandIntro", "never",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
        ]
        if let environment { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        return app
    }

    /// Ara's chat, then her Threads sheet from the name capsule's menu.
    @MainActor
    private func openAraThreads() -> XCUIApplication {
        let app = launch(screen: "02-chat")
        let name = app.buttons["chat-name"]
        XCTAssertTrue(name.waitForExistence(timeout: 30))
        name.press(forDuration: 1.0)
        let threads = app.buttons["Threads"]
        XCTAssertTrue(threads.waitForExistence(timeout: 5))
        threads.tap()
        XCTAssertTrue(app.buttons["new-thread"].waitForExistence(timeout: 10))
        return app
    }

    // MARK: API

    @discardableResult
    private func api(_ method: String, _ path: String, _ body: [String: Any]? = nil) throws -> Any? {
        var request = URLRequest(url: try XCTUnwrap(URL(string: endpoint + path)))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let done = expectation(description: "\(method) \(path)")
        var result: (Data?, URLResponse?) = (nil, nil)
        URLSession.shared.dataTask(with: request) { data, response, _ in
            result = (data, response)
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 20)
        let status = (result.1 as? HTTPURLResponse)?.statusCode ?? 0
        XCTAssertTrue((200...299).contains(status), "\(method) \(path) -> \(status)")
        guard let data = result.0, !data.isEmpty else { return nil }
        return try JSONSerialization.jsonObject(with: data)
    }

    private func bot(named name: String) throws -> [String: Any] {
        let bots = (try api("GET", "/api/bots") as? [String: Any])?["bots"] as? [[String: Any]] ?? []
        return try XCTUnwrap(bots.first { $0["name"] as? String == name }, "no bot named \(name)")
    }

    private func folders(of name: String) throws -> [[String: Any]] {
        try bot(named: name)["projects"] as? [[String: Any]] ?? []
    }

    private func task(_ threadId: String, of name: String) throws -> [String: Any]? {
        (try bot(named: name)["tasks"] as? [[String: Any]])?.first { $0["threadId"] as? String == threadId }
    }

    /// Poll the server until `check` holds.
    private func eventually(_ what: String, timeout: TimeInterval = 15, _ check: () throws -> Bool) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try check() { return }
            Thread.sleep(forTimeInterval: 0.4)
        }
        XCTFail("server never showed: \(what)")
    }

    // MARK: Helpers

    @MainActor
    private func threadMenu(_ threadId: String, in app: XCUIApplication) {
        let row = app.buttons["thread-\(threadId)"]
        // The sheet's list is lazy: a row below the fold does not exist yet.
        for _ in 0..<5 where !row.waitForExistence(timeout: 2) || !row.isHittable {
            app.collectionViews.firstMatch.swipeUp()
        }
        XCTAssertTrue(row.waitForExistence(timeout: 10), "thread row \(threadId)")
        row.press(forDuration: 1.2)
    }

    @MainActor
    private func tapMenuItem(_ label: String, in app: XCUIApplication) {
        let item = app.buttons[label].firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 5), "menu item \(label)")
        item.tap()
    }

    @MainActor
    private func createFolder(_ name: String, in app: XCUIApplication) {
        app.buttons["folders-menu"].tap()
        tapMenuItem("New folder", in: app)
        let field = app.textFields["folder-name"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        type(name, into: field, expecting: name, in: app)
        app.buttons["folder-save"].tap()
        XCTAssertTrue(waitForDisappearance(field))
    }

    /// Type into a field and check what landed: a loaded runner drops keys.
    /// A miss clears the field and types the whole expected value again.
    @MainActor
    private func type(_ text: String, into field: XCUIElement, expecting expected: String, in app: XCUIApplication) {
        if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { field.tap() }
        field.typeText(text)
        for _ in 0..<2 where field.value as? String != expected {
            let current = field.value as? String ?? ""
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 2))
            field.typeText(expected)
        }
        XCTAssertEqual(field.value as? String, expected)
    }

    /// A confirmation that shows for two seconds, with a screenshot kept
    /// in the result bundle either way.
    @MainActor
    private func assertNotice(in app: XCUIApplication, _ what: String) {
        let notice = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier == 'thread-action-notice' OR label == %@", what)).firstMatch
        let shown = notice.waitForExistence(timeout: 5)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = what
        shot.lifetime = .keepAlways
        add(shot)
        XCTAssertTrue(shown, what)
    }

    private func waitForDisappearance(_ element: XCUIElement, timeout: TimeInterval = 10) -> Bool {
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element)
        return XCTWaiter.wait(for: [gone], timeout: timeout) == .completed
    }

    // MARK: Tests

    /// New folder, file a thread, rename it, folder settings, reorder,
    /// copy link, regenerate the title, then delete the folder and keep
    /// the thread: each step checked on the server.
    @MainActor
    func testFolderLifecycleAndThreadMenu() throws {
        let suffix = String(UUID().uuidString.prefix(4))
        let ara = try bot(named: "Ara")
        let araId = try XCTUnwrap(ara["id"] as? String)
        let created = try api("POST", "/api/bots/\(araId)/tasks", ["title": "WP5 thread \(suffix)"]) as? [String: Any]
        let tasks = (created?["bot"] as? [String: Any])?["tasks"] as? [[String: Any]] ?? []
        let threadId = try XCTUnwrap(tasks.first { $0["title"] as? String == "WP5 thread \(suffix)" }?["threadId"] as? String)
        let current = try XCTUnwrap(ara["threadId"] as? String)

        let app = openAraThreads()

        // New folder, twice (reorder needs two).
        let first = "Clients \(suffix)"
        let second = "Admin \(suffix)"
        createFolder(first, in: app)
        try eventually("folder \(first)") { try folders(of: "Ara").contains { $0["name"] as? String == first } }
        createFolder(second, in: app)
        try eventually("folder \(second)") { try folders(of: "Ara").contains { $0["name"] as? String == second } }
        let firstId = try XCTUnwrap(folders(of: "Ara").first { $0["name"] as? String == first }?["id"] as? String)
        let secondId = try XCTUnwrap(folders(of: "Ara").first { $0["name"] as? String == second }?["id"] as? String)
        XCTAssertTrue(app.staticTexts["folder-empty.\(secondId)"].waitForExistence(timeout: 10), "an empty folder says so")

        // Move to folder.
        threadMenu(threadId, in: app)
        tapMenuItem("Move to folder", in: app)
        tapMenuItem(first, in: app)
        try eventually("thread filed in \(first)") { try task(threadId, of: "Ara")?["projectId"] as? String == firstId }

        // Rename, through the sheet's own title row.
        threadMenu(threadId, in: app)
        tapMenuItem("Rename", in: app)
        let title = app.textFields["Thread title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        type(" renamed", into: title, expecting: "WP5 thread \(suffix) renamed", in: app)
        app.buttons["Save"].firstMatch.tap()
        try eventually("thread renamed") { try task(threadId, of: "Ara")?["title"] as? String == "WP5 thread \(suffix) renamed" }

        // Folder settings: a new name and a preset icon.
        app.buttons["folder-menu.\(firstId)"].tap()
        tapMenuItem("Folder settings", in: app)
        let name = app.textFields["folder-name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        type(" 2", into: name, expecting: "\(first) 2", in: app)
        app.buttons["🚀"].tap()
        app.buttons["folder-save"].tap()
        try eventually("folder renamed with an icon") {
            let folder = try folders(of: "Ara").first { $0["id"] as? String == firstId }
            return folder?["name"] as? String == "\(first) 2" && folder?["emoji"] as? String == "🚀"
        }

        // Reorder: the first saved folder moves down.
        let before = try folders(of: "Ara").compactMap { $0["id"] as? String }
        XCTAssertEqual(Array(before.suffix(2)), [firstId, secondId])
        app.buttons["folder-menu.\(firstId)"].tap()
        tapMenuItem("Move folder down", in: app)
        try eventually("folder order saved") {
            Array(try folders(of: "Ara").compactMap { $0["id"] as? String }.suffix(2)) == [secondId, firstId]
        }

        // Copy link: a local action, confirmed on screen.
        threadMenu(threadId, in: app)
        tapMenuItem("Copy link", in: app)
        assertNotice(in: app, "Link copied")

        // Regenerate title: only where the computer generates titles.
        let config = try api("GET", "/api/config") as? [String: Any]
        let generated = (config?["features"] as? [String: Any])?["llmThreadTitles"] as? Bool == true
        threadMenu(current, in: app)
        if generated {
            tapMenuItem("Regenerate title", in: app)
            try eventually("title regenerated", timeout: 30) {
                try task(current, of: "Ara")?["title"] as? String == "Fixture generated title"
            }
        } else {
            XCTAssertFalse(app.buttons["Regenerate title"].exists, "hidden while generated titles are off")
            app.buttons["Copy link"].firstMatch.tap()
        }

        // Delete the folder: its thread stays, out of any folder.
        app.buttons["folder-menu.\(firstId)"].tap()
        tapMenuItem("Folder settings", in: app)
        let delete = app.buttons["folder-delete"]
        XCTAssertTrue(delete.waitForExistence(timeout: 5))
        delete.tap()
        tapMenuItem("Delete folder, keep threads", in: app)
        try eventually("folder deleted, thread kept") {
            let gone = try !folders(of: "Ara").contains { $0["id"] as? String == firstId }
            let kept = try task(threadId, of: "Ara")
            return gone && kept != nil && (kept?["projectId"] == nil || kept?["projectId"] is NSNull)
        }
    }

    /// The bot row's long press: Mark as Unread and Copy conversation ID.
    @MainActor
    func testBotRowMarksUnreadAndCopiesTheConversationId() throws {
        let helios = try bot(named: "Helios")
        let id = try XCTUnwrap(helios["id"] as? String)
        try api("PATCH", "/api/bots/\(id)", ["unread": false])
        try eventually("Helios read") { try bot(named: "Helios")["unread"] as? Bool != true }

        let app = launch(screen: "01-home")
        let cell = app.buttons["pinned.\(id)"]
        XCTAssertTrue(cell.waitForExistence(timeout: 30))
        cell.press(forDuration: 1.2)
        tapMenuItem("Mark as Unread", in: app)
        try eventually("Helios unread") { try bot(named: "Helios")["unread"] as? Bool == true }

        cell.press(forDuration: 1.2)
        tapMenuItem("Copy conversation ID", in: app)
        assertNotice(in: app, "Conversation ID copied")
    }
}
