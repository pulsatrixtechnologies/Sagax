// The bot creation wizard on iOS: the same server draft as the desktop
// (`/api/bot-wizard`), its steps, the mode switch that sends the mode only,
// and the calls behind the steps.
import Foundation
import XCTest
@testable import CompanionCore

private final class WizardRequestStub: URLProtocol {
    static var responses: [(status: Int, body: String)] = []
    static var requests: [(request: URLRequest, body: Data?)] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.requests.append((request, Self.readBody(from: request)))
        let index = min(Self.requests.count - 1, Self.responses.count - 1)
        let answer = Self.responses[max(0, index)]
        let response = HTTPURLResponse(url: request.url!, statusCode: answer.status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(answer.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func readBody(from request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1_024)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

final class BotWizardTests: XCTestCase {
    private var session: URLSession!
    private var client: CompanionClient!

    static let draftJSON = #"""
    {"botId":"bot-1","owner":"pr_me","origin":"new","mode":"manual","step":"rules","visited":["identity","soul","rules"],
    "skipped":["soul"],"roleId":"inbox","answers":{"tone":"Calme","language":"","does":"","never":"","speech":""},
    "rules":{"ask-send-mail":"rule-1","deny-payment":"pending"},"routines":["inbox-triage"],"guidedThreadId":"t-g",
    "status":"draft","createdAt":1,"updatedAt":2,"botName":"Tri"}
    """#

    override func setUp() {
        super.setUp()
        WizardRequestStub.responses = [(200, "{}")]
        WizardRequestStub.requests = []
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [WizardRequestStub.self]
        session = URLSession(configuration: configuration)
        client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "paired-token", session: session)
    }

    override func tearDown() {
        session.invalidateAndCancel()
        session = nil
        client = nil
        super.tearDown()
    }

    private func json(_ index: Int) throws -> [String: Any] {
        let body = try XCTUnwrap(WizardRequestStub.requests[index].body)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
    }

    func testStepsInOrderAndNavigation() {
        XCTAssertEqual(WizardStep.allCases.map(\.rawValue), ["identity", "soul", "rules", "tools", "routines", "recap"])
        XCTAssertEqual(WizardStep.identity.next, .soul)
        XCTAssertNil(WizardStep.recap.next)
        XCTAssertNil(WizardStep.identity.previous)
        XCTAssertEqual(WizardStep.tools.previous, .rules)
    }

    func testReadsTheServerDraftAndItsSuggestions() async throws {
        WizardRequestStub.responses = [(200, #"{"draft":\#(Self.draftJSON),"suggestions":{"answers":{"tone":"Calme et professionnel","language":"","does":"","never":"","speech":""},"rules":[{"id":"ask-send-mail","behavior":"ask","when":"envoyer un courriel"}],"routines":[{"id":"inbox-triage","name":"Tri du courriel","prompt":"Trie","time":"08:30","weekdays":[1,2,3,4,5]}],"tools":["apps","mcp"],"apps":["gmail"]}}"#)]
        let (draft, suggestions) = try await client.wizardDraft(botId: "bot-1", language: "fr")
        XCTAssertEqual(draft.step, .rules)
        XCTAssertEqual(draft.skipped, [.soul])
        XCTAssertEqual(draft.answers.tone, "Calme")
        XCTAssertEqual(draft.botName, "Tri")
        XCTAssertTrue(draft.isOpen)
        XCTAssertEqual(BotWizardRules.pendingRules(draft), ["deny-payment"])
        XCTAssertEqual(suggestions.tools, ["apps", "mcp"])
        XCTAssertEqual(suggestions.rules.first?.when, "envoyer un courriel")
        let request = WizardRequestStub.requests[0].request
        XCTAssertEqual(request.url?.path, "/api/bot-wizard/bot-1")
        XCTAssertEqual(request.url?.query, "language=fr")
    }

    func testModeSwitchSendsTheModeOnlyAndKeepsTheDraft() async throws {
        WizardRequestStub.responses = [(200, #"{"draft":\#(Self.draftJSON)}"#)]
        _ = try await client.patchWizard(botId: "bot-1", patch: WizardPatch(mode: .guided))
        XCTAssertEqual(WizardRequestStub.requests[0].request.httpMethod, "PATCH")
        XCTAssertEqual(try json(0) as NSDictionary, ["mode": "guided"] as NSDictionary)
        let data = try JSONDecoder().decode(WizardDraft.self, from: Data(Self.draftJSON.utf8))
        let switched = BotWizardRules.switching(data, to: .guided)
        XCTAssertEqual(switched.mode, .guided)
        XCTAssertEqual(switched.answers, data.answers)
        XCTAssertEqual(switched.rules, data.rules)
        XCTAssertEqual(switched.step, data.step)
    }

    func testPatchEncodesSkipAnswersAndARemovedRuleAsNull() throws {
        let body = try JSONEncoder().encode(WizardPatch(skip: .soul, answers: ["tone": "Calme"], rules: ["ask-send-mail": nil, "deny-payment": "rule-2"]))
        let decoded = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(decoded["skip"] as? String, "soul")
        XCTAssertEqual(decoded["answers"] as? [String: String], ["tone": "Calme"])
        let rules = try XCTUnwrap(decoded["rules"] as? [String: Any])
        XCTAssertTrue(rules["ask-send-mail"] is NSNull)
        XCTAssertEqual(rules["deny-payment"] as? String, "rule-2")
        XCTAssertNil(decoded["mode"])
    }

    func testStartsResumesAndFinishesOnTheServerRoutes() async throws {
        WizardRequestStub.responses = [(201, #"{"draft":\#(Self.draftJSON)}"#)]
        _ = try await client.startWizard(botId: "bot-1", origin: "redo", mode: .manual, restart: true)
        XCTAssertEqual(WizardRequestStub.requests[0].request.httpMethod, "PUT")
        XCTAssertEqual(try json(0) as NSDictionary, ["origin": "redo", "mode": "manual", "restart": true] as NSDictionary)
        _ = try await client.finishWizard(botId: "bot-1")
        XCTAssertEqual(WizardRequestStub.requests[1].request.url?.path, "/api/bot-wizard/bot-1/finish")
        await XCTAssertThrowsErrorAsync(try await client.startWizard(botId: "../x", origin: "new", mode: .manual))
    }

    func testRulesAndRoutinesGoThroughTheirOwnRoutes() async throws {
        WizardRequestStub.responses = [(201, #"{"rule":{"id":"rule-7"}}"#)]
        let id = try await client.addWizardRule(botId: "bot-1", suggestion: WizardRuleSuggestion(id: "deny-payment", behavior: "deny", when: "faire un paiement"))
        XCTAssertEqual(id, "rule-7")
        XCTAssertEqual(WizardRequestStub.requests[0].request.url?.path, "/api/custom-rules")
        XCTAssertEqual(try json(0)["behavior"] as? String, "deny")
        WizardRequestStub.responses = [(201, "{}")]
        try await client.addWizardRoutine(botId: "bot-1", suggestion: WizardRoutineSuggestion(id: "inbox-triage", name: "Tri", prompt: "Trie", time: "08:30", weekdays: [1, 2, 3, 4, 5]))
        let routine = try json(1)
        XCTAssertEqual(WizardRequestStub.requests[1].request.url?.path, "/api/routines")
        XCTAssertEqual((routine["schedule"] as? [String: Any])?["time"] as? String, "08:30")
        XCTAssertEqual(routine["target"] as? String, "bot")
    }

    func testGuideKickoffAndSchedule() {
        func bot(_ id: String, primary: Bool = false, hidden: Bool = false) -> Bot {
            var bot = Bot(id: id, threadId: "t-\(id)", name: id, title: "", description: "", notifications: true, color: "green", unread: false,
                          modelSelection: ModelSelection(instanceId: "e", model: "m"), createdAt: 1)
            bot.chiefOfStaff = primary
            bot.hidden = hidden
            return bot
        }
        XCTAssertEqual(BotWizardRules.guide(bots: [bot("new", primary: true), bot("a"), bot("p", primary: true)], draftBotId: "new")?.id, "p")
        XCTAssertEqual(BotWizardRules.guide(bots: [bot("new"), bot("h", primary: true, hidden: true), bot("a")], draftBotId: "new")?.id, "a")
        XCTAssertNil(BotWizardRules.guide(bots: [bot("new")], draftBotId: "new"))
        XCTAssertTrue(BotWizardRules.kickoff(botName: "Tri", french: true).contains("mon nouveau bot Tri"))
        XCTAssertTrue(BotWizardRules.kickoff(botName: "Tri", french: false).contains("bot.wizard"))
        let days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        XCTAssertEqual(BotWizardRules.scheduleLabel(time: "08:00", weekdays: [1, 2, 3, 4, 5], dayNames: days, weekdaysLabel: "weekdays", everyDay: "every day"), "08:00, weekdays")
        XCTAssertEqual(BotWizardRules.scheduleLabel(time: "16:00", weekdays: [5], dayNames: days, weekdaysLabel: "weekdays", everyDay: "every day"), "16:00, Fri")
    }

    // MARK: v2 (2026-10-27)

    private func bot(_ id: String, name: String? = nil, primary: Bool = false, hidden: Bool = false) -> Bot {
        var bot = Bot(id: id, threadId: "t-\(id)", name: name ?? id, title: "", description: "", notifications: true, color: "green", unread: false,
                      modelSelection: ModelSelection(instanceId: "e", model: "m"), createdAt: 1)
        bot.chiefOfStaff = primary
        bot.hidden = hidden
        return bot
    }

    func testTheBotDesignerGuidesFirstInEitherLanguage() {
        XCTAssertEqual(BotWizardRules.guide(bots: [bot("new"), bot("p", primary: true), bot("d", name: "  bot   DESIGNER ")], draftBotId: "new")?.id, "d")
        XCTAssertEqual(BotWizardRules.guide(bots: [bot("a"), bot("d", name: "Concepteur de bots"), bot("p", primary: true)], draftBotId: nil)?.id, "d")
        // a hidden designer never leads; the Primary Bot does
        XCTAssertEqual(BotWizardRules.guide(bots: [bot("d", name: "Bot designer", hidden: true), bot("p", primary: true)], draftBotId: nil)?.id, "p")
        // the bot being made never guides itself, even named Bot designer
        XCTAssertNil(BotWizardRules.guide(bots: [bot("new", name: "Bot designer")], draftBotId: "new"))
        XCTAssertTrue(BotWizardRules.isDesigner("Concepteur de bot"))
        XCTAssertFalse(BotWizardRules.isDesigner("Bot designers"))
        XCTAssertFalse(BotWizardRules.isDesigner(nil))
    }

    func testDesignerProfileMatchesTheDesktop() {
        let fr = BotWizardRules.designerProfile(french: true)
        XCTAssertEqual(fr.name, "Concepteur de bots")
        XCTAssertEqual(fr.title, "Conçoit vos bots")
        XCTAssertTrue(fr.soul.hasPrefix("Tu es le Concepteur de bots."))
        let en = BotWizardRules.designerProfile(french: false)
        XCTAssertEqual(en.name, "Bot designer")
        XCTAssertTrue(en.soul.contains("never ask an administrator"))
        for text in [fr.soul, en.soul, fr.description, en.description] {
            XCTAssertFalse(text.contains("\u{2014}") || text.contains("\u{2013}"))
        }
    }

    func testCreatesTheDesignerWithMemberFieldsAndTheAutoModel() async throws {
        WizardRequestStub.responses = [
            (200, #"{"modelSelection":{"instanceId":"claude","model":"opus"},"suggestedName":"Nova"}"#),
            (201, #"{"bot":{"id":"des","threadId":"t-des","name":"Bot designer","title":"Designs your bots","description":"","notifications":true,"color":"green","unread":false,"modelSelection":{"instanceId":"claude","model":"opus"},"createdAt":1}}"#),
        ]
        let created = try await client.createDesignerBot(french: false)
        XCTAssertEqual(created.id, "des")
        XCTAssertEqual(WizardRequestStub.requests[0].request.url?.path, "/api/bot-defaults")
        XCTAssertEqual(WizardRequestStub.requests[1].request.url?.path, "/api/bots")
        let body = try json(1)
        XCTAssertEqual(body["name"] as? String, "Bot designer")
        XCTAssertEqual(body["title"] as? String, "Designs your bots")
        XCTAssertNotNil(body["description"] as? String)
        XCTAssertNil(body["soul"], "the soul is a template field: it goes in settings")
        XCTAssertTrue(((body["settings"] as? [String: Any])?["soul"] as? String)?.hasPrefix("You are the Bot designer.") == true)
        XCTAssertEqual((body["modelSelection"] as? [String: Any])?["model"] as? String, "opus")
    }

    func testWizardBotStartsWithNoMcpOnlyWhenAsked() async throws {
        // bot-defaults refused (a member): nothing pinned, the server picks
        WizardRequestStub.responses = [
            (403, #"{"error":"forbidden"}"#),
            (201, #"{"bot":{"id":"b","threadId":"t-b","name":"Nova","title":"","description":"","notifications":true,"color":"green","unread":false,"modelSelection":{"instanceId":"e","model":"m"},"createdAt":1}}"#),
        ]
        _ = try await client.createWizardBot(noMcp: true)
        let body = try json(1)
        XCTAssertNil(body["modelSelection"])
        XCTAssertNil(body["name"])
        XCTAssertEqual((body["settings"] as? [String: Any])?["mcpServers"] as? [String], [])
        WizardRequestStub.requests = []
        _ = try await client.createWizardBot(noMcp: false)
        XCTAssertNil(try json(1)["settings"])
    }

    func testToolsAreOffThePathUnlessYesOrOpen() throws {
        var draft = try JSONDecoder().decode(WizardDraft.self, from: Data(Self.draftJSON.utf8))
        XCTAssertNil(draft.tools)
        XCTAssertEqual(draft.path, [.identity, .soul, .rules, .routines, .recap])
        XCTAssertEqual(draft.nextStep(), .routines)
        draft.step = .routines
        XCTAssertEqual(draft.previousStep, .rules)
        draft.tools = .yes
        XCTAssertEqual(draft.path, WizardStep.allCases)
        XCTAssertEqual(draft.previousStep, .tools)
        draft.step = .rules
        XCTAssertEqual(draft.nextStep(), .tools)
        // opened from the recap's Edit: on the path while on it
        draft.tools = .later
        draft.step = .tools
        XCTAssertEqual(draft.path, WizardStep.allCases)
        XCTAssertEqual(draft.nextStep(), .routines)
        XCTAssertEqual(draft.previousStep, .rules)
        let decoded = try JSONDecoder().decode(WizardDraft.self, from: Data(Self.draftJSON.replacingOccurrences(of: #""status":"draft""#, with: #""tools":"yes","status":"draft""#).utf8))
        XCTAssertEqual(decoded.tools, .yes)
        let body = try JSONEncoder().encode(WizardPatch(tools: .yes))
        XCTAssertEqual(try JSONSerialization.jsonObject(with: body) as? NSDictionary, ["tools": "yes"] as NSDictionary)
    }

    func testRuleEffectsReadPatchAndCreate() async throws {
        let draft = try JSONDecoder().decode(WizardDraft.self, from: Data(Self.draftJSON.utf8))
        WizardRequestStub.responses = [(200, #"{"rules":[{"id":"rule-1","behavior":"deny"},{"id":"other","behavior":"allow"}]}"#)]
        let read = try await client.wizardRuleEffects(draft: draft)
        XCTAssertEqual(read, ["ask-send-mail": .deny])
        XCTAssertEqual(WizardRequestStub.requests[0].request.url?.path, "/api/custom-rules")
        XCTAssertEqual(WizardRequestStub.requests[0].request.url?.query, "botId=bot-1")
        WizardRequestStub.responses = [(200, "{}")]
        try await client.setWizardRuleEffect(ruleId: "rule-1", effect: .allow)
        XCTAssertEqual(WizardRequestStub.requests[1].request.httpMethod, "PATCH")
        XCTAssertEqual(WizardRequestStub.requests[1].request.url?.path, "/api/custom-rules/rule-1")
        XCTAssertEqual(try json(1) as NSDictionary, ["behavior": "allow"] as NSDictionary)
        WizardRequestStub.responses = [(201, #"{"rule":{"id":"rule-9"}}"#)]
        let made = try await client.addWizardRule(botId: "bot-1", suggestion: WizardRuleSuggestion(id: "deny-payment", behavior: "deny", when: "faire un paiement"), effect: .ask)
        XCTAssertEqual(made, "rule-9")
        XCTAssertEqual(try json(2)["behavior"] as? String, "ask")
        // the shown effects: read, else suggested; a rule never made is Off
        let suggestions = WizardSuggestions(answers: nil, rules: [
            WizardRuleSuggestion(id: "ask-send-mail", behavior: "ask", when: "envoyer un courriel"),
            WizardRuleSuggestion(id: "deny-payment", behavior: "deny", when: "faire un paiement"),
            WizardRuleSuggestion(id: "allow-read-web", behavior: "allow", when: "lire des pages web"),
        ], routines: [], tools: [], apps: [])
        let shown = BotWizardRules.currentEffects(draft: draft, suggestions: suggestions, read: read)
        XCTAssertEqual(shown, ["ask-send-mail": .deny, "deny-payment": .deny])
        let counts = BotWizardRules.ruleCounts(shown)
        XCTAssertEqual(counts.deny, 2)
        XCTAssertEqual(counts.ask, 0)
    }

    func testRecapFactsAndEngineReadiness() throws {
        let draft = try JSONDecoder().decode(WizardDraft.self, from: Data(Self.draftJSON.utf8))
        XCTAssertEqual(BotWizardRules.answeredCount(draft.answers).answered, 1)
        XCTAssertEqual(BotWizardRules.answeredCount(draft.answers).total, 5)
        let suggestions = WizardSuggestions(answers: nil, rules: [], routines: [
            WizardRoutineSuggestion(id: "inbox-afternoon", name: "Suivis", prompt: "", time: "14:00", weekdays: [1]),
            WizardRoutineSuggestion(id: "inbox-triage", name: "Tri du courriel", prompt: "", time: "08:30", weekdays: [1]),
        ], tools: [], apps: [])
        XCTAssertEqual(BotWizardRules.pickedRoutineNames(draft: draft, suggestions: suggestions), ["Tri du courriel"])
        XCTAssertEqual(BotWizardRules.mcpSummary(nil), .all)
        XCTAssertEqual(BotWizardRules.mcpSummary([]), .none)
        XCTAssertEqual(BotWizardRules.mcpSummary(["fs"]), .some(["fs"]))
        func instance(_ state: String, authenticated: Bool?, access: String? = nil) -> Instance {
            Instance(instanceId: "i", driverKind: "claudeAgent", displayName: nil,
                     snapshot: ProviderSnapshot(state: state, reason: nil, authenticated: authenticated, version: nil),
                     models: ModelCatalog(default: "m", options: []), access: access)
        }
        XCTAssertTrue(BotWizardRules.engineReady(nil))
        XCTAssertTrue(BotWizardRules.engineReady([]))
        XCTAssertFalse(BotWizardRules.engineReady([instance("unavailable", authenticated: nil), instance("available", authenticated: false)]))
        XCTAssertTrue(BotWizardRules.engineReady([instance("available", authenticated: true)]))
        XCTAssertTrue(BotWizardRules.engineReady([instance("available", authenticated: false, access: "custom")]))
    }

    func testKickoffNamesTheToolsChoice() {
        XCTAssertTrue(BotWizardRules.kickoff(botName: " Tri ", french: false).contains("tools and apps only if I say"))
        XCTAssertTrue(BotWizardRules.kickoff(botName: "Tri", french: true).contains("le choix des outils"))
    }
}

private func XCTAssertThrowsErrorAsync<T>(_ expression: @autoclosure () async throws -> T, file: StaticString = #filePath, line: UInt = #line) async {
    do {
        _ = try await expression()
        XCTFail("expected an error", file: file, line: line)
    } catch {}
}
