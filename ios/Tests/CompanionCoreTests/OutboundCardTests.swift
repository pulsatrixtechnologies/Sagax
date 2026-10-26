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
}
