import Foundation
import XCTest
@testable import CompanionCore

/// 2026-10-30: proactive bots wired for real (server/proactive-wake.ts).
/// The phone reads a bot's mode like the server (absent is follow-rules,
/// unknown is off), draws a proposal card until it is answered and answers
/// it on its own route (shared/proactive-proposal.ts).
final class ProactiveModeTests: XCTestCase {
    func testModeReadsLikeTheServer() {
        XCTAssertEqual(ProactiveMode.of(nil), .followRules)
        XCTAssertEqual(ProactiveMode.of("propose"), .propose)
        XCTAssertEqual(ProactiveMode.of("read-auto"), .readAuto)
        XCTAssertEqual(ProactiveMode.of("off"), .off)
        XCTAssertEqual(ProactiveMode.of("garbled"), .off)
        XCTAssertEqual(ProactiveMode.allCases.map(\.rawValue), ["off", "propose", "read-auto", "follow-rules"])
    }

    private func card(_ json: String) throws -> OptionCard {
        try JSONDecoder().decode(OptionCard.self, from: Data(json.utf8))
    }

    func testProposalCardDecodesAndAnswersWithItsFirstOption() throws {
        let proposal = try card(#"{"title":"Nova offers to handle this","subtitle":"alex@example.com: Invoice 4. Shall I handle it?","options":["Yes, handle it","No thanks"],"proactiveProposal":{"id":"p1"}}"#)
        XCTAssertEqual(proposal.proactiveProposal?.id, "p1")
        XCTAssertTrue(ProactiveProposalRules.isProposal(proposal))
        XCTAssertTrue(ProactiveProposalRules.accepts(proposal, answer: "Yes, handle it"))
        XCTAssertTrue(ProactiveProposalRules.accepts(proposal, answer: " Yes, handle it "))
        XCTAssertFalse(ProactiveProposalRules.accepts(proposal, answer: "No thanks"))
        XCTAssertFalse(ProactiveProposalRules.isSettled(proposal))
        let plain = try card(#"{"title":"Pick","subtitle":"","options":["A"]}"#)
        XCTAssertFalse(ProactiveProposalRules.isProposal(plain))
    }

    func testProposalStaysUntilAnswered() throws {
        let proposal = try JSONDecoder().decode(Message.self, from: Data(#"{"id":"m1","role":"bot","kind":"options","at":1,"card":{"title":"T","subtitle":"S","options":["Yes, handle it","No thanks"],"proactiveProposal":{"id":"p1"}}}"#.utf8))
        let later = try JSONDecoder().decode(Message.self, from: Data(#"{"id":"m2","role":"user","kind":"text","at":2,"text":"Something else"}"#.utf8))
        XCTAssertFalse(OptionCardRules.isOnboardingCard(proposal))
        XCTAssertFalse(OptionCardRules.hidesOnboardingCard(proposal, in: [proposal, later]))
    }

    func testPatchCarriesTheMode() throws {
        let data = try JSONEncoder().encode(BotPanelPatch(proactiveMode: "propose"))
        XCTAssertEqual(try JSONSerialization.jsonObject(with: data) as? [String: String], ["proactiveMode": "propose"])
    }
}
