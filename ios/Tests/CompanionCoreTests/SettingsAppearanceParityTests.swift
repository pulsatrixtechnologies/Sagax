import XCTest
@testable import CompanionCore

/// WP12 of the iOS feature parity matrix: achievements (ST9), the
/// organization page and routine delegation (ST8, AU19), usage by bot and
/// its history (ST10), Settings search (ST11) and their gates.
final class SettingsAppearanceParityTests: XCTestCase {
    private let client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t")

    // MARK: Achievements

    func testTheCatalogMatchesTheDesktopOne() {
        let catalog = AchievementDefinition.catalog
        XCTAssertEqual(catalog.count, 52)
        XCTAssertEqual(Set(catalog.map(\.id)).count, catalog.count, "ids are unique")
        XCTAssertEqual(AchievementDefinition.lookup("first-words")?.name.fr, "Premiers mots")
        XCTAssertEqual(AchievementDefinition.lookup("first-words")?.rewards.first?.key, "title:rookie")
        XCTAssertTrue(catalog.contains { $0.hidden && $0.hint != nil }, "secrets carry a hint")
        XCTAssertTrue(catalog.allSatisfy { [5, 10, 20, 50, 100].contains($0.points) })
    }

    func testRarityAndLevelFollowTheSharedRules() {
        XCTAssertEqual(AchievementRarity(points: 5), .common)
        XCTAssertEqual(AchievementRarity(points: 20), .rare)
        XCTAssertEqual(AchievementRarity(points: 50), .epic)
        XCTAssertEqual(AchievementRarity(points: 100), .legendary)
        XCTAssertEqual(AchievementLevel(points: 0), AchievementLevel(level: 1, from: 0, to: 50))
        XCTAssertEqual(AchievementLevel(points: 50), AchievementLevel(level: 2, from: 50, to: 150))
        XCTAssertEqual(AchievementLevel(points: 149).level, 2)
        XCTAssertEqual(AchievementLevel(points: 300), AchievementLevel(level: 4, from: 300, to: 500))
        XCTAssertEqual(AchievementLevel(level: 2, from: 50, to: 150).progress(points: 100), 0.5, accuracy: 0.0001)
    }

