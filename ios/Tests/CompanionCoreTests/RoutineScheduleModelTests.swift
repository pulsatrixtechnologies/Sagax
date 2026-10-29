import XCTest
@testable import CompanionCore

/// The schedule as a person picks it (shared/schedule-model.ts): every
/// frequency to cron and back, the shared-minutes rule, what fits no model.
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

    func testSeveralTimesShareTheirMinutes() {
        let model = RoutineScheduleModel(frequency: .daily, times: ["08:15", "12:30"])
        XCTAssertEqual(model.cron(), .failure(.sameMinute))
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
