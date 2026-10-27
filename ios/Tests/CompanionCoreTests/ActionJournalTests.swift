// The Journal of the person's bots (shared/action-journal.ts): decoding of
// the wire payload, the filters, the words and the rule test. Names in the
// fixtures are neutral. No network, no simulator.
import Foundation
import XCTest
@testable import CompanionCore

final class ActionJournalTests: XCTestCase {
    private let uuid = "3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60"

    private var fixture: String {
        """
        {"days":7,"truncated":true,"entries":[
          {"key":"req-1","at":"2026-10-26T14:00:00.000Z","botId":"bot-nova","botName":"Nova","threadId":"thr-1",
           "tool":"Bash","summary":"ls ~/Documents","outcome":"allowed","decider":"custom-rule","source":"custom-rule",
           "ruleText":"always allow reading files in ~/Documents","ruleBehavior":"allow","ruleId":"rule-1","replayable":true},
          {"key":"req-2","at":"2026-10-26T15:30:00Z","botId":"bot-atlas","botName":"Atlas","threadId":"thr-2","requestId":"req-2",
           "tool":"mcp__mail__send","summary":"Send to team about \(uuid) and 0123456789abcdef0123","outcome":"asked","decider":"person",
           "answeredBy":"you","unattended":true},
          {"key":"req-3","at":"2026-10-25T09:00:00Z","botId":"bot-atlas","botName":"Atlas","threadId":"thr-2",
           "tool":"Write","outcome":"denied","decider":"org-rule","ruleText":"never write outside the project"},
          {"key":"req-4","at":"2026-10-24T09:00:00Z","botId":"\(uuid)","botName":"\(uuid)","threadId":"thr-3",
           "tool":"agent_tool","outcome":"failed","decider":"error","ran":"failed",
           "guard":{"allow":false,"reason":"not_granted","mode":"shadow","scope":"files:write"}},
          {"key":"req-5","at":"2026-10-23T09:00:00Z","botId":"bot-nova","botName":"Nova","threadId":"thr-1",
           "tool":"Read","outcome":"expired","decider":"expired"},
          {"key":"req-6","at":"2026-10-22T09:00:00Z","botId":"bot-nova","botName":"Nova","threadId":"thr-1",
           "tool":"Read","outcome":"quarantined","decider":"something-new","source":"future-source"}
        ]}
        """
    }

    private func payload() throws -> JournalPayload {
        try JSONDecoder().decode(JournalPayload.self, from: Data(fixture.utf8))
    }

    func testDecodesThePayloadAndToleratesUnknownValues() throws {
        let payload = try payload()
        XCTAssertEqual(payload.days, 7)
        XCTAssertEqual(payload.truncated, true)
        XCTAssertEqual(payload.entries.count, 6)
        let first = payload.entries[0]
        XCTAssertEqual(first.outcome, .allowed)
        XCTAssertEqual(first.decider, .customRule)
        XCTAssertEqual(first.ruleBehavior, .allow)
        XCTAssertEqual(first.replayable, true)
        XCTAssertEqual(payload.entries[1].unattended, true)
        XCTAssertEqual(payload.entries[3].guardVerdict, JournalGuard(allow: false, reason: "not_granted", mode: "shadow", scope: "files:write"))
        XCTAssertEqual(payload.entries[5].outcome, .unknown)
        XCTAssertEqual(payload.entries[5].decider, .unknown)
    }

    func testFiltersByOutcomeBotAndSearchNewestFirst() throws {
        let entries = try payload().entries
        XCTAssertEqual(ActionJournal.filter(entries, JournalFilter()).map(\.key), ["req-2", "req-1", "req-3", "req-4", "req-5", "req-6"])
        XCTAssertEqual(ActionJournal.filter(entries, JournalFilter(outcome: .denied)).map(\.key), ["req-3"])
        XCTAssertEqual(ActionJournal.filter(entries, JournalFilter(bot: "bot-atlas")).map(\.key), ["req-2", "req-3"])
        XCTAssertEqual(ActionJournal.filter(entries, JournalFilter(query: "  DOCUMENTS ")).map(\.key), ["req-1"])
        XCTAssertEqual(ActionJournal.filter(entries, JournalFilter(query: "outside the project")).map(\.key), ["req-3"])
        XCTAssertEqual(ActionJournal.filter(entries, JournalFilter(outcome: .allowed, bot: "bot-atlas")).map(\.key), [])
    }

