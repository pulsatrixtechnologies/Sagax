// Settings > Usage (#518, `UsageSection.tsx` and `usage-personal.ts`): the
// signed-in person's own usage only. Plan, then Cost (this month, its trend
// against the same days of last month, the last 30 days), then a folded
// breakdown by bot and by model. Every figure comes from `GET /api/me/usage`
// (#524: any signed-in member, their own turns only); a server older than
// that answers 404 and the page falls back to the admin's
// `GET /api/usage?mine=1`. Per-person tables, organization totals and
// budgets belong to Sagax Business.
import Foundation

/// The three periods the page asks for, inclusive UTC days (YYYY-MM-DD).
public struct PersonalUsagePeriods: Equatable, Sendable {
    public var month: (from: String, to: String)
    public var previous: (from: String, to: String)
    public var days30: (from: String, to: String)

    public init(now: Date = Date()) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let today = calendar.startOfDay(for: now)
        let parts = calendar.dateComponents([.year, .month, .day], from: today)
        let firstOfMonth = calendar.date(from: DateComponents(year: parts.year, month: parts.month, day: 1))!
        let firstOfPrevious = calendar.date(byAdding: .month, value: -1, to: firstOfMonth)!
        let lastOfPrevious = calendar.date(byAdding: .day, value: -1, to: firstOfMonth)!
        let lastDay = calendar.component(.day, from: lastOfPrevious)
        let sameDay = calendar.date(byAdding: .day, value: min(parts.day ?? 1, lastDay) - 1, to: firstOfPrevious)!
        month = (Self.day(firstOfMonth, calendar), Self.day(today, calendar))
        previous = (Self.day(firstOfPrevious, calendar), Self.day(sameDay, calendar))
        days30 = (Self.day(calendar.date(byAdding: .day, value: -29, to: today)!, calendar), Self.day(today, calendar))
    }

    public static func == (a: Self, b: Self) -> Bool {
        a.month == b.month && a.previous == b.previous && a.days30 == b.days30
    }

    static func day(_ date: Date, _ calendar: Calendar) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

/// The page's five reads.
public struct PersonalUsage: Hashable, Sendable {
    public var month: UsageHistory
    public var previous: UsageHistory
    public var days30: UsageHistory
    public var byBot: UsageHistory
    public var byModel: UsageHistory

    public init(month: UsageHistory, previous: UsageHistory, days30: UsageHistory, byBot: UsageHistory, byModel: UsageHistory) {
        self.month = month
        self.previous = previous
        self.days30 = days30
        self.byBot = byBot
        self.byModel = byModel
    }

    /// This month's cost, 0 when nothing is priced.
    public var cost: Double { PersonalUsageRules.cost(month) }

    /// Percent against the same days of last month; nil with nothing before.
    public var trend: Int? { PersonalUsageRules.trend(current: cost, previous: PersonalUsageRules.cost(previous)) }

    /// Nothing at all in this month or the last 30 days.
    public var isEmpty: Bool { (month.total?.turns ?? 0) == 0 && (days30.total?.turns ?? 0) == 0 }

    /// Part of this month's cost is estimated from public prices.
    public var estimated: Bool { (month.total?.estimatedUsd ?? 0) > 0 }
}

public enum PersonalUsageRules {
    public static func cost(_ summary: UsageHistory?) -> Double {
        guard let cost = summary?.total?.costUsd, cost.isFinite else { return 0 }
        return cost
    }

    /// `costTrend`: rounded percent change; nil when there was nothing before.
    public static func trend(current: Double, previous: Double) -> Int? {
        guard previous > 0 else { return nil }
        return Int((((current - previous) / previous) * 100).rounded())
    }

    /// One cost per day of `range`, oldest first; a day with no turn is 0.
    /// The ledger keys a day "day:YYYY-MM-DD".
    public static func dailyCosts(_ summary: UsageHistory?, range: (from: String, to: String)) -> [Double] {
        var byDay: [String: Double] = [:]
        for group in summary?.groups ?? [] {
            var key = group.key
            if key.hasPrefix("day:") { key.removeFirst(4) }
            byDay[String(key.prefix(10))] = group.costUsd ?? 0
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let format = DateFormatter()
        format.calendar = calendar
        format.timeZone = calendar.timeZone
        format.locale = Locale(identifier: "en_US_POSIX")
        format.dateFormat = "yyyy-MM-dd"
        guard var at = format.date(from: range.from), let end = format.date(from: range.to) else { return [] }
        var out: [Double] = []
        while at <= end {
            out.append(byDay[format.string(from: at)] ?? 0)
            at = calendar.date(byAdding: .day, value: 1, to: at)!
        }
        return out
    }

    /// `rankedGroups`: the most cost first, then the most turns.
    public static func ranked(_ summary: UsageHistory?) -> [UsageGroup] {
        (summary?.groups ?? []).sorted { a, b in
            let costA = a.costUsd ?? -1, costB = b.costUsd ?? -1
            if costA != costB { return costA > costB }
            return a.turns > b.turns
        }
    }
}

public extension CompanionClient {
    /// The page's five reads of `GET /api/me/usage`, or of
    /// `GET /api/usage?mine=1` when the server does not know the first (404).
    func personalUsage(now: Date = Date()) async throws -> PersonalUsage {
        do {
            return try await personalUsage(now: now, legacy: false)
        } catch let APIError.status(code, _) where code == 404 {
            return try await personalUsage(now: now, legacy: true)
        }
    }

    private func personalUsage(now: Date, legacy: Bool) async throws -> PersonalUsage {
        let periods = PersonalUsagePeriods(now: now)
        // the month first: a 404 there means an older server, before any other read
        let month = try await send(try personalUsageRequest(periods.month, groupBy: .day, legacy: legacy), as: UsageHistory.self)
        async let previous = send(try personalUsageRequest(periods.previous, groupBy: .day, legacy: legacy), as: UsageHistory.self)
        async let days30 = send(try personalUsageRequest(periods.days30, groupBy: .day, legacy: legacy), as: UsageHistory.self)
        async let byBot = send(try personalUsageRequest(periods.month, groupBy: .bot, legacy: legacy), as: UsageHistory.self)
        async let byModel = send(try personalUsageRequest(periods.month, groupBy: .model, legacy: legacy), as: UsageHistory.self)
        return try await PersonalUsage(month: month, previous: previous, days30: days30, byBot: byBot, byModel: byModel)
    }

    /// `GET /api/me/usage?from=&to=&groupBy=`; `legacy`: `GET /api/usage?mine=1&…`.
    func personalUsageRequest(_ range: (from: String, to: String), groupBy: UsageGroupBy, legacy: Bool = false) throws -> URLRequest {
        var query = [
            URLQueryItem(name: "from", value: range.from), URLQueryItem(name: "to", value: range.to),
            URLQueryItem(name: "groupBy", value: groupBy.rawValue),
        ]
        if legacy { query.insert(URLQueryItem(name: "mine", value: "1"), at: 0) }
        return try makeRequest("GET", legacy ? "/api/usage" : "/api/me/usage", query: query)
    }
}
