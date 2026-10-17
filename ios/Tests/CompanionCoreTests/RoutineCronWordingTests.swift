import XCTest
@testable import CompanionCore

/// The profile's routine rows say simple cron schedules as sentences
/// ("Weekdays at 8:11 AM"); anything else stays raw.
final class RoutineCronWordingTests: XCTestCase {
    private func wording(_ expression: String, zone: String? = "America/Toronto") -> RoutineSchedule.CronWording? {
        RoutineSchedule(type: .cron, expression: expression, timeZone: zone).cronWording
    }

    func testWeekdaysAtOneTime() {
        let w = wording("11 8 * * 1-5")
        XCTAssertEqual(w?.days, .weekdays)
        XCTAssertEqual(w?.minutesOfDay, [8 * 60 + 11])
        XCTAssertEqual(w?.timeZone, "America/Toronto")
    }

    func testSeveralHoursAreSorted() {
        let w = wording("17 16,12 * * MON-FRI")
        XCTAssertEqual(w?.days, .weekdays)
        XCTAssertEqual(w?.minutesOfDay, [12 * 60 + 17, 16 * 60 + 17])
    }

    func testEveryDayAndSundayAsSeven() {
        XCTAssertEqual(wording("31 16 * * *")?.days, .everyDay)
        XCTAssertEqual(wording("0 9 * * 7")?.days, .days([0]))
        XCTAssertEqual(wording("0 9 * * 0,6")?.days, .weekends)
        XCTAssertEqual(wording("0 9 * * 1-7")?.days, .everyDay)
        XCTAssertEqual(wording("0 9 * * 1,3,5")?.days, .days([1, 3, 5]))
    }

    func testUnsayableSchedulesStayRaw() {
        XCTAssertNil(wording("2 7 1-7 * 1"), "day-of-month limit")
        XCTAssertNil(wording("*/5 * * * *"), "step")
        XCTAssertNil(wording("0 9-17 * * *"), "hour range")
        XCTAssertNil(wording("0 9 * 1 *"), "month limit")
        XCTAssertNil(wording("0 9 * * 1/2"), "day step")
        XCTAssertNil(wording("0 9 * *"), "four fields")
        XCTAssertNil(wording("0 24 * * *"), "hour out of range")
        XCTAssertNil(RoutineSchedule(type: .daily, time: "07:00", weekdays: [1]).cronWording)
    }

    func testMissingZone() {
        XCTAssertNil(wording("0 9 * * *", zone: nil)?.timeZone)
        XCTAssertNil(wording("0 9 * * *", zone: "")?.timeZone)
    }

    func testIntervalHours() {
        XCTAssertEqual(RoutineSchedule(type: .interval, everyMinutes: 120).intervalHours, 2)
        XCTAssertEqual(RoutineSchedule(type: .interval, everyMinutes: 60).intervalHours, 1)
        XCTAssertNil(RoutineSchedule(type: .interval, everyMinutes: 90).intervalHours)
        XCTAssertNil(RoutineSchedule(type: .interval, everyMinutes: 30).intervalHours)
    }
}
