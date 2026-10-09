// Threads in a conversation between two people on iOS (#262), the people of a
// room in "@" (#274) and a notification tap without a bot.
import Foundation
import XCTest
@testable import CompanionCore

private final class PersonThreadsStub: URLProtocol {
    static var requests: [URLRequest] = []
    static var bodies: [Data] = []
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.append(request)
        var data = request.httpBody ?? Data()
        if data.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable {
                let n = stream.read(&buffer, maxLength: buffer.count)
                if n <= 0 { break }
                data.append(buffer, count: n)
            }
            stream.close()
        }
        Self.bodies.append(data)
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{}".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class PersonThreadsTests: XCTestCase {
    private func room(threadId: String, tasks: [(String, Bool)], unread: Bool = false, messages: Bool = false, peopleDm: Bool = true) throws -> Room {
        let list = tasks.map { #"{"threadId":"\#($0.0)","title":"T \#($0.0)","createdAt":1,"unread":\#($0.1)}"# }.joined(separator: ",")
        let json = """
        {"id":"g1","threadId":"\(threadId)","name":"Ada","memberIds":[],"defaultResponder":{"kind":"auto"},"bulletin":"","unread":\(unread),"createdAt":1,
         "peopleDm":\(peopleDm),"humanIds":["p_me","p_ada"],"tasks":[\(list)]\(messages ? #","messages":[]"# : "")}
        """
        return try JSONDecoder().decode(Room.self, from: Data(json.utf8))
    }

    func testAPersonsConversationHasThreads() throws {
        XCTAssertTrue(Chat.room(try room(threadId: "t1", tasks: [("t1", false)])).supportsTasks)
        var botRoom = try room(threadId: "t1", tasks: [("t1", false)], peopleDm: false)
        botRoom.dm = true
        XCTAssertFalse(Chat.room(botRoom).supportsTasks, "a bot-to-bot room stays one thread")
    }

    func testALiveFrameKeepsTheThreadOpenHere() throws {
        let open = try room(threadId: "t2", tasks: [("t1", false), ("t2", false)])
        let frame = try room(threadId: "t1", tasks: [("t1", true), ("t2", false)])
        XCTAssertEqual(PersonThreads.keptThreadId(previous: open, incoming: frame), "t2")
        let gone = try room(threadId: "t1", tasks: [("t1", false)])
        XCTAssertEqual(PersonThreads.keptThreadId(previous: open, incoming: gone), "t1", "the other person deleted it")
        let page = try room(threadId: "t1", tasks: [("t1", false), ("t2", false)], messages: true)
        XCTAssertEqual(PersonThreads.keptThreadId(previous: open, incoming: page), "t1", "a switch carries its page")

        var state = CompanionState()
        state.apply(.room(open))
        state.apply(.room(frame))
        XCTAssertEqual(state.rooms.first?.threadId, "t2")
        XCTAssertEqual(state.rooms.first?.tasks?.first { $0.threadId == "t1" }?.unread, true)
    }

    func testReadsTheOpenThreadOnly() throws {
        XCTAssertEqual(PersonThreads.readTarget(try room(threadId: "t1", tasks: [("t1", true), ("t2", true)], unread: true)), "t1")
        XCTAssertNil(PersonThreads.readTarget(try room(threadId: "t1", tasks: [("t1", false), ("t2", true)], unread: true)),
                     "a sibling's unread is never read from here")
        XCTAssertEqual(PersonThreads.readTarget(try room(threadId: "t1", tasks: [("t1", false)])), "t1")
        XCTAssertEqual(PersonThreads.unreadThreads(try room(threadId: "t1", tasks: [("t1", true), ("t2", true)])), 2)
    }

    func testRequestsCarryTheHeaderAndTheThread() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PersonThreadsStub.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let client = CompanionClient(connection: Connection(name: "Org", host: "127.0.0.1", port: 8810), token: "t", session: session)
        PersonThreadsStub.requests = []
        PersonThreadsStub.bodies = []

        try await client.markRead(roomId: "g1", threadId: "t2")
        try await client.patchRoomTask(groupId: "g1", threadId: "t2", archivedAt: .some(nil))
        try await client.patchRoomTask(groupId: "g1", threadId: "t2", snoozedUntil: .some(0))
        _ = try await client.send(text: "hi", toRoom: "g1", threadId: "t2")

        XCTAssertEqual(PersonThreadsStub.requests.map { $0.value(forHTTPHeaderField: "x-sagax-person-threads") }, ["1", "1", "1", "1"])
        XCTAssertEqual(PersonThreadsStub.requests[0].url?.path, "/api/groups/g1/read")
        func json(_ i: Int) throws -> [String: Any] { try XCTUnwrap(JSONSerialization.jsonObject(with: PersonThreadsStub.bodies[i]) as? [String: Any]) }
        XCTAssertEqual(try json(0)["threadId"] as? String, "t2")
        XCTAssertEqual(PersonThreadsStub.requests[1].httpMethod, "PATCH")
        XCTAssertEqual(PersonThreadsStub.requests[1].url?.path, "/api/groups/g1/tasks/t2")
        XCTAssertTrue(try json(1)["archivedAt"] is NSNull, "null restores")
        XCTAssertNil(try json(1)["snoozedUntil"])
        XCTAssertEqual(try json(2)["snoozedUntil"] as? Double, 0)
        XCTAssertEqual(try json(3)["threadId"] as? String, "t2")
    }

    func testANotificationWithoutABotOpensItsConversation() {
        let person = NotificationTarget(payload: ["botId": "", "groupId": "g1", "threadId": "t2"])
        XCTAssertEqual(person?.botId, "g1")
        XCTAssertEqual(person?.threadId, "t2")
        XCTAssertEqual(NotificationTarget(payload: ["botId": "b1", "groupId": "g1", "threadId": "t"])?.botId, "b1")
        XCTAssertNil(NotificationTarget(payload: ["botId": "", "threadId": "t"]))
        let frame = try? JSONDecoder().decode(NotificationFrame.self, from: Data(#"{"kind":"message","botId":"","botName":"Ada","threadId":"t2","groupId":"g1","title":"Ada","body":"hi"}"#.utf8))
        XCTAssertEqual(frame?.groupId, "g1")
    }

    func testThreadMenuArchivesAndSnoozesAPersonsThread() throws {
        let task = try XCTUnwrap(try room(threadId: "t1", tasks: [("t1", false)]).tasks?.first)
        let person = ThreadMenuPlan(task: task, ownerIsBot: false, folders: [], generatedTitles: true, canDelete: true, personThreads: true)
        XCTAssertTrue(person.shows(.archive))
        XCTAssertTrue(person.shows(.snooze))
        XCTAssertFalse(person.shows(.regenerateTitle), "no generated title in a person's conversation")
        let teamRoom = ThreadMenuPlan(task: task, ownerIsBot: false, folders: [], generatedTitles: true, canDelete: true)
        XCTAssertFalse(teamRoom.shows(.archive))
    }

    func testARoomOffersItsPeopleToTag() throws {
        var team = try room(threadId: "t1", tasks: [("t1", false)], peopleDm: false)
        team.memberIds = []
        let people = [MentionChoice(id: "p_ada", name: "Ada Lovelace", isPerson: true)]
        let pool = MentionSuggestions.pool(for: .room(team), bots: [], people: people)
        XCTAssertEqual(pool.map(\.id), [MentionChoice.everyoneId, "p_ada"])
        XCTAssertTrue(pool[1].isPerson)
        let dm = try room(threadId: "t1", tasks: [("t1", false)])
        XCTAssertFalse(MentionSuggestions.pool(for: .room(dm), bots: [], people: people).contains { $0.isPerson })
    }
}
