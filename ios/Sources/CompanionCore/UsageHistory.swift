// Usage (matrix ST10): what each bot spent, summed from its threads as the
// desktop's UsageSection.tsx does (nothing fetched), and the History card
// (UsageHistory.tsx): GET /api/usage?from=&to=&groupBy= over a period, and
// the CSV of every turn (GET /api/usage.csv). History is admin scope on a
// server; the owner's sidecar passes GET /api/usage.
import Foundation

// MARK: - By bot

public struct BotUsageRow: Hashable, Sendable, Identifiable {
    public var bot: Bot
    public var usage: BotUsageTotal
    public var id: String { bot.id }
}

public enum UsageByBot {
    /// Visible bots with a turn, money first, then volume.
    public static func rows(_ bots: [Bot]) -> [BotUsageRow] {
        bots.filter { $0.hidden != true }
            .map { BotUsageRow(bot: $0, usage: BotUsageTotal.of($0)) }
            .filter { $0.usage.turns > 0 }
            .sorted { a, b in
                let costA = a.usage.hasCost ? a.usage.costUsd ?? -.infinity : -.infinity
                let costB = b.usage.hasCost ? b.usage.costUsd ?? -.infinity : -.infinity
                if costA != costB { return costA > costB }
                return a.usage.headlineTokens > b.usage.headlineTokens
            }
    }

    /// The "All bots" line.
    public static func total(_ rows: [BotUsageRow]) -> BotUsageTotal {
        // Each row's own cache split is already folded; re-sum the totals.
        var out = BotUsageTotal()
        var cacheUnknown = false
        for row in rows {
            out.input += row.usage.input
            out.output += row.usage.output
            out.turns += row.usage.turns
            if let cached = row.usage.cachedInput { out.cachedInput = (out.cachedInput ?? 0) + cached }
            if let cost = row.usage.costUsd, cost.isFinite { out.costUsd = (out.costUsd ?? 0) + cost }
            if row.usage.input > 0, row.usage.cachedInput == nil { cacheUnknown = true }
        }
        if cacheUnknown { out.cachedInput = nil }
        return out
    }
}

// MARK: - History

public enum UsagePeriod: String, CaseIterable, Hashable, Sendable {
    case month, lastMonth, days30

    /// The period's first and last day, UTC, both inclusive (YYYY-MM-DD).
    public func range(now: Date = Date()) -> (from: String, to: String) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let today = calendar.startOfDay(for: now)
        let firstOfMonth = calendar.date(from: calendar.dateComponents([.year, .month], from: today))!
        switch self {
        case .month:
            return (Self.day(firstOfMonth, calendar), Self.day(today, calendar))
        case .lastMonth:
            let start = calendar.date(byAdding: .month, value: -1, to: firstOfMonth)!
            let end = calendar.date(byAdding: .day, value: -1, to: firstOfMonth)!
            return (Self.day(start, calendar), Self.day(end, calendar))
        case .days30:
            return (Self.day(calendar.date(byAdding: .day, value: -29, to: today)!, calendar), Self.day(today, calendar))
        }
    }

    private static func day(_ date: Date, _ calendar: Calendar) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

public enum UsageGroupBy: String, CaseIterable, Hashable, Sendable {
    case bot, model, user, day, engine, routine
}

public struct UsageGroup: Decodable, Hashable, Sendable, Identifiable {
    public var key: String
    public var label: String
    public var turns: Int
    public var input: Int
    public var output: Int
    public var cachedInput: Int
    public var costUsd: Double?
    public var estimatedUsd: Double?
    public var unpriced: Int
    public var billableUsd: Double?

