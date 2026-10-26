import Foundation

// The bot creation wizard (shared/bot-wizard.ts, 2026-10-26): the same
// draft as the desktop, kept by the server (`/api/bot-wizard`), so a draft
// started on one device resumes on the other, in either mode. The bot is a
// real bot from the first step; its fields change through the bot's own
// routes, its rules through `/api/custom-rules` and its routines through
// `/api/routines` when the person finishes.

public enum WizardStep: String, Codable, CaseIterable, Hashable, Sendable {
    case identity, soul, rules, tools, routines, recap

    public var index: Int { Self.allCases.firstIndex(of: self) ?? 0 }
    public var next: WizardStep? { index + 1 < Self.allCases.count ? Self.allCases[index + 1] : nil }
    public var previous: WizardStep? { index > 0 ? Self.allCases[index - 1] : nil }
}

public enum WizardMode: String, Codable, CaseIterable, Hashable, Sendable {
    case guided, manual
}

public struct WizardAnswers: Codable, Hashable, Sendable {
    public var tone: String
    public var language: String
    public var does: String
    public var never: String
    public var speech: String

    public init(tone: String = "", language: String = "", does: String = "", never: String = "", speech: String = "") {
        self.tone = tone
        self.language = language
        self.does = does
        self.never = never
        self.speech = speech
    }

    public enum Key: String, CaseIterable, Sendable { case tone, language, does, never, speech }

    public subscript(key: Key) -> String {
        get {
            switch key {
            case .tone: tone
            case .language: language
            case .does: does
            case .never: never
            case .speech: speech
            }
        }
        set {
            switch key {
            case .tone: tone = newValue
            case .language: language = newValue
            case .does: does = newValue
            case .never: never = newValue
            case .speech: speech = newValue
            }
        }
    }
}

/// The server's draft (`GET /api/bot-wizard/:botId`).
public struct WizardDraft: Codable, Hashable, Sendable {
    public var botId: String
    public var botName: String?
    public var origin: String
    public var mode: WizardMode
    public var step: WizardStep
    public var visited: [WizardStep]
    public var skipped: [WizardStep]
    public var roleId: String
    public var answers: WizardAnswers
    /// Suggestion id to the custom rule's id ("pending" while the Primary Bot asked for it).
    public var rules: [String: String]
    public var routines: [String]
    public var guidedBotId: String?
    public var guidedThreadId: String?
    public var testThreadId: String?
    public var status: String
    public var updatedAt: Double

    public var isOpen: Bool { status == "draft" }
}

public struct WizardRuleSuggestion: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    /// allow, ask or deny.
    public var behavior: String
    public var when: String
}

public struct WizardRoutineSuggestion: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var prompt: String
    public var time: String
    public var weekdays: [Int]
}

public struct WizardSuggestions: Codable, Hashable, Sendable {
    public var answers: WizardAnswers?
    public var rules: [WizardRuleSuggestion]
    public var routines: [WizardRoutineSuggestion]
    /// apps, mcp, computer, browser: only what the role uses.
    public var tools: [String]
    public var apps: [String]

    public static let empty = WizardSuggestions(answers: nil, rules: [], routines: [], tools: ["apps", "mcp", "computer", "browser"], apps: [])
}

/// The six roles the wizard starts from (src/lib/bot-roles.ts ids; the
/// server's kits carry their suggestions).
public enum WizardRole: String, CaseIterable, Hashable, Sendable {
    case assistant, inbox, research, coder, community, ops

    /// The role's title and one sentence (BOT_ROLES), sent to the bot when
    /// it is still empty.
    public var defaults: (title: String, description: String) {
        switch self {
        case .assistant: ("General assistant", "Answers questions, drafts text, and takes on whatever you hand it.")
        case .inbox: ("Email triage", "Reads your inbox, flags what needs you, and drafts replies for approval.")
        case .research: ("Researcher", "Digs through the web and your files, and comes back with a sourced brief.")
        case .coder: ("Coding partner", "Works inside a project folder: reads, edits, runs tests, explains changes.")
        case .community: ("Community monitor", "Watches Discord, Slack, or forums and reports what matters, on a schedule.")
        case .ops: ("Operations", "Keeps calendars, tasks, and follow-ups moving; nudges you before things slip.")
        }
    }
}

/// `PATCH /api/bot-wizard/:botId`: only the fields set are sent, so the
/// mode switch changes the mode alone and nothing the other mode filled.
public struct WizardPatch: Encodable, Equatable, Sendable {
    public var mode: WizardMode?
    public var step: WizardStep?
    public var skip: WizardStep?
    public var roleId: String?
    public var answers: [String: String]?
    /// A rule suggestion's id to its custom rule's id, or nil to forget it.
    public var rules: [String: String?]?
    public var routines: [String]?
    public var guidedBotId: String?
    public var guidedThreadId: String?
    public var testThreadId: String?

