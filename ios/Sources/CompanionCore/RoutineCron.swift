// Cron schedules for routines (matrix AU12), as the desktop edits them.
//
// The desktop's Monthly, Yearly and "Custom cron (advanced)" choices
// (src/components/routines/cron-editor.ts, CronScheduleFields.tsx) write a
// five-field cron expression in an explicit IANA zone; the server and the
// editor's "Next runs" preview read it with croner (shared/routine-schedule.ts,
// `mode: "5-part"`). This file is that calculator for the phone: the same
// field syntax, the same day rule (day of month OR day of week when both are
// restricted), the same errors, and strictly-future runs. The server stays the
// authority; the phone uses this to validate before saving and to preview.
import Foundation

public struct CronExpression: Hashable, Sendable {
    public let expression: String
    /// The zone as written ("UTC" stays "UTC"; Foundation would say "GMT").
    public let zoneName: String
    public let timeZone: TimeZone

    let minutes: Set<Int>
    let hours: Set<Int>
    let months: Set<Int>
    /// Day of month: plain days, `L` (last day) and `nW` (nearest weekday).
    let days: Set<Int>
    let lastDay: Bool
    let nearestWeekdays: Set<Int>
    let dayWildcard: Bool
    /// Day of week (0 = Sunday): plain days, `nL` (last n of the month) and `n#k`.
    let weekdays: Set<Int>
    let lastWeekdays: Set<Int>
    let nthWeekdays: Set<NthWeekday>
    let weekdayWildcard: Bool

    struct NthWeekday: Hashable, Sendable {
        let weekday: Int
        let nth: Int
    }

    public enum Failure: Error, Equatable, LocalizedError {
        case fields
        case zone
        case invalidZone
        case pattern(String)
        case noFutureRuns

        public var errorDescription: String? {
            switch self {
            case .fields:
                "Cron must have five fields: minute hour day-of-month month weekday (no seconds, year, or macros)"
            case .zone:
                "Choose an IANA timezone such as America/New_York, Asia/Kolkata, or UTC"
            case .invalidZone:
                "Choose a valid IANA timezone such as America/New_York, Asia/Kolkata, or UTC"
            case let .pattern(detail):
                "Invalid cron expression: \(detail)"
            case .noFutureRuns:
                "This cron expression has no future runs. Choose dates that exist."
            }
        }
    }

    /// Parse as `normalizeCronSchedule` does: whitespace collapsed, five
    /// fields, a named zone (or UTC).
    public init(expression raw: String, timeZone rawZone: String) throws {
        let expression = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: { $0 == " " || $0 == "\t" || $0 == "\n" }).joined(separator: " ")
        let parts = expression.split(separator: " ").map(String.init)
        guard expression.count <= 256, parts.count == 5, !expression.contains("@") else { throw Failure.fields }
        let zoneName = rawZone.trimmingCharacters(in: .whitespacesAndNewlines)
        guard zoneName.count <= 128,
              zoneName == "UTC" || zoneName.range(of: #"^[A-Za-z][A-Za-z0-9_+-]*(?:/[A-Za-z0-9_+-]+)+$"#, options: .regularExpression) != nil
        else { throw Failure.zone }
        guard let zone = TimeZone(identifier: zoneName) else { throw Failure.invalidZone }
        self.expression = expression
        self.zoneName = zoneName
        self.timeZone = zone

        minutes = try Self.field(parts[0], name: "minute", range: 0...59)
        hours = try Self.field(parts[1], name: "hour", range: 0...23)
        months = try Self.field(parts[3], name: "month", range: 1...12, names: Self.monthNames, offset: 1)

        // Day of month
        var days = Set<Int>()
        var lastDay = false
        var nearest = Set<Int>()
        let dayField = parts[2]
        dayWildcard = dayField == "*" || dayField == "?"
        if !dayWildcard {
            for item in dayField.split(separator: ",", omittingEmptySubsequences: false).map(String.init) {
                if item.uppercased() == "L" { lastDay = true; continue }
                if item.uppercased().hasSuffix("W"), let day = Int(item.dropLast()), (1...31).contains(day) {
                    nearest.insert(day)
                    continue
                }
                days.formUnion(try Self.field(item, name: "day", range: 1...31))
            }
        }
        self.days = days
        self.lastDay = lastDay
        self.nearestWeekdays = nearest

        // Day of week
        var weekdays = Set<Int>()
        var lastWeekdays = Set<Int>()
        var nth = Set<NthWeekday>()
        let weekdayField = parts[4]
        weekdayWildcard = weekdayField == "*" || weekdayField == "?"
        if !weekdayWildcard {
            for item in weekdayField.split(separator: ",", omittingEmptySubsequences: false).map(String.init) {
                let upper = item.uppercased()
                if let hash = upper.firstIndex(of: "#") {
                    guard let day = Self.weekdayValue(String(upper[..<hash])),
                          let index = Int(upper[upper.index(after: hash)...]), (1...5).contains(index)
                    else { throw Failure.pattern("Invalid value for weekday: \(item)") }
                    nth.insert(NthWeekday(weekday: day, nth: index))
                    continue
                }
                if upper.count > 1, upper.hasSuffix("L") {
                    guard let day = Self.weekdayValue(String(upper.dropLast())) else {
                        throw Failure.pattern("Invalid value for weekday: \(item)")
                    }
                    lastWeekdays.insert(day)
                    continue
                }
                let values = try Self.field(item, name: "weekday", range: 0...7, names: Self.weekdayNames, offset: 0)
                weekdays.formUnion(values.map { $0 == 7 ? 0 : $0 })
            }
        }
        self.weekdays = weekdays
        self.lastWeekdays = lastWeekdays
        self.nthWeekdays = nth
    }

