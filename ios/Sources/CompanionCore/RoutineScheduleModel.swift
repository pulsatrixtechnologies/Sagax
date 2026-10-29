// The routine schedule as a person picks it (2026-10-29): a frequency, the
// times, the days, the zone. Cron stays under the hood: the editor turns a
// model into the five-field expression the scheduler already runs, and an
// expression back into a model when it fits one. An expression that fits
// none gives nil: the editor then keeps it as it is behind "Advanced",
// still described in words. A port of shared/schedule-model.ts (same rules,
// same refusals).
import Foundation

/// How often: what the Repeats picker offers beside "Does not repeat" and
/// the interval.
public enum RoutineScheduleFrequency: String, CaseIterable, Hashable, Sendable {
    /// Every hour at :MM.
    case hourly
    case daily
    /// Monday to Friday.
    case weekdays
    /// Certain days of the week.
    case days
    case monthly
    case yearly
    /// Every N minutes or every N hours.
    case every
}

public enum RoutineScheduleEveryUnit: String, CaseIterable, Hashable, Sendable {
    case minutes, hours
}

/// A day of the month, or its last day.
public enum RoutineMonthDay: Hashable, Sendable {
    case day(Int)
    case last
}

public struct RoutineScheduleModel: Hashable, Sendable {
    /// Steps that land on the same minutes every hour.
    public static let everyMinutes = [5, 10, 15, 20, 30]
    /// Steps that land on the same hours every day; one hour is "Every hour".
    public static let everyHours = [2, 3, 4, 6, 8, 12]
    public static let workWeek = [1, 2, 3, 4, 5]

    public var frequency: RoutineScheduleFrequency
    /// "HH:MM" in 24 h, for daily, weekdays, days, monthly and yearly.
    public var times: [String]
    /// Hourly: the minute past each hour.
    public var minute: Int
    /// Certain days: Sunday = 0.
    public var weekdays: [Int]
    /// Monthly and yearly (yearly reads the last day as the 31st).
    public var monthDay: RoutineMonthDay
    /// Yearly: 1 to 12.
    public var month: Int
    /// Every N minutes or hours.
    public var every: Int
    public var unit: RoutineScheduleEveryUnit

    public init(
        frequency: RoutineScheduleFrequency = .daily, times: [String] = ["09:00"], minute: Int = 0,
        weekdays: [Int] = RoutineScheduleModel.workWeek, monthDay: RoutineMonthDay = .day(1), month: Int = 1,
        every: Int = 15, unit: RoutineScheduleEveryUnit = .minutes
    ) {
        self.frequency = frequency
        self.times = times
        self.minute = minute
        self.weekdays = weekdays
        self.monthDay = monthDay
        self.month = month
        self.every = every
        self.unit = unit
    }

    /// Why a model cannot be an expression.
    public enum Problem: String, Error, Hashable, Sendable {
        /// No time chosen.
        case noTime
        /// Several times a day that do not share their minutes.
        case sameMinute
        /// "Certain days" with none ticked.
        case noDays
        /// A value out of range.
        case badTime
    }

    // MARK: Clock

    static func clock(_ hour: Int, _ minute: Int) -> String {
        String(format: "%02d:%02d", hour, minute)
    }

    static func parseClock(_ value: String) -> (hour: Int, minute: Int)? {
        let text = value.trimmingCharacters(in: .whitespaces)
        let parts = text.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, (1...2).contains(parts[0].count), parts[1].count == 2,
              parts.allSatisfy({ $0.allSatisfy { $0.isASCII && $0.isNumber } }),
              let hour = Int(parts[0]), let minute = Int(parts[1]), hour <= 23, minute <= 59
        else { return nil }
        return (hour, minute)
    }

    /// Sorted, without repeats or unreadable entries.
    public static func normalizeTimes(_ times: [String]) -> [String] {
        Array(Set(times.compactMap(parseClock).map { clock($0.hour, $0.minute) })).sorted()
    }

    // MARK: Model to expression

    /// The cron expression of the model, or why it cannot be one. Several
    /// times a day share their minutes (8:30, 12:30, 16:30): one expression
    /// cannot say 8:15 and 12:30 without also meaning 8:30 and 12:15.
    public func cron() -> Result<String, Problem> {
        switch frequency {
        case .hourly:
            guard (0...59).contains(minute) else { return .failure(.badTime) }
            return .success("\(minute) * * * *")
        case .every:
            if unit == .minutes {
                guard Self.everyMinutes.contains(every) else { return .failure(.badTime) }
                return .success("*/\(every) * * * *")
            }
            guard Self.everyHours.contains(every) else { return .failure(.badTime) }
            return .success("0 */\(every) * * *")
        default:
            break
        }
        if times.contains(where: { Self.parseClock($0) == nil }) { return .failure(.badTime) }
        let parsed = Self.normalizeTimes(times).compactMap(Self.parseClock)
        guard let first = parsed.first else { return .failure(.noTime) }
        guard parsed.allSatisfy({ $0.minute == first.minute }) else { return .failure(.sameMinute) }
        let at = "\(first.minute) \(parsed.map { String($0.hour) }.joined(separator: ","))"
        switch frequency {
        case .daily:
            return .success("\(at) * * *")
        case .weekdays:
            return .success("\(at) * * 1-5")
        case .days:
            let days = Array(Set(weekdays.map { $0 % 7 }.filter { (0...6).contains($0) })).sorted()
            guard !days.isEmpty else { return .failure(.noDays) }
            if days.count == 7 { return .success("\(at) * * *") }
            return .success("\(at) * * \(days.map(String.init).joined(separator: ","))")
        case .monthly:
            switch monthDay {
            case .last: return .success("\(at) L * *")
            case let .day(day):
                guard (1...31).contains(day) else { return .failure(.badTime) }
                return .success("\(at) \(day) * *")
            }
        case .yearly:
            let day: Int
            switch monthDay {
            case .last: day = 31
            case let .day(value): day = value
            }
            guard (1...31).contains(day), (1...12).contains(month) else { return .failure(.badTime) }
            return .success("\(at) \(day) \(month) *")
        case .hourly, .every:
            return .failure(.badTime)
        }
    }

