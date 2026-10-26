import XCTest
@testable import CompanionCore

/// Each synced preference the phone used to ignore, read and written the way
/// the desktop module does (shared/user-preferences.ts).
final class PersonPreferencesTests: XCTestCase {
    // MARK: The record keeps them

    func testTheRecordKeepsThePersonKeysAndReportsTheirChanges() {
        let prefs = SidebarPrefs(values: ["omb-language": "fr", "sagax.botAccent.v1": "1", "not-a-key": "x"])
        XCTAssertEqual(prefs.languageCode, "fr")
        XCTAssertTrue(prefs.botAccent)
        XCTAssertNil(prefs.values["not-a-key"])
        var next = prefs
        next.setReadReceipts(false)
        XCTAssertEqual(next.changedKeys(from: prefs), ["sagax.readReceipts.v1"])
        // a pending change of this phone survives the server's record
        let received = next.receiving(["omb-language": "en"], pending: ["sagax.readReceipts.v1"])
        XCTAssertEqual(received.languageCode, "en")
        XCTAssertEqual(received.values["sagax.readReceipts.v1"], "off")
        XCTAssertFalse(received.botAccent)
    }

    // MARK: Language (R1)

    func testLanguageIsStoredAsTheDesktopCodes() {
        XCTAssertEqual(PersonLanguage.stored(fromApp: "system"), "")
        XCTAssertEqual(PersonLanguage.stored(fromApp: "fr"), "fr")
        XCTAssertEqual(PersonLanguage.stored(fromApp: "pt-BR"), "pt-br")
        let phone = ["en", "fr", "pt-BR"]
        XCTAssertEqual(PersonLanguage.app(fromStored: "", available: phone), "system")
        XCTAssertEqual(PersonLanguage.app(fromStored: "fr", available: phone), "fr")
        XCTAssertEqual(PersonLanguage.app(fromStored: "fr-CA", available: phone), "fr")
        XCTAssertEqual(PersonLanguage.app(fromStored: "pt-br", available: phone), "pt-BR")
        XCTAssertNil(PersonLanguage.app(fromStored: "ja", available: phone), "a language the phone lacks keeps its own")
        var prefs = SidebarPrefs()
        prefs.setLanguageCode("fr")
        XCTAssertEqual(prefs.values["omb-language"], "fr")
    }

    // MARK: Bot accent (R5)

    func testBotAccentIsOnlyOnForOne() {
        var prefs = SidebarPrefs(values: ["sagax.botAccent.v1": "true"])
        XCTAssertFalse(prefs.botAccent)
        prefs.setBotAccent(true)
        XCTAssertEqual(prefs.values["sagax.botAccent.v1"], "1")
        prefs.setBotAccent(false)
        XCTAssertNil(prefs.values["sagax.botAccent.v1"])
    }

    func testBotAccentHoldsContrastOnThePanel() throws {
        let palette = SkinPalette.of(.pulsatrixLight)
        let panel = try XCTUnwrap(SkinColor(css: "#f6f8fb"))
        let yellow = try XCTUnwrap(SkinColor(css: "#facc15"))
        let accented = palette.withBotAccent(yellow, panel: panel)
        let colors = try XCTUnwrap(accented.botAccent)
        XCTAssertGreaterThanOrEqual(BotAccent.contrast(colors.fill, panel), 3)
        XCTAssertGreaterThanOrEqual(BotAccent.contrast(colors.text, panel), 4.5)
        XCTAssertGreaterThanOrEqual(BotAccent.contrast(colors.ink, colors.fill), 4.5)
        XCTAssertEqual(accented.accent, colors.fill)
        XCTAssertEqual(accented.toggleOn, colors.fill, "a desktop skin's switches wear the accent")
        XCTAssertEqual(palette.withBotAccent(nil), palette, "no colour keeps the skin's accent")
        // a colour that already reads stays itself
        let blue = try XCTUnwrap(SkinColor(css: "#1d4ed8"))
        XCTAssertEqual(BotAccent.holdContrast(blue, on: panel, ratio: 3), blue)
    }

    // MARK: HD mascots (R6)

    func testHdMascotsAreOnUnlessOff() {
        XCTAssertTrue(SidebarPrefs().hdMascots)
        var prefs = SidebarPrefs()
        prefs.setHdMascots(false)
        XCTAssertEqual(prefs.values["sagax.hdMascots.v1"], "off")
        XCTAssertFalse(prefs.hdMascots)
        XCTAssertTrue(HdMascots.enabled("maybe"))
    }