    func testTheSnapshotDecodesAndFilters() throws {
        let json = #"""
        {"points":15,"maxPoints":1500,"level":{"level":1,"from":0,"to":50},"unlockedCount":2,"count":51,"streak":3,
         "rewards":["title:rookie","skin:shape:outline"],"recent":["hello-bot","first-words"],
         "items":[{"id":"first-words","unlockedAt":1700000000000,"current":1,"target":1,"percent":40},
                  {"id":"hello-bot","unlockedAt":1700000001000,"current":1,"target":1},
                  {"id":"small-family","current":1,"target":3}],
         "settings":{"showPoints":true,"toasts":false,"native":false,"public":true,"title":"rookie"}}
        """#
        let snapshot = try JSONDecoder().decode(AchievementSnapshot.self, from: Data(json.utf8))
        XCTAssertEqual(snapshot.points, 15)
        XCTAssertEqual(snapshot.streak, 3)
        XCTAssertEqual(snapshot.settings.toasts, false)
        XCTAssertEqual(snapshot.settings.public, true)
        XCTAssertEqual(snapshot.settings.title, "rookie")
        XCTAssertEqual(snapshot.state("first-words")?.percent, 40)
        XCTAssertTrue(snapshot.state("small-family")?.showsProgress == true)
        XCTAssertFalse(snapshot.state("first-words")?.showsProgress == true)
        XCTAssertEqual(snapshot.unlockedTitles.map(\.id), ["rookie"])
        let unlocked = snapshot.cards(category: nil, filter: .unlocked).map(\.id)
        XCTAssertEqual(unlocked, ["first-words", "hello-bot"])
        let onboardingLocked = snapshot.cards(category: .onboarding, filter: .locked)
        XCTAssertFalse(onboardingLocked.contains { $0.id == "first-words" })
        XCTAssertTrue(onboardingLocked.allSatisfy { $0.category == .onboarding })
    }

    func testAnEmptyAnswerFallsBackToTheDefaults() throws {
        let snapshot = try JSONDecoder().decode(AchievementSnapshot.self, from: Data("{}".utf8))
        XCTAssertEqual(snapshot.settings, AchievementSettings())
        XCTAssertTrue(snapshot.settings.showPoints)
        XCTAssertTrue(snapshot.settings.toasts)
        XCTAssertEqual(snapshot.level.level, 1)
    }

    func testSettingsPatchesSendOnlyWhatChanged() throws {
        let request = try client.updateAchievementSettingsRequest(AchievementSettingsPatch(toasts: false))
        XCTAssertEqual(request.httpMethod, "PUT")
        XCTAssertEqual(request.url?.path, "/api/me/achievements/settings")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
        XCTAssertEqual(body["settings"] as? [String: Bool], ["toasts": false])

        let clear = try client.updateAchievementSettingsRequest(AchievementSettingsPatch(clearTitle: true))
        let cleared = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(clear.httpBody)) as? [String: Any])
        XCTAssertTrue((cleared["settings"] as? [String: Any])?["title"] is NSNull, "No title sends null")

        var settings = AchievementSettings(title: "rookie")
        settings = AchievementSettingsPatch(public: true, clearTitle: true).applied(to: settings)
        XCTAssertTrue(settings.public)
        XCTAssertNil(settings.title)
    }

    func testEventsAreCappedAndKeysCut() throws {
        let events = (0..<40).map { AchievementEvent(type: "mascot.pet", key: String(repeating: "k", count: 100), value: Double($0)) }
        let request = try client.reportAchievementsRequest(events)
        XCTAssertEqual(request.url?.path, "/api/me/achievements/events")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
        let sent = try XCTUnwrap(body["events"] as? [[String: Any]])
        XCTAssertEqual(sent.count, 32)
        XCTAssertEqual((sent[0]["key"] as? String)?.count, 80)
    }

    func testAnEventsAnswerDecodesItsUnlocks() throws {
        let json = #"{"accepted":1,"unlocked":[{"id":"konami","points":20,"unlockedAt":5}],"snapshot":{"points":20}}"#
        let result = try JSONDecoder().decode(AchievementEventsResult.self, from: Data(json.utf8))
        XCTAssertEqual(result.unlocked.map(\.id), ["konami"])
        XCTAssertEqual(result.snapshot?.points, 20)
    }

    // MARK: Organization and routine delegation

    func testTheOrganizationDecodes() throws {
        let json = #"""
        {"org":{"name":"Parity Org","identity":{"kind":"perspicax","issuer":"https://idp.example.test/"}},
         "link":{"state":"ok","syncedAt":1700000000000},"viewerRole":"admin",
         "settings":{"orgKeyConfigured":false,"allowFullAccess":true}}
        """#
        let org = try JSONDecoder().decode(OrgInfo.self, from: Data(json.utf8))
        XCTAssertTrue(org.isPerspicax)
        XCTAssertTrue(org.isAdmin)
        XCTAssertEqual(org.consoleURL?.absoluteString, "https://idp.example.test/console/")
        XCTAssertEqual(org.settings?.allowFullAccess, true)
    }

    func testTheConsentOutcomeIsReadFromTheAddress() {
        XCTAssertEqual(RoutineDelegationReturn(fragment: "routine-delegation=ok"), .ok)
        XCTAssertEqual(RoutineDelegationReturn(fragment: "#routine-delegation-error=routines_subject"), .error("routines_subject"))
        XCTAssertNil(RoutineDelegationReturn(fragment: "routine-delegation-error=bad code"))
        XCTAssertNil(RoutineDelegationReturn(fragment: "section=1"))
        XCTAssertNil(RoutineDelegationReturn(fragment: nil))
    }

    func testTheConsentStartsOncePerPerson() throws {
        let none = try JSONDecoder().decode(RoutineDelegationStatus.self, from: Data(#"{"state":"none","suspended":2,"principalId":"pr_1"}"#.utf8))
        XCTAssertEqual(none.suspended, 2)
        XCTAssertTrue(RoutineDelegation.shouldStart(none, alreadyAsked: false))
        XCTAssertFalse(RoutineDelegation.shouldStart(none, alreadyAsked: true))
        XCTAssertEqual(RoutineDelegation.autoConsentKey(for: none), "sagax.routineDelegation.autoConsent.v1:pr_1")
        let active = RoutineDelegationStatus(state: "active", consentedAt: 1, renewedAt: 2)
        XCTAssertFalse(RoutineDelegation.shouldStart(active, alreadyAsked: false))
        XCTAssertEqual(RoutineDelegation.autoConsentKey(for: RoutineDelegationStatus(state: "none")), "sagax.routineDelegation.autoConsent.v1:self")
    }

    func testSharingFiltersAndGroupsLikeTheDesktop() throws {
        let json = #"""
        {"bots":[{"id":"a","name":"Ara","ownerName":"Sam","section":"Desk","grants":[{"target":"user:x","level":"use"}],"running":true},
                 {"id":"b","name":"Bix","ownerPrincipalId":"pr_2","grants":[]},
                 {"id":"c","name":"Cyd","ownerName":"Alex","section":"Ops"}]}
        """#
        struct Answer: Decodable { var bots: [OrgBot] }
        let bots = try JSONDecoder().decode(Answer.self, from: Data(json.utf8)).bots
        XCTAssertEqual(bots[1].owner, "pr_2")
        XCTAssertEqual(OrgSharing.filter(bots, query: "sam").map(\.id), ["a"])
        XCTAssertEqual(OrgSharing.filter(bots, query: " ops ").map(\.id), ["c"])
        XCTAssertEqual(OrgSharing.filter(bots, query: "").count, 3)
        XCTAssertEqual(OrgSharing.groupedByOwner(bots).map(\.owner), ["Alex", "pr_2", "Sam"])
    }

    // MARK: Usage

    func testPeriodsAreUTCDays() {
        let now = ISO8601DateFormatter().date(from: "2026-03-15T23:30:00Z")!
        XCTAssertEqual(UsagePeriod.month.range(now: now).from, "2026-03-01")
        XCTAssertEqual(UsagePeriod.month.range(now: now).to, "2026-03-15")
        XCTAssertEqual(UsagePeriod.lastMonth.range(now: now).from, "2026-02-01")
        XCTAssertEqual(UsagePeriod.lastMonth.range(now: now).to, "2026-02-28")
        XCTAssertEqual(UsagePeriod.days30.range(now: now).from, "2026-02-14")
    }

    func testTheHistoryRequestAndAnswer() throws {
        let now = ISO8601DateFormatter().date(from: "2026-03-15T10:00:00Z")!
        let request = try client.usageHistoryRequest(period: .month, groupBy: .routine, now: now)
        XCTAssertEqual(request.url?.path, "/api/usage")
        XCTAssertEqual(request.url?.query, "from=2026-03-01&to=2026-03-15&groupBy=routine")
        let json = #"""
        {"groupBy":"routine","groups":[{"key":"routine:r1","label":"Digest","turns":2,"input":10,"output":5,"cachedInput":0,"costUsd":0.004,"estimatedUsd":0.004,"unpriced":1,"billableUsd":null},
         {"key":"manual","label":"manual","turns":1,"input":1,"output":1,"cachedInput":0,"costUsd":null,"estimatedUsd":null,"unpriced":0,"billableUsd":null}],
         "total":{"key":"total","label":"Total","turns":3,"input":11,"output":6,"cachedInput":0,"costUsd":0.004,"estimatedUsd":0.004,"unpriced":1,"billableUsd":null},
         "budget":null,"billing":null}
        """#
        let history = try JSONDecoder().decode(UsageHistory.self, from: Data(json.utf8))
        XCTAssertFalse(history.hasBilling)
        XCTAssertEqual(history.groups[0].displayLabel, .routine("Digest"))
        XCTAssertEqual(history.groups[1].displayLabel, .notRoutine)
        XCTAssertEqual(history.groups[0].costText, "~$0.004*")
        XCTAssertEqual(history.groups[1].costText, "—")
    }

    func testUsageByBotSortsMoneyFirst() throws {
        func bot(_ id: String, cost: Double?, tokens: Int, hidden: Bool = false) throws -> Bot {
            var usage: [String: Any] = ["input": tokens, "output": 0, "turns": 1]
            if let cost { usage["costUsd"] = cost }
            let json: [String: Any] = [
                "id": id, "threadId": "t-\(id)", "name": id, "title": "", "description": "", "notifications": true, "color": "green",
                "unread": false, "modelSelection": ["instanceId": "claude", "model": "m"], "createdAt": 1, "hidden": hidden,
                "tasks": [["threadId": "t-\(id)", "title": "x", "createdAt": 1, "usage": usage]],
            ]
            return try JSONDecoder().decode(Bot.self, from: JSONSerialization.data(withJSONObject: json))
        }
        let rows = UsageByBot.rows([try bot("cheap", cost: 0.01, tokens: 5), try bot("free", cost: nil, tokens: 900),
                                    try bot("dear", cost: 1, tokens: 1), try bot("ghost", cost: 9, tokens: 1, hidden: true)])
        XCTAssertEqual(rows.map(\.id), ["dear", "cheap", "free"])
        let total = UsageByBot.total(rows)
        XCTAssertEqual(total.turns, 3)
        XCTAssertEqual(total.costUsd ?? 0, 1.01, accuracy: 0.0001)
    }

    // MARK: Search and gates

    func testSearchMatchesLabelsAndKeywords() {
        let label: (SettingsDestination) -> String = { $0.rawValue.capitalized }
        let all = SettingsDestination.allCases
        XCTAssertEqual(SettingsSearch.results("", available: all, label: label), all)
        XCTAssertTrue(SettingsSearch.results("TROPHY", available: all, label: label).contains(.achievements))
        XCTAssertTrue(SettingsSearch.results("chime", available: all, label: label).contains(.haptics))
        XCTAssertEqual(SettingsSearch.results("zzz", available: all, label: label), [])
        XCTAssertFalse(SettingsSearch.results("trophy", available: [.about], label: label).contains(.achievements))
    }

    func testTheSettingsGates() {
        let sidecar = SurfaceGate(scope: .sidecar)
        let client = SurfaceGate(scope: .serverClient)
        let admin = SurfaceGate(scope: .serverAdmin)
        let member = SurfaceGate(scope: .serverClient, organization: true)
        XCTAssertTrue(sidecar.allows(.achievements))
        XCTAssertFalse(SurfaceGate(scope: .sidecar, sidecarRoutes: []).allows(.achievements))
        XCTAssertTrue(client.allows(.achievements))
        XCTAssertFalse(client.allows(.organizationSettings))
        XCTAssertTrue(member.allows(.organizationSettings))
        XCTAssertTrue(member.allows(.orgRoutineDelegation))
        XCTAssertFalse(client.allows(.usageHistory))
        XCTAssertTrue(admin.allows(.usageHistory))
        XCTAssertTrue(sidecar.allows(.usageHistory))
    }
}
