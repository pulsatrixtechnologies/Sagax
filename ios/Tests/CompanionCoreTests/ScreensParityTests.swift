import XCTest
@testable import CompanionCore

/// #985: who shared a bot with the viewer.
final class BotSharerTests: XCTestCase {
    private let directory = OrgDirectory(people: [
        OrgDirectoryPerson(principalId: "p-owner", name: "Sample Owner", login: "owner", avatarUrl: "/api/people/p-owner/avatar?v=3"),
        OrgDirectoryPerson(principalId: "p-plain", name: "", login: "member"),
    ])

    func testASharedBotWearsItsOwnersFace() {
        let sharer = BotSharerRules.sharer(ownerUserId: "P-OWNER", viewerId: "p-viewer", directory: directory)
        XCTAssertEqual(sharer, BotSharer(principalId: "p-owner", name: "Sample Owner", initials: "SO", avatarUrl: "/api/people/p-owner/avatar?v=3"))
        XCTAssertEqual(BotSharerRules.sharer(ownerUserId: "p-plain", viewerId: "p-viewer", directory: directory)?.name, "member")
    }

    func testNoFaceForOnesOwnALocalOrAnUnlistedOwner() {
        XCTAssertNil(BotSharerRules.sharer(ownerUserId: "p-owner", viewerId: "P-Owner", directory: directory), "the viewer's own bot")
        XCTAssertNil(BotSharerRules.sharer(ownerUserId: "local-owner", viewerId: "p-viewer", directory: directory), "a local bot")
        XCTAssertNil(BotSharerRules.sharer(ownerUserId: "p-hidden", viewerId: "p-viewer", directory: directory), "not in the directory")
        XCTAssertNil(BotSharerRules.sharer(ownerUserId: nil, viewerId: "p-viewer", directory: directory))
        XCTAssertNil(BotSharerRules.sharer(ownerUserId: "p-owner", viewerId: "p-viewer", directory: nil))
    }

    func testOnlyThisServersOwnPersonAvatarRoute() {
        XCTAssertEqual(BotSharerRules.personAvatarPath("/api/people/abc_1-2/avatar"), "/api/people/abc_1-2/avatar")
        XCTAssertNil(BotSharerRules.personAvatarPath("https://example.org/a.png"))
        XCTAssertNil(BotSharerRules.personAvatarPath("/api/people/../avatar"))
        XCTAssertNil(BotSharerRules.personAvatarPath("/api/people/a/avatar?v=1&x=2"))
    }
}

/// Exact or flexible timing (RoutineTimingFields.tsx `withRoutineTiming`).
final class RoutineTimingTests: XCTestCase {
    func testAFlexibleRepeatingScheduleKeepsItsWindow() {
        let daily = RoutineSchedule.daily(time: "09:00", weekdays: [1, 2, 3, 4, 5])
        let timed = RoutineScheduleForm.withTiming(daily, mode: .flexible, early: 10, late: 0)
        XCTAssertEqual(timed.timing, "flexible")
        XCTAssertEqual(timed.windowEarlyMinutes, 10)
        XCTAssertEqual(timed.windowLateMinutes, 0)
    }

    func testExactNamesItselfAndOnceCarriesNoTiming() {
        var flexible = RoutineSchedule.daily(time: "09:00", weekdays: [1])
        flexible.timing = "flexible"
        flexible.windowEarlyMinutes = 5
        let exact = RoutineScheduleForm.withTiming(flexible, mode: .exact, early: 15, late: 15)
        XCTAssertEqual(exact.timing, "exact")
        XCTAssertNil(exact.windowEarlyMinutes)
        let once = RoutineScheduleForm.withTiming(.once(at: Date(timeIntervalSince1970: 1_000)), mode: .flexible, early: 15, late: 15)
        XCTAssertNil(once.timing)
        XCTAssertNil(once.windowLateMinutes)
    }

