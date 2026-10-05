// Client calls behind the home screens: create a bot with its look (20),
// with the fallback for a server that refuses the look at create time, and
// group pins, which a server without them must not appear to accept.
import Foundation
import XCTest
@testable import CompanionCore

private final class HomeRequestStub: URLProtocol {
    /// Answers in order; the last one repeats.
    static var responses: [(status: Int, body: String)] = []
    static var requests: [(request: URLRequest, body: Data?)] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.requests.append((request, Self.readBody(from: request)))
        let index = min(Self.requests.count - 1, Self.responses.count - 1)
        let answer = Self.responses[max(0, index)]
        let response = HTTPURLResponse(
            url: request.url!, statusCode: answer.status, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
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

final class HomeClientTests: XCTestCase {
    private var session: URLSession!
    private var client: CompanionClient!

    private static let botJSON = #"""
    {"bot":{"id":"bot-9","threadId":"thread-9","name":"Nova","title":"","description":"",
    "notifications":true,"color":"teal","unread":false,
    "modelSelection":{"instanceId":"claude","model":"default"},"createdAt":1}}
    """#

    private static func groupJSON(pinned: Bool?) -> String {
        let pin = pinned.map { #","pinned":\#($0)"# } ?? ""
        return #"{"group":{"id":"g-1","threadId":"t-g","name":"Peer Managers","memberIds":["a","b"],"defaultResponder":{"kind":"first"},"bulletin":"","unread":false,"createdAt":1\#(pin)}}"#
    }

    override func setUp() {
        super.setUp()
        HomeRequestStub.responses = [(200, "{}")]
        HomeRequestStub.requests = []
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [HomeRequestStub.self]
        session = URLSession(configuration: configuration)
        client = CompanionClient(
            connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810),
            token: "paired-token",
            session: session
        )
    }

    override func tearDown() {
        session.invalidateAndCancel()
        session = nil
        client = nil
        super.tearDown()
    }

    private func json(_ index: Int) throws -> [String: Any] {
        let body = try XCTUnwrap(HomeRequestStub.requests[index].body)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
    }

    // MARK: Create bot

    func testDefaultOwlSendsNameAndColourOnly() async throws {
        HomeRequestStub.responses = [(201, Self.botJSON)]
        let bot = try await client.createBot(NewBotDraft(name: "  Nova ", color: "teal"))
        XCTAssertEqual(bot.id, "bot-9")
        XCTAssertEqual(HomeRequestStub.requests.count, 1)
        let request = HomeRequestStub.requests[0].request
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/bots")
        let body = try json(0)
        XCTAssertEqual(body["name"] as? String, "Nova")
        XCTAssertEqual(body["settings"] as? [String: String], ["color": "teal"])
    }

    func testACustomLookRidesInSettings() async throws {
        HomeRequestStub.responses = [(201, Self.botJSON)]
        let look = MascotLook(character: .shape, shape: .cloud, skins: .init(shape: .glossy))
        _ = try await client.createBot(NewBotDraft(name: "Nova", color: "orange", look: look, skin: .none))
        let settings = try XCTUnwrap(try json(0)["settings"] as? [String: Any])
        XCTAssertEqual(settings["color"] as? String, "orange")
        let sent = try XCTUnwrap(settings["mascotLook"] as? [String: Any])
        XCTAssertEqual(sent["character"] as? String, "shape")
        XCTAssertEqual(sent["shape"] as? String, "cloud")
        XCTAssertNil(settings["mascotSkin"])
        XCTAssertEqual(HomeRequestStub.requests.count, 1)
    }

    func testARefusedLookFallsBackToCreateThenPatch() async throws {
        HomeRequestStub.responses = [
            (400, #"{"error":"Unrecognized key: \"mascotLook\""}"#),
            (201, Self.botJSON),
            (200, Self.botJSON),
        ]
        let draft = NewBotDraft(name: "Nova", color: "teal", look: .owl, skin: .gold)
        let bot = try await client.createBot(draft)
        XCTAssertEqual(bot.id, "bot-9")
        XCTAssertEqual(HomeRequestStub.requests.count, 3)
        XCTAssertEqual(try json(0)["settings"] as? [String: String], ["color": "teal", "mascotSkin": "gold"])
        XCTAssertEqual(try json(1)["settings"] as? [String: String], ["color": "teal"])
        let patch = HomeRequestStub.requests[2].request
        XCTAssertEqual(patch.httpMethod, "PATCH")
        XCTAssertEqual(patch.url?.path, "/api/bots/bot-9")
        XCTAssertEqual(try json(2) as? [String: String], ["mascotSkin": "gold"])
    }

    func testOtherRefusalsAreNotRetried() async {
        HomeRequestStub.responses = [(403, #"{"error":"forbidden"}"#)]
        let draft = NewBotDraft(name: "Nova", look: MascotLook(character: .trombi))
        do {
            _ = try await client.createBot(draft)
            XCTFail("expected a refusal")
        } catch let APIError.status(code, _) {
            XCTAssertEqual(code, 403)
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertEqual(HomeRequestStub.requests.count, 1)
    }

    func testABlankNameIsNotSent() {
        XCTAssertThrowsError(try client.createBotRequest(NewBotDraft(name: "   "), includeLook: true))
    }

    // MARK: Create bot, More options (WP13)

    func testMoreOptionsRideAsTheDesktopSendsThem() async throws {
        HomeRequestStub.responses = [(201, Self.botJSON)]
        let draft = NewBotDraft(
            name: "Scout", color: "teal", title: "Researcher", description: "Digs.", soul: "Cite sources.",
            section: "Administration", preset: "preset-1", mascotBody: "round", mascotExpression: "happy"
        )
        _ = try await client.createBot(draft)
        let body = try json(0)
        XCTAssertEqual(body["name"] as? String, "Scout")
        XCTAssertEqual(body["title"] as? String, "Researcher")
        XCTAssertEqual(body["description"] as? String, "Digs.")
        XCTAssertEqual(body["section"] as? String, "Administration")
        XCTAssertEqual(body["preset"] as? String, "preset-1")
        XCTAssertNil(body["soul"], "instructions ride in settings, the strict profile schema")
        XCTAssertEqual(body["settings"] as? [String: String], [
            "color": "teal", "soul": "Cite sources.", "mascotBody": "round", "mascotExpression": "happy",
        ])
    }

    func testUntouchedOptionsAreNotSent() async throws {
        HomeRequestStub.responses = [(201, Self.botJSON)]
        _ = try await client.createBot(NewBotDraft(name: "Nova"))
        XCTAssertEqual(Set(try json(0).keys), ["name", "settings"])
    }

    func testARefusedLookKeepsTheOptionsOnTheRetry() async throws {
        HomeRequestStub.responses = [(400, #"{"error":"bad"}"#), (201, Self.botJSON), (200, Self.botJSON)]
        let draft = NewBotDraft(name: "Nova", look: MascotLook(character: .trombi), title: "T", soul: "S", section: "Ops")
        _ = try await client.createBot(draft)
        let retry = try json(1)
        XCTAssertEqual(retry["title"] as? String, "T")
        XCTAssertEqual(retry["section"] as? String, "Ops")
        XCTAssertEqual((retry["settings"] as? [String: Any])?["soul"] as? String, "S")
        XCTAssertNil((retry["settings"] as? [String: Any])?["mascotLook"])
    }

    func testPresetsAreRead() async throws {
        HomeRequestStub.responses = [(200, #"""
        {"presets":[{"id":"p1","source":"org","key":"k","name":"Analyst","packageName":"Pack","release":"1.0",
        "publisherName":"Acme","bot":{"title":"Analyst","soul":"Be exact.","appearance":{"color":"blue"}},
        "skills":[{"name":"report","description":"d"}],"skillsEnabled":true,"playbooks":[],"notes":["MEMORY.md"]}]}
        """#)]
        let presets = try await client.botPresets()
        XCTAssertEqual(HomeRequestStub.requests[0].request.url?.path, "/api/bot-presets")
        XCTAssertEqual(presets.map(\.id), ["p1"])
        XCTAssertEqual(presets[0].bot.appearance?.color, "blue")
        XCTAssertEqual(presets[0].skills.map(\.name), ["report"])
    }

    func testBotPatchCarriesTheLook() throws {
        let patch = BotPatch(mascotLook: MascotLook(character: .trombi, skins: .init(trombi: .gold)), mascotSkin: .neon)
        XCTAssertFalse(patch.isEmpty)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(patch)) as? [String: Any])
        XCTAssertEqual(Set(object.keys), ["mascotLook", "mascotSkin"])
    }

    // MARK: Group pins

    func testGroupPinIsAPinnedOnlyPatch() async throws {
        HomeRequestStub.responses = [(200, Self.groupJSON(pinned: true))]
        let room = try await client.setGroupPinned(groupId: "g-1", pinned: true)
        XCTAssertEqual(room.pinned, true)
        let request = HomeRequestStub.requests[0].request
        XCTAssertEqual(request.httpMethod, "PATCH")
        XCTAssertEqual(request.url?.path, "/api/groups/g-1")
        XCTAssertEqual(try json(0) as? [String: Bool], ["pinned": true])
    }

    func testAServerThatDropsThePinIsUnsupported() async {
        HomeRequestStub.responses = [(200, Self.groupJSON(pinned: nil))]
        do {
            _ = try await client.setGroupPinned(groupId: "g-1", pinned: true)
            XCTFail("expected unsupported")
        } catch {
            XCTAssertTrue(error is GroupPinUnsupported)
        }
    }

    func testGroupPinRefusesAPathLikeId() {
        XCTAssertThrowsError(try client.setGroupPinnedRequest(groupId: "../x", pinned: true))
    }

    // MARK: Decoding

    func testRoomAndBotDecodeTheNewOptionalFields() throws {
        let room = try JSONDecoder().decode(GroupResponse.self, from: Data(Self.groupJSON(pinned: false).utf8)).group
        XCTAssertEqual(room.pinned, false)
        let bot = try JSONDecoder().decode(CreatedBot.self, from: Data(#"""
        {"bot":{"id":"b","threadId":"t","name":"Ara","title":"","description":"","notifications":true,
        "color":"purple","unread":false,"modelSelection":{"instanceId":"claude","model":"default"},
        "createdAt":1,"instructionsLead":"Ara, Chief of Staff"}}
        """#.utf8)).bot
        XCTAssertEqual(bot.instructionsLead, "Ara, Chief of Staff")
    }

    func testAuthSessionReadsAPhoto() throws {
        let session = try JSONDecoder().decode(AuthSession.self, from: Data(#"{"kind":"session","scopes":["client"],"avatarUrl":"/api/people/pr_1/avatar?v=0123456789abcdef"}"#.utf8))
        XCTAssertEqual(session.avatar?.route, .person(id: "pr_1", version: "0123456789abcdef"))
        // A `picture` claim names Perspicax itself: never fetched by the phone.
        let claim = try JSONDecoder().decode(AuthSession.self, from: Data(#"{"kind":"session","scopes":["client"],"picture":"https://example.com/me.png"}"#.utf8))
        XCTAssertNil(claim.avatarUrl)
        XCTAssertNil(claim.avatar)
        let none = try JSONDecoder().decode(AuthSession.self, from: Data(#"{"kind":"session","scopes":[],"avatarUrl":" "}"#.utf8))
        XCTAssertNil(none.avatarUrl)
    }
}
