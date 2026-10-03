// The routine editor's schedule, as the desktop's EventEditor builds it
// (src/components/RoutineCalendarPage.tsx, matrix AU12, AU13).
//
// One value type holds what the Repeat picker and its fields show; it
// validates exactly as the desktop does and produces the schedule to save.
// The phone's editor binds to it, so the rules live here, tested, and any
// layout (iPhone sheet, a future iPad panel) shows the same thing.
import Foundation

/// The Repeat picker (`RecurrenceChoice`).
public enum RoutineRecurrence: String, CaseIterable, Hashable, Sendable {
    /// "Does not repeat".
    case none
    /// "Every X minutes".
    case interval
    /// "Daily": every day at a time.
    case daily
    /// "Every weekday (Monday to Friday)".
    case weekdays
    /// "Weekly on <day of the start date>".
    case weekly
    /// "Selected weekdays".
    case custom
    case monthly
    case yearly
    /// "Custom cron (advanced)".
    case cron

    public var cronChoice: RoutineCronChoice? {
        switch self {
        case .monthly: .monthly
        case .yearly: .yearly
        case .cron: .cron
        default: nil
        }
    }

    public init(_ choice: RoutineCronChoice) {
        switch choice {
        case .monthly: self = .monthly
        case .yearly: self = .yearly
        case .cron: self = .cron
        }
    }
}

/// "On": which days an interval runs.
public enum RoutineIntervalDays: String, CaseIterable, Hashable, Sendable {
    case everyDay = "every-day"
    case weekdays
    case custom
}

public struct RoutineScheduleForm: Hashable, Sendable {
    public static let allDays = [0, 1, 2, 3, 4, 5, 6]
    public static let workWeek = [1, 2, 3, 4, 5]
    public static let intervalPresets = [5, 10, 15, 30, 60]

    public var recurrence: RoutineRecurrence
    /// The start: the date and time of a one-time run, the time of a daily
    /// one, and for "Weekly" also the day.
    public var at: Date
    /// "Selected weekdays". Never empty: the last day cannot be removed.
    public private(set) var weekdays: [Int]
    /// Minutes between interval runs; nil while the custom field is empty.
    public var intervalMinutes: Int?
    public var intervalDays: RoutineIntervalDays
    /// The custom interval days; may be empty (then invalid).
    public var intervalWeekdays: [Int]
    /// "During": nil is all day.
    public var windowCustom: Bool
    public var windowStart: String
    public var windowEnd: String
    /// "Ends": on a date (the end of that local day), or never.
    public var endsOnDate: Bool
    public var endDate: Date
    public var cronDraft: RoutineCronDraft
    /// The person touched the cron fields; until then a cron schedule is
    /// kept exactly as it was.
    public var cronChanged: Bool

    /// The schedule the editor opened, nil for a new routine.
    public let original: RoutineSchedule?
    public let openedAt: Date
    public let calendar: Calendar

    /// `seedAt`: when the routine would next run (or the next hour for a new one).
    public init(schedule: RoutineSchedule?, seedAt: Date, now: Date = Date(), calendar: Calendar = .current) {
        self.original = schedule
        self.openedAt = now
        self.calendar = calendar
        let initialAt: Date
        switch schedule?.type {
        case .once?: initialAt = schedule?.at.map { Date(timeIntervalSince1970: $0 / 1_000) } ?? seedAt
        case .daily?: initialAt = Self.atLocalTime(seedAt, schedule?.time ?? "09:00", calendar: calendar)
        case .interval?: initialAt = schedule?.anchorAt.map { Date(timeIntervalSince1970: Double($0) / 1_000) } ?? seedAt
        default: initialAt = seedAt
        }
        at = initialAt
        recurrence = Self.recurrence(for: schedule, at: initialAt, calendar: calendar)
        let startDay = calendar.component(.weekday, from: initialAt) - 1
        weekdays = schedule?.type == .daily ? (schedule?.weekdays ?? [startDay]) : [startDay]
        let interval = schedule?.type == .interval ? schedule : nil
        intervalMinutes = interval?.everyMinutes ?? 15
        intervalDays = Self.intervalDayChoice(interval)
        intervalWeekdays = (interval?.weekdays).flatMap { $0.isEmpty ? nil : $0 } ?? Self.allDays
        windowCustom = interval?.window != nil
        windowStart = interval?.window?.start ?? "09:00"
        windowEnd = interval?.window?.end ?? "17:00"
        endsOnDate = interval?.endsAt != nil
        if let endsAt = interval?.endsAt {
            endDate = Date(timeIntervalSince1970: Double(endsAt) / 1_000)
        } else {
            let start = calendar.startOfDay(for: max(now, initialAt))
            endDate = calendar.date(byAdding: .day, value: 7, to: start) ?? start
        }
        cronDraft = RoutineCronEditor.draft(
            for: schedule?.type == .cron ? schedule : nil, at: initialAt, localZone: calendar.timeZone
        )
        cronChanged = false
    }

