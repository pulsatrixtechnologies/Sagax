import XCTest
@testable import CompanionCore

/// The schedule as a person picks it (shared/schedule-model.ts): every
/// frequency to cron and back, times with their own minutes, what fits no model.
final class RoutineScheduleModelTests: XCTestCase {
    private func cron(_ model: RoutineScheduleModel) -> String? {
        try? model.cron().get()
    }

    func testEveryFrequencyRoundTrips() {
        let models: [(RoutineScheduleModel, String)] = [
            (RoutineScheduleModel(frequency: .hourly, minute: 30), "30 * * * *"),
            (RoutineScheduleModel(frequency: .daily, times: ["09:00"]), "0 9 * * *"),
            (RoutineScheduleModel(frequency: .weekdays, times: ["08:30", "12:30", "16:30"]), "30 8,12,16 * * 1-5"),
            (RoutineScheduleModel(frequency: .days, times: ["07:15"], weekdays: [0, 3, 6]), "15 7 * * 0,3,6"),
            (RoutineScheduleModel(frequency: .monthly, times: ["09:00"], monthDay: .day(15)), "0 9 15 * *"),
            (RoutineScheduleModel(frequency: .monthly, times: ["18:45"], monthDay: .last), "45 18 L * *"),
            (RoutineScheduleModel(frequency: .yearly, times: ["10:00"], monthDay: .day(1), month: 7), "0 10 1 7 *"),
            (RoutineScheduleModel(frequency: .every, every: 15, unit: .minutes), "*/15 * * * *"),
            (RoutineScheduleModel(frequency: .every, every: 6, unit: .hours), "0 */6 * * *"),
        ]
        for (model, expression) in models {
            XCTAssertEqual(cron(model), expression)
            let back = RoutineScheduleModel.from(cron: expression)
            XCTAssertNotNil(back, expression)
            XCTAssertEqual(back.flatMap(cron), expression)
            XCTAssertEqual(back?.frequency, model.frequency, expression)
        }
    }

    func testWeekdaysAtThreeTimes() throws {
        let model = try XCTUnwrap(RoutineScheduleModel.from(cron: "30 8,12,16 * * 1-5"))
        XCTAssertEqual(model.frequency, .weekdays)
        XCTAssertEqual(model.times, ["08:30", "12:30", "16:30"])
    }

    func testDayListsAndNamesReadAsTheirModel() {
        XCTAssertEqual(RoutineScheduleModel.from(cron: "0 9 * * MON-FRI")?.frequency, .weekdays)
        XCTAssertEqual(RoutineScheduleModel.from(cron: "0 9 * * 0-6")?.frequency, .daily)
        XCTAssertEqual(RoutineScheduleModel.from(cron: "0 9 * * 1-7")?.frequency, .daily)
        let days = RoutineScheduleModel.from(cron: "0 9 * * 7,2")
        XCTAssertEqual(days?.frequency, .days)
        XCTAssertEqual(days?.weekdays, [0, 2])
        XCTAssertEqual(cron(RoutineScheduleModel(frequency: .days, times: ["09:00"], weekdays: [0, 1, 2, 3, 4, 5, 6])), "0 9 * * *")
    }

    /// 2026-10-29: each time keeps its minutes; times sharing their minutes
    /// share an expression, the earliest time's expression first.
    func testTimesWithOtherMinutesBecomeSeveralExpressions() throws {
        let cases: [(RoutineScheduleModel, String)] = [
            (RoutineScheduleModel(frequency: .weekdays, times: ["12:30", "08:15"]), "15 8 * * 1-5; 30 12 * * 1-5"),
            (RoutineScheduleModel(frequency: .daily, times: ["08:15", "12:30", "16:15"]), "15 8,16 * * *; 30 12 * * *"),
            (RoutineScheduleModel(frequency: .monthly, times: ["09:00", "17:45"], monthDay: .day(15)), "0 9 15 * *; 45 17 15 * *"),
            (RoutineScheduleModel(frequency: .monthly, times: ["06:05", "18:30"], monthDay: .last), "5 6 L * *; 30 18 L * *"),
            (RoutineScheduleModel(frequency: .days, times: ["07:10", "19:40"], weekdays: [0, 3, 6]), "10 7 * * 0,3,6; 40 19 * * 0,3,6"),
            (RoutineScheduleModel(frequency: .yearly, times: ["10:00", "10:30"], monthDay: .day(1), month: 7), "0 10 1 7 *; 30 10 1 7 *"),
        ]
        for (model, expression) in cases {
            XCTAssertEqual(cron(model), expression)
            let back = try XCTUnwrap(RoutineScheduleModel.from(cron: expression), expression)
            XCTAssertEqual(back.frequency, model.frequency, expression)
            XCTAssertEqual(back.times, RoutineScheduleModel.normalizeTimes(model.times), expression)
            XCTAssertEqual(cron(back), expression)
        }
        let days = try XCTUnwrap(RoutineScheduleModel.from(cron: "10 7 * * 0,3,6;40 19 * * 0,3,6"))
        XCTAssertEqual(days.weekdays, [0, 3, 6])
        XCTAssertEqual(RoutineScheduleModel.from(cron: "45 17 15 * *; 0 9 15 * *")?.times, ["09:00", "17:45"])
    }

