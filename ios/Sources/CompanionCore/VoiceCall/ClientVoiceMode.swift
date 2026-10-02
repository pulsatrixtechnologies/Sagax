// The live call's routes (server/voice-mode.ts) and the call turn's send,
// the same requests the desktop's voice mode makes (src/lib/voice-mode/api.ts
// and LiveCall's send with `voiceCall`). The xAI key stays on the server:
// the phone gets a yes or no, voice labels, and audio.
import Foundation

/// Why voice mode cannot run for this person (shared/voice-mode.ts).
public struct VoiceModeRefusal: Decodable, Equatable, Sendable {
    public var cause: String
    public var admin: Bool?
    public var keysUrl: String?
}

/// `GET /api/bots/<id>/voice/status`.
public struct VoiceModeStatus: Decodable, Equatable, Sendable {
    public var provider: String
    public var available: Bool
    /// An organization server: voice mode is the only call there.
    public var organization: Bool?
    public var via: String?
    public var refusal: VoiceModeRefusal?

    public init(provider: String = "xai", available: Bool, organization: Bool? = nil, via: String? = nil, refusal: VoiceModeRefusal? = nil) {
        self.provider = provider
        self.available = available
        self.organization = organization
        self.via = via
        self.refusal = refusal
    }
}

public struct VoiceModeVoice: Decodable, Hashable, Identifiable, Sendable {
    public var id: String
    public var label: String
}

/// `Message.voiceCall` on a send: the turn was said on a live call, so the
/// server adds its hidden phone-call instruction (server/voice-call-prompt.ts).
public struct VoiceCallMeta: Codable, Equatable, Sendable {
    public var callId: String
    public var interrupted: Bool?
    public var language: String?
    /// One id per utterance (also the send's `sendId`): the server delivers
    /// it once, and answers a second send of it with the first receipt.
    public var utteranceId: String?
    /// A barge-in: what the person heard of the cut answer, and what not.
    public var heard: String?
    public var unheard: String?
    /// It completes the fragment sent just before (cut by a pause).
    public var continues: Bool?

    /// The longest heard or unheard excerpt kept (server VOICE_CALL_EXCERPT_MAX).
    public static let excerptMax = 1_200

    public init(callId: String, interrupted: Bool = false, language: String? = nil, utteranceId: String? = nil, cut: PlaybackCut? = nil, continues: Bool = false) {
        self.callId = callId
        self.interrupted = interrupted ? true : nil
        // "auto" is never sent: the server takes only a picked language
        self.language = language.flatMap { $0 == "auto" || !VoiceModeSettings.isLanguage($0) ? nil : $0 }
        self.utteranceId = utteranceId
        // what was heard only means something for words that cut the bot
        if interrupted, let cut {
            heard = Self.excerpt(cut.heard)
            unheard = Self.excerpt(cut.unheard)
        }
        self.continues = continues ? true : nil
    }

    private static func excerpt(_ text: String) -> String? {
        let folded = text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard !folded.isEmpty else { return nil }
        return folded.count > excerptMax ? String(folded.prefix(excerptMax - 1)) + "\u{2026}" : folded
    }

    var json: [String: Any] {
        var out: [String: Any] = ["callId": callId]
        if let utteranceId { out["utteranceId"] = utteranceId }
        if continues == true { out["continues"] = true }
        if interrupted == true {
            out["interrupted"] = true
            if let heard { out["heard"] = heard }
            if let unheard { out["unheard"] = unheard }
        }
        if let language { out["language"] = language }
        return out
    }
}

/// The call's life on the server (POST /voice/call): every send to the
/// thread while it lasts is a call turn, whatever path it takes.
public enum VoiceCallSessionState: String, Sendable { case start, alive, end }

/// One sentence of the bot's voice, as the server streams it: raw 16-bit
/// little-endian PCM at `sampleRate`, in chunks as xAI makes it.
public struct VoiceStreamAudio: Sendable {
    public let sampleRate: Double
    public let chunks: AsyncThrowingStream<Data, Error>
}

/// Which voice reads the bot's answers on this call, in order of preference:
/// what the desktop would use for the same bot, then the phone's own.
public enum CallVoiceSource: Equatable, Sendable {
    /// voice mode with xAI (POST /voice/stream), the person's Voice/Speed/Language
    case xai
    /// the computer's voice provider (POST /api/tts/speak) with the bot's voice
    case server(voiceId: String?)
    /// ElevenLabs straight from the phone, with the key in its Keychain
    case phoneElevenLabs(voiceId: String?)
    /// the phone's best installed voice
    case device