    func testCountsLeaveAnUnknownOutcomeOut() throws {
        let counts = ActionJournal.counts(try payload().entries)
        XCTAssertEqual(counts.allowed, 1)
        XCTAssertEqual(counts.asked, 1)
        XCTAssertEqual(counts.denied, 1)
        XCTAssertEqual(counts.failed, 1)
        XCTAssertEqual(counts.expired, 1)
        XCTAssertEqual(counts.total, 5)
        XCTAssertEqual(counts.count(nil), 5)
    }

    func testDeciderLabelsUseTheRulesOwnWords() {
        XCTAssertEqual(ActionJournal.deciderLabel(.customRule, ruleText: "read ~/Documents"), JournalDeciderLabel(key: "Your rule: %@", argument: "read ~/Documents"))
        XCTAssertEqual(ActionJournal.deciderLabel(.customRule), JournalDeciderLabel(key: "One of your rules"))
        XCTAssertEqual(ActionJournal.deciderLabel(.orgRule, ruleText: "no external send").key, "Organization rule: %@")
        XCTAssertEqual(ActionJournal.deciderLabel(.alwaysAllow, ruleText: "git status").key, "Always allow: %@")
        XCTAssertEqual(ActionJournal.deciderLabel(.person, answeredBy: "you"), JournalDeciderLabel(key: "You answered"))
        XCTAssertEqual(ActionJournal.deciderLabel(.person, answeredBy: "Ana"), JournalDeciderLabel(key: "Answered by %@", argument: "Ana"))
        XCTAssertEqual(ActionJournal.deciderLabel(.unknown, source: "future-source"), JournalDeciderLabel(key: "Decided by: %@", argument: "future-source"))
        XCTAssertEqual(ActionJournal.deciderLabel(.unknown, source: uuid), JournalDeciderLabel(key: "Not known"))
        XCTAssertEqual(ActionJournal.deciderLabel(.customRule, ruleText: "use \(uuid)").argument, "use \u{2026}")
    }

    func testNoIdReachesTheVisibleText() throws {
        let entries = try payload().entries
        for entry in entries {
            var visible = [ActionJournal.botName(entry), ActionJournal.title(tool: entry.tool), ActionJournal.summary(entry) ?? ""]
            let label = ActionJournal.deciderLabel(entry)
            visible.append(label.key)
            visible.append(label.argument ?? "")
            for text in visible {
                XCTAssertFalse(text.contains(uuid), "\(entry.key): \(text)")
                XCTAssertFalse(text.contains("0123456789abcdef0123"), "\(entry.key): \(text)")
            }
        }
        XCTAssertEqual(ActionJournal.botName(entries[3]), "Deleted bot")
        XCTAssertEqual(ActionJournal.summary(entries[1]), "Send to team about \u{2026} and \u{2026}")
        XCTAssertEqual(ActionJournal.bots(entries).map(\.name), ["Atlas", "Deleted bot", "Nova"])
    }

    func testActionTitlesAreWords() {
        XCTAssertEqual(ActionJournal.title(tool: "Bash"), "Run a command")
        XCTAssertEqual(ActionJournal.title(tool: "mcp__mail__send"), "Mail send")
        XCTAssertEqual(ActionJournal.title(tool: ""), "An action")
    }

    func testTheGuardNoteSaysObservation() {
        XCTAssertEqual(ActionJournal.guardNote(JournalGuard(allow: false, mode: "shadow")), "The guard would have refused (observation mode)")
        XCTAssertEqual(ActionJournal.guardNote(JournalGuard(allow: false, mode: "enforce")), "The guard refused")
        XCTAssertNil(ActionJournal.guardNote(nil))
    }