    public init(mode: WizardMode? = nil, step: WizardStep? = nil, skip: WizardStep? = nil, roleId: String? = nil,
                answers: [String: String]? = nil, rules: [String: String?]? = nil, routines: [String]? = nil,
                guidedBotId: String? = nil, guidedThreadId: String? = nil, testThreadId: String? = nil) {
        self.mode = mode
        self.step = step
        self.skip = skip
        self.roleId = roleId
        self.answers = answers
        self.rules = rules
        self.routines = routines
        self.guidedBotId = guidedBotId
        self.guidedThreadId = guidedThreadId
        self.testThreadId = testThreadId
    }

    enum CodingKeys: String, CodingKey {
        case mode, step, skip, roleId, answers, rules, routines, guidedBotId, guidedThreadId, testThreadId
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(mode, forKey: .mode)
        try container.encodeIfPresent(step, forKey: .step)
        try container.encodeIfPresent(skip, forKey: .skip)
        try container.encodeIfPresent(roleId, forKey: .roleId)
        try container.encodeIfPresent(answers, forKey: .answers)
        if let rules {
            // a removed rule travels as JSON null
            var nested = container.nestedContainer(keyedBy: DynamicKey.self, forKey: .rules)
            for (id, value) in rules {
                let key = DynamicKey(stringValue: id)
                if let value { try nested.encode(value, forKey: key) } else { try nested.encodeNil(forKey: key) }
            }
        }
        try container.encodeIfPresent(routines, forKey: .routines)
        try container.encodeIfPresent(guidedBotId, forKey: .guidedBotId)
        try container.encodeIfPresent(guidedThreadId, forKey: .guidedThreadId)
        try container.encodeIfPresent(testThreadId, forKey: .testThreadId)
    }

    struct DynamicKey: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }
}

/// Pure helpers of the wizard, shared by the phone and the iPad.
public enum BotWizardRules {
    /// The guide: the person's Primary Bot, else their first other bot,
    /// never the one being made.
    public static func guide(bots: [Bot], draftBotId: String?) -> Bot? {
        let others = bots.filter { $0.hidden != true && $0.id != draftBotId }
        return others.first { $0.chiefOfStaff == true } ?? others.first
    }

    /// The first message of the guided conversation: the person asks their
    /// Primary Bot to run the wizard, naming the bot (shared `guidedKickoff`).
    public static func kickoff(botName: String, french: Bool) -> String {
        let name = botName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "?" : botName
        return french
            ? "Aide-moi à configurer mon nouveau bot \(name) avec l'assistant. Pose-moi les questions une à la fois (identité, soul, règles, outils et apps, routines) et remplis chaque étape en direct : les champs de \(name) avec sagax_settings (bot.name, bot.description, bot.persona, bot.approvalMode...), et les réponses, règles et routines de l'assistant avec bot.wizard. Commence par la première question."
            : "Help me set up my new bot \(name) with the wizard. Ask me the questions one at a time (identity, soul, rules, tools and apps, routines) and fill each step live: \(name)'s own fields with sagax_settings (bot.name, bot.description, bot.persona, bot.approvalMode...), and the wizard's answers, rules and routines with bot.wizard. Start with the first question."
    }

    /// "Try it": the test message (shared `tryItMessage`).
    public static func tryIt(french: Bool) -> String {
        french ? "Salut! En deux phrases, qui es-tu et que peux-tu faire pour moi?" : "Hi! In two sentences, who are you and what can you do for me?"
    }

    /// Rules the Primary Bot marked for the app to make.
    public static func pendingRules(_ draft: WizardDraft) -> [String] {
        draft.rules.filter { $0.value == "pending" }.map(\.key).sorted()
    }

    /// The draft after a mode switch, as the server keeps it: the mode only.
    public static func switching(_ draft: WizardDraft, to mode: WizardMode) -> WizardDraft {
        var next = draft
        next.mode = mode
        return next
    }

    /// A routine's schedule in words: "08:00, weekdays".
    public static func scheduleLabel(time: String, weekdays: [Int], dayNames: [String], weekdaysLabel: String, everyDay: String) -> String {
        let days = weekdays.sorted()
        if days.count == 7 { return "\(time), \(everyDay)" }
        if days == [1, 2, 3, 4, 5] { return "\(time), \(weekdaysLabel)" }
        return "\(time), " + days.compactMap { dayNames.indices.contains($0) ? dayNames[$0] : nil }.joined(separator: ", ")
    }
}