    public static func route(voiceMode: VoiceModeStatus?, config: ConfigStatus?, agentVoice: String?, phoneKey: Bool) -> [CallVoiceSource] {
        var out: [CallVoiceSource] = []
        if voiceMode?.available == true { out.append(.xai) }
        if let config, config.canSpeak(agentVoice: agentVoice) {
            let voice = agentVoice?.trimmingCharacters(in: .whitespacesAndNewlines)
            out.append(.server(voiceId: voice?.isEmpty == false ? voice : nil))
        }
        if phoneKey { out.append(.phoneElevenLabs(voiceId: config?.walkieAgentVoice(agentVoice))) }
        out.append(.device)
        return out
    }
}

extension CompanionClient {
    private static func voiceBase(_ botId: String) throws -> String {
        guard validRouteID(botId) else { throw APIError.badURL }
        return "/api/bots/\(botId)/voice"
    }

    /// Can this person talk to this bot with voice mode, and who pays.
    public func voiceModeStatus(botId: String) async throws -> VoiceModeStatus {
        try await send(try makeRequest("GET", "\(Self.voiceBase(botId))/status"), as: VoiceModeStatus.self)
    }

    /// xAI's voices (labels only).
    public func voiceModeVoices(botId: String) async throws -> [VoiceModeVoice] {
        struct Body: Decodable { var voices: [VoiceModeVoice]? }
        return try await send(try makeRequest("GET", "\(Self.voiceBase(botId))/voices"), as: Body.self).voices ?? []
    }

