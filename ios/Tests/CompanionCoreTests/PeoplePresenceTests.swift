// The desktop changes of 2026-10-08 that the phone mirrors in its core
// (matrix section 14): presence and labels on people (#167, #172), the
// frames that carry them, the nudge and admin approvals frames (#222,
// #213), the threads location (#210) and the unread dot's own token (#182).
import Foundation
import XCTest
@testable import CompanionCore

final class PeoplePresenceTests: XCTestCase {
    private func frame(_ json: String) throws -> Frame {
        try JSONDecoder().decode(Frame.self, from: Data(json.utf8))
    }

    // MARK: Presence

    func testTheListEnablesDotsAndAFrameAboutMeFromOthersIsSkipped() {
        var book = PresenceBook()
        XCTAssertNil(book.entry("pr_ada"), "nothing before the list answers")
        XCTAssertFalse(book.applyFrame(audience: nil, rows: [PresenceRow(principalId: "pr_ada", state: .online)]))

        book.applyList([
            PresenceRow(principalId: "PR_Ada", state: .online, lastSeenAt: 1_000),
            PresenceRow(principalId: "pr_me", state: .away, hidden: true),
        ])
        XCTAssertEqual(book.entry("pr_ada")?.state, .online)
        XCTAssertNil(book.entry("pr_team"), "not a person of the directory")

        // my own real state, then the public copy about me (offline) is ignored
        XCTAssertTrue(book.applyFrame(audience: "PR_ME", rows: [PresenceRow(principalId: "pr_me", state: .online, hidden: true)]))
        XCTAssertFalse(book.applyFrame(audience: nil, rows: [PresenceRow(principalId: "pr_me", state: .offline)]))
        XCTAssertEqual(book.entry("pr_me"), PresenceEntry(state: .online, hidden: true))

        XCTAssertTrue(book.applyFrame(audience: nil, rows: [PresenceRow(principalId: "pr_ada", state: .offline, lastSeenAt: 2_000)]))
        XCTAssertEqual(book.entry("pr_ada"), PresenceEntry(state: .offline, lastSeenAt: 2_000))
        book.reset()
        XCTAssertNil(book.entry("pr_ada"))
    }

    func testLastSeenBuckets() {
        let now = 10 * 86_400_000.0
        XCTAssertEqual(PresenceLastSeen.ago(now - 30_000, now: now), .justNow)
        XCTAssertEqual(PresenceLastSeen.ago(now - 5 * 60_000, now: now), .minutes(5))
        XCTAssertEqual(PresenceLastSeen.ago(now - 2 * 3_600_000 - 1, now: now), .hours(2))
        XCTAssertEqual(PresenceLastSeen.ago(now - 3 * 86_400_000, now: now), .days(3))
        XCTAssertEqual(PresenceLastSeen.ago(now + 9_000, now: now), .justNow, "a clock ahead is not negative")
    }

