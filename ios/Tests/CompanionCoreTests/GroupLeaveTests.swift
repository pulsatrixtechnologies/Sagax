import XCTest
@testable import CompanionCore

/// #1480: a person leaves a group; their devices drop it, the others read
/// one neutral line.
final class GroupLeaveTests: XCTestCase {
    func testTheLeftFrameDropsTheRoomLikeADeletedOne() throws {
        let frame = try JSONDecoder().decode(Frame.self, from: Data(#"{"kind":"group.left","roomId":"g-1","audience":"p-me"}"#.utf8))
        guard case .roomDeleted(let groupId) = frame else { return XCTFail("expected roomDeleted, got \(frame)") }
        XCTAssertEqual(groupId, "g-1")
    }

    func testARosterLineDecodesWithItsNote() throws {
        let json = #"{"id":"m1","role":"bot","kind":"roster","at":1,"text":"Ann left the group","roster":{"event":"left","personId":"p-ann","name":"Ann"}}"#
        let message = try JSONDecoder().decode(Message.self, from: Data(json.utf8))
        XCTAssertEqual(message.kind, .roster)
        XCTAssertEqual(message.roster, RosterNote(event: "left", personId: "p-ann", name: "Ann"))
    }

    func testTheLeaveRequestPostsToTheGroupsOwnRoute() throws {
        let client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t", session: .shared)
        let request = try client.leaveRoomRequest(groupId: "g-1")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/groups/g-1/leave")
    }
}
