import XCTest
import UIKit

/// Rooms of WP11 (feature parity matrix RM6-RM8, RM11, RM13-RM19, CA14)
/// against the parity fixture's card lab (`PARITY_CARDS=1 node
/// ios/parity/fixture-server.mjs`), whose "Lab Room" is led by Room Lab on a
/// holding engine. The fixture pairs the phone with the admin scope on a
/// solo server, so it owns every room. Each test acts in the app, then reads
/// the server's own state through the API, so a control that only changed
/// the screen fails.
///
/// The session comes from TEST_RUNNER_PARITY_ENDPOINT / _TOKEN / _ENVIRONMENT
/// or `ios/parity/out/session.json`; without a card lab the tests are skipped.
final class RoomInfoUITests: XCTestCase {
    private struct FixtureSession: Decodable {
        let endpoint: String
        let token: String
        let environmentId: String?
    }

    private struct LabBot: Decodable { let id: String; let threadId: String; let name: String }
    private struct Lab: Decodable {
        let bots: [String: LabBot]
        let room: LabBot?
    }
    private struct Responder: Decodable { let kind: String; let botId: String? }
    private struct WireRoom: Decodable {
        let id: String
        let threadId: String
        let name: String
        let bulletin: String
        let memberIds: [String]
        let defaultResponder: Responder
        let section: String?
        let working: Bool?
    }
    private struct Fleet: Decodable { let groups: [WireRoom] }
    private struct Memory: Decodable { let text: String; let enabled: Bool }
    private struct WireMessage: Decodable {
        let role: String
        let kind: String
        let text: String?
        let channelMode: String?
    }
    private struct Page: Decodable { let messages: [WireMessage] }
    private struct Created: Decodable { let group: WireRoom }

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

    private func labRoom() throws -> LabBot { try XCTUnwrap(lab().room, "the card lab seeds Lab Room") }

    private func room(_ id: String) throws -> WireRoom? {
        try JSONDecoder().decode(Fleet.self, from: request("GET", "/api/bots")).groups.first { $0.id == id }
    }

    private func page(_ threadId: String) throws -> [WireMessage] {
        try JSONDecoder().decode(Page.self, from: request("GET", "/api/threads/\(threadId)/messages?limit=200")).messages
    }

    private func eventually(_ what: String, timeout: TimeInterval = 30, _ check: () throws -> Bool) rethrows {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try check() { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        XCTFail("timed out waiting for: \(what)")
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

    /// The header opens the Room info sheet (RM6).
    @MainActor
    private func openRoomInfo(_ app: XCUIApplication) {
        tap(app, "chat-name")
        XCTAssertTrue(element(app, "room-info").waitForExistence(timeout: 15), "the Room info sheet")
    }

    @MainActor
    private func scrollTo(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        let target = element(app, id)
        let list = element(app, "room-info")
        var tries = 0
        while !(target.exists && target.isHittable) && tries < 8 {
            list.swipeUp()
            tries += 1
        }
        return target
    }

    @MainActor
    private func replaceText(_ field: XCUIElement, with text: String) {
        field.tap()
        let current = field.value as? String ?? ""
        if !current.isEmpty {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 2))
        }
        field.typeText(text)
    }