    func testPresenceRowsDecodeLenientlyAndTheHeartbeatHasAnAcceptedPageId() throws {
        let rows = try JSONDecoder().decode([PresenceRow].self, from: Data(#"[{"principalId":"a","state":"away","lastSeenAt":null},{"principalId":"b","state":"offline","lastSeenAt":12,"hidden":true}]"#.utf8))
        XCTAssertEqual(rows, [PresenceRow(principalId: "a", state: .away), PresenceRow(principalId: "b", state: .offline, lastSeenAt: 12, hidden: true)])
        let page = PresenceHeartbeat.newPageId()
        XCTAssertNotNil(page.range(of: "^[A-Za-z0-9_-]{8,64}$", options: .regularExpression))
        let body = try JSONSerialization.jsonObject(with: JSONEncoder().encode(PresenceHeartbeat(pageId: page, idleMs: 0))) as? [String: Any]
        XCTAssertEqual(body?["kind"] as? String, "web")
        XCTAssertEqual(Set(body?.keys.map { $0 } ?? []), ["pageId", "kind", "idleMs"], "the route is strict")
    }

    // MARK: Labels

    func testLabelsNormalizeAsTheDesktopAndOnlyTheRightPeopleEdit() {
        XCTAssertEqual(try PersonLabel.normalize("  CTO ").get(), "CTO")
        XCTAssertEqual(try PersonLabel.normalize("   ").get(), nil)
        XCTAssertEqual(try PersonLabel.normalize(nil).get(), nil)
        XCTAssertEqual(try PersonLabel.normalize(String(repeating: "é", count: 40)).get()?.count, 40)
        if case .failure(.tooLong) = PersonLabel.normalize(String(repeating: "a", count: 41)) {} else { XCTFail("41 is too long") }
        if case .failure(.oneLine) = PersonLabel.normalize("a\nb") {} else { XCTFail("one line") }

        XCTAssertTrue(PersonLabel.canEdit(personId: "pr_ada", viewerId: "PR_ADA", viewerAdmin: false, managedTeamIds: [], personTeamIds: []))
        XCTAssertTrue(PersonLabel.canEdit(personId: "pr_ada", viewerId: "pr_me", viewerAdmin: true, managedTeamIds: [], personTeamIds: []))
        XCTAssertTrue(PersonLabel.canEdit(personId: "pr_ada", viewerId: "pr_me", viewerAdmin: false, managedTeamIds: ["t1"], personTeamIds: ["t1"]))
        XCTAssertFalse(PersonLabel.canEdit(personId: "pr_ada", viewerId: "pr_me", viewerAdmin: false, managedTeamIds: ["t2"], personTeamIds: ["t1"]))
    }

    func testTheLabelBookFollowsFramesAndClears() throws {
        var book = PersonLabelBook(["PR_Ada": "CTO"])
        XCTAssertEqual(book.label("pr_ada"), "CTO")
        guard case let .personLabel(id, label) = try frame(#"{"kind":"person.label","principalId":"pr_ada","label":null}"#) else {
            return XCTFail("person.label")
        }
        book.set(id, label)
        XCTAssertNil(book.label("pr_ada"))
        book.set("pr_bob", "Dispatch")
        XCTAssertEqual(book.label("PR_BOB"), "Dispatch")
    }

    func testTheDirectoryCarriesLabelsAndTheViewersManagedTeams() throws {
        let json = #"{"people":[{"principalId":"pr_ada","name":"Ada","login":"ada","label":"CTO","teams":[{"id":"t1","manager":false}]}],"teams":[],"viewer":{"principalId":"pr_me","orgRole":"member","managedTeamIds":["t1"]}}"#
        let directory = try JSONDecoder().decode(OrgDirectory.self, from: Data(json.utf8))
        XCTAssertEqual(directory.people.first?.label, "CTO")
        XCTAssertEqual(directory.viewer?.managedTeamIds, ["t1"])
        XCTAssertEqual(directory.viewer?.orgRole, "member")
    }

    // MARK: Frames

    func testPresenceNudgeAndApprovalFramesDecode() throws {
        guard case let .presenceChanged(audience, people) = try frame(#"{"kind":"presence.changed","audience":"pr_me","people":[{"principalId":"pr_me","state":"online","lastSeenAt":5},{"bad":1}]}"#) else {
            return XCTFail("presence.changed")
        }
        XCTAssertEqual(audience, "pr_me")
        XCTAssertEqual(people, [PresenceRow(principalId: "pr_me", state: .online, lastSeenAt: 5)])

        guard case let .nudge(nudge) = try frame(#"{"kind":"nudge","audience":"pr_me","fromId":"pr_bob","fromName":"Bob","at":1000,"open":{"groupId":"g1","threadId":"t1"}}"#) else {
            return XCTFail("nudge")
        }
        XCTAssertEqual(nudge.fromName, "Bob")
        XCTAssertEqual(nudge.open, NudgeFrame.Conversation(groupId: "g1", threadId: "t1"))
        XCTAssertTrue(nudge.isFresh(now: 1000 + 119_000))
        XCTAssertFalse(nudge.isFresh(now: 1000 + 121_000), "a replay older than two minutes does nothing")
        guard case let .nudge(old) = try frame(#"{"kind":"nudge"}"#) else { return XCTFail("bare nudge") }
        XCTAssertTrue(old.isFresh(now: 0), "an older server sends no time")

        guard case let .orgApprovals(approvals) = try frame(#"{"kind":"org.approvals","count":2,"added":[{"requestId":"r1","botName":"Sprout","ownerName":"Alice","tool":"Bash"}]}"#) else {
            return XCTFail("org.approvals")
        }
        XCTAssertEqual(approvals.count, 2)
        XCTAssertEqual(approvals.added.first?.ownerName, "Alice")
    }

    // MARK: Threads location

    func testThreadsLiveInOnePlaceAtATime() {
        XCTAssertEqual(ThreadsLocation.parse(nil), .header)
        XCTAssertEqual(ThreadsLocation.parse("sidebar"), .sidebar)
        XCTAssertEqual(ThreadsLocation.parse("left"), .header)
        XCTAssertEqual(ThreadsPlacement(showThreads: true, location: .header), ThreadsPlacement(inSidebar: false, inHeader: true))
        XCTAssertEqual(ThreadsPlacement(showThreads: true, location: .sidebar), ThreadsPlacement(inSidebar: true, inHeader: false))
        XCTAssertEqual(ThreadsPlacement(showThreads: false, location: .sidebar), ThreadsPlacement(inSidebar: false, inHeader: false))
    }

    // MARK: Unread dot

    func testTheUnreadDotIsNeverTheGreySkinsWhiteAccent() throws {
        for id in ["midnight", "graphite", "linen"] {
            let tokens = try XCTUnwrap(DesktopSkins.tokens(try XCTUnwrap(SkinID(rawValue: id))))
            XCTAssertEqual(tokens.unread, SkinColor(0x3C76F4), "\(id): Pulsatrix blue")
        }
        let lagoon = try XCTUnwrap(DesktopSkins.tokens(.lagoon))
        XCTAssertEqual(lagoon.unread, lagoon.accent, "a chromatic skin: its accent")
    }
}

final class AccountRowTests: XCTestCase {
    private func routine(_ id: String, bot: String, enabled: Bool = true, next: Double? = 10, suspended: Bool = false) throws -> Routine {
        var json: [String: Any] = [
            "id": id, "botId": bot, "name": id, "prompt": "p", "runOn": "maus", "enabled": enabled,
            "schedule": ["type": "daily", "time": "09:00"], "durationMinutes": 30, "createdAt": 1, "updatedAt": 1,
        ]
        if let next { json["nextRunAt"] = next }
        if suspended { json["suspended"] = ["reason": "person_out", "at": 1] }
        return try JSONDecoder().decode(Routine.self, from: JSONSerialization.data(withJSONObject: json))
    }

    private func bot(_ id: String, owner: String?) throws -> Bot {
        var json: [String: Any] = [
            "id": id, "threadId": "t-\(id)", "name": id, "title": "", "description": "", "notifications": true,
            "color": "green", "unread": false, "modelSelection": ["instanceId": "claude", "model": "m"], "createdAt": 1,
        ]
        if let owner { json["ownerUserId"] = owner }
        return try JSONDecoder().decode(Bot.self, from: JSONSerialization.data(withJSONObject: json))
    }

    func testTheBadgeCountsTheViewersActiveRoutinesOnly() throws {
        let bots = [try bot("mine", owner: "pr_me"), try bot("theirs", owner: "pr_other")]
        let routines = [
            try routine("a", bot: "mine"),
            try routine("off", bot: "mine", enabled: false),
            try routine("done", bot: "mine", next: nil),
            try routine("paused", bot: "mine", suspended: true),
            try routine("shared", bot: "theirs"),
        ]
        XCTAssertEqual(AccountRow.activeRoutines(routines, bots: bots, viewerId: "PR_ME"), 1)
    }

    func testTitleAndPointsFollowTheirSwitches() throws {
        let titleId = try XCTUnwrap(AchievementDefinition.catalog.flatMap(\.rewards).compactMap { reward -> String? in
            if case let .title(id, _) = reward { return id }
            return nil
        }.first)
        var snapshot = try JSONDecoder().decode(AchievementSnapshot.self, from: Data(#"{"points":120,"settings":{"showPoints":true,"title":"\#(titleId)"}}"#.utf8))
        XCTAssertNotNil(AccountRow.title(snapshot), "Show my title is on by default")
        XCTAssertEqual(AccountRow.points(snapshot), 120)
        snapshot.settings.showTitle = false
        snapshot.settings.showPoints = false
        XCTAssertNil(AccountRow.title(snapshot))
        XCTAssertNil(AccountRow.points(snapshot))
        let patch = try JSONSerialization.jsonObject(with: JSONEncoder().encode(AchievementSettingsPatch(showTitle: false))) as? [String: [String: Bool]]
        XCTAssertEqual(patch?["settings"]?["showTitle"], false)
    }
}