    // MARK: Reading a schedule

    public static func recurrence(for schedule: RoutineSchedule?, at: Date, calendar: Calendar = .current) -> RoutineRecurrence {
        guard let schedule else { return .none }
        switch schedule.type {
        case .once, .unknown: return .none
        case .interval: return .interval
        case .cron: return RoutineRecurrence(RoutineCronEditor.choice(for: schedule))
        case .daily:
            let days = schedule.weekdays ?? []
            if days.count == 7 { return .daily }
            if days == workWeek { return .weekdays }
            if days.count == 1, days[0] == calendar.component(.weekday, from: at) - 1 { return .weekly }
            return .custom
        }
    }

    static func intervalDayChoice(_ schedule: RoutineSchedule?) -> RoutineIntervalDays {
        guard let days = schedule?.weekdays, days.count != 7 else { return .everyDay }
        return days == workWeek ? .weekdays : .custom
    }

    // MARK: Edits

    /// What a recurrence change does beside switching (`selectRecurrence`).
    /// The interval's default 30-minute run limit is the editor's to apply.
    public mutating func select(_ choice: RoutineRecurrence) {
        if let cronChoice = choice.cronChoice {
            // Switching from a preset to Advanced starts with what was chosen.
            if cronChoice == .cron, let schedule = cronValue?.schedule, let expression = schedule.expression {
                cronDraft.expression = expression
            }
            cronChanged = true
        }
        recurrence = choice
    }

    public mutating func toggleWeekday(_ day: Int) {
        if weekdays.contains(day) {
            guard weekdays.count > 1 else { return }
            weekdays.removeAll { $0 == day }
        } else {
            weekdays = (weekdays + [day]).sorted()
        }
    }

    public mutating func selectIntervalDays(_ choice: RoutineIntervalDays) {
        if choice == .custom && intervalDays != .custom {
            intervalWeekdays = intervalDays == .weekdays ? Self.workWeek : Self.allDays
        }
        intervalDays = choice
    }

    public mutating func toggleIntervalWeekday(_ day: Int) {
        if intervalWeekdays.contains(day) { intervalWeekdays.removeAll { $0 == day } }
        else { intervalWeekdays = (intervalWeekdays + [day]).sorted() }
    }

    public mutating func updateCron(_ change: (inout RoutineCronDraft) -> Void) {
        change(&cronDraft)
        cronChanged = true
    }

    // MARK: Validation (the desktop's messages)

    public var intervalInvalid: Bool {
        recurrence == .interval && !(5...1_440).contains(intervalMinutes ?? 0)
    }

    public var intervalDaysInvalid: Bool {
        recurrence == .interval && intervalDays == .custom && intervalWeekdays.isEmpty
    }

    public var windowInvalid: Bool {
        guard recurrence == .interval, windowCustom else { return false }
        guard let start = Self.clockMinutes(windowStart), let end = Self.clockMinutes(windowEnd) else { return true }
        return end - start < max(intervalMinutes ?? 0, 0)
    }