    func testSeveralExpressionsThatDifferInTheirDaysFitNoModel() {
        for expression in ["15 8 * * 1-5; 30 12 * * *", "0 9 1 * *; 30 9 15 * *", "15 8 * * *; */15 * * * *", "30 * * * *; 45 * * * *",
                           "15 8 * * *; 0 9 1 * 1", "15 8 * * *; 0 9 * *"] {
            XCTAssertNil(RoutineScheduleModel.from(cron: expression), expression)
        }
    }

    func testOneExpressionIsUnchanged() {
        XCTAssertEqual(cron(RoutineScheduleModel(frequency: .weekdays, times: ["08:30", "12:30"])), "30 8,12 * * 1-5")
        XCTAssertEqual(RoutineScheduleModel.from(cron: "30 8,12 * * 1-5")?.times, ["08:30", "12:30"])
    }

    func testProblems() {
        XCTAssertEqual(RoutineScheduleModel(frequency: .daily, times: []).cron(), .failure(.noTime))
        XCTAssertEqual(RoutineScheduleModel(frequency: .days, weekdays: []).cron(), .failure(.noDays))
        XCTAssertEqual(RoutineScheduleModel(frequency: .daily, times: ["25:00"]).cron(), .failure(.badTime))
        XCTAssertEqual(RoutineScheduleModel(frequency: .every, every: 7, unit: .minutes).cron(), .failure(.badTime))
        XCTAssertEqual(RoutineScheduleModel(frequency: .every, every: 5, unit: .hours).cron(), .failure(.badTime))
        // repeats and order do not matter
        XCTAssertEqual(cron(RoutineScheduleModel(frequency: .daily, times: ["16:00", "08:00", "08:00"])), "0 8,16 * * *")
    }

    func testYearlyReadsTheLastDayAsThe31st() {
        XCTAssertEqual(cron(RoutineScheduleModel(frequency: .yearly, times: ["09:00"], monthDay: .last, month: 12)), "0 9 31 12 *")
    }

    func testWhatFitsNoModelIsNil() {
        for expression in ["2 7 1-7 * 1", "0 9 * * 1#2", "*/7 * * * *", "0 */5 * * *", "*/15 9-17 * * *", "0 9 L 3 *",
                           "0 9 1 * 1", "0 9-17/2 * * *", "0 9 * *", "61 9 * * *", "0 9 W * *", "15 */2 * * *"] {
            XCTAssertNil(RoutineScheduleModel.from(cron: expression), expression)
        }
    }

    func testADailyScheduleReadsAsItsModel() {
        XCTAssertEqual(RoutineScheduleModel.from(time: "07:00", weekdays: [1, 2, 3, 4, 5])?.frequency, .weekdays)
        XCTAssertEqual(RoutineScheduleModel.from(time: "07:00", weekdays: nil)?.frequency, .daily)
        XCTAssertEqual(RoutineScheduleModel.from(time: "07:00", weekdays: [2])?.weekdays, [2])
        XCTAssertNil(RoutineScheduleModel.from(time: "7h", weekdays: nil))
    }

    func testTimeZoneCity() {
        XCTAssertEqual(RoutineScheduleModel.timeZoneCity("America/Toronto"), "Toronto")
        XCTAssertEqual(RoutineScheduleModel.timeZoneCity("America/Argentina/Buenos_Aires"), "Buenos Aires")
        XCTAssertEqual(RoutineScheduleModel.timeZoneCity("UTC"), "UTC")
        XCTAssertEqual(RoutineScheduleModel.timeZoneCity("Etc/UTC"), "UTC")
    }
}