    /// `normalizeCronSchedule`: valid and with at least one future run.
    public static func normalized(_ schedule: RoutineSchedule, after: Date) throws -> RoutineSchedule {
        let cron = try CronExpression(expression: schedule.expression ?? "", timeZone: schedule.timeZone ?? "")
        guard !cron.nextRuns(after: after, count: 1).isEmpty else { throw Failure.noFutureRuns }
        return .cron(expression: cron.expression, timeZone: cron.zoneName)
    }

    /// Strictly-future instants, in order. Empty when the dates never exist.
    public func nextRuns(after: Date, count: Int) -> [Date] {
        guard count > 0 else { return [] }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        var runs: [Date] = []
        var day = calendar.startOfDay(for: after)
        let sortedHours = hours.sorted()
        let sortedMinutes = minutes.sorted()
        // Every pattern that can happen happens within eight years (29 February).
        for _ in 0..<(366 * 8 + 2) {
            let parts = calendar.dateComponents([.year, .month, .day], from: day)
            if let year = parts.year, let month = parts.month, let dayOfMonth = parts.day,
               matches(year: year, month: month, day: dayOfMonth, calendar: calendar) {
                for hour in sortedHours {
                    for minute in sortedMinutes {
                        var wall = DateComponents()
                        wall.year = year; wall.month = month; wall.day = dayOfMonth
                        wall.hour = hour; wall.minute = minute
                        guard let at = calendar.date(from: wall) else { continue }
                        // A missing clock time moves through the gap; a
                        // repeated one runs once.
                        if at > (runs.last ?? after) {
                            runs.append(at)
                            if runs.count == count { return runs }
                        }
                    }
                }
            }
            guard let next = calendar.date(byAdding: .day, value: 1, to: day) else { break }
            day = next
        }
        return runs
    }

