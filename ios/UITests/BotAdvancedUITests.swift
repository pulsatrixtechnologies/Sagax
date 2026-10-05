import XCTest

/// WP16 of the iOS feature parity matrix: the advanced bot panel (rows BA2,
/// BA4-BA7, BA9, BA14-BA19) against the parity fixture. Each test acts in
/// the app and reads the result back through the server's API.
///
/// Decision D1 opens the panel on the owner's sidecar: start the fixture
/// with the real sidecar in front (`PARITY_OWNER=1 node
/// ios/parity/fixture-server.mjs`), which also seeds a disabled imported
/// skill on Ara. The session comes from TEST_RUNNER_PARITY_ENDPOINT /
/// _TOKEN (/ _ENVIRONMENT) or `ios/parity/out/session.json`; without a
/// fixture the tests skip.
final class BotAdvancedUITests: XCTestCase {
    private struct FixtureSession: Decodable {
        let endpoint: String
        let token: String
        let environmentId: String?
    }

    private var fixture: FixtureSession!
    private static let skill = "fixture-check"

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        if let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"] {
            fixture = FixtureSession(endpoint: endpoint, token: token, environmentId: env["PARITY_ENVIRONMENT"].flatMap { $0.isEmpty ? nil : $0 })
            return
        }
        let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("parity/out/session.json")
        guard let data = try? Data(contentsOf: file) else { throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN") }
        fixture = try JSONDecoder().decode(FixtureSession.self, from: data)
    }

    // MARK: API

    @discardableResult
    private func api(_ method: String, _ path: String, _ body: [String: Any]? = nil, allowFailure: Bool = false) throws -> Any? {
        var request = URLRequest(url: try XCTUnwrap(URL(string: fixture.endpoint + path)))
        request.httpMethod = method
        request.timeoutInterval = 60
        request.setValue("Bearer \(fixture.token)", forHTTPHeaderField: "Authorization")
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
        wait(for: [done], timeout: 70)
        let status = (result.1 as? HTTPURLResponse)?.statusCode ?? 0
        if !allowFailure {
            XCTAssertTrue((200...299).contains(status), "\(method) \(path) -> \(status): \(String(data: result.0 ?? Data(), encoding: .utf8) ?? "")")
        }
        guard let data = result.0, !data.isEmpty else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    private func bots() throws -> [[String: Any]] {
        (try api("GET", "/api/bots") as? [String: Any])?["bots"] as? [[String: Any]] ?? []
    }

    private func araId() throws -> String {
        try XCTUnwrap(try bots().first { $0["name"] as? String == "Ara" }?["id"] as? String)
    }

    private func eventually(_ what: String, timeout: TimeInterval = 30, _ check: () throws -> Bool) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try check() { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        XCTFail("never true: \(what)")
    }

    /// The panel is the owner's sidecar's (D1) or an admin's: a fixture
    /// paired as a client skips.
    private func requirePanel() throws {
        guard try api("GET", "/api/bots/\(try araId())/skills", allowFailure: true) is [String: Any] else {
            throw XCTSkip("this pairing has no advanced panel: start the fixture with PARITY_OWNER=1")
        }
    }

    // MARK: App

    @MainActor
    private func launchAdvanced() -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", fixture.endpoint, "-parityToken", fixture.token,
            "-parityScreen", "03-profile-info", "-parityChat", "Ara",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.prefs.islandIntro", "never",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
        ]
        if let environment = fixture.environmentId { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(element("profile-name", in: app).waitForExistence(timeout: 30))
        // the bot panel's More tab: every section, in the desktop's order
        element("panel-tab.more", in: app).tap()
        XCTAssertTrue(element("panel-more", in: app).waitForExistence(timeout: 10))
        return app
    }

    private func element(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    /// Lists are lazy: an off-screen row does not exist until scrolled to.
    @discardableResult
    private func reveal(_ target: XCUIElement, in app: XCUIApplication, swipes: Int = 12) -> Bool {
        _ = target.waitForExistence(timeout: 3)
        for _ in 0..<swipes where !(target.exists && target.isHittable) {
            app.swipeUp()
            _ = target.waitForExistence(timeout: 1)
        }
        return target.exists
    }

    @MainActor
    private func open(_ row: String, in app: XCUIApplication) {
        let link = element(row, in: app)
        reveal(link, in: app)
        XCTAssertTrue(link.waitForExistence(timeout: 10), "\(row) shows on this pairing")
        link.tap()
    }

    private func attach(_ name: String, _ app: XCUIApplication) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    // MARK: Skills (BA4)

    /// A disabled import is reviewed in full before it is switched on; then
    /// it is removed. The server says so each time.
    @MainActor
    func testSkillIsReviewedEnabledThenRemoved() throws {
        try requirePanel()
        let id = try araId()
        let listed = ((try api("GET", "/api/bots/\(id)/skills") as? [String: Any])?["skills"] as? [[String: Any]]) ?? []
        guard let skill = listed.first(where: { $0["name"] as? String == Self.skill }) else {
            throw XCTSkip("the fixture's seeded skill is gone (a previous run removed it)")
        }
        if skill["enabled"] as? Bool == true {
            try api("PATCH", "/api/bots/\(id)/skills/\(Self.skill)", ["enabled": false])
        }
        let app = launchAdvanced()
        open("panel-row.skills", in: app)
        let toggle = app.switches["skill-toggle.\(Self.skill)"].firstMatch
        XCTAssertTrue(toggle.waitForExistence(timeout: 15))
        attach("Skills", app)
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let enable = element("skill-enable-reviewed", in: app)
        XCTAssertTrue(enable.waitForExistence(timeout: 10), "the review shows before enabling")
        XCTAssertTrue(app.staticTexts["Full SKILL.md for \(Self.skill)"].firstMatch.exists, "the full SKILL.md shows")
        attach("Skill review", app)
        enable.tap()
        try eventually("the skill is on on the server") {
            let skills = ((try api("GET", "/api/bots/\(id)/skills") as? [String: Any])?["skills"] as? [[String: Any]]) ?? []
            return skills.first { $0["name"] as? String == Self.skill }?["enabled"] as? Bool == true
        }

        let row = element("skill-open.\(Self.skill)", in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.swipeLeft()
        app.buttons["Remove"].firstMatch.tap()
        let confirm = element("skills-remove-confirm", in: app)
        XCTAssertTrue(confirm.waitForExistence(timeout: 10))
        confirm.tap()
        try eventually("the skill is gone on the server") {
            let skills = ((try api("GET", "/api/bots/\(id)/skills") as? [String: Any])?["skills"] as? [[String: Any]]) ?? []
            return !skills.contains { $0["name"] as? String == Self.skill }
        }
        XCTAssertTrue(element("skills-empty", in: app).waitForExistence(timeout: 10) || reveal(element("skills-empty", in: app), in: app))
    }

    // MARK: Memory (BA5)

    /// MEMORY.md saves with its hash; a bot's write in between is a
    /// conflict, and "Overwrite with mine" saves the person's words.
    @MainActor
    func testMemorySavesAndAConflictIsOverwritten() throws {
        try requirePanel()
        let id = try araId()
        let doc = try XCTUnwrap(try api("GET", "/api/bots/\(id)/memory/file?path=MEMORY.md") as? [String: Any])
        try api("PUT", "/api/bots/\(id)/memory/file", ["path": "MEMORY.md", "text": "- Placeholder fact one\n", "expectedHash": doc["hash"] as? String ?? ""])
        let app = launchAdvanced()
        open("panel-row.memory", in: app)
        XCTAssertTrue(element("memory-gauge", in: app).waitForExistence(timeout: 15), "the gauge shows")
        let file = element("memory-file.MEMORY.md", in: app)
        XCTAssertTrue(reveal(file, in: app))
        file.tap()
        let editor = element("memory-editor", in: app)
        XCTAssertTrue(editor.waitForExistence(timeout: 10))
        editor.tap()
        app.typeText("- Placeholder from the phone\n")
        element("memory-save", in: app).tap()
        try eventually("the phone's line is saved") {
            ((try api("GET", "/api/bots/\(id)/memory/file?path=MEMORY.md") as? [String: Any])?["text"] as? String ?? "").contains("Placeholder from the phone")
        }

        // the bot writes meanwhile: the phone's next save is refused (409)
        let now = try XCTUnwrap(try api("GET", "/api/bots/\(id)/memory/file?path=MEMORY.md") as? [String: Any])
        try api("PUT", "/api/bots/\(id)/memory/file", ["path": "MEMORY.md", "text": "- The bot's own rewrite\n", "expectedHash": now["hash"] as? String ?? ""])
        editor.tap()
        app.typeText("- Second phone line\n")
        element("memory-save", in: app).tap()
        let overwrite = element("memory-conflict-overwrite", in: app)
        XCTAssertTrue(overwrite.waitForExistence(timeout: 10), "the conflict shows")
        attach("Memory conflict", app)
        let unchanged = (try api("GET", "/api/bots/\(id)/memory/file?path=MEMORY.md") as? [String: Any])?["text"] as? String
        XCTAssertEqual(unchanged, "- The bot's own rewrite\n", "nothing was saved over the bot's version")
        overwrite.tap()
        try eventually("the phone's words win") {
            ((try api("GET", "/api/bots/\(id)/memory/file?path=MEMORY.md") as? [String: Any])?["text"] as? String ?? "").contains("Second phone line")
        }
    }

    /// The upkeep switch writes `memoryUpkeep` (a companion field).
    @MainActor
    func testMemoryUpkeepSwitchSaves() throws {
        try requirePanel()
        let id = try araId()
        try api("PATCH", "/api/bots/\(id)", ["memoryUpkeep": true])
        defer { _ = try? api("PATCH", "/api/bots/\(id)", ["memoryUpkeep": true]) }
        let app = launchAdvanced()
        open("panel-row.memory", in: app)
        let toggle = app.switches["memory-upkeep"].firstMatch
        XCTAssertTrue(reveal(toggle, in: app))
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        try eventually("upkeep is off on the server") {
            try bots().first { $0["id"] as? String == id }?["memoryUpkeep"] as? Bool == false
        }
    }

    // MARK: History (BA18)

    /// "Undo this change" on the newest instructions row restores the text
    /// from before it.
    @MainActor
    func testHistoryUndoRestoresTheInstructions() throws {
        try requirePanel()
        let id = try araId()
        let before = try XCTUnwrap((try api("GET", "/api/bots/\(id)/soul") as? [String: Any])?["soul"] as? String)
        try api("PATCH", "/api/bots/\(id)", ["soul": before + "\nPlaceholder: a change to undo."])
        defer { _ = try? api("PATCH", "/api/bots/\(id)", ["soul": before]) }
        let history = try XCTUnwrap(try api("GET", "/api/bots/\(id)/history?limit=100") as? [String: Any])
        let newest = try XCTUnwrap((history["rows"] as? [[String: Any]])?
            .filter { $0["field"] as? String == "soul" && $0["canRestore"] as? Bool == true }
            .max { ($0["at"] as? Double ?? 0) < ($1["at"] as? Double ?? 0) }?["id"] as? String)

        let app = launchAdvanced()
        open("panel-row.history", in: app)
        let undo = element("history-undo.\(newest)", in: app)
        XCTAssertTrue(undo.waitForExistence(timeout: 15) || reveal(undo, in: app))
        attach("History", app)
        undo.tap()
        let confirm = app.buttons["Restore instructions"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 10))
        confirm.tap()
        try eventually("the instructions are back") {
            (try api("GET", "/api/bots/\(id)/soul") as? [String: Any])?["soul"] as? String == before
        }
    }

    // MARK: Prompt preview (BA2), Access (BA6)

    @MainActor
    func testPromptPreviewAndReadOnlyAccess() throws {
        try requirePanel()
        let app = launchAdvanced()
        // the prompt preview is on Overview, as OverviewSection.tsx draws it
        open("panel-row.overview", in: app)
        XCTAssertTrue(reveal(element("prompt-preview-header", in: app), in: app), "the sizes show")
        XCTAssertTrue(element("prompt-preview-part.soul", in: app).exists, "the instructions part shows")
        attach("Prompt preview", app)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        open("panel-row.access", in: app)
        XCTAssertTrue(element("access-folder", in: app).waitForExistence(timeout: 10))
        // the sidecar refuses these fields: read-only lines, never switches
        // the sidecar refuses these fields: read-only lines, never switches
        XCTAssertTrue(reveal(element("access-read-only", in: app), in: app), "the read-only note shows")
        XCTAssertFalse(app.switches["access-browser"].exists, "no switch the sidecar would refuse")
        XCTAssertFalse(app.switches["access-connected-apps"].exists)
        attach("Access", app)
    }

    // MARK: Command allowlist (BA9)

    @MainActor
    func testAllowlistRuleIsRemoved() throws {
        try requirePanel()
        let id = try araId()
        let rules = ((try api("GET", "/api/bots/\(id)/command-allowlist") as? [String: Any])?["rules"] as? [[String: Any]]) ?? []
        guard let rule = rules.first, let ruleId = rule["id"] as? String else { throw XCTSkip("no saved rule left on Ara") }
        let app = launchAdvanced()
        // Permissions > Command allowlist (PermissionsSection.tsx)
        open("panel-row.permissions", in: app)
        open("permissions-allowlist", in: app)
        let remove = element("allowlist-remove.\(ruleId)", in: app)
        XCTAssertTrue(remove.waitForExistence(timeout: 15) || reveal(remove, in: app))
        attach("Allowed commands", app)
        remove.tap()
        try eventually("the rule is gone on the server") {
            let after = ((try api("GET", "/api/bots/\(id)/command-allowlist") as? [String: Any])?["rules"] as? [[String: Any]]) ?? []
            return !after.contains { $0["id"] as? String == ruleId }
        }
    }

    // MARK: Duplicate (BA19)

    @MainActor
    func testDuplicateMakesACopy() throws {
        try requirePanel()
        for copy in try bots() where copy["name"] as? String == "Ara copy" {
            if let copyId = copy["id"] as? String { try api("DELETE", "/api/bots/\(copyId)", allowFailure: true) }
        }
        let app = launchAdvanced()
        // the panel's top bar menu
        element("profile-more", in: app).tap()
        let duplicate = element("profile-menu.duplicate", in: app)
        XCTAssertTrue(duplicate.waitForExistence(timeout: 10))
        duplicate.tap()
        var copyId: String?
        try eventually("Ara copy exists on the server") {
            copyId = try bots().first { $0["name"] as? String == "Ara copy" }?["id"] as? String
            return copyId != nil
        }
        XCTAssertTrue(element("panel-toast", in: app).waitForExistence(timeout: 10), "the panel says the copy was added")
        if let copyId {
            let source = (try api("GET", "/api/bots/\(try araId())/soul") as? [String: Any])?["soul"] as? String
            let copied = (try api("GET", "/api/bots/\(copyId)/soul") as? [String: Any])?["soul"] as? String
            XCTAssertEqual(copied, source, "the copy carries the instructions")
            try api("DELETE", "/api/bots/\(copyId)", allowFailure: true)
        }
    }
}