    func testHdStillsFollowTheDesktopStateMap() {
        XCTAssertEqual(HdMascots.still(forState: "idle"), "neutral")
        XCTAssertEqual(HdMascots.still(forState: "excited"), "happy")
        XCTAssertEqual(HdMascots.still(forState: "celebrate"), "jump")
        XCTAssertEqual(HdMascots.still(forState: "searching"), "look-right")
        XCTAssertEqual(HdMascots.still(forState: "suspicious"), "sit")
        XCTAssertEqual(HdMascots.still(forState: "powering-down"), "sleepy")
        XCTAssertEqual(HdMascots.still(forState: "unknown"), "neutral")
        XCTAssertEqual(HdMascots.resource(character: "shiba", still: "sad"), "shiba-hd-still-sad")
    }

    /// Every still the map names is shipped in the app (App/Mascots/HD).
    func testEveryMappedStillIsBundled() throws {
        let folder = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("App/Mascots/HD")
        guard FileManager.default.fileExists(atPath: folder.path) else { throw XCTSkip("App/ is not next to this package") }
        let states = ["sleeping", "idle", "thinking", "searching", "excited", "surprised", "suspicious", "angry", "confused",
                      "proud", "shy", "sad", "laughing", "playful", "celebrate"]
        for state in states {
            let name = HdMascots.resource(character: "shiba", still: HdMascots.still(forState: state))
            XCTAssertTrue(FileManager.default.fileExists(atPath: folder.appendingPathComponent("\(name).webp").path), name)
        }
    }

    // MARK: Suggestions (R7)

    func testSuggestionsHideWithZero() {
        XCTAssertTrue(SidebarPrefs().showSuggestions)
        var prefs = SidebarPrefs()
        prefs.setShowSuggestions(false)
        XCTAssertEqual(prefs.values["sagax.showSuggestions.v1"], "0")
        XCTAssertFalse(prefs.showSuggestions)
    }

    func testSuggestionsPutWhatWaitsFirstAndKeepFour() {
        var waiting = BotTask(threadId: "t1", title: "Invoices", createdAt: 1)
        waiting.activity = "waiting-on-you"
        var idle = BotTask(threadId: "t2", title: "Other", createdAt: 1)
        idle.activity = "idle"
        let rows = BotSuggestions.suggestions(
            setup: [BotSetupStep(id: "identity", done: true), BotSetupStep(id: "soul", done: false),
                    BotSetupStep(id: "folder", done: false), BotSetupStep(id: "apps", done: false), BotSetupStep(id: "mystery", done: false)],
            tasks: [waiting, idle],
            waiting: [BotWaitingApproval(threadId: "t1"), BotWaitingApproval(threadId: "t3", openedByName: "Scout")]
        )
        XCTAssertEqual(rows.map(\.id), ["approval:t1", "approval:t3", "setup:soul", "setup:folder"])
        XCTAssertEqual(rows[0].argument, "Invoices")
        XCTAssertEqual(rows[1].subtitle, "%@ is waiting for your answer")
        XCTAssertEqual(rows[2].action, .openSection("soul"))
    }

    // MARK: Read receipts (R8)

    func testReadReceiptsOffIsStoredAsOff() {
        var prefs = SidebarPrefs()
        XCTAssertTrue(prefs.readReceipts)
        prefs.setReadReceipts(false)
        XCTAssertEqual(prefs.values["sagax.readReceipts.v1"], "off")
        prefs.setReadReceipts(true)
        XCTAssertNil(prefs.values["sagax.readReceipts.v1"], "on removes the key, as the desktop does")
    }

    // MARK: Notification sound (R9)

    func testNotificationSoundChoices() {
        XCTAssertEqual(NotificationSoundChoice.parse(nil), .system)
        XCTAssertEqual(NotificationSoundChoice.parse("chime-b"), .chimeB)
        XCTAssertEqual(NotificationSoundChoice.parse("loud"), .system)
        XCTAssertNil(NotificationSoundChoice.system.fileName)
        XCTAssertEqual(NotificationSoundChoice.doubleTick.fileName, "notify-double-tick.caf")
        var prefs = SidebarPrefs()
        prefs.setNotificationSound(.blip)
        XCTAssertEqual(prefs.notificationSound, .blip)
        XCTAssertEqual(NotificationSoundChoice.allCases.map(\.rawValue), ["system", "tick", "double-tick", "chime-a", "chime-b", "blip"])
    }

