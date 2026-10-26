// Settings > Bot Computer (#1001, src/lib/computer-working-bots.ts): the bots
// working on the computer right now, so a person can stop one and let a
// held-back Update through (the server's 409 computer_busy). The list is
// GET /api/computer/working-bots; the stop is the ordinary task stop
// (POST /api/bots/:id/interrupt with the thread), the chat's Stop.
import Foundation

public struct WorkingBot: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var threadId: String

    public init(id: String, name: String, threadId: String) {
        self.id = id
        self.name = name
        self.threadId = threadId
    }
}

public enum ComputerWorkingBots {
    /// How often the list is asked again while Update is offered.
    public static let pollSeconds: Double = 3

    /// Decodes `{ bots }`, skipping a row it cannot read; nil bots is none.
    public static func decode(_ data: Data) -> [WorkingBot] {
        struct Answer: Decodable {
            var bots: [Lossy]?
            struct Lossy: Decodable {
                var bot: WorkingBot?
                init(from decoder: Decoder) throws { bot = try? WorkingBot(from: decoder) }
            }
        }
        let answer = try? JSONDecoder().decode(Answer.self, from: data)
        return (answer?.bots ?? []).compactMap(\.bot)
    }
}

public extension CompanionClient {
    func workingBots() async throws -> [WorkingBot] {
        let (data, response) = try await perform(makeRequest("GET", "/api/computer/working-bots"))
        try Self.check(response, data)
        return ComputerWorkingBots.decode(data)
    }

    /// Stop one bot's current task on the computer (a member stops only
    /// their own bot's thread: the route's own authorization).
    func stopWorkingBot(_ bot: WorkingBot) async throws {
        try await interrupt(botId: bot.id, threadId: bot.threadId)
    }
}