    /// The room's turns stopped, so its roster may change.
    private func idleRoom(_ room: LabBot) throws {
        _ = try? request("POST", "/api/groups/\(room.id)/interrupt", body: ["threadId": room.threadId])
        try eventually("\(room.name) idle") { try self.room(room.id)?.working != true }
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

    // MARK: - Rename, instructions, memory (RM6, RM7, RM8, RM14, RM17)

    /// The header opens Room info; the owner renames the room, writes its
    /// instructions and its memory. The server keeps each.
    @MainActor
    func testRoomInfoRenamesWritesInstructionsAndMemory() throws {
        try setUpFixture()
        let lab = try labRoom()
        let originalName = try XCTUnwrap(try room(lab.id)).name
        defer { _ = try? request("PATCH", "/api/groups/\(lab.id)", body: ["name": originalName, "bulletin": ""]) }
        let app = try launch(originalName)
        openRoomInfo(app)
        XCTAssertTrue(element(app, "room-threads").exists, "Threads is a row of Room info")
        XCTAssertFalse(element(app, "room-owner-only").exists, "the owner reads no owner-only note")
        attach("Room info", app)

        // rename (RM14)
        let newName = "Lab Room \(stamp())"
        tap(app, "room-info-name")
        let field = app.alerts.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the rename field")
        replaceText(field, with: newName)
        app.alerts.buttons["room-rename-save"].firstMatch.tap()
        try eventually("the room renamed") { try room(lab.id)?.name == newName }
        XCTAssertTrue(app.staticTexts[newName].waitForExistence(timeout: 10), "the new name on the sheet")

        // instructions (RM7 read, RM17 edit)
        let brief = "Brief partagé \(stamp())"
        tap(app, "room-instructions")
        let editor = element(app, "room-instructions-editor")
        XCTAssertTrue(editor.waitForExistence(timeout: 10), "the instructions editor")
        editor.tap()
        editor.typeText(brief)
        tap(app, "room-instructions-save")
        try eventually("the instructions saved") { try room(lab.id)?.bulletin == brief }
        app.navigationBars["Instructions"].buttons.element(boundBy: 0).tap()

        // memory (RM8)
        let fact = "- Fait du groupe \(stamp())"
        tap(app, "room-memory")
        let memory = element(app, "room-memory-editor")
        XCTAssertTrue(memory.waitForExistence(timeout: 15), "the memory editor")
        XCTAssertTrue(element(app, "room-memory-gauge").exists, "the memory gauge")
        memory.tap()
        memory.typeText(fact)
        tap(app, "room-memory-save")
        try eventually("the memory saved") {
            let saved = try JSONDecoder().decode(Memory.self, from: request("GET", "/api/groups/\(lab.id)/memory"))
            return saved.text.contains(fact)
        }
        attach("Room memory", app)
        _ = try? request("PUT", "/api/groups/\(lab.id)/memory", body: ["text": ""])
    }

    // MARK: - Who answers and members (RM18, RM19)

    @MainActor
    func testWhoAnswersAndManageMembers() throws {
        try setUpFixture()
        let lab = try labRoom()
        let labs = try self.lab().bots
        let lead = try XCTUnwrap(labs["room"])
        let extra = try XCTUnwrap(labs["quiz"])
        let restore: [String: Any] = ["memberIds": [lead.id], "defaultResponder": ["kind": "member", "botId": lead.id]]
        try idleRoom(lab)
        try request("PATCH", "/api/groups/\(lab.id)", body: restore)
        defer { _ = try? request("PATCH", "/api/groups/\(lab.id)", body: restore) }
        let app = try launch(try XCTUnwrap(try room(lab.id)).name)
        openRoomInfo(app)

        let picker = scrollTo(app, "room-responder")
        XCTAssertTrue(picker.waitForExistence(timeout: 10), "who answers")
        picker.tap()
        let everyone = app.buttons["Everyone responds"]
        XCTAssertTrue(everyone.waitForExistence(timeout: 10), "the responder choices")
        everyone.tap()
        try eventually("everyone answers") { try room(lab.id)?.defaultResponder.kind == "everyone" }

        let manage = scrollTo(app, "room-manage-members")
        XCTAssertTrue(manage.waitForExistence(timeout: 10))
        manage.tap()
        tap(app, "room-pick-\(extra.id)")
        XCTAssertEqual(element(app, "room-pick-\(extra.id)").value as? String, "on", "the bot ticked")
        attach("Picked", app)
        tap(app, "room-members-save")
        XCTAssertFalse(element(app, "room-members-save").waitForExistence(timeout: 5) && element(app, "room-members-save").isHittable, "the sheet closed")
        try eventually("the bot joined") { try room(lab.id)?.memberIds == [lead.id, extra.id] }
        attach("Members", app)

        let remove = scrollTo(app, "room-remove-bot-\(extra.id)")
        XCTAssertTrue(remove.waitForExistence(timeout: 10), "the bot's remove button")
        remove.tap()
        try eventually("the bot left") { try room(lab.id)?.memberIds == [lead.id] }
    }

    // MARK: - Goal (RM11, CA14)

    /// "+" > Goal puts the composer in goal mode; the send runs a team goal
    /// and its card shows in the transcript.
    @MainActor
    func testGoalFromThePlusSheet() throws {
        try setUpFixture()
        let lab = try labRoom()
        try idleRoom(lab)
        defer { _ = try? request("POST", "/api/groups/\(lab.id)/interrupt", body: ["threadId": lab.threadId]) }
        let app = try launch(try XCTUnwrap(try room(lab.id)).name)
        tap(app, "composer-plus")
        tap(app, "plus-goal")
        let field = app.textFields["message-input"].exists ? app.textFields["message-input"] : app.textViews["message-input"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        XCTAssertEqual(field.value as? String, "/goal ")
        let goal = "Livrer le plan trimestriel \(stamp())"
        field.typeText(goal)
        tap(app, "composer-send")
        try eventually("the goal sent in goal mode") {
            try page(lab.threadId).contains { $0.role == "user" && $0.text == goal && $0.channelMode == "goal" }
        }
        try eventually("the goal card on the server") { try page(lab.threadId).contains { $0.kind == "goal.run" } }
        XCTAssertTrue(element(app, "goal-run-status").waitForExistence(timeout: 20), "the goal card in the transcript")
        XCTAssertTrue(app.staticTexts[goal].exists, "the card names the goal")
        attach("Goal card", app)
    }

    // MARK: - Copy ID, move, delete (RM13, RM15, RM16)

    @MainActor
    func testCopyMoveAndDeleteARoom() throws {
        try setUpFixture()
        let lead = try XCTUnwrap(try lab().bots["room"])
        let name = "Salle jetable \(stamp())"
        let created = try JSONDecoder().decode(Created.self, from: request("POST", "/api/groups", body: ["name": name, "memberIds": [lead.id]]))
        let id = created.group.id
        defer { _ = try? request("DELETE", "/api/groups/\(id)") }
        let app = try launch(name)
        openRoomInfo(app)

        let copy = scrollTo(app, "room-copy-id")
        copy.tap()
        XCTAssertTrue(element(app, "room-action-notice").waitForExistence(timeout: 5), "the copy notice")

        let move = scrollTo(app, "room-section")
        XCTAssertTrue(move.waitForExistence(timeout: 10), "Move to section")
        move.tap()
        tap(app, "room-section-new")
        let field = app.alerts.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        let section = "Pièce \(stamp())"
        field.typeText(section)
        app.alerts.buttons["Add"].firstMatch.tap()
        try eventually("the room moved") { try room(id)?.section == section }
        app.navigationBars["Move to section"].buttons.element(boundBy: 0).tap()

        let delete = scrollTo(app, "room-delete")
        delete.tap()
        tap(app, "room-delete-confirm")
        try eventually("the room deleted") { try room(id) == nil }
        XCTAssertFalse(element(app, "room-info").waitForExistence(timeout: 3), "the sheet closed")
        attach("Deleted", app)
    }
}
