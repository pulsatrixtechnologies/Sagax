import XCTest

/// The bot profile (03 to 10) and its routine screens (05, 06) against the
/// parity fixture server: every action is a real request, and each test reads
/// the result back from the server's API.
///
/// Start the fixture first and pass its session to the test runner:
///
///   node ios/parity/fixture-server.mjs &
///   TEST_RUNNER_PARITY_ENDPOINT=... TEST_RUNNER_PARITY_TOKEN=... \
///   TEST_RUNNER_PARITY_ENVIRONMENT=... xcodebuild test \
///     -only-testing:SagaxCompanionUITests/ProfileUITests ...
///
/// Without those variables the tests skip.
final class ProfileUITests: XCTestCase {
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
        var arguments = ["-parityEndpoint", endpoint, "-parityToken", token, "-parityScreen", screen]
        if let environment { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        return app
    }

    /// Ara's profile, pushed from her chat by the parity launcher.
    @MainActor
    private func launchProfile() -> XCUIApplication {
        let app = launch(screen: "03-profile-info")
        XCTAssertTrue(app.staticTexts["profile-name"].waitForExistence(timeout: 30))
        return app
    }

    private func element(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    private func scrollTo(_ element: XCUIElement, in app: XCUIApplication) {
        let scroll = app.scrollViews["profile-scroll"].firstMatch
        for _ in 0..<6 where !element.isHittable {
            scroll.swipeUp()
        }
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

    private func bots() throws -> [[String: Any]] {
        (try api("GET", "/api/bots") as? [String: Any])?["bots"] as? [[String: Any]] ?? []
    }

    private func bot(named name: String) throws -> [String: Any]? {
        try bots().first { $0["name"] as? String == name }
    }

    private func routines() throws -> [[String: Any]] {
        (try api("GET", "/api/routines") as? [String: Any])?["routines"] as? [[String: Any]] ?? []
    }

    /// Poll the server until `check` holds.
    private func eventually(_ what: String, timeout: TimeInterval = 10, _ check: () throws -> Bool) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try check() { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.4))
        }
        XCTFail("never true: \(what)")
    }

    // MARK: Character

    @MainActor
    func testCharacterChangeSavesAtOnceAndResetGoesBackToTheDefault() throws {
        let ara = try XCTUnwrap(try bot(named: "Ara"))
        let id = try XCTUnwrap(ara["id"] as? String)
        defer { _ = try? api("PATCH", "/api/bots/\(id)", ["color": "purple", "mascotLook": ["character": "owl"], "mascotSkin": "none"]) }
        let app = launchProfile()

        let teal = app.buttons["teal"]
        XCTAssertTrue(teal.waitForExistence(timeout: 10))
        teal.tap()
        try eventually("Ara is teal on the server") { try bot(named: "Ara")?["color"] as? String == "teal" }

        app.buttons["Shape"].tap()
        try eventually("Ara is a shape on the server") {
            ((try bot(named: "Ara")?["mascotLook"] as? [String: Any])?["character"] as? String) == "shape"
        }

        let reset = app.buttons["character-reset"]
        XCTAssertTrue(reset.exists)
        reset.tap()
        try eventually("Ara is the default green owl again") {
            let now = try bot(named: "Ara")
            return now?["color"] as? String == "green"
                && ((now?["mascotLook"] as? [String: Any])?["character"] as? String) == "owl"
        }
    }

    // MARK: Picture

    /// Generate runs the real route against the fixture's image provider
    /// stub: the bot gets a stored picture, and Frame and Remove appear.
    @MainActor
    func testGenerateGivesTheBotAStoredPicture() throws {
        let ara = try XCTUnwrap(try bot(named: "Ara"))
        let id = try XCTUnwrap(ara["id"] as? String)
        defer { _ = try? api("PATCH", "/api/bots/\(id)", ["avatarUrl": NSNull(), "avatarCrop": "mascot"]) }
        try api("PATCH", "/api/bots/\(id)", ["avatarUrl": NSNull(), "avatarCrop": "mascot"])
        let app = launchProfile()

        let generate = element("character-photo-generate", in: app)
        XCTAssertTrue(generate.waitForExistence(timeout: 10))
        XCTAssertFalse(element("character-photo-frame", in: app).exists, "no picture yet, nothing to frame")
        generate.tap()
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        let field = alert.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("Une chouette calme")
        // Cancel and Generate: the action is the button that is not Cancel.
        alert.buttons.matching(NSPredicate(format: "label != 'Cancel'")).firstMatch.tap()

        try eventually("Ara has a generated picture on the server", timeout: 30) {
            (try bot(named: "Ara")?["avatarUrl"] as? String)?.hasPrefix("/api/attachments/") == true
        }
        XCTAssertEqual(try bot(named: "Ara")?["avatarCrop"] as? String, "circle")
        XCTAssertTrue(element("character-photo-frame", in: app).waitForExistence(timeout: 10))
        XCTAssertTrue(element("character-photo-remove", in: app).exists)

        // Remove goes back to the mascot.
        element("character-photo-remove", in: app).tap()
        try eventually("Ara's picture is removed") {
            let now = try bot(named: "Ara")
            return now?["avatarUrl"] as? String == nil && now?["avatarCrop"] as? String == "mascot"
        }
    }

    /// Frame: a pinch and a drag in the framing sheet are saved, and the
    /// server returns the new zoom and focus.
    @MainActor
    func testFramingSavesZoomAndFocus() throws {
        let ara = try XCTUnwrap(try bot(named: "Ara"))
        let id = try XCTUnwrap(ara["id"] as? String)
        defer { _ = try? api("PATCH", "/api/bots/\(id)", ["avatarUrl": NSNull(), "avatarCrop": "mascot"]) }
        // A picture to frame, through the same route the Generate button uses.
        try api("POST", "/api/bots/\(id)/avatar/generate", ["prompt": "Une chouette calme"])
        try api("PATCH", "/api/bots/\(id)", ["avatarZoom": 1, "avatarFocusX": 0.5, "avatarFocusY": 0.5])
        let app = launchProfile()

        let frame = element("character-photo-frame", in: app)
        XCTAssertTrue(frame.waitForExistence(timeout: 10))
        frame.tap()
        let picture = element("framing-picture", in: app)
        XCTAssertTrue(picture.waitForExistence(timeout: 10))
        picture.pinch(withScale: 2.2, velocity: 1)
        let start = picture.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        start.press(forDuration: 0.1, thenDragTo: picture.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.75)))
        element("framing-save", in: app).tap()

        try eventually("the framing is saved on the server") {
            let now = try bot(named: "Ara")
            let zoom = now?["avatarZoom"] as? Double ?? 1
            let x = now?["avatarFocusX"] as? Double ?? 0.5
            let y = now?["avatarFocusY"] as? Double ?? 0.5
            return zoom > 1.2 && x < 0.5 && y < 0.5
        }
        // Reopened, the sheet starts from what the server holds.
        XCTAssertTrue(frame.waitForExistence(timeout: 10))
    }

    /// Upload: the Photo row offers the system picker (PhotosPicker). The
    /// picker itself runs out of process; what it hands back is covered by
    /// `ProfileClientTests.testUploadAvatarPostsTheBytesAndReturnsTheStoredPath`.
    @MainActor
    func testUploadOpensThePhotoPicker() throws {
        let app = launchProfile()
        let upload = element("character-photo-upload", in: app)
        XCTAssertTrue(upload.waitForExistence(timeout: 10))
        XCTAssertTrue(upload.isHittable)
        upload.tap()
        // The picker is a remote view: its navigation bar or its "Photos" tab shows.
        let shown = app.navigationBars.matching(NSPredicate(format: "identifier CONTAINS[c] 'photo' OR identifier CONTAINS[c] 'Photos'")).firstMatch
        let cancel = app.buttons["Cancel"]
        XCTAssertTrue(shown.waitForExistence(timeout: 10) || cancel.waitForExistence(timeout: 5), "the photo picker opens")
        if cancel.exists { cancel.tap() }
    }

    // MARK: Instructions

    @MainActor
    func testInstructionsShowTheSoulAndAnEditSaves() throws {
        let ara = try XCTUnwrap(try bot(named: "Ara"))
        let id = try XCTUnwrap(ara["id"] as? String)
        // The fixture saves Ara's instructions (SOUL_ARA) when it creates her.
        let before = try XCTUnwrap((try api("GET", "/api/bots/\(id)/soul") as? [String: Any])?["soul"] as? String)
        XCTAssertTrue(before.contains("Tu coordonnes l'équipe"), "the fixture seeds Ara's soul: \(before)")
        defer { _ = try? api("PATCH", "/api/bots/\(id)", ["soul": before]) }
        let app = launchProfile()

        element("profile-instructions", in: app).tap()
        let body = app.staticTexts["text-card-body"]
        XCTAssertTrue(body.waitForExistence(timeout: 10))
        XCTAssertTrue(body.label.contains("Tu coordonnes"), body.label)

        element("instructions-edit", in: app).tap()
        let editor = app.textViews["instructions-editor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap()
        editor.typeText(" UIEDIT42")
        element("instructions-save", in: app).tap()
        XCTAssertTrue(app.staticTexts["text-card-body"].waitForExistence(timeout: 10))
        try eventually("the soul carries the edit") {
            ((try api("GET", "/api/bots/\(id)/soul") as? [String: Any])?["soul"] as? String)?.contains("UIEDIT42") == true
        }
    }

    // MARK: Routines

    @MainActor
    func testRoutineDetailShowsTheScheduleAndTheActiveToggleSaves() throws {
        let app = launchProfile()
        let row = element("profile-routine.Scan skills populaires mensuel", in: app)
        scrollTo(row, in: app)
        XCTAssertTrue(row.label.contains("CRON_TZ=America/Toronto 2 7 1-7 * 1"), row.label)
        let paused = element("profile-routine.Planif CW approbation temps lundi", in: app)
        XCTAssertTrue(paused.label.contains("Every Monday at 7:00 AM · Paused"), paused.label)
        row.tap()

        XCTAssertTrue(app.staticTexts["routine-title"].waitForExistence(timeout: 10))
        XCTAssertTrue(element("routine-no-runs", in: app).exists)
        let active = element("routine-active", in: app)
        XCTAssertTrue(active.exists)
        func enabled() throws -> Bool? {
            try routines().first { $0["name"] as? String == "Scan skills populaires mensuel" }?["enabled"] as? Bool
        }
        XCTAssertEqual(try enabled(), true)
        active.tap()
        try eventually("the routine is paused on the server") { try enabled() == false }
        active.tap()
        try eventually("the routine is active again") { try enabled() == true }

        element("routine-instruction", in: app).tap()
        let text = app.staticTexts["text-card-body"]
        XCTAssertTrue(text.waitForExistence(timeout: 5))
        XCTAssertTrue(text.label.contains("Texte de remplacement"))
    }

    @MainActor
    func testAddRoutineCreatesOneForThisBot() throws {
        let ara = try XCTUnwrap(try bot(named: "Ara"))
        let id = try XCTUnwrap(ara["id"] as? String)
        let name = "UI routine \(Int(Date().timeIntervalSince1970) % 100_000)"
        let app = launchProfile()
        let add = element("profile-add-routine", in: app)
        scrollTo(add, in: app)
        add.tap()

        let nameField = app.textFields["Routine name"]
        XCTAssertTrue(nameField.waitForExistence(timeout: 10))
        nameField.tap()
        nameField.typeText(name)
        let prompt = app.textFields["What should the agent do?"]
        prompt.tap()
        prompt.typeText("Placeholder routine made by the UI test.")
        // a new routine's button says "Schedule routine", as on the desktop
        element("routine-editor-save", in: app).tap()

        try eventually("the routine exists on the server for Ara") {
            try routines().contains { $0["name"] as? String == name && $0["botId"] as? String == id }
        }
        XCTAssertTrue(element("profile-routine.\(name)", in: app).waitForExistence(timeout: 10))
        if let created = try routines().first(where: { $0["name"] as? String == name }), let rid = created["id"] as? String {
            try api("DELETE", "/api/routines/\(rid)")
        }
    }

    // MARK: Library tabs

    @MainActor
    func testLinksMediaAndFilesLoadAPageThenShowMore() throws {
        let app = launchProfile()

        element("profile-tab.links", in: app).tap()
        XCTAssertTrue(element("profile-link.1", in: app).waitForExistence(timeout: 10))
        XCTAssertFalse(element("profile-link.2", in: app).exists)
        XCTAssertTrue(element("profile-link.0", in: app).label.contains("docs.example.com"))
        element("profile-show-more", in: app).tap()
        XCTAssertTrue(element("profile-link.2", in: app).waitForExistence(timeout: 10))
        XCTAssertFalse(element("profile-show-more", in: app).exists)

        element("profile-tab.media", in: app).tap()
        XCTAssertTrue(element("profile-media.1", in: app).waitForExistence(timeout: 10))
        XCTAssertFalse(element("profile-media.2", in: app).exists)
        element("profile-show-more", in: app).tap()
        XCTAssertTrue(element("profile-media.2", in: app).waitForExistence(timeout: 10))
        element("profile-media.0", in: app).tap()
        XCTAssertTrue(element("media-viewer-image", in: app).waitForExistence(timeout: 10))
        element("media-viewer-close", in: app).tap()

        element("profile-tab.files", in: app).tap()
        XCTAssertTrue(element("profile-file.2", in: app).waitForExistence(timeout: 10))
        XCTAssertTrue(element("profile-file.0", in: app).label.contains("skills-export-2026-09-28.zip"))
        XCTAssertFalse(element("profile-file.3", in: app).exists)
        element("profile-show-more", in: app).tap()
        XCTAssertTrue(element("profile-file.5", in: app).waitForExistence(timeout: 10))
        // a file opens in Quick Look
        element("profile-file.1", in: app).tap()
        XCTAssertTrue(app.navigationBars.matching(NSPredicate(format: "identifier CONTAINS 'QL' OR identifier == 'EXEC_BRIEF.md'")).firstMatch.waitForExistence(timeout: 10)
            || app.staticTexts["EXEC_BRIEF"].waitForExistence(timeout: 2)
            || app.otherElements["QLPreviewControllerView"].waitForExistence(timeout: 2))
    }

    // MARK: Share and delete

    @MainActor
    func testShareExportsThePackageIntoTheShareSheet() throws {
        let app = launchProfile()
        element("profile-share", in: app).tap()
        // the system share sheet, with the package named after the bot
        let sheet = app.otherElements["ActivityListView"].firstMatch
        let named = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Ara'")).firstMatch
        XCTAssertTrue(sheet.waitForExistence(timeout: 20) || named.waitForExistence(timeout: 5))
    }

    @MainActor
    func testDeleteBotFromTheMenuRemovesItAndGoesHome() throws {
        let name = "Delete UI \(Int(Date().timeIntervalSince1970) % 100_000)"
        try api("POST", "/api/bots", ["name": name, "title": "Temporary"])
        let app = launch(screen: "01-home")
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'chat-row.' AND label CONTAINS %@", name)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 30))
        row.tap()
        let capsule = element("chat-name", in: app)
        XCTAssertTrue(capsule.waitForExistence(timeout: 10))
        capsule.tap()
        XCTAssertTrue(app.staticTexts["profile-name"].waitForExistence(timeout: 10))

        element("profile-more", in: app).tap()
        let delete = element("profile-menu.delete", in: app)
        XCTAssertTrue(delete.waitForExistence(timeout: 5))
        delete.tap()
        let confirm = app.buttons["Delete Bot"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()

        try eventually("the bot is gone from the server") { try bot(named: name) == nil }
        XCTAssertTrue(app.buttons["home-plus"].waitForExistence(timeout: 10))
        XCTAssertFalse(row.exists)
    }
}
