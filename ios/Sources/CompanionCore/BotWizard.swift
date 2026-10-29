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

/// 2026-10-27: Tools and apps is off the main path. "yes" when the person
/// said this bot uses apps or a computer (the step is then on the path);
/// absent or "later" keeps the defaults (Workspace on Auto, no MCP server,
/// apps connected later). The recap still opens the step at any time.
public enum WizardToolsChoice: String, Codable, CaseIterable, Hashable, Sendable {
    case later, yes
}

/// A suggested rule's effect (Off is no rule at all).
public enum WizardRuleEffect: String, Codable, CaseIterable, Hashable, Sendable {
    case allow, ask, deny
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
    /// Absent reads as "later" (shared `WizardDraft.tools`).
    public var tools: WizardToolsChoice?
    public var status: String
    public var updatedAt: Double

    public var isOpen: Bool { status == "draft" }

    /// The steps this draft walks through (shared `wizardPath`): Tools and
    /// apps only when the person said yes, or while they are on it.
    public var path: [WizardStep] {
        WizardStep.allCases.filter { $0 != .tools || tools == .yes || step == .tools }
    }

    /// The next step on the draft's own path (shared `nextStepFor`).
    public func nextStep(from start: WizardStep? = nil) -> WizardStep? {
        let from = start ?? step
        return WizardStep.allCases.dropFirst(from.index + 1).first { $0 != .tools || tools == .yes }
    }

    /// The previous step on the draft's own path (shared `previousStepFor`).
    public var previousStep: WizardStep? {
        WizardStep.allCases.prefix(step.index).reversed().first { $0 != .tools || tools == .yes }
    }
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
    case assistant, inbox, research, coder, community, ops, subscriptions

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
        case .subscriptions: ("Subscriptions", "Watches your free trials and subscriptions, flags the unused ones and price rises, and cancels the ones you say.")
        }
    }
}

