// The wire side of the live browser view (BrowserLive.swift): the stream and
// the frame acknowledgement. Separate from the parser so that one is tested
// without a network.
import Foundation

public extension CompanionClient {
    /// `GET /api/bots/:id/browser/live`, as understood messages. Runs until
    /// the stream ends or the consuming task is cancelled; a 409 or 503 (the
    /// bot's browser is off, or the engine is not installed) throws with the
    /// server's sentence.
    func browserLive(botId: String, preview: Bool = false) throws -> AsyncThrowingStream<BrowserLiveMessage, Error> {
        var request = try browserLiveRequest(botId: botId, preview: preview)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        // a heartbeat comes every few seconds; a quiet gap is not an answer
        request.timeoutInterval = 90
        let session = streamingSession
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let (bytes, response) = try await session.bytes(for: request)
                    if let http = response as? HTTPURLResponse, http.statusCode != 200 {
                        var body = Data()
                        for try await byte in bytes {
                            body.append(byte)
                            if body.count > 4096 { break }
                        }
                        try Self.check(response, body)
                    }
                    var parser = SSEParser()
                    var line = [UInt8]()
                    // by hand, for the blank line that ends an event (SSE.swift)
                    for try await byte in bytes {
                        guard byte == 0x0A else {
                            line.append(byte)
                            continue
                        }
                        if line.last == 0x0D { line.removeLast() }
                        let text = String(decoding: line, as: UTF8.self)
                        line.removeAll(keepingCapacity: true)
                        guard let event = parser.line(text),
                              let message = BrowserLiveMessage.parse(event: event.event, data: event.data)
                        else { continue }
                        continuation.yield(message)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// The stream's request. `preview` is the Computer tab's watch-only view:
    /// the server never launches the browser for it, streams 5 frames a
    /// second, and takes only acknowledgements from it.
    func browserLiveRequest(botId: String, preview: Bool) throws -> URLRequest {
        try makeRequest("GET", "/api/bots/\(botId)/browser/live",
                        query: preview ? [URLQueryItem(name: "preview", value: "1")] : [])
    }

    /// `POST /api/bots/:id/browser/action`: one action of the take-control
    /// window. Returns whether a take waited for the bot's own action to end
    /// (the page may have moved meanwhile). A refusal throws the server's
    /// sentence.
    @discardableResult
    func browserAction(botId: String, viewerId: String, action: BrowserLiveAction) async throws -> Bool {
        var body = action.body
        body["viewerId"] = viewerId
        let request = try makeRequest("POST", "/api/bots/\(botId)/browser/action", body: body)
        let (data, response) = try await perform(request)
        try Self.check(response, data)
        let reply = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        return reply?["waited"] as? Bool ?? false
    }

    /// `POST /api/bots/:id/browser/action {viewerId, type: "ack", seq}`:
    /// this viewer has the frame, the next may come.
    func browserAck(botId: String, viewerId: String, seq: Int) async throws {
        let request = try makeRequest("POST", "/api/bots/\(botId)/browser/action",
                                      body: ["viewerId": viewerId, "type": "ack", "seq": seq])
        try await send(request)
    }
}