    func testDecodesARuleTestResult() throws {
        let json = """
        {"days":7,"scanned":42,"matched":3,
         "counts":{"allowed":1,"asked":1,"denied":0,"cardStays":1,"changed":1},
         "hits":[
           {"key":"a","at":"2026-10-26T14:00:00Z","botName":"Nova","tool":"Read","summary":"cat notes","actual":"asked","would":"allowed","changed":false},
           {"key":"b","at":"2026-10-26T13:00:00Z","botName":"Atlas","tool":"Bash","actual":"allowed","would":"asked","changed":true,"missing":["money","bogus"],"approximate":true},
           {"key":"c","at":"2026-10-26T12:00:00Z","botName":"Nova","tool":"Write","actual":"asked","would":"card-stays","changed":false}
         ]}
        """
        let result = try JSONDecoder().decode(RuleTestResult.self, from: Data(json.utf8))
        XCTAssertEqual(result.scanned, 42)
        XCTAssertEqual(result.matched, 3)
        XCTAssertEqual(result.counts, RuleTestCounts(allowed: 1, asked: 1, denied: 0, cardStays: 1, changed: 1))
        XCTAssertEqual(result.hits.map(\.would), [.allowed, .asked, .cardStays])
        XCTAssertEqual(result.hits[1].missing, [.money])
        XCTAssertTrue(result.hits[1].approximate)
        XCTAssertTrue(result.hits[1].changed)
        XCTAssertFalse(result.unreadable)
        let unreadable = try JSONDecoder().decode(RuleTestResult.self, from: Data(#"{"days":7,"scanned":3,"matched":0,"counts":{},"hits":[],"unreadable":true}"#.utf8))
        XCTAssertTrue(unreadable.unreadable)
    }

    func testRuleTestChangedMatchesTheSharedRule() {
        XCTAssertFalse(ActionJournal.ruleTestChanged(actual: .asked, would: .cardStays))
        XCTAssertTrue(ActionJournal.ruleTestChanged(actual: .allowed, would: .denied))
        XCTAssertFalse(ActionJournal.ruleTestChanged(actual: .denied, would: .denied))
        XCTAssertTrue(ActionJournal.ruleTestChanged(actual: .asked, would: .allowed))
        XCTAssertFalse(ActionJournal.ruleTestChanged(actual: .allowed, would: .allowed))
        XCTAssertTrue(ActionJournal.ruleTestChanged(actual: .allowed, would: .asked))
        XCTAssertTrue(ActionJournal.ruleTestChanged(actual: .failed, would: .asked))
        XCTAssertFalse(ActionJournal.ruleTestChanged(actual: .asked, would: .asked))
    }

    func testRequestsCarryTheDraftAndTheWindow() throws {
        let client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t", session: .shared)
        let journal = try client.makeRequest("GET", "/api/approvals/journal", query: [URLQueryItem(name: "days", value: "30")])
        XCTAssertEqual(journal.url?.query, "days=30")
        let draft = RuleTestDraft(id: "rule-1", when: "read files", behavior: .allow, botId: nil, riskScope: [.money])
        struct Body: Encodable { var rule: RuleTestDraft }
        let request = try client.makeRequest("POST", "/api/approvals/journal/test", encodedBody: Body(rule: draft))
        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? [String: Any])
        let rule = try XCTUnwrap(sent["rule"] as? [String: Any])
        XCTAssertEqual(rule["id"] as? String, "rule-1")
        XCTAssertEqual(rule["behavior"] as? String, "allow")
        XCTAssertTrue(rule["botId"] is NSNull)
        XCTAssertEqual(rule["riskScope"] as? [String], ["money"])
    }

    func testMyToolGrantsDecodeAndTheFormMirrorsTheDesktop() throws {
        let json = """
        {"grants":[
          {"id":"tg_a","scope":"files:read","grantedBy":"me","grantedAt":1000,"state":"expired"},
          {"id":"tg_b","scope":"files:write","grantedBy":"me","grantedAt":2000,"expiresAt":9999999999999,"state":"active"},
          {"id":"tg_c","scope":"mail:read","grantedAt":3000,"revokedAt":3500,"state":"revoked"}],
         "adminOnlyAreas":["org"],"mayGrantAdmin":false}
        """
        let grants = try JSONDecoder().decode(MyToolGrants.self, from: Data(json.utf8))
        XCTAssertEqual(grants.sorted.map(\.id), ["tg_b", "tg_a", "tg_c"])
        XCTAssertEqual(grants.sorted[0].area, "files")
        XCTAssertEqual(grants.sorted[0].tier, "write")
        XCTAssertEqual(grants.adminOnlyAreas, ["org"])
        XCTAssertFalse(grants.mayGrantAdmin)

        let now = Date(timeIntervalSince1970: 0)
        XCTAssertEqual(try MyToolGrantForm.request(area: " Files ", tier: "write", days: "2", now: now).get().scope, "files:write")
        XCTAssertEqual(try MyToolGrantForm.request(area: "files", tier: "write", days: "2", now: now).get().expiresAt, 172_800_000)
        XCTAssertNil(try MyToolGrantForm.request(area: "files", tier: "read", days: "", now: now).get().expiresAt)
        XCTAssertEqual(MyToolGrantForm.request(area: "a b", tier: "read", days: "", now: now), .failure(.badArea))
        XCTAssertEqual(MyToolGrantForm.request(area: "files", tier: "read", days: "0", now: now), .failure(.badDays))
        XCTAssertEqual(MyToolGrantForm.request(area: "files", tier: "admin", days: "", now: now), .failure(.adminDays))
        XCTAssertEqual(MyToolGrantForm.request(area: "files", tier: "admin", days: "31", now: now), .failure(.adminDays))
    }
}
