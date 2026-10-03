// Per-send options the desktop composer sets beside the text.
import Foundation

public struct SendOptions: Hashable, Sendable {
    /// Quote this message (`replyToId`): a flat reference for the inline
    /// quote, unrelated to branch ancestry.
    public var replyToId: String?
    /// Bots only: what the send does while the bot is working. Nil leaves
    /// the server default (steer).
    public var busyMode: BusySendMode?
    /// Rooms only: "goal" runs the line as a bounded room goal (`/goal`).
    public var goal: Bool

    public init(replyToId: String? = nil, busyMode: BusySendMode? = nil, goal: Bool = false) {
        self.replyToId = replyToId
        self.busyMode = busyMode
        self.goal = goal
    }

    /// Adds the fields the destination's route reads, and nothing else:
    /// `busyMode` belongs to the bot route, `mode` to the room route.
    func apply(to body: inout [String: Any], destination: MessageDestination) {
        if let replyToId, !replyToId.isEmpty { body["replyToId"] = replyToId }
        switch destination {
        case .bot:
            if let busyMode { body["busyMode"] = busyMode.rawValue }
        case .room:
            if goal { body["mode"] = "goal" }
        }
    }
}
