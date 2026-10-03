// What a routine edit sends: only the fields the person changed.
//
// The phone's editor shows a subset of a routine (name, prompt, bot, run
// location, a simple schedule, duration, timeout). A desktop routine can carry
// more: an interval's days, run-between window and end date, overlap,
// attachments, a results thread, a room-goal target. Resending the whole form
// on every save wrote the phone's partial view over the desktop's full one
// (matrix AU13), so an edit is now a diff against the routine it started from.
import Foundation

public enum RoutinePatch {
    /// The PATCH body: each top-level field only when it differs from
    /// `original`. The schedule, when it changed, is sent whole (the server
    /// validates a schedule as a unit) with the interval restrictions the
    /// editor does not show carried over from `original`.
    public static func body(original: Routine, input: RoutineInput) -> [String: Any] {
        var body: [String: Any] = [:]
        if input.name != original.name { body["name"] = input.name }
        if input.prompt != original.prompt { body["prompt"] = input.prompt }
        if input.botId != original.botId { body["botId"] = input.botId }
        if input.runOn != original.runOn { body["runOn"] = input.runOn }
        if let enabled = input.enabled, enabled != original.enabled { body["enabled"] = enabled }
        let schedule = input.schedule.keepingIntervalRestrictions(of: original.schedule)
        if !sameSchedule(schedule, original.schedule) { body["schedule"] = scheduleBody(schedule) }
        if input.durationMinutes != original.durationMinutes { body["durationMinutes"] = input.durationMinutes }
        let timeout = input.timeoutMinutes ?? (input.clearTimeout ? nil : original.timeoutMinutes)
        if timeout != original.timeoutMinutes { body["timeoutMinutes"] = timeout.map { $0 as Any } ?? NSNull() }
        return body
    }

    /// One schedule as the wire takes it (`RoutineScheduleInput`), every
    /// field the schedule carries and nothing it does not.
    public static func scheduleBody(_ schedule: RoutineSchedule) -> [String: Any] {
        var body: [String: Any] = ["type": schedule.type.rawValue]
        if let at = schedule.at { body["at"] = at }
        if let time = schedule.time { body["time"] = time }
        if let weekdays = schedule.weekdays { body["weekdays"] = weekdays }
        if let everyMinutes = schedule.everyMinutes { body["everyMinutes"] = everyMinutes }
        if let anchorAt = schedule.anchorAt { body["anchorAt"] = anchorAt }
        if let expression = schedule.expression { body["expression"] = expression }
        if let timeZone = schedule.timeZone { body["timeZone"] = timeZone }
        if let window = schedule.window { body["window"] = ["start": window.start, "end": window.end] }
        if let endsAt = schedule.endsAt { body["endsAt"] = endsAt }
        return body
    }

    /// Equal as the server reads them: `at` to the millisecond (a Date
    /// round trip leaves float dust), weekdays as a set.
    static func sameSchedule(_ a: RoutineSchedule, _ b: RoutineSchedule) -> Bool {
        a.type == b.type
            && a.at.map { Int64($0.rounded()) } == b.at.map { Int64($0.rounded()) }
            && a.time == b.time
            && a.weekdays.map(Set.init) == b.weekdays.map(Set.init)
            && a.everyMinutes == b.everyMinutes
            && a.anchorAt == b.anchorAt
            && a.expression == b.expression
            && a.timeZone == b.timeZone
            && a.window == b.window
            && a.endsAt == b.endsAt
    }
}