    func testEveryToneIsBundled() throws {
        let folder = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("App")
        guard FileManager.default.fileExists(atPath: folder.path) else { throw XCTSkip("App/ is not next to this package") }
        for choice in NotificationSoundChoice.allCases {
            guard let file = choice.fileName else { continue }
            XCTAssertTrue(FileManager.default.fileExists(atPath: folder.appendingPathComponent(file).path), file)
        }
    }

    // MARK: Automations scope (R11)

    func testRoutineScopeIsKeptPerPerson() {
        var prefs = SidebarPrefs()
        prefs.setRoutineScope(RoutineScopePrefs(scope: .team, teamId: "t-1", status: .failing), for: "Alice@Example.com")
        prefs.setRoutineScope(RoutineScopePrefs(scope: .all), for: "bob")
        XCTAssertEqual(prefs.routineScope(for: "alice@example.com"), RoutineScopePrefs(scope: .team, teamId: "t-1", status: .failing))
        XCTAssertEqual(prefs.routineScope(for: "bob").scope, .all)
        XCTAssertEqual(prefs.routineScope(for: "carol"), RoutineScopePrefs())
        XCTAssertEqual(prefs.routineScope(for: nil), RoutineScopePrefs())
        // the newest last, as the desktop reads age
        XCTAssertEqual(prefs.values["sagax.routineScope.v1"], #"{"alice@example.com":{"scope":"team","status":"failing","teamId":"t-1"},"bob":{"scope":"all"}}"#)
        prefs.setRoutineScope(RoutineScopePrefs(scope: .mine), for: "alice@example.com")
        XCTAssertTrue(prefs.values["sagax.routineScope.v1"]!.hasPrefix(#"{"bob":"#))
    }

    func testRoutineScopeReadsTheDesktopValueAndDropsWhatItCannotRead() {
        let raw = #"{"local":{"scope":"everyone","teamId":"bad id!","status":"paused"},"p1":{"scope":"team","ownerId":"o.1"}}"#
        XCTAssertEqual(RoutineScopePrefs.read(raw, principalId: nil), RoutineScopePrefs(scope: .mine, status: .paused))
        XCTAssertEqual(RoutineScopePrefs.read(raw, principalId: "P1").query, RoutineScopeQuery(scope: .team, ownerId: "o.1"))
        XCTAssertEqual(RoutineScopePrefs.read("not json", principalId: "p1"), RoutineScopePrefs())
    }

    func testRoutineScopeKeepsTwentyPeople() {
        var raw: String?
        for index in 0..<25 { raw = RoutineScopePrefs.write(RoutineScopePrefs(scope: .all), principalId: "p\(index)", over: raw) }
        let object = try? JSONSerialization.jsonObject(with: Data(raw!.utf8)) as? [String: Any]
        XCTAssertEqual(object?.count, 20)
        XCTAssertNil(object?["p4"])
        XCTAssertNotNil(object?["p24"])
    }

    // MARK: Details and threads in the chat (R2, R3)

    func testDetailsFollowTheDesktopToolCallsSwitch() {
        XCTAssertEqual(ActivityDetail.forToolCalls(true), .full)
        XCTAssertEqual(ActivityDetail.forToolCalls(false), .hidden)
        XCTAssertEqual(ActivityDetail.forToolCalls(nil), .hidden, "off by default, as on the desktop")
        XCTAssertNotNil(DesktopConfigChange.feature("showToolCalls", true).body)
    }

    func testThreadsOffDropsThreadReceiptsFromTheChat() {
        var reply = Message(id: "r", role: .bot, kind: .text, at: 1)
        reply.text = "done"
        var receipt = Message(id: "g", role: .bot, kind: .activity, at: 2)
        receipt.tool = ToolActivity(name: "start_thread", ok: true)
        receipt.threadRef = ThreadRef(botId: "b", threadId: "t2", title: "Ship it")
        let shown = transcriptRows([reply, receipt], detail: .full, showThreads: true)
        let hidden = transcriptRows([reply, receipt], detail: .full, showThreads: false)
        XCTAssertEqual(shown.count, 2)
        XCTAssertEqual(hidden.count, 1)
        if case let .message(message)? = hidden.first { XCTAssertEqual(message.id, "r") } else { XCTFail("the reply stays") }
    }
}
