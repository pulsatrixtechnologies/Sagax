import XCTest
@testable import CompanionCore

final class NotificationApprovalTests: XCTestCase {
    func testAllowAndDenyNeedARequest() {
        let info = ["threadId": "t1", "botId": "b1", "requestId": "r1", "kind": "approval"]
        XCTAssertEqual(
            NotificationApproval.decide(actionIdentifier: NotificationApproval.allowAction, info: info),
            .allow(threadId: "t1", requestId: "r1", needsKey: false)
        )
        XCTAssertEqual(
            NotificationApproval.decide(actionIdentifier: NotificationApproval.denyAction, info: info),
            .deny(threadId: "t1", requestId: "r1")
        )
        XCTAssertEqual(
            NotificationApproval.decide(actionIdentifier: NotificationApproval.allowAction, info: info.merging(["needsKey": "1"]) { _, new in new }),
            .allow(threadId: "t1", requestId: "r1", needsKey: true)
        )
    }

    func testAMissingRequestOpensTheConversation() {
        let info = ["threadId": "t1", "botId": "b1", "kind": "approval"]
        XCTAssertEqual(
            NotificationApproval.decide(actionIdentifier: NotificationApproval.allowAction, info: info),
            .open(NotificationTarget(botId: "b1", threadId: "t1")!)
        )
        XCTAssertNil(NotificationApproval.decide(actionIdentifier: NotificationApproval.denyAction, info: ["kind": "approval"]))
    }

    func testABadIdIsNotSent() {
        let info = ["threadId": "../t", "requestId": "r1", "botId": "b1"]
        let opened = NotificationApproval.decide(actionIdentifier: NotificationApproval.allowAction, info: info)
        guard case .open(let target) = opened else { return XCTFail("opens, does not post") }
        XCTAssertEqual(target.threadId, "../t")
        XCTAssertEqual(target.botId, "b1")
    }

    func testATapOpensAndAKeyFollowUpConfirms() {
        let info = ["threadId": "t1", "botId": "b1", "requestId": "r1", "stepUp": NotificationApproval.stepUpPending]
        XCTAssertEqual(
            NotificationApproval.decide(actionIdentifier: NotificationApproval.defaultAction, info: info),
            .confirmKey(threadId: "t1", requestId: "r1")
        )
        XCTAssertEqual(
            NotificationApproval.decide(actionIdentifier: NotificationApproval.defaultAction, info: ["threadId": "t1", "botId": "b1"]),
            .open(NotificationTarget(botId: "b1", threadId: "t1")!)
        )
        XCTAssertNil(NotificationApproval.decide(actionIdentifier: NotificationApproval.dismissAction, info: info))
    }

    func testAKeyRefusalDoesNotApproveInTheBackground() {
        XCTAssertEqual(NotificationApproval.afterRefusal(appActive: true), .ceremony)
        XCTAssertEqual(NotificationApproval.afterRefusal(appActive: false), .deferToApp)
    }

    func testOnlyAnApprovalOrAQuestionWithARequestGetsActions() {
        XCTAssertEqual(NotificationApproval.category(kind: "approval", requestId: "r1", needsKey: false), NotificationApproval.category)
        XCTAssertEqual(NotificationApproval.category(kind: "approval", requestId: "r1", needsKey: true), NotificationApproval.keyCategory)
        XCTAssertEqual(NotificationApproval.category(kind: "question", requestId: "q1", needsKey: false), NotificationApproval.questionCategory)
        XCTAssertEqual(NotificationApproval.category(kind: "question", requestId: nil, needsKey: false), NotificationApproval.updateCategory)
        XCTAssertEqual(NotificationApproval.category(kind: "approval", requestId: nil, needsKey: false), NotificationApproval.updateCategory)
        XCTAssertEqual(NotificationApproval.category(kind: "done", requestId: nil, needsKey: false), NotificationApproval.updateCategory)
    }

    func testReplyAnswersTheQuestionWithTheTypedText() {
        let info = ["threadId": "t1", "botId": "b1", "requestId": "q1", "kind": "approval", "prompt": "question"]
        XCTAssertEqual(
            NotificationApproval.decide(actionIdentifier: NotificationApproval.replyAction, info: info, replyText: "  Tuesday  "),
            .reply(threadId: "t1", requestId: "q1", text: "Tuesday")
        )
        XCTAssertEqual(
            NotificationApproval.decide(actionIdentifier: NotificationApproval.replyAction, info: info, replyText: "   "),
            .open(NotificationTarget(botId: "b1", threadId: "t1")!),
            "nothing typed: the conversation opens"
        )
        XCTAssertEqual(
            NotificationApproval.decide(actionIdentifier: NotificationApproval.replyAction, info: ["threadId": "t1", "botId": "b1"], replyText: "yes"),
            .open(NotificationTarget(botId: "b1", threadId: "t1")!),
            "no request: nothing is sent"
        )
    }
}