    func matches(year: Int, month: Int, day: Int, calendar: Calendar) -> Bool {
        guard months.contains(month) else { return false }
        var first = DateComponents()
        first.year = year; first.month = month; first.day = 1
        guard let firstOfMonth = calendar.date(from: first),
              let length = calendar.range(of: .day, in: .month, for: firstOfMonth)?.count
        else { return false }
        let firstWeekday = calendar.component(.weekday, from: firstOfMonth) - 1
        let weekday = (firstWeekday + day - 1) % 7

        let dayMatch: Bool = {
            if dayWildcard { return true }
            if days.contains(day) { return true }
            if lastDay && day == length { return true }
            for target in nearestWeekdays where Self.nearestWeekday(to: target, length: length, firstWeekday: firstWeekday) == day {
                return true
            }
            return false
        }()
        let weekdayMatch: Bool = {
            if weekdayWildcard { return true }
            if weekdays.contains(weekday) { return true }
            if lastWeekdays.contains(weekday) && day + 7 > length { return true }
            if nthWeekdays.contains(NthWeekday(weekday: weekday, nth: (day - 1) / 7 + 1)) { return true }
            return false
        }()
        // Both restricted: either may match (croner's default, Vixie cron).
        if !dayWildcard && !weekdayWildcard { return dayMatch || weekdayMatch }
        return dayMatch && weekdayMatch
    }

    static func nearestWeekday(to target: Int, length: Int, firstWeekday: Int) -> Int? {
        guard target <= length else { return nil }
        let weekday = (firstWeekday + target - 1) % 7
        switch weekday {
        case 6: return target == 1 ? 3 : target - 1
        case 0: return target == length ? target - 2 : target + 1
        default: return target
        }
    }

    // MARK: Fields

    static let monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
    static let weekdayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

    static func weekdayValue(_ text: String) -> Int? {
        if let index = weekdayNames.firstIndex(of: text.uppercased()) { return index }
        guard let value = Int(text), (0...7).contains(value) else { return nil }
        return value == 7 ? 0 : value
    }

    /// One comma list: `*`, `?`, values, names, `a-b`, `*/n`, `a-b/n`.
    static func field(
        _ text: String, name: String, range: ClosedRange<Int>, names: [String] = [], offset: Int = 0
    ) throws -> Set<Int> {
        func value(_ token: String) throws -> Int {
            let upper = token.uppercased()
            if let index = names.firstIndex(of: upper) { return index + offset }
            guard !token.isEmpty, token.allSatisfy(\.isNumber), let number = Int(token), range.contains(number) else {
                throw Failure.pattern("Invalid value for \(name): \(token)")
            }
            return number
        }
        var out = Set<Int>()
        for item in text.split(separator: ",", omittingEmptySubsequences: false).map(String.init) {
            guard !item.isEmpty else { throw Failure.pattern("Invalid value for \(name): \(text)") }
            var base = item
            var step = 1
            if let slash = item.firstIndex(of: "/") {
                base = String(item[..<slash])
                let stepText = String(item[item.index(after: slash)...])
                guard let parsed = Int(stepText), parsed > 0 else {
                    throw Failure.pattern("Invalid step for \(name): \(item)")
                }
                guard base == "*" || base.contains("-") else {
                    throw Failure.pattern("Syntax error, stepping with numeric prefix ('\(item)') is not allowed. Use wildcard (*/step) or range (min-max/step) instead.")
                }
                step = parsed
            }
            let lower: Int
            let upper: Int
            if base == "*" || base == "?" {
                lower = range.lowerBound
                upper = range.upperBound
            } else if let dash = base.firstIndex(of: "-") {
                lower = try value(String(base[..<dash]))
                upper = try value(String(base[base.index(after: dash)...]))
                guard lower <= upper else { throw Failure.pattern("Invalid range for \(name): \(item)") }
            } else {
                let single = try value(base)
                lower = single
                upper = single
            }
            out.formUnion(stride(from: lower, through: upper, by: step))
        }
        return out
    }
}

// MARK: - The desktop's cron editor (cron-editor.ts)

/// Monthly, Yearly or a raw expression.
public enum RoutineCronChoice: String, CaseIterable, Hashable, Sendable {
    case monthly, yearly, cron
}

/// `CronDraft`: what the Monthly / Yearly / Custom fields hold.
public struct RoutineCronDraft: Hashable, Sendable {
    public var expression: String
    public var timeZone: String
    /// "1"..."31" or "L".
    public var day: String
    /// "1"..."12".
    public var month: String
    /// "HH:mm".
    public var time: String

    public init(expression: String, timeZone: String, day: String, month: String, time: String) {
        self.expression = expression
        self.timeZone = timeZone
        self.day = day
        self.month = month
        self.time = time
    }
}