    var originalInterval: (everyMinutes: Int, anchorAt: Int64)? {
        guard let original, original.type == .interval, let every = original.everyMinutes, let anchor = original.anchorAt else { return nil }
        return (every, anchor)
    }

    /// The earliest allowed end: the first run after the editor opened.
    public var endMinimum: Date {
        Self.nextIntervalForSave(now: openedAt, everyMinutes: max(5, intervalMinutes ?? 5), current: originalInterval)
    }

    public var endsAt: Int64? {
        guard endsOnDate else { return nil }
        // An end set elsewhere (an agent, the API) need not be the end of a
        // day: the same day picked again keeps it exactly.
        if let original, original.type == .interval, let kept = original.endsAt,
           calendar.isDate(Date(timeIntervalSince1970: Double(kept) / 1_000), inSameDayAs: endDate) {
            return kept
        }
        return Self.endOfLocalDate(endDate, calendar: calendar)
    }

    public var endInvalid: Bool {
        guard recurrence == .interval, endsOnDate, let endsAt else { return false }
        return Double(endsAt) < endMinimum.timeIntervalSince1970 * 1_000
    }

    public var cronValue: RoutineCronEditor.Value? {
        guard let choice = recurrence.cronChoice else { return nil }
        let unchanged = !cronChanged && original?.type == .cron ? original : nil
        return RoutineCronEditor.value(choice: choice, draft: cronDraft, after: openedAt, unchanged: unchanged)
    }

    /// What is wrong, in the desktop's order; nil when valid.
    public enum Problem: Hashable, Sendable {
        /// "Choose a whole number from 5 to 1,440 minutes."
        case intervalRange
        /// "Choose at least one day."
        case noDays
        /// "Choose a same-day window at least N minutes long."
        case window(minutes: Int)
        /// "Choose an end date after the first run."
        case endDate
        /// The cron editor's message (`RoutineCronEditor.Value.error`).
        case cron(String)

        public var message: String {
            switch self {
            case .intervalRange: "Choose a whole number from 5 to 1,440 minutes."
            case .noDays: "Choose at least one day."
            case let .window(minutes): "Choose a same-day window at least \(minutes) minutes long."
            case .endDate: "Choose an end date after the first run."
            case let .cron(message): message
            }
        }
    }

    public var problem: Problem? {
        if intervalInvalid { return .intervalRange }
        if intervalDaysInvalid { return .noDays }
        if windowInvalid { return .window(minutes: (intervalMinutes ?? 0) == 0 ? 5 : intervalMinutes ?? 5) }
        if endInvalid { return .endDate }
        if let cron = cronValue, !cron.error.isEmpty { return .cron(cron.error) }
        return nil
    }

    public var isValid: Bool { problem == nil }

    // MARK: Saving

    /// The schedule to send (`makeRoutineSchedule` / the cron value), with
    /// the interval's days, window and end date written out: nil there
    /// means "clear it" (`RoutinePatch` sends null).
    public func schedule(savedAt: Date) throws -> RoutineSchedule {
        if let problem { throw RoutineScheduleError(problem.message) }
        switch recurrence {
        case .monthly, .yearly, .cron:
            guard let schedule = cronValue?.schedule else { throw RoutineScheduleError("Choose a valid schedule.") }
            return schedule
        case .interval:
            let minutes = intervalMinutes ?? 15
            if let endsAt, Double(endsAt) < Self.nextIntervalForSave(now: savedAt, everyMinutes: minutes, current: originalInterval).timeIntervalSince1970 * 1_000 {
                throw RoutineScheduleError("Choose an end date after the first run.")
            }
            let anchor = Self.intervalAnchorForSave(now: savedAt, everyMinutes: minutes, current: originalInterval)
            var schedule = RoutineSchedule(type: .interval, everyMinutes: minutes, anchorAt: Int64((anchor.timeIntervalSince1970 * 1_000).rounded()))
            switch intervalDays {
            case .everyDay: schedule.weekdays = nil
            case .weekdays: schedule.weekdays = Self.workWeek
            case .custom: schedule.weekdays = intervalWeekdays.sorted()
            }
            schedule.window = windowCustom ? RoutineIntervalWindow(start: windowStart, end: windowEnd) : nil
            schedule.endsAt = endsAt
            return schedule
        case .none:
            return .init(type: .once, at: exactAt)
        case .daily, .weekdays, .weekly, .custom:
            let days: [Int]
            switch recurrence {
            case .daily: days = Self.allDays
            case .weekdays: days = Self.workWeek
            case .weekly: days = [calendar.component(.weekday, from: at) - 1]
            default: days = weekdays
            }
            return .daily(time: Self.clock(at, calendar: calendar), weekdays: days.sorted())
        }
    }

