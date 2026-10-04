import XCTest
@testable import CompanionCore

/// iPad I2b: the sidebar's foot as the desktop draws it now (Sidebar.tsx
/// `places`, Gamertag.tsx) and its edge (`sidebarDragTarget`).
final class DesktopSidebarPlacesTests: XCTestCase {
    func testTeamMapAndAutomationsAlwaysShowConnectedAppsAndTemplatesWaitForExperimental() {
        let admin = SurfaceGate(scope: .serverAdmin)
        XCTAssertEqual(DesktopSidebarPlaces.visible(connected: true, gate: admin, features: nil), [.teamMap, .automations])
        XCTAssertEqual(DesktopSidebarPlaces.visible(connected: true, gate: admin, features: ServerFeatures()), [.teamMap, .automations])
        XCTAssertEqual(
            DesktopSidebarPlaces.visible(connected: true, gate: admin, features: ServerFeatures(connectedApps: true)),
            [.teamMap, .automations, .connectedApps]
        )
        XCTAssertEqual(
            DesktopSidebarPlaces.visible(connected: true, gate: admin, features: ServerFeatures(connectedApps: true, templates: true)),
            [.teamMap, .automations, .connectedApps, .templates]
        )
    }

    func testExperimentalPlacesStillNeedThePairingsGate() {
        let features = ServerFeatures(connectedApps: true, templates: true)
        let client = SurfaceGate(scope: .serverClient)
        let places = DesktopSidebarPlaces.visible(connected: true, gate: client, features: features)
        XCTAssertFalse(places.contains(.templates), "Templates is an administrator's")
        XCTAssertEqual(places.prefix(2), [.teamMap, .automations])
        XCTAssertEqual(DesktopSidebarPlaces.visible(connected: false, gate: SurfaceGate(scope: .serverAdmin), features: features), [])
    }

    func testGamertagShowsGroupedPointsOnlyWhenReadyAndShown() {
        let snapshot = AchievementSnapshot(points: 1240)
        XCTAssertEqual(DesktopSidebarPlaces.gamertag(ready: true, snapshot: snapshot, locale: Locale(identifier: "en_US")), "1,240")
        XCTAssertNil(DesktopSidebarPlaces.gamertag(ready: false, snapshot: snapshot))
        XCTAssertNil(DesktopSidebarPlaces.gamertag(ready: true, snapshot: nil))
        let hidden = AchievementSnapshot(points: 40, settings: AchievementSettings(showPoints: false))
        XCTAssertNil(DesktopSidebarPlaces.gamertag(ready: true, snapshot: hidden))
        XCTAssertEqual(DesktopSidebarPlaces.gamertag(ready: true, snapshot: AchievementSnapshot(points: 40)), "40")
    }

    func testEdgeSnapsToTheRailAndHoldsTheWidth() {
        XCTAssertEqual(DesktopSidebarEdge.target(raw: 120), .collapsed)
        XCTAssertEqual(DesktopSidebarEdge.target(raw: 179.9), .collapsed)
        XCTAssertEqual(DesktopSidebarEdge.target(raw: 180), .expanded(width: 240))
        XCTAssertEqual(DesktopSidebarEdge.target(raw: 330.4), .expanded(width: 330))
        XCTAssertEqual(DesktopSidebarEdge.target(raw: 900), .expanded(width: 400))
        XCTAssertEqual(DesktopSidebarEdge.target(raw: .nan), .collapsed)
        XCTAssertEqual(DesktopSidebarEdge.clamped(nil), 280)
        XCTAssertEqual(DesktopSidebarEdge.clamped(100), 240)
        XCTAssertEqual(DesktopSidebarEdge.clamped(320), 320)
    }

    private func bot(_ id: String, chief: Bool = false, hidden: Bool = false) -> Bot {
        var bot = Bot(id: id, threadId: "t-\(id)", name: id, title: "", description: "", notifications: true, color: "blue",
                      unread: false, modelSelection: ModelSelection(instanceId: "i", model: "m"), createdAt: 0)
        bot.chiefOfStaff = chief
        bot.hidden = hidden
        return bot
    }

    func testArchiveKeepsThePrimaryBotAndTheLastActiveBot() {
        let chief = bot("chief", chief: true)
        let ana = bot("ana")
        let old = bot("old", hidden: true)
        XCTAssertEqual(DesktopBotArchive.block(chief, in: [chief, ana]), .primary)
        XCTAssertNil(DesktopBotArchive.block(ana, in: [chief, ana]))
        XCTAssertEqual(DesktopBotArchive.block(ana, in: [ana, old]), .last)
        XCTAssertEqual(DesktopBotArchive.archived([ana, old, chief]).map(\.id), ["old"])
    }

    func testArchivePatchCarriesOnlyHidden() throws {
        let client = CompanionClient(connection: Connection(name: "Test", host: "127.0.0.1", port: 8810), token: "t")
        let request = try client.patchBotRequest(botId: "b1", patch: BotPatch(hidden: true))
        XCTAssertEqual(request.httpMethod, "PATCH")
        let body = try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]
        XCTAssertEqual(body?.count, 1)
        XCTAssertEqual(body?["hidden"] as? Bool, true)
        XCTAssertFalse(BotPatch(hidden: false).isEmpty)
    }
}