/// `PATCH /api/bot-wizard/:botId`: only the fields set are sent, so the
/// mode switch changes the mode alone and nothing the other mode filled.
public struct WizardPatch: Encodable, Equatable, Sendable {
    public var tools: WizardToolsChoice?
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
                guidedBotId: String? = nil, guidedThreadId: String? = nil, testThreadId: String? = nil,
                tools: WizardToolsChoice? = nil) {
        self.tools = tools
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
        case tools, mode, step, skip, roleId, answers, rules, routines, guidedBotId, guidedThreadId, testThreadId
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(tools, forKey: .tools)
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
    /// The guide (desktop `guideBot`, 2026-10-27): the person's Bot designer
    /// when they have one, else their Primary Bot, else their first other
    /// bot, never the one being made. nil: choosing Guided creates the Bot
    /// designer.
    public static func guide(bots: [Bot], draftBotId: String?) -> Bot? {
        let others = bots.filter { $0.hidden != true && $0.id != draftBotId }
        return others.first { isDesigner($0.name) } ?? others.first { $0.chiefOfStaff == true } ?? others.first
    }

    private static let designerNames: Set<String> = ["bot designer", "concepteur de bots", "concepteur de bot"]

    /// A bot named Bot designer (or Concepteur de bots), whatever its case
    /// and spacing (desktop `isDesignerBot`).
    public static func isDesigner(_ name: String?) -> Bool {
        let normalized = (name ?? "").precomposedStringWithCompatibilityMapping
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
        return designerNames.contains(normalized)
    }

    /// The Bot designer's profile in the person's language (desktop
    /// `designerProfile`): an ordinary bot of their own, no admin step.
    public static func designerProfile(french: Bool) -> (name: String, title: String, description: String, soul: String) {
        if french {
            return (
                "Concepteur de bots",
                "Conçoit vos bots",
                "Configure un nouveau bot avec vous dans l'assistant de création : une question à la fois, chaque étape remplie en direct.",
                [
                    "Tu es le Concepteur de bots. Tu aides la personne avec qui tu parles à créer et régler ses propres bots dans l'assistant de création de Sagax.",
                    "",
                    "- Pose une question courte à la fois, dans la langue de la personne, dans l'ordre de l'assistant : identité (nom, rôle, description), soul (ton, langue, ce qu'il fait, ce qu'il ne fait jamais, sa façon de parler), règles, routines. Les outils et apps sont optionnels : propose-les une fois, et ouvre-les seulement si la personne le veut.",
                    "- Remplis chaque réponse tout de suite : les champs du nouveau bot avec sagax_settings (bot.name, bot.description, bot.persona, bot.approvalMode...), et les réponses, règles et routines de l'assistant avec bot.wizard. Lis d'abord les suggestions avec get et utilise leurs ids.",
                    "- Tout ce que tu règles est le bot de la personne, dans son propre environnement : ne demande jamais à un administrateur, n'ajoute aucune limite qu'elle n'a pas demandée.",
                    "- Dis en une ligne ce que tu as rempli, puis pose la question suivante. Quand tout est réglé, dis-lui de l'essayer depuis le récap et d'appuyer sur Terminer.",
                ].joined(separator: "\n")
            )
        }
        return (
            "Bot designer",
            "Designs your bots",
            "Sets up a new bot with you in the creation wizard: one question at a time, each step filled in live.",
            [
                "You are the Bot designer. You help the person you speak with create and set up their own bots in Sagax's bot creation wizard.",
                "",
                "- Ask one short question at a time, in the person's language, in the wizard's order: identity (name, role, description), soul (tone, language, what it does, what it never does, how it talks), rules, routines. Tools and apps are optional: offer them once, and only open them if the person wants.",
                "- Fill each answer in at once: the new bot's own fields with sagax_settings (bot.name, bot.description, bot.persona, bot.approvalMode...), and the wizard's answers, rules and routines with bot.wizard. Read the suggestions with get first and use their ids.",
                "- Everything you set is the person's own bot, in their own environment: never ask an administrator, never add a limit they did not ask for.",
                "- Say in one line what you filled in, then ask the next question. When everything is set, tell them to try it from the recap and press Finish.",
            ].joined(separator: "\n")
        )
    }

    /// Whether an engine can run the guide's turns (desktop: the first
    /// run's own test). nil or an empty list (not read yet, or an older
    /// computer) gives no verdict: the wizard never blocks on a guess.
    public static func engineReady(_ instances: [Instance]?) -> Bool {
        guard let instances, !instances.isEmpty else { return true }
        return instances.contains { $0.snapshot.isAvailable && ($0.access == "custom" || $0.snapshot.authenticated != false) }
    }

    /// The first message of the guided conversation: the person asks their
    /// Primary Bot to run the wizard, naming the bot (shared `guidedKickoff`).
    public static func kickoff(botName: String, french: Bool) -> String {
        let name = botName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "?" : botName.trimmingCharacters(in: .whitespacesAndNewlines)
        return french
            ? "Aide-moi à configurer mon nouveau bot \(name) avec l'assistant. Pose-moi les questions une à la fois (identité, soul, règles, routines ; outils et apps seulement si je dis que ce bot utilise des apps ou un ordinateur) et remplis chaque étape en direct : les champs de \(name) avec sagax_settings (bot.name, bot.description, bot.persona, bot.approvalMode...), et les réponses, règles, routines et le choix des outils de l'assistant avec bot.wizard. Commence par la première question."
            : "Help me set up my new bot \(name) with the wizard. Ask me the questions one at a time (identity, soul, rules, routines; tools and apps only if I say this bot uses apps or a computer) and fill each step live: \(name)'s own fields with sagax_settings (bot.name, bot.description, bot.persona, bot.approvalMode...), and the wizard's answers, rules, routines and tools choice with bot.wizard. Start with the first question."
    }

    /// The effect each suggestion shows now (desktop `useRuleEffects`): its
    /// custom rule's own when read, else the suggested one; a suggestion
    /// with no rule is Off (absent).
    public static func currentEffects(draft: WizardDraft, suggestions: WizardSuggestions, read: [String: WizardRuleEffect]) -> [String: WizardRuleEffect] {
        var current: [String: WizardRuleEffect] = [:]
        for rule in suggestions.rules {
            guard let ruleId = draft.rules[rule.id], !ruleId.isEmpty else { continue }
            current[rule.id] = read[rule.id] ?? WizardRuleEffect(rawValue: rule.behavior) ?? .ask
        }
        return current
    }

    /// The recap's Rules counts: asked, denied, allowed.
    public static func ruleCounts(_ effects: [String: WizardRuleEffect]) -> (ask: Int, deny: Int, allow: Int) {
        var counts = (ask: 0, deny: 0, allow: 0)
        for effect in effects.values {
            switch effect {
            case .ask: counts.ask += 1
            case .deny: counts.deny += 1
            case .allow: counts.allow += 1
            }
        }
        return counts
    }

    /// The recap's Soul line: the answers given, of five.
    public static func answeredCount(_ answers: WizardAnswers) -> (answered: Int, total: Int) {
        let keys = WizardAnswers.Key.allCases
        return (keys.filter { !answers[$0].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.count, keys.count)
    }

    /// The recap's Routines line: the picked suggestions' names, in the
    /// suggestions' order.
    public static func pickedRoutineNames(draft: WizardDraft, suggestions: WizardSuggestions) -> [String] {
        suggestions.routines.filter { draft.routines.contains($0.id) }.map(\.name)
    }

    /// The recap's MCP part (desktop `recapLines`): nil is every server.
    public enum MCPSummary: Equatable, Sendable {
        case all, none, some([String])
    }

    public static func mcpSummary(_ servers: [String]?) -> MCPSummary {
        guard let servers else { return .all }
        return servers.isEmpty ? .none : .some(servers)
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
struct WizardRulesList: Decodable {
    struct Rule: Decodable { var id: String; var behavior: String? }
    var rules: [Rule]?
}

/// `GET /api/bot-defaults`: the parts the wizard sends with a new bot.
public struct WizardBotDefaults: Decodable, Sendable {
    public var modelSelection: ModelSelection?
    public var suggestedName: String?

    public init(modelSelection: ModelSelection? = nil, suggestedName: String? = nil) {
        self.modelSelection = modelSelection
        self.suggestedName = suggestedName
    }

    /// `autoSelectionReady`: an engine and a model, else nothing is pinned.
    public var readySelection: ModelSelection? {
        guard let selection = modelSelection,
              !selection.instanceId.trimmingCharacters(in: .whitespaces).isEmpty,
              !selection.model.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        return selection
    }
}

/// `POST /api/bots` from the wizard: only the fields set are sent.
struct WizardNewBotBody: Encodable {
    struct Settings: Encodable {
        var mcpServers: [String]?
        var soul: String?
    }

    var name: String?
    var title: String?
    var description: String?
    var modelSelection: ModelSelection?
    var settings: Settings?
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}

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

    /// A suggested rule made: the person's custom rule for this bot, on its
    /// suggested effect or the one they picked.
    func addWizardRule(botId: String, suggestion: WizardRuleSuggestion, effect: WizardRuleEffect? = nil) async throws -> String? {
        try await send(try makeRequest("POST", "/api/custom-rules", body: ["when": suggestion.when, "behavior": effect?.rawValue ?? suggestion.behavior, "botId": botId, "riskScope": [String]()]), as: WizardRuleResponse.self).rule?.id
    }

    /// Another effect on a rule already made (desktop `setSuggestedRuleEffect`).
    func setWizardRuleEffect(ruleId: String, effect: WizardRuleEffect) async throws {
        guard Self.validRouteID(ruleId) else { throw APIError.badURL }
        try await send(try makeRequest("PATCH", "/api/custom-rules/\(ruleId)", body: ["behavior": effect.rawValue]))
    }

    /// The effect each applied suggestion has now (desktop
    /// `appliedRuleEffects`): its custom rule's own, read for this bot.
    func wizardRuleEffects(draft: WizardDraft) async throws -> [String: WizardRuleEffect] {
        let applied = draft.rules.filter { !$0.value.isEmpty && $0.value != "pending" }
        guard !applied.isEmpty else { return [:] }
        let read = try await send(try makeRequest("GET", "/api/custom-rules", query: [URLQueryItem(name: "botId", value: draft.botId)]), as: WizardRulesList.self)
        let byId = Dictionary((read.rules ?? []).map { ($0.id, $0.behavior) }, uniquingKeysWith: { first, _ in first })
        var effects: [String: WizardRuleEffect] = [:]
        for (suggestion, ruleId) in applied {
            if let behavior = byId[ruleId] ?? nil, let effect = WizardRuleEffect(rawValue: behavior) { effects[suggestion] = effect }
        }
        return effects
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

    /// The server's Auto defaults (`/api/bot-defaults`), or none: a member
    /// of an organization server is refused them and creates their bot all
    /// the same on the model the server picks (desktop `readBotDefaults`).
    func wizardBotDefaults() async -> WizardBotDefaults {
        (try? await send(try makeRequest("GET", "/api/bot-defaults"), as: WizardBotDefaults.self)) ?? WizardBotDefaults()
    }

    /// The wizard's bot, on the server's Auto defaults and suggested name,
    /// as New bot makes one. `noMcp` (2026-10-27): the wizard's own default
    /// is no MCP server, sent only when this person may set the field.
    func createWizardBot(noMcp: Bool = false) async throws -> Bot {
        let defaults = await wizardBotDefaults()
        let body = WizardNewBotBody(
            name: defaults.suggestedName?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty,
            modelSelection: defaults.readySelection,
            settings: noMcp ? WizardNewBotBody.Settings(mcpServers: []) : nil
        )
        return try await send(try makeRequest("POST", "/api/bots", encodedBody: body), as: CreatedBot.self).bot
    }

    /// The Bot designer (desktop `createDesignerBot`): POST /api/bots with
    /// the fields a member sets on a new bot; the soul rides in `settings`.
    func createDesignerBot(french: Bool) async throws -> Bot {
        let defaults = await wizardBotDefaults()
        let profile = BotWizardRules.designerProfile(french: french)
        let body = WizardNewBotBody(
            name: profile.name, title: profile.title, description: profile.description,
            modelSelection: defaults.readySelection,
            settings: WizardNewBotBody.Settings(soul: profile.soul)
        )
        return try await send(try makeRequest("POST", "/api/bots", encodedBody: body), as: CreatedBot.self).bot
    }
}
