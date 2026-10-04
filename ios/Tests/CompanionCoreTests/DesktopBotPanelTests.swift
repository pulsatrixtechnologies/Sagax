// iPad I4: the docked bot panel's tabs, Advanced sections and search,
// against bot-settings/panel-tabs.ts and bot-settings/sections.ts as the
// desktop references draw them, gated by SurfaceGate.
import XCTest
@testable import CompanionCore

final class DesktopBotPanelTests: XCTestCase {
    func testAdminSeesEveryTabAndTheDesktopSectionOrder() {
        let admin = SurfaceGate(scope: .serverAdmin)
        XCTAssertEqual(DesktopPanelTab.visible(gate: admin), [.details, .routines, .files, .computer, .advanced])
        // a served page that is not an organization's adds "Who can see it"
        XCTAssertEqual(
            DesktopPanelSection.visible(gate: admin),
            [.overview, .soul, .skills, .memory, .access, .model, .permissions, .voice, .visibility, .history, .usage]
        )
    }

    func testOrganizationServerSwapsVisibilityForSharingAndPerspicax() {
        let org = SurfaceGate(scope: .serverAdmin, organization: true)
        let sections = DesktopPanelSection.visible(gate: org, slack: true)
        XCTAssertFalse(sections.contains(.visibility))
        XCTAssertTrue(sections.contains(.sharing))
        XCTAssertTrue(sections.contains(.perspicax))
        XCTAssertEqual(sections[1], .slack)
    }

    func testSlackNeedsTheServersLink() {
        let admin = SurfaceGate(scope: .serverAdmin)
        XCTAssertFalse(DesktopPanelSection.visible(gate: admin, slack: false).contains(.slack))
        XCTAssertTrue(DesktopPanelSection.visible(gate: admin, slack: true).contains(.slack))
        // the sidecar has no Slack route, link or not
        XCTAssertFalse(DesktopPanelSection.visible(gate: SurfaceGate(scope: .sidecar), slack: true).contains(.slack))
    }

    func testSidecarOwnerGetsTheAdvancedPanelOnlyWithTheRoute() {
        // D1: the advanced panel on the sidecar for the owner
        let current = SurfaceGate(scope: .sidecar)
        XCTAssertTrue(DesktopPanelSection.visible(gate: current).contains(.soul))
        let older = SurfaceGate(scope: .sidecar, sidecarRoutes: [])
        let sections = DesktopPanelSection.visible(gate: older)
        XCTAssertFalse(sections.contains(.soul))
        XCTAssertFalse(sections.contains(.memory))
        // what the remote client itself shows stays
        XCTAssertTrue(sections.contains(.voice))
        XCTAssertTrue(sections.contains(.overview))
    }

    func testClientSessionSeesNoAdminSections() {
        let client = SurfaceGate(scope: .serverClient)
        let sections = DesktopPanelSection.visible(gate: client)
        XCTAssertEqual(sections, [.voice, .usage])
        XCTAssertEqual(DesktopPanelTab.visible(gate: client).last, .advanced)
    }

    func testSearchMatchesLabelAndKeywords() {
        XCTAssertTrue(DesktopPanelSection.memory.matches("", label: "Memory"))
        XCTAssertTrue(DesktopPanelSection.memory.matches("  MEM ", label: "Memory"))
        XCTAssertTrue(DesktopPanelSection.voice.matches("alerts", label: "Voice & alerts"))
        XCTAssertTrue(DesktopPanelSection.access.matches("vps", label: "Access"))
        // the label in the person's language counts too
        XCTAssertTrue(DesktopPanelSection.voice.matches("voix", label: "Voix et alertes"))
        XCTAssertFalse(DesktopPanelSection.usage.matches("soul", label: "Usage"))
    }

    func testDeepLinksLandOnAdvanced() {
        XCTAssertEqual(DesktopPanelTab.holding(.memory), .advanced)
    }

    func testPlacementDocksFrom1024() {
        XCTAssertEqual(DesktopPanelPlacement.at(windowWidth: 834), .overlay)
        XCTAssertEqual(DesktopPanelPlacement.at(windowWidth: 1023.5), .overlay)
        XCTAssertEqual(DesktopPanelPlacement.at(windowWidth: 1024), .docked)
        XCTAssertEqual(DesktopPanelPlacement.at(windowWidth: 1366), .docked)
    }

    func testWidthIsHeldToTheDesktopRange() {
        XCTAssertEqual(DesktopPanelPlacement.clampedWidth(nil), 360)
        XCTAssertEqual(DesktopPanelPlacement.clampedWidth(.nan), 360)
        XCTAssertEqual(DesktopPanelPlacement.clampedWidth(100), 320)
        XCTAssertEqual(DesktopPanelPlacement.clampedWidth(900), 720)
        XCTAssertEqual(DesktopPanelPlacement.clampedWidth(480), 480)
    }

