import Foundation

/// A usage-limit switch row, as the server writes it in `tool.limitFailover`
/// (shared/limit-failover.ts). Desktop hides `switched` and `back` from the
/// chat (`isHiddenStatusActivity`, #1668); a `waiting` / `waitingRoutine`
/// stay so the person knows when the message comes back. Older threads
/// still carry these on `recovery:` rows; newer ones use a hidden `notice:`.
public struct LimitFailoverLine: Codable, Hashable, Sendable {
    /// Same values as the server: switched, back, waiting, waitingRoutine.
    public var kind: String
    public var from: String?
    public var to: String?
    public var engine: String?
    /// Epoch ms when the limited engine resets.
    public var resetsAt: Double?
    public var owner: Bool?
    /// "model" when the engine had no conversation model left (#1696).
    public var reason: String?

    public init(
        kind: String,
        from: String? = nil,
        to: String? = nil,
        engine: String? = nil,
        resetsAt: Double? = nil,
        owner: Bool? = nil,
        reason: String? = nil
    ) {
        self.kind = kind
        self.from = from
        self.to = to
        self.engine = engine
        self.resetsAt = resetsAt
        self.owner = owner
        self.reason = reason
    }
}
