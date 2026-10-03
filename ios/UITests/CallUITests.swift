import XCTest

/// A live call against the parity fixture server (a real server on throwaway
/// data, with the repository's fake engine), driven without a microphone:
/// recordings are said into the call through the same frames, turn detector
/// and endpointing as the real microphone (`-callInjectAudio`), and the
/// bot's voice is captured instead of played (`-callCaptureSpeech`). See
/// App/Call/CallDebug.swift.
///
/// Start the fixture first (`node ios/parity/fixture-server.mjs`) and pass its
/// session as TEST_RUNNER_PARITY_ENDPOINT / _TOKEN / _ENVIRONMENT, or leave the
/// `ios/parity/out/session.json` it writes in place; without either the test
/// is skipped.
final class CallUITests: XCTestCase {
    private struct FixtureSession: Decodable {
        let endpoint: String
        let token: String
        let environmentId: String?
    }

    private func fixtureSession() throws -> FixtureSession {
        let env = ProcessInfo.processInfo.environment
        if let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"] {
            return FixtureSession(endpoint: endpoint, token: token, environmentId: env["PARITY_ENVIRONMENT"].flatMap { $0.isEmpty ? nil : $0 })
        }
        let file = Self.iosRoot.appendingPathComponent("parity/out/session.json")
        guard let data = try? Data(contentsOf: file) else {
            throw XCTSkip("parity fixture server is not running (\(file.path))")
        }
        return try JSONDecoder().decode(FixtureSession.self, from: data)
    }

    private static let iosRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()

    @MainActor
    private func launch(screen: String, audio: String, plan: String) throws -> (XCUIApplication, FixtureSession) {
        continueAfterFailure = false
        let session = try fixtureSession()
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", session.endpoint,
            "-parityToken", session.token,
            "-parityScreen", screen,
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.prefs.islandIntro", "never",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
            "-callInjectAudio", Self.iosRoot.appendingPathComponent("UITests/CallAudio/\(audio)").path,
            "-callCaptureSpeech",
            "-callInjectPlan", plan,
        ]
        if let environment = session.environmentId { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        return (app, session)
    }

    // MARK: - Readouts

    private func label(_ app: XCUIApplication, _ id: String) -> String {
        let element = app.descendants(matching: .any).matching(identifier: id).firstMatch
        return element.exists ? element.label : ""
    }

    @discardableResult
    private func wait(_ timeout: TimeInterval, _ what: String, _ condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        let app = XCUIApplication()
        XCTFail("timed out: \(what) [phase=\(label(app, "call-debug-phase")) counters=\(label(app, "call-debug-counters")) spoken=\(label(app, "call-debug-spoken").replacingOccurrences(of: "\n", with: " / ")) status=\(label(app, "call-status"))]")
        return false
    }

    private func spoken(_ app: XCUIApplication) -> [String] {
        label(app, "call-debug-spoken").split(separator: "\n").map(String.init)
    }

    private func counter(_ app: XCUIApplication, _ name: String) -> Int {
        for pair in label(app, "call-debug-counters").split(separator: " ") {
            let parts = pair.split(separator: "=")
            if parts.count == 2, parts[0] == name { return Int(parts[1]) ?? 0 }
        }
        return 0
    }

    // MARK: - The server's record

    private struct Message: Decodable {
        struct VoiceCall: Decodable { let callId: String; let interrupted: Bool?; let language: String? }
        let id: String
        let role: String
        let kind: String
        let text: String?
        let voiceCall: VoiceCall?
    }

    private func get<T: Decodable>(_ session: FixtureSession, _ path: String, as type: T.Type) throws -> T {
        try call(session, "GET", path, as: type)
    }

    private func call<T: Decodable>(_ session: FixtureSession, _ method: String, _ path: String, body json: [String: Any]? = nil, as type: T.Type) throws -> T {
        var request = URLRequest(url: URL(string: session.endpoint + path)!)
        request.httpMethod = method
        request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization")
        if let json {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: json)
        }
        let done = expectation(description: path)
        var body: Data?
        URLSession.shared.dataTask(with: request) { data, _, _ in
            body = data
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 15)
        return try JSONDecoder().decode(T.self, from: XCTUnwrap(body))
    }

    private func threadMessages(_ session: FixtureSession, bot name: String) throws -> [Message] {
        struct Fleet: Decodable {
            struct Bot: Decodable { let id: String; let name: String; let threadId: String }
            let bots: [Bot]
        }
        struct Page: Decodable { let messages: [Message] }
        let fleet = try get(session, "/api/bots?messages=0", as: Fleet.self)
        let bot = try XCTUnwrap(fleet.bots.first { $0.name == name })
        return try get(session, "/api/threads/\(bot.threadId)/messages?limit=40", as: Page.self).messages
    }

    // MARK: - A cast of its own

    /// The calls run with bots (and a room) made for this test and deleted
    /// after it, so the fixture's own conversations (Ara's thread, Peer
    /// Managers) are exactly as the other suites expect, in any order.
    private struct Created: Decodable {
        struct Bot: Decodable { let id: String; let name: String; let threadId: String }
        struct Group: Decodable { let id: String }
        let bot: Bot?
        let group: Group?
    }

    private var cleanup: [(String, String)] = []
    private var cleanupSession: FixtureSession?

    private func makeBot(_ session: FixtureSession, _ name: String) throws -> Created.Bot {
        let bot = try XCTUnwrap(try call(session, "POST", "/api/bots", body: ["name": name, "title": "Call test"], as: Created.self).bot)
        cleanup.append(("DELETE", "/api/bots/\(bot.id)"))
        cleanupSession = session
        _ = try? call(session, "PATCH", "/api/bots/\(bot.id)", body: ["color": "purple", "mascotLook": ["character": "owl"]], as: Created.self)
        return bot
    }

    private func makeRoom(_ session: FixtureSession, _ name: String, members: [Created.Bot]) throws {
        let group = try XCTUnwrap(try call(session, "POST", "/api/groups", body: ["name": name, "memberIds": members.map(\.id)], as: Created.self).group)
        cleanup.insert(("DELETE", "/api/groups/\(group.id)"), at: 0)
    }

    override func tearDown() {
        if let session = cleanupSession {
            for (method, path) in cleanup {
                struct Ignored: Decodable {}
                _ = try? call(session, method, path, as: Ignored.self)
            }
        }
        cleanup = []
        cleanupSession = nil
        super.tearDown()
    }

    /// Open a chat from the home's search.
    @MainActor
    private func open(_ name: String, in app: XCUIApplication) {
        let search = app.buttons["home-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 20))
        search.tap()
        let field = app.textFields["search-field"]
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'search-row.' AND label CONTAINS %@", name)).firstMatch
        // the fleet may still be hydrating when the field opens: type again
        for attempt in 0..<3 where !row.exists {
            guard field.waitForExistence(timeout: 5) else { break }
            field.tap()
            if attempt > 0, let typed = field.value as? String, !typed.isEmpty {
                field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: typed.count))
            }
            field.typeText(name)
            _ = row.waitForExistence(timeout: 8)
        }
        XCTAssertTrue(row.waitForExistence(timeout: 5), "\(name) in search")
        // the keyboard may cover the row: put it away first
        if !row.isHittable, field.exists { field.typeText("\n") }
        if !row.isHittable { app.swipeDown(velocity: .slow) }
        if row.isHittable { row.tap() } else { row.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap() }
        XCTAssertTrue(app.buttons["composer-voice"].waitForExistence(timeout: 15))
    }

    private static func unique(_ name: String) -> String { "\(name) \(Int.random(in: 1000...9999))" }

    // MARK: - One to one

    /// A real conversation: the person's words land in the thread as call
    /// turns, the bot's streamed answer is spoken, talking over it cuts it
    /// (and the next turn says so), and hanging up leaves the transcript.
    @MainActor
    func testACallIsAConversationWithBargeIn() throws {
        let session = try fixtureSession()
        let name = Self.unique("Callie")
        _ = try makeBot(session, name)
        let (app, _) = try launch(screen: "01-home", audio: "bot", plan: "listening,speaking")
        open(name, in: app)

        app.buttons["composer-voice"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["call-pill"].waitForExistence(timeout: 15), "the call pill under the name")
        XCTAssertTrue(app.buttons["composer-end-call"].exists, "the capsule hangs up while on the call")
        wait(15, "connected") { !["", "connecting"].contains(label(app, "call-debug-phase")) }
        attach("Call connected", app)

        // the person speaks (the first clip, said once the call listens):
        // endpointing ends the turn, the words are sent
        wait(10, "hearing the person") { ["hearing", "thinking"].contains(label(app, "call-debug-phase")) || counter(app, "sent") > 0 }
        let question = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "où en est le projet")).firstMatch
        XCTAssertTrue(question.waitForExistence(timeout: 20), "the utterance is a message in the thread")

        // the bot's answer is spoken
        wait(45, "the reply spoken") { spoken(app).contains { $0.hasSuffix("hello from fake claude") } }
        let route = spoken(app).first { $0.hasSuffix("hello from fake claude") }?.split(separator: "|")
        XCTAssertEqual(route?.first.map(String.init), name, "spoken as the bot")
        XCTAssertEqual(route?.dropFirst().first.map(String.init), "device", "no voice mode or provider on the fixture: the phone's own voice")
        attach("The bot speaking", app)

        // talking over it cuts it (the second clip, said while the bot speaks)
        wait(15, "barge-in") { counter(app, "cancelled") > 0 && counter(app, "injected") >= 2 }
        let followUp = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "parle-moi plutôt de demain")).firstMatch
        XCTAssertTrue(followUp.waitForExistence(timeout: 20), "the words said over the bot are the next turn")
        attach("After the barge-in", app)

        // the server got call turns, the second marked interrupted
        wait(20, "both turns on the server") {
            ((try? self.threadMessages(session, bot: name)) ?? []).filter { $0.role == "user" && $0.voiceCall != nil }.count >= 2
        }
        let turns = try threadMessages(session, bot: name).filter { $0.role == "user" && $0.voiceCall != nil }
        let first = try XCTUnwrap(turns.first { $0.text?.contains("où en est le projet") == true })
        let second = try XCTUnwrap(turns.first { $0.text?.contains("parle-moi plutôt de demain") == true })
        XCTAssertEqual(first.voiceCall?.callId, second.voiceCall?.callId, "one call")
        XCTAssertNotEqual(first.voiceCall?.interrupted, true)
        XCTAssertEqual(second.voiceCall?.interrupted, true, "the bot is told it was interrupted")

        // the transcript card shows both sides
        app.buttons["call-transcript-toggle"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["call-transcript"].waitForExistence(timeout: 5))
        attach("Transcript card", app)

        // hang up: the call is gone, the conversation stays
        app.buttons["call-end"].tap()
        XCTAssertTrue(app.buttons["composer-voice"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.descendants(matching: .any)["call-pill"].exists)
        XCTAssertTrue(question.exists, "the transcript stays in the thread")
        XCTAssertTrue(followUp.exists)
        attach("After the call", app)
    }

    // MARK: - A room

    /// A room's call: one sentence to everyone, then each member's answer is
    /// spoken in turn, in its own voice.
    @MainActor
    func testARoomCallTakesTurns() throws {
        let session = try fixtureSession()
        let members = try ["Echo", "Nova", "Rhea"].map { try makeBot(session, Self.unique($0)) }
        let room = Self.unique("Call Room")
        try makeRoom(session, room, members: members)
        let (app, _) = try launch(screen: "01-home", audio: "room", plan: "listening")
        open(room, in: app)
        app.buttons["composer-voice"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["group-call"].waitForExistence(timeout: 15), "the room's call screen")
        wait(15, "connected") { !["", "connecting"].contains(label(app, "call-debug-phase")) }
        attach("Room call", app)

        wait(60, "three members answer") {
            spoken(app).filter { $0.hasSuffix("hello from fake claude") }.count >= 3
        }
        let speakers = spoken(app).filter { $0.hasSuffix("hello from fake claude") }.map { String($0.split(separator: "|")[0]) }
        XCTAssertEqual(Set(speakers.prefix(3)), Set(members.map(\.name)), "every member speaks, one after the other")
        XCTAssertEqual(speakers.count, Set(speakers).count, "each answer once")
        wait(30, "a member in focus while speaking") {
            app.descendants(matching: .any)["call-member-focused"].exists || label(app, "call-debug-phase") == "listening"
        }
        attach("Members taking turns", app)

        app.buttons["call-end"].tap()
        XCTAssertFalse(app.descendants(matching: .any)["group-call"].waitForExistence(timeout: 3))
    }

    @MainActor
    private func attach(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
