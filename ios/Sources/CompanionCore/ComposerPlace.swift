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

    /// 2026-10-26 (one approval level, `approvalMode.*.desc`): what each
    /// level does, rules first. The bot's one approval setting: its rules
    /// (Allow automatically, Ask every time, Deny) decide first whatever the
    /// level, and the level only decides what no rule covers.
    public var detail: String {
        switch self {
        case .ask: "Asks you before each command, file change or tool call. Your rules come first: \"Allow automatically\" goes without a card, \"Deny\" refuses."
        case .edits: "File edits go without asking; other actions ask you. Your rules come first: \"Ask every time\" shows a card, \"Deny\" refuses."
        case .auto: "Uses the engine's automatic review to approve routine actions, and asks about deletions, bulk changes and messages sent on your behalf. Your rules come first: \"Ask every time\" always shows a card, \"Deny\" always refuses."
        case .full: "Runs commands and edits files without asking. Your rules still apply: \"Ask every time\" shows a card and \"Deny\" refuses, even here. Use only with bots you trust."
        case .custom: "Uses permissions defined in config.toml"
        }
    }
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

/// The model picker's short list (src/lib/custom-models.ts `suggestedModels`):
/// the current model, the default, then the catalogue order, five at most.
public enum ModelSuggestions {
    public static func suggested(_ options: [ModelOption], defaultId: String, currentId: String?, limit: Int = 5) -> [ModelOption] {
        var picked: [ModelOption] = []
        var seen = Set<String>()
        func add(_ option: ModelOption?) {
            guard let option, picked.count < limit, seen.insert(option.id).inserted else { return }
            picked.append(option)
        }
        add(currentId.flatMap { id in options.first { $0.id == id } })
        add(options.first { $0.id == defaultId })
        options.forEach(add)
        return picked
    }

    /// The search: a model whose label or id holds every word of the query.
    public static func filter(_ options: [ModelOption], query: String) -> [ModelOption] {
        let words = query.lowercased().split(whereSeparator: \.isWhitespace)
        guard !words.isEmpty else { return options }
        return options.filter { option in
            let haystack = "\(option.label) \(option.id)".lowercased()
            return words.allSatisfy { haystack.contains($0) }
        }
    }
}