struct WizardDraftResponse: Decodable { var draft: WizardDraft }
struct WizardReadResponse: Decodable { var draft: WizardDraft; var suggestions: WizardSuggestions }
struct WizardDraftsResponse: Decodable { var drafts: [WizardDraft] }
public struct WizardSoul: Decodable, Sendable { public var soul: String; public var source: String }
struct WizardRuleResponse: Decodable { struct Rule: Decodable { var id: String }; var rule: Rule? }
struct WizardTaskResponse: Decodable {
    struct Task: Decodable { var threadId: String? }
    struct BotThread: Decodable { var threadId: String? }
    var task: Task?
    var bot: BotThread?
}
struct WizardStartBody: Encodable { var origin: String; var mode: WizardMode; var restart: Bool? }

public extension CompanionClient {
    private func wizardPath(_ botId: String, _ suffix: String = "") throws -> String {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return "/api/bot-wizard/\(botId)\(suffix)"
    }

    func wizardDrafts() async throws -> [WizardDraft] {
        try await send(try makeRequest("GET", "/api/bot-wizard"), as: WizardDraftsResponse.self).drafts
    }

    func wizardDraft(botId: String, language: String) async throws -> (WizardDraft, WizardSuggestions) {
        let read = try await send(try makeRequest("GET", try wizardPath(botId), query: [URLQueryItem(name: "language", value: language)]), as: WizardReadResponse.self)
        return (read.draft, read.suggestions)
    }

    func startWizard(botId: String, origin: String, mode: WizardMode, restart: Bool = false) async throws -> WizardDraft {
        try await send(try makeRequest("PUT", try wizardPath(botId), encodedBody: WizardStartBody(origin: origin, mode: mode, restart: restart ? true : nil)), as: WizardDraftResponse.self).draft
    }

    func patchWizard(botId: String, patch: WizardPatch) async throws -> WizardDraft {
        try await send(try makeRequest("PATCH", try wizardPath(botId), encodedBody: patch), as: WizardDraftResponse.self).draft
    }

    func writeWizardSoul(botId: String, language: String) async throws -> WizardSoul {
        try await send(try makeRequest("POST", try wizardPath(botId, "/soul"), body: ["language": language]), as: WizardSoul.self)
    }

    func finishWizard(botId: String) async throws -> WizardDraft {
        try await send(try makeRequest("POST", try wizardPath(botId, "/finish"), body: [:]), as: WizardDraftResponse.self).draft
    }

    func deleteWizard(botId: String) async throws {
        try await send(try makeRequest("DELETE", try wizardPath(botId)))
    }

    /// A ticked rule: the person's custom rule for this bot.
    func addWizardRule(botId: String, suggestion: WizardRuleSuggestion) async throws -> String? {
        try await send(try makeRequest("POST", "/api/custom-rules", body: ["when": suggestion.when, "behavior": suggestion.behavior, "botId": botId, "riskScope": [String]()]), as: WizardRuleResponse.self).rule?.id
    }

    func removeWizardRule(ruleId: String) async throws {
        guard Self.validRouteID(ruleId) else { throw APIError.badURL }
        try await send(try makeRequest("DELETE", "/api/custom-rules/\(ruleId)"))
    }

    /// A picked routine, made when the wizard finishes.
    func addWizardRoutine(botId: String, suggestion: WizardRoutineSuggestion) async throws {
        try await send(try makeRequest("POST", "/api/routines", body: [
            "name": suggestion.name, "prompt": suggestion.prompt, "botId": botId, "target": "bot", "enabled": true,
            "schedule": ["type": "daily", "time": suggestion.time, "weekdays": suggestion.weekdays],
        ]))
    }

    /// A conversation opened for the wizard (the guided one, Try it).
    func openWizardThread(botId: String, title: String) async throws -> String {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        let created = try await send(try makeRequest("POST", "/api/bots/\(botId)/tasks", body: ["title": title]), as: WizardTaskResponse.self)
        guard let threadId = created.task?.threadId ?? created.bot?.threadId else { throw APIError.transport("Could not open a conversation") }
        return threadId
    }

    /// Step 1's "Primary Bot": the owner's own route, one per person.
    func setWizardPrimary(botId: String, on: Bool) async throws -> Bot {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(try makeRequest(on ? "POST" : "DELETE", "/api/bots/\(botId)/primary"), as: BotResponse.self).bot
    }

    /// The wizard's bot, on the server's Auto defaults and suggested name,
    /// as New bot's quick creation makes one.
    func createWizardBot() async throws -> Bot {
        try await createBot()
    }
}