    // MARK: Routines tab

    private func routine(_ id: String, name: String, bot: String = "b1", enabled: Bool, next: Double?, schedule: String = #"{"type":"daily","time":"09:00"}"#) throws -> Routine {
        let next = next.map { String(format: "%.0f", $0) } ?? "null"
        let json = """
        {"id":"\(id)","name":"\(name)","prompt":"p","botId":"\(bot)","runOn":"maus","enabled":\(enabled),
         "schedule":\(schedule),"durationMinutes":30,"nextRunAt":\(next),"createdAt":1,"updatedAt":2}
        """
        return try JSONDecoder().decode(Routine.self, from: Data(json.utf8))
    }

    func testRoutinesSortActiveFirstThenSoonestThenName() throws {
        let list = [
            try routine("a", name: "Zed", enabled: false, next: nil),
            try routine("b", name: "Later", enabled: true, next: 2_000),
            try routine("c", name: "Beta", enabled: true, next: 1_000),
            try routine("d", name: "Alpha", enabled: true, next: 1_000),
            try routine("e", name: "Other bot", bot: "b2", enabled: true, next: 1),
        ]
        XCTAssertEqual(DesktopRoutineList.of(botId: "b1", in: list).map(\.id), ["d", "c", "b", "a"])
    }

    func testRoutineStateSaysFinishedForASpentOneShot() throws {
        let now = Date(timeIntervalSince1970: 1_000)
        let spent = try routine("o", name: "Once", enabled: true, next: nil, schedule: #"{"type":"once","at":500000}"#)
        XCTAssertEqual(DesktopRoutineList.state(spent, now: now), .finished)
        let coming = try routine("o2", name: "Once", enabled: true, next: 2_000_000, schedule: #"{"type":"once","at":2000000}"#)
        XCTAssertEqual(DesktopRoutineList.state(coming, now: now), .active)
        XCTAssertEqual(DesktopRoutineList.state(try routine("p", name: "P", enabled: false, next: nil), now: now), .paused)
    }

    func testFileSizesReadAsTheDesktopWritesThem() {
        XCTAssertEqual(DesktopFileSize.format(14), "14 B")
        XCTAssertEqual(DesktopFileSize.format(1023), "1023 B")
        XCTAssertEqual(DesktopFileSize.format(1536), "1.5 KB")
        XCTAssertEqual(DesktopFileSize.format(1_887), "1.8 KB")
        XCTAssertEqual(DesktopFileSize.format(5 * 1024 * 1024), "5.0 MB")
    }

    // MARK: Settings patch

    private func body(_ request: URLRequest) -> [String: Any] {
        (request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
    }

    func testSettingsPatchSendsOnlyItsFields() throws {
        let client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t")
        let request = try client.patchBotSettingsRequest(botId: "b1", patch: BotPanelPatch(approvePeerComms: true, cwd: "/work"))
        XCTAssertEqual(request.httpMethod, "PATCH")
        XCTAssertEqual(request.url?.path, "/api/bots/b1")
        let sent = body(request)
        XCTAssertEqual(Set(sent.keys), ["approvePeerComms", "cwd"])
        XCTAssertEqual(sent["approvePeerComms"] as? Bool, true)
        XCTAssertThrowsError(try client.patchBotSettingsRequest(botId: "b1", patch: BotPanelPatch()))
        XCTAssertThrowsError(try client.patchBotSettingsRequest(botId: "../x", patch: BotPanelPatch(chiefOfStaff: true)))
    }

    func testFullAccessCarriesItsConfirmation() throws {
        XCTAssertEqual(BotPanelPatch.approval(.ask), BotPanelPatch(approvalMode: "ask"))
        let full = BotPanelPatch.approval(.full, allThreads: false)
        XCTAssertEqual(full.confirmFullAccess, true)
        XCTAssertEqual(full.applyToAllThreads, false)
    }

    func testWorksOnReadsTheBotsComputer() throws {
        func bot(_ computer: String?) throws -> Bot {
            let field = computer.map { #","computer":"\#($0)""# } ?? ""
            let json = #"{"id":"b1","threadId":"t1","name":"Ara","title":"","description":"","notifications":true,"color":"purple","unread":false,"modelSelection":{"instanceId":"i","model":"m"},"createdAt":1"# + field + "}"
            return try JSONDecoder().decode(Bot.self, from: Data(json.utf8))
        }
        XCTAssertEqual(DesktopWorksOn.of(try bot(nil)), .auto)
        XCTAssertEqual(DesktopWorksOn.of(try bot("vm")), .vm)
        XCTAssertEqual(DesktopWorksOn.of(try bot("mystery")), .auto)
        XCTAssertNil(try bot(nil).approvePeerComms)
    }
}
