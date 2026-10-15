import XCTest

/// The bundled offline fleet: one turn's tool steps folded into a single
/// line (#488, #518) and the model menu with provider submenus, favorites
/// and the models that cannot run left out (#477, #478). With
/// TEST_RUNNER_SAGAX_SHOTS set, each screen is also saved as a PNG.
final class StepsModelMenuUITests: XCTestCase {
    @MainActor
    func testTurnStepsReadAsOneLineThatOpens() {
        let app = launchPreview()
        let line = app.buttons["step-group.preview-turn"]
        XCTAssertTrue(line.waitForExistence(timeout: 10), "one line for the turn")
        XCTAssertTrue(line.label.contains("6 outils"), line.label)
        XCTAssertTrue(line.label.contains("1 échec"), line.label)
        shot("steps-closed", app)
        line.tap()
        let repeated = app.buttons["step-repeat.step-1"]
        XCTAssertTrue(repeated.waitForExistence(timeout: 5), "the same step three times reads once")
        XCTAssertTrue(repeated.label.hasPrefix("A lu un fichier ×3"), repeated.label)
        XCTAssertTrue(contains("A consulté les billets dans ConnectWise PSA", in: app), "the MCP server is named")
        shot("steps-open", app)
        repeated.tap()
        shot("steps-repeat-open", app)
    }

    @MainActor
    func testModelMenuNestsProvidersAndHidesBrokenModels() {
        let app = launchPreview(simple: false)
        openModelPage(app)
        shot("model-section", app)
        let open = app.buttons["model-menu-open"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()
        let claude = app.buttons["model-provider.preview"]
        XCTAssertTrue(claude.waitForExistence(timeout: 5), "one row per provider")
        // OpenAI is signed out and Qwen is not installed: neither is offered
        XCTAssertFalse(app.buttons["model-provider.codex"].exists)
        XCTAssertFalse(app.buttons["model-provider.qwen"].exists)
        XCTAssertTrue(app.buttons["model-provider.local:this-computer"].exists, "local models in their own section")
        shot("model-menu-advanced", app)
        claude.tap()
        let star = app.buttons["model-favorite.preview.claude-opus-4-5"]
        XCTAssertTrue(star.waitForExistence(timeout: 5))
        star.tap()
        shot("model-menu-provider", app)
        app.buttons["model-menu-back"].tap()
        XCTAssertTrue(app.buttons["model-row.favorite.preview.claude-opus-4-5"].waitForExistence(timeout: 5), "the star puts it under Auto")
        shot("model-menu-favorite", app)
        // leave the favorite as it was for the next run
        app.buttons["model-provider.preview"].tap()
        app.buttons["model-favorite.preview.claude-opus-4-5"].tap()
    }

    @MainActor
    func testSimpleModeGroupsProvidersBehindAllModels() {
        let app = launchPreview(simple: true)
        openModelPage(app)
        app.buttons["model-menu-open"].tap()
        let all = app.buttons["model-all"]
        XCTAssertTrue(all.waitForExistence(timeout: 5), "one All models row")
        XCTAssertFalse(app.buttons["model-provider.preview"].exists)
        shot("model-menu-simple", app)
        all.tap()
        XCTAssertTrue(app.buttons["model-provider.preview"].waitForExistence(timeout: 5))
        shot("model-menu-simple-all", app)
    }

    @MainActor
    private func openModelPage(_ app: XCUIApplication) {
        app.buttons["chat-name"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["profile-name"].firstMatch.waitForExistence(timeout: 10), "bot panel")
        let persona = app.descendants(matching: .any)["panel-edit-persona"].firstMatch
        for _ in 0..<8 where !(persona.exists && persona.isHittable) { app.swipeUp() }
        persona.tap()
        let row = app.descendants(matching: .any)["panel-row.model"].firstMatch
        _ = row.waitForExistence(timeout: 10)
        for _ in 0..<8 where !(row.exists && row.isHittable) { app.swipeUp() }
        row.tap()
    }

    @MainActor
    private func launchPreview(simple: Bool = true) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = [
            "-store-preview", "-chat-presentation-preview", "-chat-steps-preview", "-model-menu-preview",
            "-AppleLanguages", "(fr)", "-AppleLocale", "fr_CA",
            "-companion.prefs.activityDetail", "full",
            "-companion.prefs.rosterDensity", "comfortable",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
            "-sagax.interfaceMode.v1", simple ? "simple" : "advanced",
            "-omb-threads-location", "sidebar",
        ]
        app.launch()
        // Pepper's own thread is the Gmail triage: the row opens it.
        let pepper = app.staticTexts["Pepper"].firstMatch
        XCTAssertTrue(pepper.waitForExistence(timeout: 40))
        pepper.tap()
        return app
    }

    @MainActor
    private func contains(_ text: String, in app: XCUIApplication) -> Bool {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch.waitForExistence(timeout: 3)
            || app.buttons.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch.exists
    }

    @MainActor
    private func shot(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        ParityShots.save(name, app)
    }
}
