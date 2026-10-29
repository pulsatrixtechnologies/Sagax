import Foundation

/// #1329 (2026-10-29): a "do not finish until" check's row, as the server
/// writes it in `tool.finishUntil` (shared/finish-until-line.ts): relaunch
/// x/N while the condition is not met, met, blocked, the bound reached, or
/// stopped. The chat draws it in the reader's language; `tool.name` keeps
/// the English words for older apps.
public struct FinishUntilLine: Codable, Hashable, Sendable {
    /// Same values as the server: relaunch, met, blocked, limit, stopped.
    public var status: String
    public var condition: String
    public var round: Int?
    public var max: Int?
    public var detail: String?

    /// Relaunches Sagax starts on its own when the bot has no bound of its own.
    public static let defaultRounds = 5
    /// The highest bound the server accepts.
    public static let maxRounds = 50

    public init(status: String, condition: String, round: Int? = nil, max: Int? = nil, detail: String? = nil) {
        self.status = status
        self.condition = condition
        self.round = round
        self.max = max
        self.detail = detail
    }

    /// The bound in force for a bot: its own, else the default, in range.
    public static func rounds(_ value: Int?) -> Int {
        guard let value else { return defaultRounds }
        return Swift.min(maxRounds, Swift.max(1, value))
    }
}