    func testTheFormReadsAFlexibleScheduleBack() throws {
        var schedule = RoutineSchedule.daily(time: "08:30", weekdays: RoutineScheduleForm.allDays)
        schedule.timing = "flexible"
        schedule.windowEarlyMinutes = 20
        schedule.windowLateMinutes = 0
        let form = RoutineScheduleForm(schedule: schedule, seedAt: Date())
        XCTAssertEqual(form.timing, .flexible)
        XCTAssertEqual(form.earlyMinutes, 20)
        XCTAssertEqual(form.lateMinutes, 0)
        let saved = try form.schedule(savedAt: Date())
        XCTAssertEqual(saved.timing, "flexible")
        XCTAssertEqual(saved.windowEarlyMinutes, 20)
        XCTAssertEqual(saved.windowLateMinutes, 0)
        let fresh = RoutineScheduleForm(schedule: nil, seedAt: Date())
        XCTAssertEqual(fresh.timing, .exact)
        XCTAssertEqual(fresh.earlyMinutes, 15)
    }

    func testTheTimingTravelsInTheSchedule() throws {
        var schedule = RoutineSchedule.daily(time: "09:00", weekdays: [1])
        schedule.timing = "flexible"
        schedule.windowEarlyMinutes = 15
        schedule.windowLateMinutes = 5
        let json = try XCTUnwrap(String(data: JSONEncoder().encode(schedule), encoding: .utf8))
        XCTAssertTrue(json.contains("\"timing\":\"flexible\""), json)
        XCTAssertTrue(json.contains("\"windowLateMinutes\":5"), json)
        let back = try JSONDecoder().decode(RoutineSchedule.self, from: Data(json.utf8))
        XCTAssertEqual(back.windowEarlyMinutes, 15)
    }
}

/// "Share as Template" (TemplateLinkSection.tsx).
final class TemplateLinkTests: XCTestCase {
    func testTheBodyTrimsAndLeavesEmptyFieldsOut() throws {
        let body = TemplateLinkBody(name: "  Support  ", description: "   ")
        XCTAssertEqual(body.name, "Support")
        XCTAssertNil(body.description)
        let json = try XCTUnwrap(String(data: JSONEncoder().encode(body), encoding: .utf8))
        XCTAssertEqual(json, "{\"name\":\"Support\"}")
    }

    func testOnlyALinkIdGoesInTheAddress() {
        XCTAssertTrue(TemplateLinkRules.validId("abcdefghijklmnopqrstu_"))
        XCTAssertFalse(TemplateLinkRules.validId("short"))
        XCTAssertFalse(TemplateLinkRules.validId("abcdefghijklmnopqrst/u"))
    }
}

/// #1001: the bots working on the computer.
final class ComputerWorkingBotsTests: XCTestCase {
    func testTheListSkipsWhatItCannotRead() {
        let data = Data(#"{"bots":[{"id":"b1","name":"Ara","threadId":"t1"},{"id":"b2"}]}"#.utf8)
        XCTAssertEqual(ComputerWorkingBots.decode(data), [WorkingBot(id: "b1", name: "Ara", threadId: "t1")])
        XCTAssertEqual(ComputerWorkingBots.decode(Data("{}".utf8)), [])
    }
}

/// The "Read-only" pill (cloud-guest.ts `canWriteIn`).
final class ReadOnlyConversationTests: XCTestCase {
    func testAGuestWritesOnlyWhereItStarted() throws {
        let guest = try JSONDecoder().decode(AuthSession.self, from: Data(#"{"kind":"session","scopes":[],"cloudGuest":true,"openedThreads":["t-mine"]}"#.utf8))
        XCTAssertTrue(guest.canWrite(in: "t-mine"))
        XCTAssertFalse(guest.canWrite(in: "t-owner"))
        let owner = try JSONDecoder().decode(AuthSession.self, from: Data(#"{"kind":"session","scopes":["admin"]}"#.utf8))
        XCTAssertTrue(owner.canWrite(in: "t-owner"))
    }
}
