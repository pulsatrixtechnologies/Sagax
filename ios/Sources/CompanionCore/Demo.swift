// Demo mode: the whole app on local, made-up data, with no computer, no
// server, no account and no network.
//
// `DemoServer` answers the same calls a server would (`CompanionClient`
// talks to it through `DemoURLProtocol`, the only protocol its URLSession
// has, so a request can never leave the phone), and plays the replies a
// server would stream as frames handed to `onFrame`. Everything it holds is
// in memory and dies with it: nothing is written to the Keychain, the saved
// connections, the widgets or the App Group.
//
// The data is generic (Atlas, Pixel, Scout, Forge, Sam Rivera) and every
// timestamp derives from the `now` it was made with, so a fixed clock gives
// the same screens every time (App Review, screenshots).
import Foundation

public final class DemoServer: @unchecked Sendable {
    /// Never resolvable (RFC 2606), and never dialled: the demo session's
    /// only protocol answers every request itself.
    public static let host = "demo.sagax.invalid"
    public static let connectionID = "sagax-demo"

    public let connection: Connection
    /// Replies and card updates, in order. Called on an arbitrary queue.
    public var onFrame: (@Sendable (Frame) -> Void)?
    /// Delay between streamed chunks; tests use zero.
    public var chunkDelay: TimeInterval

    private let lock = NSLock()
    private let now: Date
    private var bots: [Bot]
    private var rooms: [Room]
    private var routines: [Routine]
    private var runs: [RoutineRun]
    private var counter = 0
    private var stopped = false
    /// Every request the demo answered, for tests.
    private var handled: [String] = []

    public init(now: Date = Date(), chunkDelay: TimeInterval = 0.06) {
        self.now = now
        self.chunkDelay = chunkDelay
        let fixture = DemoFixture(now: now)
        bots = fixture.bots
        rooms = fixture.rooms
        routines = fixture.routines
        runs = fixture.runs
        connection = Connection(id: Self.connectionID, name: "Sagax demo", host: Self.host, port: 443, serverScopes: ["client"])
    }

    /// The fleet the app hydrates from on entering the demo.
    public var fleet: Fleet {
        lock.lock(); defer { lock.unlock() }
        return Fleet(bots: bots, groups: rooms, botQueuedMessages: [:], sections: ["Launch", "Engineering"])
    }

