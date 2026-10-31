// Composer dictation over /voice/listen: words appear while speaking, the
// stop only waits for finalize, and a socket that never opens uploads the
// whole clip (desktop LiveTranscriber / useComposerDictation).
import XCTest
@testable import CompanionCore

private final class FakeListenSocket: DictationListenSocket, @unchecked Sendable {
    var binary = 0
    var texts: [String] = []
    var closed = false
    let continuation: AsyncStream<ListenEvent>.Continuation
    let events: AsyncStream<ListenEvent>

    init() {
        var cont: AsyncStream<ListenEvent>.Continuation!
        events = AsyncStream { cont = $0 }
        continuation = cont
    }

    func sendBinary(_ data: Data) { binary += 1 }
    func sendText(_ text: String) { texts.append(text) }
    func close() {
        closed = true
        continuation.yield(.closed)
        continuation.finish()
    }

    func ready() { continuation.yield(.frame(.ready)) }
    func transcript(_ text: String, final: Bool, speechFinal: Bool, requestId: String? = nil) {
        continuation.yield(.frame(.transcript(text: text, final: final, speechFinal: speechFinal, requestId: requestId)))
    }

    var lastFinalizeId: String? {
        guard let last = texts.last,
              let data = last.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              json["type"] as? String == "finalize"
        else { return nil }
        return json["requestId"] as? String
    }
}

@MainActor
final class LiveDictationTests: XCTestCase {
    func testPartialsReachTheFieldAndStopWaitsForFinalize() async throws {
        let socket = FakeListenSocket()
        var uploads = 0
        let ears = LiveDictation(
            openListen: { (socket, socket.events) },
            upload: { _ in
                uploads += 1
                return VoiceTranscription(text: "uploaded")
            },
            finalTimeoutMs: 500,
            connectTimeoutMs: 1_000
        )
        var partials: [String] = []
        ears.onPartial { partials.append($0) }

        let connected = Task { await ears.connect() }
        // let connect arm its waiter before ready arrives
        await Task.yield()
        socket.ready()
        let ok = await connected.value
        XCTAssertTrue(ok)

        ears.push(Array(repeating: 0.05, count: 320))
        socket.transcript("bonjour", final: false, speechFinal: false)
        socket.transcript("bonjour le monde", final: false, speechFinal: false)
        // the listen task hops onto MainActor; wait until both partials land
        let partialDeadline = Date().addingTimeInterval(0.5)
        while partials.last != "bonjour le monde", Date() < partialDeadline {
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        XCTAssertEqual(partials.last, "bonjour le monde")
        XCTAssertEqual(socket.binary, 1)

        let finished = Task { await ears.finish() }
        let finalizeDeadline = Date().addingTimeInterval(0.5)
        while socket.lastFinalizeId == nil, Date() < finalizeDeadline {
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        let requestId = try XCTUnwrap(socket.lastFinalizeId)
        socket.transcript("Bonjour le monde.", final: true, speechFinal: true, requestId: requestId)
        let heard = await finished.value

        XCTAssertEqual(heard.text, "Bonjour le monde.")
        XCTAssertTrue(heard.streamed)
        XCTAssertEqual(uploads, 0, "streaming stop must not re-upload the clip")
        ears.close()
    }

    func testSocketThatNeverOpensUploadsTheWholeClip() async {
        let socket = FakeListenSocket()
        var uploadedSamples = 0
        let ears = LiveDictation(
            openListen: { (socket, socket.events) },
            upload: { samples in
                uploadedSamples = samples.count
                return VoiceTranscription(text: "from upload")
            },
            finalTimeoutMs: 50,
            connectTimeoutMs: 30
        )

        let connected = await ears.connect()
        XCTAssertFalse(connected)
        ears.push(Array(repeating: 0.1, count: 160))
        ears.push(Array(repeating: 0.1, count: 160))
        let heard = await ears.finish()

        XCTAssertEqual(heard.text, "from upload")
        XCTAssertFalse(heard.streamed)
        XCTAssertEqual(uploadedSamples, 320)
        XCTAssertEqual(socket.binary, 0, "no audio on a socket that never opened")
        ears.close()
    }

    func testEmptyRecordingSkipsUploadAndFinalize() async {
        let socket = FakeListenSocket()
        var uploads = 0
        let ears = LiveDictation(
            openListen: { (socket, socket.events) },
            upload: { _ in
                uploads += 1
                return VoiceTranscription(text: "nope")
            },
            connectTimeoutMs: 1_000
        )
        let connected = Task { await ears.connect() }
        await Task.yield()
        socket.ready()
        let ok = await connected.value
        XCTAssertTrue(ok)
        let heard = await ears.finish()
        XCTAssertEqual(heard.text, "")
        XCTAssertEqual(uploads, 0)
        XCTAssertTrue(socket.texts.isEmpty)
        ears.close()
    }

    func testListenFrameParsing() {
        XCTAssertEqual(ListenFrame.parse(#"{"type":"ready"}"#), .ready)
        XCTAssertEqual(ListenFrame.parse(#"{"type":"reconnected"}"#), .reconnected)
        XCTAssertEqual(
            ListenFrame.parse(#"{"type":"transcript","text":"hi","final":true,"speechFinal":true,"requestId":"stt-1"}"#),
            .transcript(text: "hi", final: true, speechFinal: true, requestId: "stt-1")
        )
        XCTAssertEqual(ListenFrame.parse(#"{"type":"error","message":"down"}"#), .error("down"))
        XCTAssertEqual(ListenFrame.parse("not-json"), .unknown)
    }

    func testPcm16MatchesWavPayloadWithoutHeader() {
        let samples: [Float] = [0, 0.5, -0.5, 1, -1]
        let pcm = CallWav.pcm16(samples)
        let wav = CallWav.encode(samples)
        XCTAssertEqual(pcm.count, samples.count * 2)
        XCTAssertEqual(Data(wav.dropFirst(44)), pcm)
    }
}

@MainActor
final class VoiceListenRequestTests: XCTestCase {
    func testListenRequestUsesWsAndQuery() throws {
        let client = CompanionClient(
            connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810),
            token: "paired-token"
        )
        let request = try client.voiceModeListenRequest(
            botId: "b-1",
            language: "auto",
            threadId: "t-1",
            locale: "fr-CA",
            stt: "auto"
        )
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer paired-token")
        let url = try XCTUnwrap(request.url)
        XCTAssertEqual(url.scheme, "ws")
        XCTAssertEqual(url.path, "/api/bots/b-1/voice/listen")
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let query = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(query["language"], "auto")
        XCTAssertEqual(query["locale"], "fr-CA")
        XCTAssertEqual(query["threadId"], "t-1")
        XCTAssertEqual(query["stt"], "auto")
    }
}
