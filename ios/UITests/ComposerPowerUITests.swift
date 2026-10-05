import XCTest
import UIKit

/// The composer's power features of WP3 (feature parity matrix CO5, CO9-CO12,
/// CO14, CO15, CO17, CO24, RM4, RM5, RM9) against the parity fixture's card
/// lab (`PARITY_CARDS=1 node ios/parity/fixture-server.mjs`): Card Lab's
/// engine holds its turns still, lists a lab slash command and records its
/// prompts; Lab Room is led by it; the composer lab (composer-lab.mjs)
/// refuses sends on request. Each test acts in the app, then reads the
/// server's own state through the API, so a control that only changed the
/// screen fails.
///
/// The session comes from TEST_RUNNER_PARITY_ENDPOINT / _TOKEN / _ENVIRONMENT
/// or `ios/parity/out/session.json`; without a card lab the tests are skipped.
final class ComposerPowerUITests: XCTestCase {
    private struct FixtureSession: Decodable {
        let endpoint: String
        let token: String
        let environmentId: String?
    }

    private struct LabBot: Decodable { let id: String; let threadId: String; let name: String }
    private struct Lab: Decodable {
        let bots: [String: LabBot]
        let room: LabBot?
        let prompts: [String]?
    }
    private struct Parallel: Decodable { let threadId: String; let role: String }
    private struct Compaction: Decodable { let by: String? }
    private struct WireMessage: Decodable {
        let id: String
        let role: String
        let kind: String
        let text: String?
        let steered: Bool?
        let parallelTask: Parallel?
        let compaction: Compaction?
    }
    private struct Page: Decodable { let messages: [WireMessage] }
    private struct ParallelOf: Decodable { let threadId: String }
    private struct WireTask: Decodable { let threadId: String; let parallelOf: ParallelOf?; let busy: Bool? }
    private struct WireBot: Decodable { let id: String; let busy: Bool?; let tasks: [WireTask]? }
    private struct WireRoom: Decodable { let id: String; let working: Bool?; let busyBotId: String? }
    private struct Fleet: Decodable { let bots: [WireBot]; let groups: [WireRoom] }
    private struct ComposerLab: Decodable { let failNext: Int }

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

    @discardableResult
    private func request(_ method: String, _ path: String, body: [String: Any]? = nil) throws -> Data {
        var request = URLRequest(url: URL(string: fixture.endpoint + path)!)
        request.httpMethod = method
        request.timeoutInterval = 60
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
        wait(for: [done], timeout: 70)
        return try result.get()
    }

    private func lab() throws -> Lab {
        do {
            return try JSONDecoder().decode(Lab.self, from: request("GET", "/__parity/cards"))
        } catch let error as NSError where error.domain == "fixture" && error.code == 404 {
            throw XCTSkip("start the fixture with PARITY_CARDS=1 for the card lab")
        }
    }

    private func bot(_ key: String) throws -> LabBot {
        try XCTUnwrap(lab().bots[key], "the card lab seeds \(key)")
    }

    private func room() throws -> LabBot {
        try XCTUnwrap(lab().room, "the card lab seeds Lab Room")
    }

    private func page(_ threadId: String) throws -> [WireMessage] {
        try JSONDecoder().decode(Page.self, from: request("GET", "/api/threads/\(threadId)/messages?limit=200")).messages
    }

    private func fleet() throws -> Fleet {
        try JSONDecoder().decode(Fleet.self, from: request("GET", "/api/bots"))
    }

    private func busy(_ botId: String) throws -> Bool {
        try fleet().bots.first { $0.id == botId }?.busy == true
    }

