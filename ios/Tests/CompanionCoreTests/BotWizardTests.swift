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
}

private func XCTAssertThrowsErrorAsync<T>(_ expression: @autoclosure () async throws -> T, file: StaticString = #filePath, line: UInt = #line) async {
    do {
        _ = try await expression()
        XCTFail("expected an error", file: file, line: line)
    } catch {}
}
