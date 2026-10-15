// The desktop's simplified menus (#518) on iOS: the bot's one "..." menu,
// the editor's six groups and Settings > Usage for the signed-in person.
import XCTest
@testable import CompanionCore

final class MenusParityTests: XCTestCase {
    private func bot(_ id: String, owner: String? = nil, primary: Bool = false) throws -> Bot {
        var json: [String: Any] = [
            "id": id, "threadId": "t-\(id)", "name": id.capitalized, "title": "", "description": "", "notifications": true,
            "color": "green", "unread": false, "modelSelection": ["instanceId": "claude", "model": "m"], "createdAt": 1,
            "chiefOfStaff": primary,
        ]
        if let owner { json["ownerUserId"] = owner }
        return try JSONDecoder().decode(Bot.self, from: JSONSerialization.data(withJSONObject: json))
    }

    // MARK: The bot's "..." menu

    func testTheOwnerGetsTheDesktopMenuInOrder() throws {
        let mine = try bot("mine", owner: "pr_me")
        let plan = BotActionsMenuPlan(gate: SurfaceGate(scope: .serverAdmin), bot: mine, viewerId: "pr_me",
                                      editable: true, zipExport: true, activeBotCount: 3)
        XCTAssertEqual(plan.groups, [
            [.editBot, .rename, .makePrimary],
            [.copyConversation, .downloadConversation, .exportZip],
            [.archive],
        ])
        XCTAssertNil(plan.archiveBlock)
        XCTAssertTrue(plan.enables(.archive))
    }

    func testThePrimaryBotHandsTheRoleOverAndCannotBeArchived() throws {
        let star = try bot("star", owner: "pr_me", primary: true)
        let plan = BotActionsMenuPlan(gate: SurfaceGate(scope: .serverAdmin), bot: star, viewerId: "pr_me",
                                      editable: true, zipExport: false, activeBotCount: 3)
        XCTAssertTrue(plan.items.contains(.replacePrimary))
        XCTAssertFalse(plan.items.contains(.makePrimary))
        XCTAssertFalse(plan.items.contains(.exportZip))
        XCTAssertEqual(plan.archiveBlock, .primary)
        XCTAssertFalse(plan.enables(.archive))
    }

    func testTheLastActiveBotStaysAndAClientCannotRenameAnotherOnesBot() throws {
        let theirs = try bot("theirs", owner: "pr_other")
        let plan = BotActionsMenuPlan(gate: SurfaceGate(scope: .serverClient), bot: theirs, viewerId: "pr_me",
                                      editable: false, zipExport: false, activeBotCount: 1)
        XCTAssertFalse(plan.items.contains(.editBot))
        XCTAssertFalse(plan.items.contains(.rename))
        XCTAssertFalse(plan.items.contains(.makePrimary))
        XCTAssertEqual(plan.items.prefix(2), [.copyConversation, .downloadConversation])
        if plan.items.contains(.archive) { XCTAssertEqual(plan.archiveBlock, .lastActive) }
    }

    // MARK: The editor's six groups

    func testEverySectionBelongsToOneGroupInTheDesktopOrder() {
        XCTAssertEqual(DesktopPanelGroup.allCases, [.profile, .instructions, .memoryFiles, .modelTools, .behavior, .activity])
        for section in DesktopPanelSection.allCases {
            XCTAssertEqual(DesktopPanelGroup.allCases.filter { $0.sections.contains(section) }.count, 1, "\(section)")
        }
        XCTAssertEqual(DesktopPanelGroup.of(.soul), .instructions)
        XCTAssertEqual(DesktopPanelGroup.of(.history), .activity)
        XCTAssertEqual(DesktopPanelGroup.of(.sharing), .profile)
    }

    func testAGroupWithNothingToShowIsLeftOut() {
        let visible: [DesktopPanelSection] = [.overview, .voice, .usage]
        XCTAssertEqual(DesktopPanelGroup.visible(visible), [.profile, .behavior, .activity])
        XCTAssertEqual(DesktopPanelGroup.behavior.sections(in: visible), [.voice])
        XCTAssertTrue(DesktopPanelGroup.behavior.matches("alerts", label: "Behavior", visible: visible) { _ in "Voice & alerts" })
        XCTAssertFalse(DesktopPanelGroup.profile.matches("alerts", label: "Profile", visible: visible) { _ in "Overview" })
    }

    // MARK: Usage for the signed-in person

    func testThePeriodsAreThisMonthTheSameDaysBeforeAndThirtyDays() {
        let now = ISO8601DateFormatter().date(from: "2026-03-31T12:00:00Z")!
        let periods = PersonalUsagePeriods(now: now)
        XCTAssertEqual(periods.month.from, "2026-03-01")
        XCTAssertEqual(periods.month.to, "2026-03-31")
        XCTAssertEqual(periods.previous.from, "2026-02-01")
        XCTAssertEqual(periods.previous.to, "2026-02-28", "the same day, kept inside a shorter month")
        XCTAssertEqual(periods.days30.from, "2026-03-02")
    }

    func testTheRequestAsksForTheRequestersOwnTurns() throws {
        let client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t")
        let request = try client.personalUsageRequest((from: "2026-03-01", to: "2026-03-31"), groupBy: .model)
        let items = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertEqual(request.url?.path, "/api/usage")
        XCTAssertTrue(items.contains(URLQueryItem(name: "mine", value: "1")))
        XCTAssertTrue(items.contains(URLQueryItem(name: "groupBy", value: "model")))
    }

    func testTrendDailyCostsAndRanking() throws {
        XCTAssertNil(PersonalUsageRules.trend(current: 5, previous: 0))
        XCTAssertEqual(PersonalUsageRules.trend(current: 15, previous: 10), 50)
        XCTAssertEqual(PersonalUsageRules.trend(current: 5, previous: 10), -50)
        let json = #"""
        {"groupBy":"day","groups":[
          {"key":"day:2026-03-02","label":"2026-03-02","turns":2,"costUsd":1.5},
          {"key":"day:2026-03-04","label":"2026-03-04","turns":9,"costUsd":0.25}],
         "total":{"key":"total","label":"Total","turns":11,"costUsd":1.75}}
        """#
        let summary = try JSONDecoder().decode(UsageHistory.self, from: Data(json.utf8))
        XCTAssertEqual(PersonalUsageRules.dailyCosts(summary, range: (from: "2026-03-01", to: "2026-03-04")), [0, 1.5, 0, 0.25])
        XCTAssertEqual(PersonalUsageRules.ranked(summary).map(\.key), ["day:2026-03-02", "day:2026-03-04"])
        XCTAssertEqual(PersonalUsageRules.cost(summary), 1.75)
    }
}