public enum RoutineCronEditor {
    struct Preset: Equatable {
        let day: String
        let month: String
        let time: String
    }

    /// A Monthly or Yearly expression: "M H D|L *|MONTH *".
    static func presetParts(_ expression: String) -> Preset? {
        let parts = expression.trimmingCharacters(in: .whitespaces).split(whereSeparator: \.isWhitespace).map(String.init)
        guard parts.count == 5 else { return nil }
        let (minute, hour, day, month, weekday) = (parts[0], parts[1], parts[2], parts[3], parts[4])
        func number(_ text: String, _ range: ClosedRange<Int>) -> Int? {
            guard !text.isEmpty, text.allSatisfy(\.isNumber), let value = Int(text), range.contains(value) else { return nil }
            return value
        }
        guard let m = number(minute, 0...59), let h = number(hour, 0...23),
              day == "L" || number(day, 1...31) != nil,
              month == "*" || number(month, 1...12) != nil,
              weekday == "*"
        else { return nil }
        return Preset(
            day: day == "L" ? day : String(number(day, 1...31)!),
            month: month,
            time: String(format: "%02d:%02d", h, m)
        )
    }

    public static func choice(for schedule: RoutineSchedule) -> RoutineCronChoice {
        guard let preset = presetParts(schedule.expression ?? "") else { return .cron }
        return preset.month == "*" ? .monthly : .yearly
    }

    /// `cronDraftFor`: an existing schedule's fields, or a new one from `at`
    /// read in this device's zone.
    public static func draft(for schedule: RoutineSchedule?, at: Date, localZone: TimeZone = .current) -> RoutineCronDraft {
        let zoneName = schedule?.timeZone ?? localZone.identifier
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: zoneName) ?? TimeZone(identifier: "UTC")!
        let parts = calendar.dateComponents([.month, .day, .hour, .minute], from: at)
        let preset = schedule.flatMap { presetParts($0.expression ?? "") }
        let time = preset?.time ?? String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
        let day = preset?.day ?? String(parts.day ?? 1)
        let minute = Int(time.suffix(2)) ?? 0
        let hour = Int(time.prefix(2)) ?? 0
        return RoutineCronDraft(
            expression: schedule?.expression ?? "\(minute) \(hour) \(day) * *",
            timeZone: zoneName,
            day: day,
            month: preset.flatMap { $0.month == "*" ? nil : String(Int($0.month) ?? 1) } ?? String(parts.month ?? 1),
            time: time
        )
    }

    public struct Value: Equatable, Sendable {
        public var schedule: RoutineSchedule?
        public var runs: [Date]
        public var error: String
    }

    /// `cronEditorValue`: the schedule to save, its next three runs, or the
    /// error to show. `unchanged` keeps an untouched expression byte for byte.
    public static func value(
        choice: RoutineCronChoice, draft: RoutineCronDraft, after: Date, unchanged: RoutineSchedule? = nil
    ) -> Value {
        do {
            if choice != .cron, draft.time.range(of: #"^\d{2}:\d{2}$"#, options: .regularExpression) == nil {
                throw RoutineScheduleError("Choose a time for this routine.")
            }
            let hour = Int(draft.time.prefix(2)) ?? 0
            let minute = Int(draft.time.suffix(2)) ?? 0
            let proposed = unchanged ?? .cron(
                expression: choice == .cron
                    ? draft.expression
                    : "\(minute) \(hour) \(draft.day) \(choice == .yearly ? draft.month : "*") *",
                timeZone: draft.timeZone
            )
            let normalized = try CronExpression.normalized(proposed, after: after)
            let cron = try CronExpression(expression: normalized.expression ?? "", timeZone: normalized.timeZone ?? "")
            return Value(schedule: unchanged ?? normalized, runs: cron.nextRuns(after: after, count: 3), error: "")
        } catch {
            return Value(schedule: nil, runs: [], error: error.localizedDescription)
        }
    }
}

/// A validation message the editor shows as is.
public struct RoutineScheduleError: Error, Equatable, LocalizedError {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}