    /// One sentence spoken as xAI makes it; nil when there is nothing to say.
    public func voiceModeStream(botId: String, text: String, settings: VoiceModeSettings, threadId: String?) async throws -> VoiceStreamAudio? {
        var body: [String: Any] = ["text": text, "voice": settings.voice, "speed": settings.speed, "language": settings.language]
        if let threadId, Self.validRouteID(threadId) { body["threadId"] = threadId }
        var request = try makeRequest("POST", "\(Self.voiceBase(botId))/stream", body: body)
        request.timeoutInterval = 30
        let (bytes, response): (URLSession.AsyncBytes, URLResponse)
        do {
            (bytes, response) = try await streamingSession.bytes(for: request)
        } catch {
            throw APIError.transport(error.localizedDescription)
        }
        let http = response as? HTTPURLResponse
        if http?.statusCode == 204 { return nil }
        if let http, !(200...299).contains(http.statusCode) {
            var data = Data()
            for try await byte in bytes {
                data.append(byte)
                if data.count > 16_384 { break }
            }
            try Self.check(response, data)
        }
        let rate = Double(http?.value(forHTTPHeaderField: "x-voice-sample-rate") ?? "") ?? 24_000
        let chunks = AsyncThrowingStream<Data, Error> { continuation in
            let task = Task {
                var chunk = Data()
                chunk.reserveCapacity(4_800)
                do {
                    for try await byte in bytes {
                        chunk.append(byte)
                        if chunk.count >= 4_800 {
                            continuation.yield(chunk)
                            chunk = Data()
                            chunk.reserveCapacity(4_800)
                        }
                    }
                    if !chunk.isEmpty { continuation.yield(chunk) }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
        return VoiceStreamAudio(sampleRate: rate, chunks: chunks)
    }

    /// One whole turn uploaded (16 kHz mono WAV) when the phone cannot
    /// recognize speech itself.
    public func voiceModeTranscribe(botId: String, wav: Data, language: String, threadId: String?) async throws -> String {
        var query = [URLQueryItem(name: "language", value: VoiceModeSettings.isLanguage(language) ? language : "auto")]
        if let threadId, Self.validRouteID(threadId) { query.append(URLQueryItem(name: "threadId", value: threadId)) }
        var request = try makeRequest("POST", "\(Self.voiceBase(botId))/transcribe", query: query)
        request.setValue("audio/wav", forHTTPHeaderField: "Content-Type")
        request.httpBody = wav
        request.timeoutInterval = 30
        struct Body: Decodable { var text: String? }
        return try await send(request, as: Body.self).text ?? ""
    }

    /// The computer's own voice provider (`POST /api/tts/speak`): audio bytes.
    public func speak(text: String, voiceId: String?) async throws -> Data {
        var body: [String: Any] = ["text": String(text.prefix(500))]
        if let voiceId, !voiceId.isEmpty { body["voiceId"] = voiceId }
        var request = try makeRequest("POST", "/api/tts/speak", body: body)
        request.timeoutInterval = 30
        let (data, response) = try await perform(request)
        try Self.check(response, data)
        return data
    }

    /// A turn said on a live call: an ordinary send to the bot, marked as a
    /// call turn exactly like the desktop's (`voiceCall`).
    @discardableResult
    public func send(text: String, toBot botId: String, threadId: String?, voiceCall: VoiceCallMeta) async throws -> SendReceipt {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        var body: [String: Any] = ["text": text, "voiceCall": voiceCall.json]
        if let threadId { body["threadId"] = threadId }
        // the utterance id is the send's id: delivered once, whatever retries
        if let utteranceId = voiceCall.utteranceId { body["sendId"] = utteranceId }
        let (data, response) = try await perform(try makeRequest("POST", "/api/bots/\(botId)/messages", body: body))
        try Self.check(response, data)
        return (try? JSONDecoder().decode(SendReceipt.self, from: data)) ?? SendReceipt()
    }

    /// Tell the server the thread is on a call (start, alive every few
    /// minutes, end). Best effort: an old server without the route still
    /// gets each turn's mark. True when the server took it.
    @discardableResult
    public func voiceCallSession(botId: String, state: VoiceCallSessionState, callId: String, threadId: String?, language: String?) async -> Bool {
        var body: [String: Any] = ["state": state.rawValue, "callId": callId]
        if let threadId, Self.validRouteID(threadId) { body["threadId"] = threadId }
        if let language, language != "auto", VoiceModeSettings.isLanguage(language) { body["language"] = language }
        guard let request = try? makeRequest("POST", "\(Self.voiceBase(botId))/call", body: body),
              let (data, response) = try? await perform(request) else { return false }
        return (try? Self.check(response, data)) != nil
    }

    public func interrupt(roomId: String) async throws {
        guard Self.validRouteID(roomId) else { throw APIError.badURL }
        try await send(try makeRequest("POST", "/api/groups/\(roomId)/interrupt"))
    }
}

/// 16 kHz mono 16-bit WAV of float frames (a turn uploaded whole).
public enum CallWav {
    public static func encode(_ samples: [Float], sampleRate: Int = 16_000) -> Data {
        var pcm = Data(capacity: samples.count * 2)
        for sample in samples {
            let clamped = max(-1, min(1, sample))
            var value = Int16(clamped < 0 ? clamped * 32768 : clamped * 32767).littleEndian
            withUnsafeBytes(of: &value) { pcm.append(contentsOf: $0) }
        }
        var header = Data()
        func append<T: FixedWidthInteger>(_ value: T) {
            var little = value.littleEndian
            withUnsafeBytes(of: &little) { header.append(contentsOf: $0) }
        }
        header.append(contentsOf: Array("RIFF".utf8))
        append(UInt32(36 + pcm.count))
        header.append(contentsOf: Array("WAVEfmt ".utf8))
        append(UInt32(16))
        append(UInt16(1))
        append(UInt16(1))
        append(UInt32(sampleRate))
        append(UInt32(sampleRate * 2))
        append(UInt16(2))
        append(UInt16(16))
        header.append(contentsOf: Array("data".utf8))
        append(UInt32(pcm.count))
        return header + pcm
    }

    /// Decode a 16-bit PCM WAV (any rate, mono or the first channel) to
    /// floats and its rate. Nil for anything else.
    public static func decode(_ data: Data) -> (samples: [Float], sampleRate: Int)? {
        let bytes = [UInt8](data)
        guard bytes.count > 44, String(decoding: bytes[0..<4], as: UTF8.self) == "RIFF",
              String(decoding: bytes[8..<12], as: UTF8.self) == "WAVE" else { return nil }
        func u16(_ at: Int) -> Int { Int(bytes[at]) | Int(bytes[at + 1]) << 8 }
        func u32(_ at: Int) -> Int { u16(at) | u16(at + 2) << 16 }
        var at = 12
        var channels = 1, rate = 16_000, bits = 16
        while at + 8 <= bytes.count {
            let id = String(decoding: bytes[at..<(at + 4)], as: UTF8.self)
            let size = u32(at + 4)
            let body = at + 8
            if id == "fmt " {
                channels = max(1, u16(body + 2))
                rate = u32(body + 4)
                bits = u16(body + 14)
            } else if id == "data" {
                guard bits == 16 else { return nil }
                let end = min(bytes.count, body + size)
                var samples: [Float] = []
                samples.reserveCapacity((end - body) / (2 * channels))
                var i = body
                while i + 1 < end {
                    let value = Int16(bitPattern: UInt16(bytes[i]) | UInt16(bytes[i + 1]) << 8)
                    samples.append(Float(value) / 32768)
                    i += 2 * channels
                }
                return (samples, rate)
            }
            at = body + size + (size % 2)
        }
        return nil
    }
}