    /// `at` in epoch ms. Untouched, an existing one-time run keeps its exact
    /// instant (seconds included); a chosen time is on the minute.
    var exactAt: Double {
        if let original, original.type == .once, let originalAt = original.at,
           Int64(originalAt.rounded() / 1_000) == Int64(at.timeIntervalSince1970.rounded()) {
            return originalAt
        }
        let minute = calendar.dateInterval(of: .minute, for: at)?.start ?? at
        return (minute.timeIntervalSince1970 * 1_000).rounded()
    }

    // MARK: Helpers (src/lib/routine-calendar.ts)

    public static func clock(_ date: Date, calendar: Calendar) -> String {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }

    public static func clockMinutes(_ text: String) -> Int? {
        let parts = text.split(separator: ":")
        guard parts.count == 2, let hour = Int(parts[0]), let minute = Int(parts[1]),
              (0..<24).contains(hour), (0..<60).contains(minute) else { return nil }
        return hour * 60 + minute
    }

    public static func atLocalTime(_ day: Date, _ time: String, calendar: Calendar) -> Date {
        let minutes = clockMinutes(time) ?? 9 * 60
        return calendar.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: day) ?? day
    }

    /// The next whole hour from now, where a new routine starts.
    public static func nextHour(after now: Date = Date(), calendar: Calendar = .current) -> Date {
        let later = now.addingTimeInterval(3_600)
        return calendar.dateInterval(of: .hour, for: later)?.start ?? later
    }

    public static func endOfLocalDate(_ date: Date, calendar: Calendar) -> Int64 {
        let start = calendar.startOfDay(for: date)
        let end = calendar.date(byAdding: DateComponents(day: 1, nanosecond: -1_000_000), to: start) ?? start
        return Int64((end.timeIntervalSince1970 * 1_000).rounded())
    }

    /// A new interval starts at least one full cadence from now, on a clean minute.
    public static func nextIntervalAnchor(now: Date, everyMinutes: Int) -> Date {
        let ms = now.timeIntervalSince1970 * 1_000 + Double(everyMinutes) * 60_000
        return Date(timeIntervalSince1970: (ms / 60_000).rounded(.up) * 60)
    }

    public static func intervalAnchorForSave(now: Date, everyMinutes: Int, current: (everyMinutes: Int, anchorAt: Int64)?) -> Date {
        if let current, current.everyMinutes == everyMinutes {
            return Date(timeIntervalSince1970: Double(current.anchorAt) / 1_000)
        }
        return nextIntervalAnchor(now: now, everyMinutes: everyMinutes)
    }

    /// The next cadence point, keeping the original phase when editing.
    public static func nextIntervalForSave(now: Date, everyMinutes: Int, current: (everyMinutes: Int, anchorAt: Int64)?) -> Date {
        let anchor = intervalAnchorForSave(now: now, everyMinutes: everyMinutes, current: current)
        if anchor > now { return anchor }
        let step = Double(everyMinutes) * 60
        let periods = ((now.timeIntervalSince1970 - anchor.timeIntervalSince1970) / step).rounded(.down) + 1
        return anchor.addingTimeInterval(periods * step)
    }
}
