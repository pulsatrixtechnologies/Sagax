import Foundation
import XCTest
@testable import CompanionCore

/// Demo mode: realistic local data, simulated replies, and no network.
final class DemoModeTests: XCTestCase {
    private let clock = Date(timeIntervalSince1970: 1_790_000_000)

    func testTheFixtureIsDeterministicAndGeneric() {
        let a = DemoServer(now: clock, chunkDelay: 0).fleet
        let b = DemoServer(now: clock, chunkDelay: 0).fleet
        XCTAssertEqual(a.bots, b.bots)
        XCTAssertEqual(a.groups, b.groups)
        XCTAssertEqual(a.bots.map(\.name), ["Atlas", "Scout", "Pixel", "Forge"])
        XCTAssertEqual(a.groups.map(\.name), ["Launch room"])
        // an approval waits on you, a bot works, a person talks in the group
        XCTAssertTrue(a.bots.contains { $0.messages?.contains { $0.card?.isPending == true } == true })
        XCTAssertTrue(a.bots.contains { $0.busy == true })
        XCTAssertTrue(a.groups[0].messages?.contains { $0.from?.name == "Sam Rivera" } == true)
        XCTAssertEqual(a.bots.first { $0.name == "Pixel" }?.mascotLook?.character, .shape)
        XCTAssertEqual(a.bots.first { $0.name == "Forge" }?.mascotSkin, .neon)
        XCTAssertNotNil(DemoServer(now: clock).connection.baseURL)
    }

    func testTheClientReadsTheDemoWithoutANetwork() async throws {
        let server = DemoServer(now: clock, chunkDelay: 0)
        defer { server.stop() }
        let client = server.makeClient()
        let fleet = try await client.fleet()
        XCTAssertEqual(fleet.bots.count, 4)
        let routines = try await client.routines()
        XCTAssertEqual(routines.routines.map(\.name), ["Morning digest"])
        let page = try await client.messages(threadId: "demo-thread-scout")
        XCTAssertEqual(page.messages.last?.id, "scout-approval")
        XCTAssertTrue(server.handledRequests.allSatisfy { $0.contains("/api/") })
    }

    func testASendStreamsAReplyAndSettlesIt() async throws {
        let server = DemoServer(now: clock, chunkDelay: 0)
        defer { server.stop() }
        let frames = FrameLog()
        server.onFrame = { frames.append($0) }
        let client = server.makeClient()
        _ = try await client.send(text: "hello", toBot: "demo-atlas", threadId: "demo-thread-atlas")
        let log = frames.all
        guard case let .message(_, user) = log.first else { return XCTFail("the user's line comes first") }
        XCTAssertEqual(user.role, .user)
        XCTAssertEqual(user.text, "hello")
        XCTAssertTrue(log.contains { if case .runtime = $0 { return true }; return false })
        guard case let .message(thread, reply) = log.last(where: { if case .message = $0 { return true }; return false }) else { return XCTFail() }
        XCTAssertEqual(thread, "demo-thread-atlas")
        XCTAssertEqual(reply.role, .bot)
        XCTAssertTrue(reply.text?.contains("demo") == true)
        // the transcript remembers it
        let page = try await client.messages(threadId: "demo-thread-atlas")
        XCTAssertEqual(page.messages.suffix(2).map(\.id), [user.id, reply.id])
        // same input, same answer
        XCTAssertEqual(DemoFixture.reply(to: "hello", from: "Atlas"), reply.text)
    }

    func testAnsweringTheApprovalSettlesTheCard() async throws {
        let server = DemoServer(now: clock, chunkDelay: 0)
        defer { server.stop() }
        let frames = FrameLog()
        server.onFrame = { frames.append($0) }
        let client = server.makeClient()
        let outcome = try await client.respond(threadId: "demo-thread-scout", requestId: "demo-request-testflight", behavior: "allow")
        XCTAssertEqual(outcome, "allowed")
        guard case let .messagePatch(_, card) = frames.all.first else { return XCTFail("the card is patched first") }
        XCTAssertEqual(card.card?.answered, "allow")
        XCTAssertFalse(card.card?.isPending ?? true)
        // twice is refused, like a server
        do {
            _ = try await client.respond(threadId: "demo-thread-scout", requestId: "demo-request-testflight", behavior: "deny")
            XCTFail("a second answer must be refused")
        } catch APIError.status(code: 409, _) {}
    }

    func testAnythingElseSaysItIsADemoAndNeverLeavesThePhone() async throws {
        let server = DemoServer(now: clock, chunkDelay: 0)
        defer { server.stop() }
        let client = server.makeClient()
        do {
            _ = try await client.overview(botId: "demo-atlas")
            XCTFail("no overview in the demo")
        } catch let APIError.status(code, message) {
            XCTAssertEqual(code, 404)
            XCTAssertEqual(message, DemoServer.unavailable)
        }
        // The demo session claims every request: one for a real host fails
        // locally instead of reaching the network.
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DemoURLProtocol.self]
        let session = URLSession(configuration: configuration)
        do {
            _ = try await session.data(from: URL(string: "https://example.com/")!)
            XCTFail("a demo session must not reach another host")
        } catch let error as URLError {
            XCTAssertEqual(error.code, .notConnectedToInternet)
        }
        XCTAssertTrue(DemoURLProtocol.refusedHosts.contains("example.com"))
    }

    func testStoppingSilencesReplies() async throws {
        let server = DemoServer(now: clock, chunkDelay: 0)
        let frames = FrameLog()
        server.onFrame = { frames.append($0) }
        let client = server.makeClient()
        server.stop()
        _ = try? await client.send(text: "hello", toBot: "demo-atlas", threadId: "demo-thread-atlas")
        XCTAssertTrue(frames.all.isEmpty)
    }
}

private final class FrameLog: @unchecked Sendable {
    private let lock = NSLock()
    private var frames: [Frame] = []
    func append(_ frame: Frame) { lock.lock(); frames.append(frame); lock.unlock() }
    var all: [Frame] { lock.lock(); defer { lock.unlock() }; return frames }
}