    /// A client whose every request is answered here.
    public func makeClient() -> CompanionClient {
        DemoURLProtocol.register(self)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DemoURLProtocol.self]
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        return CompanionClient(connection: connection, token: "demo", session: URLSession(configuration: configuration))
    }

    /// Stop playing replies (leaving the demo).
    public func stop() {
        lock.lock(); stopped = true; lock.unlock()
        DemoURLProtocol.unregister(self)
    }

    public var handledRequests: [String] {
        lock.lock(); defer { lock.unlock() }
        return handled
    }

    // MARK: - Requests

    public struct Response: Sendable {
        public var status: Int
        public var body: Data
    }

    static let unavailable = "Not available in the demo. Connect a computer or sign in to an organization to use this."

    /// Answer one request. Public for tests.
    public func respond(method: String, path: String, body: Data?) -> Response {
        lock.lock()
        handled.append("\(method) \(path)")
        lock.unlock()
        let parts = path.split(separator: "/").map(String.init)
        let json = (body.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
        switch (method, parts.count >= 2 ? Array(parts.prefix(2)) : parts) {
        case ("GET", ["api", "bots"]) where parts.count == 2:
            return encode(FleetBody(fleet: fleet))
        case ("GET", ["api", "health"]):
            return .init(status: 200, body: Data(#"{"app":"openmausbot"}"#.utf8))
        case ("GET", ["api", "routines"]):
            lock.lock(); defer { lock.unlock() }
            return encode(RoutinesResponse(routines: routines, runs: runs))
        case ("GET", ["api", "threads"]) where parts.count == 4 && parts[3] == "messages":
            return encode(page(threadId: parts[2]))
        case ("POST", ["api", "bots"]) where parts.count == 4 && parts[3] == "messages":
            return send(text: json["text"] as? String ?? "", botId: parts[2], groupId: nil, threadId: json["threadId"] as? String)
        case ("POST", ["api", "groups"]) where parts.count == 4 && parts[3] == "messages":
            return send(text: json["text"] as? String ?? "", botId: nil, groupId: parts[2], threadId: json["threadId"] as? String)
        case ("POST", ["api", "threads"]) where parts.count == 4 && parts[3] == "respond":
            return answer(threadId: parts[2], requestId: json["requestId"] as? String, behavior: json["behavior"] as? String ?? "deny", message: json["message"] as? String)
        case ("POST", ["api", "bots"]) where parts.count == 4 && (parts[3] == "read" || parts[3] == "always-allow"),
             ("POST", ["api", "groups"]) where parts.count == 4 && parts[3] == "read":
            return .init(status: 200, body: Data("{}".utf8))
        default:
            return refusal(status: method == "GET" ? 404 : 403)
        }
    }

    private func refusal(status: Int) -> Response {
        let body = (try? JSONSerialization.data(withJSONObject: ["error": Self.unavailable, "code": "demo"])) ?? Data()
        return .init(status: status, body: body)
    }

    private struct FleetBody: Encodable {
        var bots: [Bot]
        var groups: [Room]
        var botQueuedMessages: [String: [QueuedSend]]
        var sections: [String]
        init(fleet: Fleet) {
            bots = fleet.bots
            groups = fleet.groups
            botQueuedMessages = fleet.botQueuedMessages ?? [:]
            sections = fleet.sections ?? []
        }
    }

    private func encode<T: Encodable>(_ value: T) -> Response {
        guard let data = try? JSONEncoder().encode(value) else { return refusal(status: 500) }
        return .init(status: 200, body: data)
    }

    private func page(threadId: String) -> ThreadPage {
        lock.lock(); defer { lock.unlock() }
        if let bot = bots.first(where: { $0.threadId == threadId }) {
            return ThreadPage(messages: bot.messages ?? [], hasMore: false, activeLeafId: bot.activeLeafId)
        }
        if let room = rooms.first(where: { $0.threadId == threadId }) {
            return ThreadPage(messages: room.messages ?? [], hasMore: false, activeLeafId: room.messages?.last?.id)
        }
        return ThreadPage(messages: [], hasMore: false, activeLeafId: nil)
    }

    private func nextID(_ prefix: String) -> String {
        lock.lock(); defer { lock.unlock() }
        counter += 1
        return "demo-\(prefix)-\(counter)"
    }

    /// A moment after the newest message, so new lines sort last even with
    /// a fixed clock.
    private func stamp() -> Double {
        lock.lock(); defer { lock.unlock() }
        counter += 1
        return now.timeIntervalSince1970 * 1000 + Double(counter) * 1000
    }

    private func send(text: String, botId: String?, groupId: String?, threadId: String?) -> Response {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return refusal(status: 400) }
        lock.lock()
        let bot = botId.flatMap { id in bots.first(where: { $0.id == id }) }
        let room = groupId.flatMap { id in rooms.first(where: { $0.id == id }) }
        lock.unlock()
        guard bot != nil || room != nil else { return refusal(status: 404) }
        let thread = bot?.threadId ?? room!.threadId
        let parent = lastMessageID(thread: thread)
        let user = Message(id: nextID("you"), role: .user, kind: .text, at: stamp(), text: trimmed, parentId: parent)
        record(user, thread: thread)
        emit(.message(threadId: thread, message: user))
        let speaker = bot ?? bots.first(where: { room!.memberIds.contains($0.id) })!
        let reply = DemoFixture.reply(to: trimmed, from: speaker.name)
        stream(reply, from: speaker, inRoom: room != nil, thread: thread, parent: user.id)
        return .init(status: 200, body: Data(#"{"threadId":"\#(thread)"}"#.utf8))
    }

    private func answer(threadId: String, requestId: String?, behavior: String, message: String?) -> Response {
        lock.lock()
        let found: (botIndex: Int, messageIndex: Int)? = bots.indices.lazy.compactMap { b -> (Int, Int)? in
            guard let m = self.bots[b].messages?.firstIndex(where: { $0.card?.requestId == requestId && $0.card?.isPending == true }) else { return nil }
            return (b, m)
        }.first
        guard let found else {
            lock.unlock()
            return .init(status: 409, body: Data(#"{"error":"This request was already answered."}"#.utf8))
        }
        var card = bots[found.botIndex].messages![found.messageIndex]
        card.card?.answered = behavior
        if let message { card.card?.answeredText = message }
        bots[found.botIndex].messages![found.messageIndex] = card
        bots[found.botIndex].activity = "working"
        let bot = bots[found.botIndex]
        lock.unlock()
        emit(.messagePatch(threadId: threadId, message: card))
        let text = behavior == "allow"
            ? "Approved, thank you. The internal TestFlight upload is done; the build shows up in App Store Connect in a few minutes."
            : "Understood, I won't upload it. The build stays on the computer until you say so."
        stream(text, from: bot, inRoom: false, thread: threadId, parent: card.id)
        return .init(status: 200, body: Data(#"{"outcome":"\#(behavior == "allow" ? "allowed" : "denied")"}"#.utf8))
    }

    private func lastMessageID(thread: String) -> String? {
        lock.lock(); defer { lock.unlock() }
        if let bot = bots.first(where: { $0.threadId == thread }) { return bot.messages?.last?.id }
        return rooms.first(where: { $0.threadId == thread })?.messages?.last?.id
    }

    private func record(_ message: Message, thread: String) {
        lock.lock(); defer { lock.unlock() }
        if let index = bots.firstIndex(where: { $0.threadId == thread }) {
            bots[index].messages = (bots[index].messages ?? []) + [message]
            bots[index].activeLeafId = message.id
        } else if let index = rooms.firstIndex(where: { $0.threadId == thread }) {
            rooms[index].messages = (rooms[index].messages ?? []) + [message]
        }
    }

    private func setBusy(_ bot: Bot, _ busy: Bool) {
        lock.lock()
        guard let index = bots.firstIndex(where: { $0.id == bot.id }) else { lock.unlock(); return }
        bots[index].busy = busy
        bots[index].activity = busy ? "working" : "idle"
        var frame = bots[index]
        frame.messages = nil
        lock.unlock()
        emit(.bot(frame))
    }

    /// The reply arrives the way a server streams one: deltas, then the
    /// settled message.
    private func stream(_ text: String, from bot: Bot, inRoom: Bool, thread: String, parent: String) {
        let id = nextID("reply")
        let delay = chunkDelay
        if !inRoom { setBusy(bot, true) }
        let words = text.split(separator: " ", omittingEmptySubsequences: false).map(String.init)
        let work = { [weak self] in
            guard let self else { return }
            var sent = ""
            for (index, word) in words.enumerated() {
                if self.isStopped { return }
                let chunk = index == 0 ? word : " " + word
                sent += chunk
                self.emit(.runtime(RuntimeEvent(type: "content.delta", threadId: thread, delta: chunk, streamKind: "assistant_text")))
                if delay > 0 { Thread.sleep(forTimeInterval: delay) }
            }
            var reply = Message(id: id, role: .bot, kind: .text, at: self.stamp(), text: sent, parentId: parent)
            if inRoom { reply.from = Sender(botId: bot.id, name: bot.name, color: bot.color) }
            self.record(reply, thread: thread)
            self.emit(.message(threadId: thread, message: reply))
            if !inRoom { self.setBusy(bot, false) }
        }
        if delay > 0 {
            DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 0.4, execute: work)
        } else {
            work()
        }
    }

    private var isStopped: Bool {
        lock.lock(); defer { lock.unlock() }
        return stopped
    }

    private func emit(_ frame: Frame) {
        guard !isStopped else { return }
        onFrame?(frame)
    }
}

// MARK: - The only protocol a demo session has

/// Answers every request of a demo session from the registered
/// `DemoServer`. It claims every request it is asked about, so a demo
/// session has no path to the network at all: a request for any other host
/// fails here with `notConnectedToInternet`.
public final class DemoURLProtocol: URLProtocol {
    nonisolated(unsafe) private static var server: DemoServer?
    private static let lock = NSLock()
    /// Requests refused because they named another host (tests).
    nonisolated(unsafe) public private(set) static var refusedHosts: [String] = []

    static func register(_ server: DemoServer) {
        lock.lock(); self.server = server; lock.unlock()
    }

    static func unregister(_ server: DemoServer) {
        lock.lock()
        if self.server === server { self.server = nil }
        lock.unlock()
    }

    override public class func canInit(with request: URLRequest) -> Bool { true }
    override public class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override public func startLoading() {
        Self.lock.lock()
        let server = Self.server
        Self.lock.unlock()
        guard let url = request.url, url.host == DemoServer.host, let server else {
            Self.lock.lock(); Self.refusedHosts.append(request.url?.host ?? "?"); Self.lock.unlock()
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let body = request.httpBody ?? request.httpBodyStream.map(Self.read)
        let answer = server.respond(method: request.httpMethod ?? "GET", path: url.path, body: body)
        let response = HTTPURLResponse(url: url, statusCode: answer.status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: answer.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override public func stopLoading() {}

    private static func read(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}
