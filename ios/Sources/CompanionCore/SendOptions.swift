// Per-send options the desktop composer sets beside the text.
import Foundation

public struct SendOptions: Hashable, Sendable {
    /// Quote this message (`replyToId`): a flat reference for the inline
    /// quote, unrelated to branch ancestry.
    public var replyToId: String?
    /// Bots only: what the send does while the bot is working. Nil leaves
    /// the server default (steer); `.auto` lets the bot route it.
    public var busyMode: BusySendMode?
    /// Rooms only: "goal" runs the line as a bounded room goal (`/goal`).
    public var goal: Bool
    /// Bots only: the page open over the conversation (`dataContext.page`,
    /// shared/data-context.ts withPageContext). The server keeps it only for
    /// the sender's own page of that bot.
    public var page: PageContextRef?

    public init(replyToId: String? = nil, busyMode: BusySendMode? = nil, goal: Bool = false, page: PageContextRef? = nil) {
        self.replyToId = replyToId
        self.busyMode = busyMode
        self.goal = goal
        self.page = page
    }

    /// Adds the fields the destination's route reads, and nothing else:
    /// `busyMode` belongs to the bot route, `mode` to the room route.
    func apply(to body: inout [String: Any], destination: MessageDestination) {
        if let replyToId, !replyToId.isEmpty { body["replyToId"] = replyToId }
        switch destination {
        case .bot:
            // auto travels as its own field: an older server ignores it and
            // joins the running turn, where an unknown busyMode would be a 400
            if busyMode == .auto { body["routeWhileBusy"] = true }
            else if let busyMode { body["busyMode"] = busyMode.rawValue }
            if let page, page.isDrawable { body["dataContext"] = ["page": page.body] }
        case .room:
            if goal { body["mode"] = "goal" }
        }
    }
}
