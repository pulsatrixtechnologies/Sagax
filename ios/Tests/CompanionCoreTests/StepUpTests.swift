import Foundation
import XCTest
@testable import CompanionCore

final class StepUpTests: XCTestCase {
    private func response(_ status: Int) -> HTTPURLResponse {
        HTTPURLResponse(url: URL(string: "https://sagax.example.com/api/threads/t/respond")!, statusCode: status, httpVersion: nil, headerFields: nil)!
    }

    func testAStepUpRefusalCarriesWhatToSign() throws {
        let body = #"{"error":"This approval needs your security key.","code":"step_up_required","classes":["destructive"],"target":{"kind":"approval","threadId":"t","requestId":"r","answer":{}}}"#
        XCTAssertThrowsError(try CompanionClient.checkStepUp(response(403), Data(body.utf8))) { error in
            guard let refusal = error as? StepUpRequired else { return XCTFail("expected a step-up refusal, got \(error)") }
            let target = try? JSONSerialization.jsonObject(with: refusal.target) as? [String: Any]
            XCTAssertEqual(target?["requestId"] as? String, "r")
            XCTAssertFalse(refusal.failed)
        }
    }

    func testAnyOtherRefusalStaysAnAPIError() {
        XCTAssertThrowsError(try CompanionClient.checkStepUp(response(403), Data(#"{"error":"Only the bot owner can answer this approval."}"#.utf8))) { error in
            XCTAssertTrue(error is APIError)
        }
    }

    func testOnlyTheMatchingCeremonyCountsAsDone() {
        let ok = URL(string: "sagax://security-key-done?status=ok&ceremony=abc")
        XCTAssertTrue(CompanionClient.stepUpSucceeded(ok, ceremonyId: "abc"))
        XCTAssertFalse(CompanionClient.stepUpSucceeded(ok, ceremonyId: "other"))
        XCTAssertFalse(CompanionClient.stepUpSucceeded(URL(string: "sagax://security-key-done?status=error&ceremony=abc"), ceremonyId: "abc"))
        XCTAssertFalse(CompanionClient.stepUpSucceeded(URL(string: "sagax://pair?status=ok&ceremony=abc"), ceremonyId: "abc"))
        XCTAssertFalse(CompanionClient.stepUpSucceeded(nil, ceremonyId: "abc"))
    }
}