    // MARK: Expression to model

    private static let dayAliases = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

    private static func isDigits(_ text: String) -> Bool {
        !text.isEmpty && text.allSatisfy { $0.isASCII && $0.isNumber }
    }

    private static func numberList(_ text: String, _ min: Int, _ max: Int, aliases: [String] = []) -> [Int]? {
        var values = Set<Int>()
        for part in text.split(separator: ",", omittingEmptySubsequences: false).map(String.init) {
            let range = part.split(separator: "-", omittingEmptySubsequences: false).map(String.init)
            if range.count > 2 || range.contains(where: \.isEmpty) { return nil }
            func read(_ token: String) -> Int? {
                if isDigits(token) { return Int(token) }
                return aliases.firstIndex(of: token.uppercased())
            }
            guard let first = read(range[0]) else { return nil }
            guard let last = range.count == 2 ? read(range[1]) : first else { return nil }
            if first < min || last > max || first > last { return nil }
            for value in first...last { values.insert(value) }
        }
        return values.sorted()
    }

    /// The model an expression is, or nil when it fits no model (the editor
    /// then keeps it under Advanced).
    public static func from(cron expression: String) -> RoutineScheduleModel? {
        let fields = expression.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard fields.count == 5 else { return nil }
        let (minuteText, hourText, dayText, monthText, weekdayText) = (fields[0], fields[1], fields[2], fields[3], fields[4])
        let base = RoutineScheduleModel()

        func step(_ text: String) -> Int? {
            guard text.hasPrefix("*/") else { return nil }
            let rest = String(text.dropFirst(2))
            return isDigits(rest) ? Int(rest) : nil
        }
        if hourText == "*" && dayText == "*" && monthText == "*" && weekdayText == "*" {
            if let every = step(minuteText), everyMinutes.contains(every) {
                var model = base
                model.frequency = .every
                model.every = every
                model.unit = .minutes
                return model
            }
            if isDigits(minuteText), let minute = Int(minuteText), minute <= 59 {
                var model = base
                model.frequency = .hourly
                model.minute = minute
                return model
            }
            return nil
        }
        if let every = step(hourText), minuteText == "0", dayText == "*", monthText == "*", weekdayText == "*" {
            guard everyHours.contains(every) else { return nil }
            var model = base
            model.frequency = .every
            model.every = every
            model.unit = .hours
            return model
        }

        guard isDigits(minuteText), let minute = Int(minuteText), minute <= 59 else { return nil }
        guard let hours = numberList(hourText, 0, 23) else { return nil }
        var model = base
        model.times = hours.map { clock($0, minute) }

        if monthText == "*" && dayText == "*" {
            if weekdayText == "*" {
                model.frequency = .daily
                return model
            }
            guard let days = numberList(weekdayText, 0, 7, aliases: dayAliases) else { return nil }
            let set = Array(Set(days.map { $0 % 7 })).sorted()
            if set.count == 7 {
                model.frequency = .daily
            } else if set == workWeek {
                model.frequency = .weekdays
            } else {
                model.frequency = .days
                model.weekdays = set
            }
            return model
        }
        guard weekdayText == "*" else { return nil }
        let monthDay: RoutineMonthDay
        if dayText == "L" {
            monthDay = .last
        } else if isDigits(dayText), let day = Int(dayText), (1...31).contains(day) {
            monthDay = .day(day)
        } else {
            return nil
        }
        model.monthDay = monthDay
        if monthText == "*" {
            model.frequency = .monthly
            return model
        }
        guard isDigits(monthText), let month = Int(monthText), (1...12).contains(month), monthDay != .last else { return nil }
        model.frequency = .yearly
        model.month = month
        return model
    }

    /// A daily schedule (a time and days, in the device's zone) as a model.
    public static func from(time: String, weekdays: [Int]?) -> RoutineScheduleModel? {
        guard let parsed = parseClock(time) else { return nil }
        let days = Array(Set((weekdays ?? Array(0...6)).map { $0 % 7 })).sorted()
        var model = RoutineScheduleModel(times: [clock(parsed.hour, parsed.minute)])
        if days.isEmpty || days.count == 7 {
            model.frequency = .daily
        } else if days == workWeek {
            model.frequency = .weekdays
        } else {
            model.frequency = .days
            model.weekdays = days
        }
        return model
    }

    // MARK: Zone

    /// The city of an IANA zone in plain words: "America/Toronto" is
    /// "Toronto", "America/Argentina/Buenos_Aires" is "Buenos Aires".
    public static func timeZoneCity(_ timeZone: String) -> String {
        if timeZone == "UTC" || timeZone == "Etc/UTC" { return "UTC" }
        let last = timeZone.split(separator: "/").last.map(String.init) ?? timeZone
        return last.replacingOccurrences(of: "_", with: " ")
    }
}
