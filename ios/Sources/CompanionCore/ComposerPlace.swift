// The desktop composer's two policy chips (ApprovalModeSelector.tsx,
// PlaceChip.tsx and src/lib/place.ts): how much a bot may do on its own in
// this conversation, and where its hands land. The iPad's desktop composer
// shows both and writes them through the task route, as the desktop does
// (`updateTask` with `approvalMode` or `surface`).
import Foundation

public enum ApprovalLevel: String, CaseIterable, Sendable {
    case ask, edits, auto, full, custom

    /// shared/approval-mode.ts `approvalModeFor`: the saved mode, else the
    /// legacy autoApprove mirror, else Ask.
    public static func of(approvalMode: String?, autoApprove: Bool?) -> ApprovalLevel {
        if let approvalMode, let level = ApprovalLevel(rawValue: approvalMode) { return level }
        return autoApprove == true ? .auto : .ask
    }

    /// What the composer menu offers: the three a remote session may pick
    /// (Full asks for a confirmation and Custom is desktop only).
    public static let offered: [ApprovalLevel] = [.ask, .edits, .auto]
}

public enum WorkPlace: String, CaseIterable, Sendable {
    case cloud, vm, local, browser

    /// The places the composer lists, in the desktop's order.
    public static let offered: [WorkPlace] = [.cloud, .vm, .local]

    /// `effectivePlace`: the conversation's pin wins over the bot's Works on,
    /// except Off. Returns the raw value ("auto", "off", or a place).
    public static func effective(botComputer: String?, taskSurface: String?) -> String {
        if botComputer == "off" { return "off" }
        return taskSurface ?? botComputer ?? "auto"
    }
}

extension CompanionClient {
    /// `PATCH /api/bots/:id/tasks/:threadId {approvalMode}`.
    public func updateApprovalMode(botId: String, threadId: String, mode: ApprovalLevel) async throws -> Bot {
        try await send(try updateTaskRequest(botId: botId, threadId: threadId, body: ["approvalMode": mode.rawValue]), as: BotResponse.self).bot
    }

    /// `PATCH /api/bots/:id/tasks/:threadId {surface}`; nil follows the bot.
    public func updateSurface(botId: String, threadId: String, place: WorkPlace?) async throws -> Bot {
        let value: Any = place?.rawValue ?? NSNull()
        return try await send(try updateTaskRequest(botId: botId, threadId: threadId, body: ["surface": value]), as: BotResponse.self).bot
    }

    func updateTaskRequest(botId: String, threadId: String, body: [String: Any]) throws -> URLRequest {
        guard Self.validRouteID(botId), Self.validRouteID(threadId) else { throw APIError.badURL }
        return try makeRequest("PATCH", "/api/bots/\(botId)/tasks/\(threadId)", body: body)
    }
}
