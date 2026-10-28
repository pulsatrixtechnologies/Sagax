// The card of a phone call or a purchase (OutboundCard.tsx, parité R13).
import XCTest
@testable import CompanionCore

final class OutboundCardTests: XCTestCase {
    func testACallCardDecodesOnItsMessage() throws {
        let message = try JSONDecoder().decode(Message.self, from: Data(#"""
        {"id":"m","role":"bot","kind":"text","at":1,"text":"Call to +1 514 555 0100",
         "outbound":{"kind":"call","id":"call_0123456789abcdef","status":"pending","botName":"Nova","destination":"+1 514 555 0100",
                     "from":"+1 438 555 0199","purpose":"Confirm the appointment","script":"Hello","callback":"+1 438 555 0199","language":"fr"}}
        """#.utf8))
        let card = try XCTUnwrap(message.outbound)
        XCTAssertEqual(card.kind, .call)
        XCTAssertEqual(card.destination, "+1 514 555 0100")
        XCTAssertEqual(card.script, "Hello")
        XCTAssertNil(OutboundCardRules.status(card))
        XCTAssertEqual(OutboundCardRules.answerPath(card), "/api/me/phone-calls/call_0123456789abcdef/answer")
    }

    func testAFieldOfAnUnknownShapeDoesNotLoseTheMessage() throws {
        let message = try JSONDecoder().decode(Message.self, from: Data(#"""
        {"id":"m","role":"bot","kind":"text","at":1,"text":"Pay",
         "outbound":{"kind":"purchase","id":"pay_0123456789abcdef","status":"done","botName":"Nova","items":"oops","amount":"45.20","currency":"CAD",
                     "flights":[{"from":"YUL","to":"CDG","date":"2026-11-02"}]}}
        """#.utf8))
        let card = try XCTUnwrap(message.outbound)
        XCTAssertNil(card.items)
        XCTAssertEqual(OutboundCardRules.bought(card), .flightOne)
        XCTAssertEqual(OutboundCardRules.answerPath(card), "/api/me/credentials/purchases/pay_0123456789abcdef/answer")
    }

    func testAnUnknownKindIsNoCard() throws {
        let message = try JSONDecoder().decode(Message.self, from: Data(#"""
        {"id":"m","role":"bot","kind":"text","at":1,"text":"x","outbound":{"kind":"fax","id":"f","status":"pending","botName":"N"}}
        """#.utf8))
        XCTAssertEqual(message.outbound?.kind, .unknown)
        XCTAssertEqual(message.outbound?.isDrawable, false, "drawn as its text")
        XCTAssertEqual(message.text, "x")
    }

    func testWhatAPurchaseBoughtAndItsStatus() {
        var card = OutboundCardData(kind: .purchase, id: "pay_1", status: "done", botName: "Nova")
        card.items = [.init(name: "Cable", quantity: 2), .init(name: "Plug")]
        XCTAssertEqual(OutboundCardRules.bought(card), .items(3))
        card.items = [.init(name: "Cable")]
        XCTAssertEqual(OutboundCardRules.bought(card), .itemOne)
        card.items = nil
        XCTAssertEqual(OutboundCardRules.bought(card), .done)
        XCTAssertEqual(OutboundCardRules.status(card, status: "approved"), .purchaseApproved)
        XCTAssertEqual(OutboundCardRules.status(card, status: "denied"), .purchaseDenied)
        let call = OutboundCardData(kind: .call, id: "call_1", status: "failed", botName: "Nova")
        XCTAssertEqual(OutboundCardRules.status(call), .callFailed)
    }

    func testMoneyInTheReadersLocale() {
        XCTAssertEqual(OutboundCardRules.money("12", currency: "USD", locale: Locale(identifier: "en_US")), "$12.00")
        XCTAssertEqual(OutboundCardRules.money("abc", currency: "USD"), "abc")
        XCTAssertEqual(OutboundCardRules.money("12.5", currency: nil), "12.5")
        XCTAssertEqual(OutboundCardRules.money(nil, currency: "USD"), "")
    }

    // MARK: Conversation call (place_phone_call mode conversation)

    func testAConversationCallDecodesWithItsObjectiveAndLimit() throws {
        let message = try JSONDecoder().decode(Message.self, from: Data(#"""
        {"id":"m","role":"bot","kind":"text","at":1,"text":"Phone call to +1 514 555 0142",
         "outbound":{"kind":"call","id":"call_0123456789abcdef","status":"pending","botName":"Rocket","destination":"+1 514 555 0142",
                     "mode":"conversation","objective":"Book the service","instructions":"Stay brief","maxMinutes":5,
                     "voicemail":"Alex will call back","language":"fr","script":"Bonjour, ici Rocket, un assistant IA qui appelle au nom d'Alex."}}
        """#.utf8))
        let card = try XCTUnwrap(message.outbound)
        XCTAssertTrue(card.isConversation)
        XCTAssertEqual(card.objective, "Book the service")
        XCTAssertEqual(card.maxMinutes, 5)
        XCTAssertEqual(card.voicemail, "Alex will call back")
        XCTAssertNil(card.result)
        XCTAssertNil(OutboundCardRules.status(card))
        XCTAssertEqual(OutboundCardRules.status(card, status: "done"), .callInProgress)
        XCTAssertEqual(OutboundCardRules.answerPath(card), "/api/me/phone-calls/call_0123456789abcdef/answer")
    }

    func testAConversationResultDecodes() throws {
        let message = try JSONDecoder().decode(Message.self, from: Data(#"""
        {"id":"m","role":"bot","kind":"text","at":1,"text":"x",
         "outbound":{"kind":"call","id":"call_1","status":"done","botName":"Rocket","mode":"conversation",
                     "result":{"outcome":"completed","endedBy":"stop-request","doNotCallAgain":true,"durationSec":247,
                               "points":["Tuesday 9 am"],"commitments":[],"truncated":true,"endedAt":1798000000000,
                               "transcript":[{"speaker":"bot","text":"Hello"},{"speaker":"callee","text":"**Hi**"}]}}}
        """#.utf8))
        let card = try XCTUnwrap(message.outbound)
        let result = try XCTUnwrap(card.result)
        XCTAssertEqual(result.outcome, .completed)
        XCTAssertEqual(result.endedBy, .stopRequest)
        XCTAssertTrue(result.doNotCallAgain)
        XCTAssertEqual(OutboundCallResult.duration(result.durationSec), "4:07")
        XCTAssertEqual(result.points, ["Tuesday 9 am"])
        XCTAssertTrue(result.commitments.isEmpty)
        XCTAssertEqual(result.transcript.map(\.isBot), [true, false])
        XCTAssertEqual(result.transcript.last?.text, "**Hi**")
        XCTAssertTrue(result.truncated)
        XCTAssertFalse(result.transcriptExpired)
        XCTAssertNil(OutboundCardRules.status(card), "the result says how it ended")
    }

    func testAnUnknownOutcomeOrReasonKeepsTheMessage() throws {
        let message = try JSONDecoder().decode(Message.self, from: Data(#"""
        {"id":"m","role":"bot","kind":"text","at":1,"text":"x",
         "outbound":{"kind":"call","id":"call_1","status":"done","botName":"Rocket","mode":"conversation","maxMinutes":"five",
                     "result":{"outcome":"transferred","endedBy":"elsewhere","durationSec":3.6,"points":"oops","commitments":["Call back"],"transcriptExpired":true}}}
        """#.utf8))
        let card = try XCTUnwrap(message.outbound)
        XCTAssertNil(card.maxMinutes)
        let result = try XCTUnwrap(card.result)
        XCTAssertEqual(result.outcome, .unknown)
        XCTAssertEqual(result.endedBy, .unknown)
        XCTAssertEqual(result.durationSec, 4)
        XCTAssertTrue(result.points.isEmpty)
        XCTAssertEqual(result.commitments, ["Call back"])
        XCTAssertTrue(result.transcriptExpired)
        XCTAssertEqual(message.text, "x")
    }

    func testTheOneWayCallIsUnchanged() {
        var card = OutboundCardData(kind: .call, id: "call_1", status: "done", botName: "Nova")
        XCTAssertFalse(card.isConversation)
        XCTAssertEqual(OutboundCardRules.status(card), .callDone)
        card.mode = "broadcast"
        XCTAssertFalse(card.isConversation, "a mode from a newer server is drawn as the one-way card")
        XCTAssertEqual(OutboundCallResult.duration(0), "0:00")
        XCTAssertEqual(OutboundCallResult.duration(65), "1:05")
    }
}
