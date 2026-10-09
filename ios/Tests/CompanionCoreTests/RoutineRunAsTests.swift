// "Runs as" in the routine editor (the desktop's RunAsField.test.ts rules):
// the options route, the rows and their search, a choice that no longer
// stands, and what a save sends.
import Foundation
import XCTest
@testable import CompanionCore

private final class RunAsStub: URLProtocol {
    static var captured: URLRequest?
    static var body = Data()

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.captured = request
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class RoutineRunAsTests: XCTestCase {
    private let options = RoutineRunAsOptions(
        canChoose: true,
        people: [
            RoutineRunAsOption(principalId: "p1", name: "Alice"),
            RoutineRunAsOption(principalId: "p2", name: "Bruno", selectable: false, reason: "no_right"),
            RoutineRunAsOption(principalId: "p3", name: "Chloe", pending: true),
        ],
        current: RoutineRunAsCurrent(principalId: "p9", name: "Zoe")
    )

    func testTheServersAnswerDecodesAndASoloServerShowsNothing() throws {
        let decoded = try JSONDecoder().decode(RoutineRunAsOptions.self, from: Data(#"""
        {"canChoose":true,"people":[{"principalId":"p1","name":"Alice","selectable":true},
         {"principalId":"p2","name":"Bruno","selectable":false,"reason":"no_right","pending":true}],
         "current":{"principalId":"p1","name":"Alice","pending":true}}
        """#.utf8))
        XCTAssertTrue(decoded.canChoose)
        XCTAssertEqual(decoded.people.map(\.principalId), ["p1", "p2"])
        XCTAssertEqual(decoded.people[1].reason, "no_right")
        XCTAssertEqual(decoded.current?.pending, true)
        let solo = try JSONDecoder().decode(RoutineRunAsOptions.self, from: Data(#"{"canChoose":false,"people":[]}"#.utf8))
        XCTAssertFalse(RoutineRunAsField.shown(solo), "a solo server: no field")
        XCTAssertFalse(RoutineRunAsField.shown(nil))
        XCTAssertTrue(RoutineRunAsField.shown(RoutineRunAsOptions(canChoose: false, current: RoutineRunAsCurrent(principalId: "p1", name: "A"))), "the line alone")
    }

    func testRowsKeepTheCurrentPersonFirstAndFilterByName() {
        let rows = RoutineRunAsField.rows(options, selected: "p9", query: "")
        XCTAssertEqual(rows.map(\.principalId), ["p9", "p1", "p2", "p3"], "the current person, unlisted, comes first")
        XCTAssertEqual(RoutineRunAsField.rows(options, selected: "p9", query: "chl").map(\.principalId), ["p9", "p3"])
        XCTAssertEqual(RoutineRunAsField.rows(options, selected: "p1", query: "zzz").map(\.principalId), ["p1"], "the selection is always kept")
        XCTAssertEqual(RoutineRunAsField.chosen(options, selected: nil)?.name, "Zoe")
        XCTAssertEqual(RoutineRunAsField.chosen(options, selected: "p3")?.pending, true)
        XCTAssertEqual(RoutineRunAsField.searchAfter, 8)
    }

    func testAChoiceThatNoLongerStandsFallsBackAndOnlyAChangeIsSent() {
        XCTAssertEqual(RoutineRunAsField.keep("p1", in: options), "p1")
        XCTAssertNil(RoutineRunAsField.keep("p2", in: options), "cannot run this bot's routines")
        XCTAssertNil(RoutineRunAsField.keep("gone", in: options))
        XCTAssertEqual(RoutineRunAsField.toSend("p1", options: options), "p1")
        XCTAssertNil(RoutineRunAsField.toSend("p9", options: options), "the current person is not resent")
        XCTAssertNil(RoutineRunAsField.toSend(nil, options: options))
        XCTAssertNil(RoutineRunAsField.toSend("p1", options: RoutineRunAsOptions(canChoose: false, people: options.people)), "no choice, nothing sent")
    }

    func testSavesCarryRunAsOnlyWhenItChanged() throws {
        var input = RoutineInput(name: "Pulse", prompt: "Check", botId: "b1", schedule: .daily(time: "09:00", weekdays: [1, 2, 3, 4, 5]))
        XCTAssertNil(RoutinePatch.createBody(input)["runAs"])
        input.runAs = "p1"
        XCTAssertEqual(RoutinePatch.createBody(input)["runAs"] as? String, "p1")

        let original = try JSONDecoder().decode(Routine.self, from: Data(#"""
        {"id":"r1","name":"Pulse","prompt":"Check","botId":"b1","runOn":"maus","enabled":true,
         "schedule":{"type":"daily","time":"09:00","weekdays":[1,2,3,4,5]},"durationMinutes":30,
         "createdAt":1,"updatedAt":1,"runAs":{"principalId":"p1","name":"Alice"}}
        """#.utf8))
        XCTAssertNil(RoutinePatch.body(original: original, input: input)["runAs"], "same person: not sent")
        input.runAs = "p3"
        XCTAssertEqual(RoutinePatch.body(original: original, input: input)["runAs"] as? String, "p3")
    }

    func testTheOptionsRouteAsksForTheBotTheRoutineAndTheRoom() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RunAsStub.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t", session: session)
        RunAsStub.body = Data(#"{"canChoose":true,"people":[{"principalId":"p1","name":"Alice","selectable":true}]}"#.utf8)
        let answer = try await client.routineRunAsOptions(botId: "b1", routineId: "r1", target: "room-goal", groupId: "g1")
        XCTAssertEqual(answer.people.first?.name, "Alice")
        let url = try XCTUnwrap(RunAsStub.captured?.url)
        XCTAssertEqual(url.path, "/api/routines/run-as-options")
        let items = Dictionary(uniqueKeysWithValues: (URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(items, ["botId": "b1", "routineId": "r1", "target": "room-goal", "groupId": "g1"])
        XCTAssertEqual(RunAsStub.captured?.httpMethod, "GET")
    }
}

final class BotTemplatesEntryTests: XCTestCase {
    func testTemplatesWhenOnAndAllowedElseTheNewBotSheet() {
        let admin = SurfaceGate(scope: .serverAdmin)
        let client = SurfaceGate(scope: .serverClient)
        var on = ServerFeatures()
        on.templates = true
        XCTAssertEqual(BotTemplatesEntry.destination(gate: admin, features: on), .templates)
        XCTAssertEqual(BotTemplatesEntry.destination(gate: admin, features: ServerFeatures()), .newBot, "Templates off: the new bot sheet")
        XCTAssertEqual(BotTemplatesEntry.destination(gate: client, features: on), .templates, "Browse Bots is a member's too")
        XCTAssertEqual(BotTemplatesEntry.destination(gate: SurfaceGate(scope: .sidecar), features: on), .newBot, "the sidecar has no catalogue")
        XCTAssertEqual(BotTemplatesEntry.destination(gate: admin, features: nil), .newBot)
    }
}
