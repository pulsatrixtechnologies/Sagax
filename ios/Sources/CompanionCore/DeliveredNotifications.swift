import Foundation

/// Which of the banners already in Notification Center to withdraw once the
/// person has read their conversation, here or on another device. A banner
/// for a bot conversation that is no longer unread and no longer waiting on
/// the person is settled; rooms and direct messages are left alone, and a
/// banner that just arrived is kept so a snapshot older than it cannot clear
/// it.
public enum DeliveredNotifications {
    public struct Delivered: Equatable, Sendable {
        public var id: String
        public var botId: String?
        public var threadId: String?
        public var date: Date
        /// The approval or question it asks, when it asks one.
        public var requestId: String?

        public init(id: String, botId: String?, threadId: String?, date: Date, requestId: String? = nil) {
            self.id = id
            self.botId = botId
            self.threadId = threadId
            self.date = date
            self.requestId = requestId.flatMap { $0.isEmpty ? nil : $0 }
        }
    }

    /// The banners of one approval or question, once it is settled: that
    /// request's only, never the other asks of the same conversation.
    public static func forRequest(_ delivered: [Delivered], threadId: String?, requestId: String?) -> [String] {
        guard let requestId, !requestId.isEmpty else { return [] }
        return delivered.filter { item in
            item.requestId == requestId && (threadId == nil || item.threadId == nil || item.threadId == threadId)
        }.map(\.id)
    }

    /// A banner younger than this is never withdrawn by a recount.
    public static let grace: TimeInterval = 10

    /// The banners for one conversation, after a "read" push said it was
    /// read on another device.
    public static func forThread(_ delivered: [Delivered], threadId: String) -> [String] {
        delivered.filter { $0.threadId == threadId }.map(\.id)
    }

    /// The banners whose bot conversation the person has settled.
    /// An ask (a banner with a request) still open (`openRequestIds`, the
    /// cards the app knows are pending) stays whatever its conversation's
    /// read state: reading a conversation is not answering it.
    public static func settled(_ delivered: [Delivered], bots: [Bot], openRequestIds: Set<String> = [], now: Date = Date()) -> [String] {
        let byId = Dictionary(bots.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return delivered.compactMap { item in
            if let requestId = item.requestId, openRequestIds.contains(requestId) { return nil }
            guard now.timeIntervalSince(item.date) >= grace,
                  let botId = item.botId, let threadId = item.threadId,
                  let task = byId[botId]?.tasks?.first(where: { $0.threadId == threadId })
            else { return nil }
            let open = task.unread == true || task.activity == "waiting-on-you"
            return open ? nil : item.id
        }
    }
}