    private func eventually(_ what: String, timeout: TimeInterval = 45, _ check: () throws -> Bool) rethrows {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try check() { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        XCTFail("timed out waiting for: \(what)")
    }

    /// Card Lab stopped, then a fresh turn that holds still.
    private func busyCardLab() throws -> LabBot {
        let lab = try bot("asks")
        idle(lab)
        try request("POST", "/__parity/cards/asks", body: ["asks": [[String: Any]]()])
        try eventually("Card Lab working") { try busy(lab.id) }
        return lab
    }

    /// Every turn of the bot stopped: its thread's and its parallel tasks'.
    private func idle(_ lab: LabBot) {
        _ = try? request("POST", "/api/bots/\(lab.id)/interrupt", body: ["threadId": lab.threadId])
        let tasks: [WireTask] = ((try? fleet())?.bots.first { $0.id == lab.id }?.tasks) ?? []
        for task in tasks where task.busy == true {
            _ = try? request("POST", "/api/bots/\(lab.id)/interrupt", body: ["threadId": task.threadId])
        }
        try? eventually("\(lab.name) idle") { try !busy(lab.id) }
    }

    private func stamp() -> String { String(Int(Date().timeIntervalSince1970 * 1000) % 1_000_000_000) }

    // MARK: - The app

    @MainActor
    private func launch(_ chatName: String) throws -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", fixture.endpoint,
            "-parityToken", fixture.token,
            "-parityScreen", "02-chat",
            "-parityChat", chatName,
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.prefs.islandIntro", "never",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
        ]
        if let environment = fixture.environmentId { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 30))
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ id: String, timeout: TimeInterval = 20) {
        let target = element(app, id)
        XCTAssertTrue(target.waitForExistence(timeout: timeout), "\(id) on screen")
        target.tap()
    }

    @MainActor
    private func type(_ app: XCUIApplication, _ text: String) {
        let field = app.textFields["message-input"].exists ? app.textFields["message-input"] : app.textViews["message-input"]
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the composer field")
        if !field.hasKeyboardFocusCompat { field.tap() }
        field.typeText(text)
    }

    @MainActor
    private func fieldValue(_ app: XCUIApplication) -> String {
        let field = app.textFields["message-input"].exists ? app.textFields["message-input"] : app.textViews["message-input"]
        return field.value as? String ?? ""
    }

    @MainActor
    private func send(_ app: XCUIApplication) {
        tap(app, "composer-send")
    }

    private func attach(_ name: String, _ app: XCUIApplication) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    private func setUpFixture() throws {
        fixture = try fixtureSession()
        _ = try lab()
    }

    // MARK: - Busy send (CO15)

    /// While the bot works a send asks what it should do: "Add to the
    /// current task" joins the running turn; "New task in parallel" opens a
    /// parallel task that answers here.
    @MainActor
    func testBusySendSteersAndStartsAParallelTask() throws {
        try setUpFixture()
        let lab = try busyCardLab()
        let app = try launch("Card Lab")
        let steerWords = "actually use the other file \(stamp())"
        type(app, steerWords)
        send(app)
        XCTAssertTrue(element(app, "busy-send-chooser").waitForExistence(timeout: 10), "the busy-send chooser")
        XCTAssertTrue(element(app, "busy-send-steer").isSelected, "a short correction suggests a steer")
        attach("Busy-send chooser", app)
        tap(app, "busy-send-steer")
        try eventually("the words joined the running turn") {
            try page(lab.threadId).contains { $0.role == "user" && $0.text == steerWords && $0.steered == true }
        }
        XCTAssertFalse(element(app, "busy-send-chooser").exists)

        let parallelWords = "Inventaire de remplacement du trimestre pour le conseil \(stamp())"
        type(app, parallelWords)
        send(app)
        XCTAssertTrue(element(app, "busy-send-parallel").waitForExistence(timeout: 10))
        XCTAssertTrue(element(app, "busy-send-parallel").isSelected, "a new request suggests parallel")
        tap(app, "busy-send-parallel")
        try eventually("the request opened a parallel task") {
            try page(lab.threadId).contains { $0.text == parallelWords && $0.parallelTask?.role == "request" }
        }
        let request = try XCTUnwrap(try page(lab.threadId).first { $0.text == parallelWords }?.parallelTask)
        try eventually("the parallel task is a thread of Card Lab") {
            try fleet().bots.first { $0.id == lab.id }?.tasks?.contains {
                $0.threadId == request.threadId && $0.parallelOf?.threadId == lab.threadId
            } == true
        }
        attach("Steered and parallel", app)
        idle(lab)
    }

    // MARK: - Steer a held send (CO14)

    /// "After this one" holds the words; Steer on the held row folds them
    /// into the running turn without stopping it.
    @MainActor
    func testQueuedSendSteersIntoTheRunningTurn() throws {
        try setUpFixture()
        let lab = try busyCardLab()
        let app = try launch("Card Lab")
        let words = "Ajoute aussi le tableau \(stamp())"
        type(app, words)
        send(app)
        tap(app, "busy-send-after")
        XCTAssertTrue(element(app, "queued-steer").waitForExistence(timeout: 20), "the held send with Steer")
        XCTAssertFalse(try page(lab.threadId).contains { $0.text == words }, "held, not said yet")
        attach("Held send with Steer", app)
        tap(app, "queued-steer")
        try eventually("the held words joined the running turn") {
            try page(lab.threadId).contains { $0.role == "user" && $0.text == words && $0.steered == true }
        }
        XCTAssertTrue(try busy(lab.id), "a steer never stops the turn")
        try eventually("the held row leaves") { !element(app, "queued-steer").exists }
        idle(lab)
    }

    // MARK: - Failed send (CO17)

    @MainActor
    func testFailedSendRetryDelivers() throws {
        try setUpFixture()
        let lab = try bot("retry")
        idle(lab)
        try request("POST", "/__parity/composer/fail-sends", body: ["count": 1])
        let app = try launch("Retry Lab")
        let words = "Réessaie le résumé \(stamp())"
        type(app, words)
        send(app)
        XCTAssertTrue(element(app, "failed-send").waitForExistence(timeout: 20), "the failed-send banner")
        XCTAssertFalse(try page(lab.threadId).contains { $0.text == words }, "the refused send never reached the server")
        let composerLab = try JSONDecoder().decode(ComposerLab.self, from: request("GET", "/__parity/composer"))
        XCTAssertEqual(composerLab.failNext, 0)
        attach("Failed send with Retry", app)
        tap(app, "failed-send-retry")
        try eventually("the retry delivered") {
            try page(lab.threadId).filter { $0.role == "user" && $0.text == words }.count == 1
        }
        try eventually("the banner leaves") { !element(app, "failed-send").exists }
        XCTAssertEqual(fieldValue(app).contains(words), false, "the sent words left the field")
        idle(lab)
    }

    // MARK: - Slash commands (CO9, CO10)

    /// "/" lists Sagax's own commands and the engine's real ones (from
    /// GET harness-commands); picking one fills the field and the send
    /// reaches the engine as that command.
    @MainActor
    func testSlashMenuRunsAnEngineCommand() throws {
        try setUpFixture()
        let lab = try bot("asks")
        idle(lab)
        let app = try launch("Card Lab")
        type(app, "/")
        XCTAssertTrue(element(app, "slash-menu").waitForExistence(timeout: 15), "the / menu")
        XCTAssertTrue(element(app, "slash-/parity-check").waitForExistence(timeout: 20), "the engine's own command")
        XCTAssertTrue(element(app, "slash-/compact").exists)
        XCTAssertTrue(element(app, "slash-/learn").exists, "Sagax's /learn")
        XCTAssertTrue(element(app, "slash-/setup").exists, "Sagax's /setup")
        XCTAssertFalse(app.staticTexts["/diff"].exists, "no prose commands")
        attach("Slash menu", app)
        tap(app, "slash-/parity-check")
        XCTAssertEqual(fieldValue(app), "/parity-check ")
        let note = "note-\(stamp())"
        type(app, note)
        send(app)
        try eventually("the engine received the command") {
            try (self.lab().prompts ?? []).contains { $0.contains("/parity-check \(note)") }
        }
        idle(lab)
    }

    // MARK: - Compact (CO24)

    @MainActor
    func testCompactSummarizesTheConversation() throws {
        try setUpFixture()
        let lab = try bot("retry")
        idle(lab)
        // something new to fold since any earlier compaction
        let words = "Note pour le résumé \(stamp())"
        try request("POST", "/api/bots/\(lab.id)/messages", body: ["text": words, "threadId": lab.threadId])
        try eventually("the reply settled") {
            try !busy(lab.id) && page(lab.threadId).last?.role == "bot"
        }
        let before = try page(lab.threadId).filter { $0.kind == "compaction" }.count
        let app = try launch("Retry Lab")
        tap(app, "composer-plus")
        tap(app, "plus-compact")
        try eventually("a compaction receipt") {
            try page(lab.threadId).filter { $0.kind == "compaction" && $0.compaction?.by == "person" }.count > before
        }
        attach("Compacted", app)
    }

    // MARK: - Paste (CO5)

    /// "+" > Paste: a copied image becomes an attachment the computer
    /// stores; a long copied text becomes a chip sent as a pasted block.
    @MainActor
    func testPasteImageAndLongText() throws {
        try setUpFixture()
        let lab = try bot("retry")
        idle(lab)
        let app = try launch("Retry Lab")
        UIPasteboard.general.image = Self.swatch()
        tap(app, "composer-plus")
        tap(app, "plus-paste")
        allowPaste(app)
        XCTAssertTrue(app.staticTexts["Pasted image.png"].waitForExistence(timeout: 15), "the pasted image's chip")
        let words = "Voici la capture \(stamp())"
        type(app, words)
        attach("Pasted image", app)
        send(app)
        var sent: WireMessage?
        try eventually("the image was sent") {
            sent = try page(lab.threadId).first { $0.role == "user" && ($0.text ?? "").contains(words) }
            return sent != nil
        }
        let text = try XCTUnwrap(sent?.text)
        XCTAssertTrue(text.contains("<attached-image path=\""), text)
        XCTAssertTrue(text.contains("name=\"Pasted image.png\""), text)
        // the computer stored it: its own attachment route serves the bytes
        let path = try XCTUnwrap(text.components(separatedBy: "path=\"").dropFirst().first?.components(separatedBy: "\"").first)
        let name = (path as NSString).lastPathComponent
        let stored = try request("GET", "/api/attachments/\(name)")
        XCTAssertEqual(Array(stored.prefix(4)), [0x89, 0x50, 0x4E, 0x47], "a PNG")

        let long = (1...20).map { "ligne \($0) du rapport de remplacement" }.joined(separator: "\n")
        UIPasteboard.general.string = long
        try eventually("the reply settled") { try !busy(lab.id) }
        tap(app, "composer-plus")
        tap(app, "plus-paste")
        allowPaste(app)
        XCTAssertTrue(element(app, "paste-chip").waitForExistence(timeout: 15), "the long paste's chip")
        XCTAssertEqual(fieldValue(app).contains("ligne 1"), false, "the long text stays out of the field")
        attach("Paste chip", app)
        send(app)
        try eventually("the pasted block was sent") {
            try page(lab.threadId).contains { ($0.text ?? "").contains("<pasted-text index=\"1\">\nligne 1 du rapport") }
        }
        idle(lab)
    }

    /// The system asks before an app reads what another app copied; the
    /// alert belongs to SpringBoard while the app waits on the read.
    @MainActor
    private func allowPaste(_ app: XCUIApplication) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.buttons["Allow Paste"]
        if allow.waitForExistence(timeout: 8) { allow.tap() }
    }

    private static func swatch() -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 24, height: 24))
        return renderer.image { context in
            UIColor(red: 0.2, green: 0.5, blue: 0.8, alpha: 1).setFill()
            context.fill(CGRect(x: 0, y: 0, width: 24, height: 24))
        }
    }

    // MARK: - "@" and "#" (CO11, CO12)

    @MainActor
    func testMentionAndThreadSuggestions() throws {
        try setUpFixture()
        let lab = try bot("retry")
        idle(lab)
        let app = try launch("Retry Lab")
        type(app, "Demande à @Card")
        tap(app, "suggestion-@Card Lab")
        XCTAssertEqual(fieldValue(app), "Demande à @Card Lab ")
        type(app, "de lire #")
        let thread = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'suggestion-#'")).firstMatch
        XCTAssertTrue(thread.waitForExistence(timeout: 10), "thread suggestions")
        let title = String(thread.identifier.dropFirst("suggestion-#".count))
        attach("Thread suggestions", app)
        thread.tap()
        XCTAssertEqual(fieldValue(app), "Demande à @Card Lab de lire #\(title) ")
        send(app)
        try eventually("the reference left as a thread link") {
            try page(lab.threadId).contains {
                $0.role == "user" && ($0.text ?? "").hasPrefix("Demande à @Card Lab de lire [\(title)](openmausbot://thread/")
            }
        }
        idle(lab)
    }

    // MARK: - Rooms (RM4, RM5)

    /// In a room a send while it works is held (no chooser); Steer folds it
    /// into the room's running turn; "+" > Interrupt stops that turn.
    @MainActor
    func testRoomSteerAndInterrupt() throws {
        try setUpFixture()
        let labRoom = try room()
        let lead = try bot("room")
        idle(lead)
        _ = try? request("POST", "/api/groups/\(labRoom.id)/interrupt", body: ["threadId": labRoom.threadId])
        try request("POST", "/api/groups/\(labRoom.id)/messages", body: ["text": "Commence le plan \(stamp())", "threadId": labRoom.threadId])
        try eventually("Lab Room working") { try fleet().groups.first { $0.id == labRoom.id }?.working == true }
        let app = try launch("Lab Room")
        let words = "Ajoute le budget \(stamp())"
        type(app, words)
        send(app)
        XCTAssertFalse(element(app, "busy-send-chooser").waitForExistence(timeout: 2), "a room never asks")
        XCTAssertTrue(element(app, "queued-steer").waitForExistence(timeout: 20), "the held send with Steer")
        tap(app, "queued-steer")
        try eventually("the held words joined the room's turn") {
            try page(labRoom.threadId).contains { $0.role == "user" && $0.text == words && $0.steered == true }
        }
        attach("Room steered", app)
        tap(app, "composer-plus")
        tap(app, "plus-stop")
        try eventually("the room's turn stopped") {
            let group = try fleet().groups.first { $0.id == labRoom.id }
            return group?.working != true && group?.busyBotId == nil
        }
        attach("Room interrupted", app)
    }
}

private extension XCUIElement {
    var hasKeyboardFocusCompat: Bool {
        (value(forKey: "hasKeyboardFocus") as? Bool) ?? false
    }
}