    public var id: String { key }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = (try? c.decodeIfPresent(String.self, forKey: .key)) ?? ""
        label = (try? c.decodeIfPresent(String.self, forKey: .label)) ?? key
        turns = (try? c.decodeIfPresent(Int.self, forKey: .turns)) ?? 0
        input = (try? c.decodeIfPresent(Int.self, forKey: .input)) ?? 0
        output = (try? c.decodeIfPresent(Int.self, forKey: .output)) ?? 0
        cachedInput = (try? c.decodeIfPresent(Int.self, forKey: .cachedInput)) ?? 0
        costUsd = try? c.decodeIfPresent(Double.self, forKey: .costUsd)
        estimatedUsd = try? c.decodeIfPresent(Double.self, forKey: .estimatedUsd)
        unpriced = (try? c.decodeIfPresent(Int.self, forKey: .unpriced)) ?? 0
        billableUsd = try? c.decodeIfPresent(Double.self, forKey: .billableUsd)
    }

    private enum CodingKeys: String, CodingKey { case key, label, turns, input, output, cachedInput, costUsd, estimatedUsd, unpriced, billableUsd }

    public var tokens: Int { input + output }

    /// The relabels of UsageHistory.tsx: who started the turn, routine or not.
    public enum Label: Hashable, Sendable {
        case text(String)
        case owner, botToBot, notRoutine
        case routine(String)
    }

    public var displayLabel: Label {
        if key == "owner" { return .owner }
        if key == "bot" { return .botToBot }
        if key == "manual" { return .notRoutine }
        if key.hasPrefix("routine:") { return .routine(label) }
        return .text(label)
    }

    /// The cost cell: "~" when part of it is estimated, "*" when some turns
    /// had no price, "—" with no cost.
    public var costText: String {
        guard let cost = costUsd, cost.isFinite else { return "—" }
        let estimated = (estimatedUsd ?? 0) > 0 ? "~" : ""
        let unpricedMark = unpriced > 0 ? "*" : ""
        return "\(estimated)\(BotUsageTotal.formatUsd(cost))\(unpricedMark)"
    }
}

public struct UsageHistory: Decodable, Hashable, Sendable {
    public var groupBy: String?
    public var groups: [UsageGroup]
    public var total: UsageGroup?
    public var billingCurrency: String?

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        groupBy = try? c.decodeIfPresent(String.self, forKey: .groupBy)
        groups = (try? c.decodeIfPresent([UsageGroup].self, forKey: .groups)) ?? []
        total = try? c.decodeIfPresent(UsageGroup.self, forKey: .total)
        struct Billing: Decodable { var currency: String? }
        let billing: Billing? = (try? c.decodeIfPresent(Billing.self, forKey: .billing)) ?? nil
        billingCurrency = billing.map { $0.currency ?? "USD" }
    }

    private enum CodingKeys: String, CodingKey { case groupBy, groups, total, billing }

    /// A "Billable" column when the installation sets sell prices.
    public var hasBilling: Bool { billingCurrency != nil }
}

public extension CompanionClient {
    /// `GET /api/usage?from=&to=&groupBy=`.
    func usageHistory(period: UsagePeriod, groupBy: UsageGroupBy, now: Date = Date()) async throws -> UsageHistory {
        try await send(usageHistoryRequest(period: period, groupBy: groupBy, now: now), as: UsageHistory.self)
    }

    func usageHistoryRequest(period: UsagePeriod, groupBy: UsageGroupBy, now: Date = Date()) throws -> URLRequest {
        let range = period.range(now: now)
        return try makeRequest("GET", "/api/usage", query: [
            URLQueryItem(name: "from", value: range.from), URLQueryItem(name: "to", value: range.to), URLQueryItem(name: "groupBy", value: groupBy.rawValue),
        ])
    }

    /// `GET /api/usage.csv?from=&to=`: one line per turn, and its file name.
    func usageCSV(period: UsagePeriod, now: Date = Date()) async throws -> (data: Data, fileName: String) {
        let range = period.range(now: now)
        let request = try makeRequest("GET", "/api/usage.csv", query: [URLQueryItem(name: "from", value: range.from), URLQueryItem(name: "to", value: range.to)])
        let (data, response) = try await perform(request)
        try Self.check(response, data)
        return (data, "usage-\(range.from)-\(range.to).csv")
    }
}
