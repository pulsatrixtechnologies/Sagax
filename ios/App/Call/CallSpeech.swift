// The bot's voice on a call: each sentence is fetched the moment it is
// queued (so the next one downloads while this one plays) from the voice the
// desktop would use for this bot (CallVoiceSource.route: voice mode's xAI
// stream, else the computer's own provider with the bot's voice, else
// ElevenLabs from this phone, else the phone's best voice), and played back
// to back through the call's engine. One player does the phone things: duck
// at once when the person starts talking, drop everything on a barge-in,
// say when each sentence becomes audible and when all of it has been heard.
import AVFoundation
import CompanionCore

/// Who is speaking (a room's member, or the bot of a one-to-one call).
struct CallSpeaker: Equatable {
    var id: String
    var name: String
    /// The bot's saved voice on the computer's provider.
    var voice: String?
    /// Its place in the room: tells the phone's own voices apart.
    var index: Int = 0
}

typealias CallSpeechAudio = AsyncThrowingStream<AVAudioPCMBuffer, Error>

@MainActor
protocol CallSpeechSourcing: AnyObject {
    func audio(for text: String, speaker: CallSpeaker?) -> CallSpeechAudio
}

/// The voices of CallVoiceSource, tried in order; one that fails for a
/// reason every sentence would share (no key, no credit) is skipped for the
/// rest of the call.
@MainActor
final class RoutedSpeechSource: CallSpeechSourcing {
    private let client: CompanionClient?
    private let botId: String?
    private let threadId: () -> String?
    private let routes: (CallSpeaker?) -> [CallVoiceSource]
    private let settings: () -> VoiceModeSettings
    private var disabled: Set<String> = []
    /// Said once when the call falls back to another voice.
    var onFallback: ((String) -> Void)?

    init(client: CompanionClient?, botId: String?, threadId: @escaping () -> String?, routes: @escaping (CallSpeaker?) -> [CallVoiceSource], settings: @escaping () -> VoiceModeSettings) {
        self.client = client
        self.botId = botId
        self.threadId = threadId
        self.routes = routes
        self.settings = settings
    }

    private static func key(_ source: CallVoiceSource) -> String {
        switch source {
        case .xai: "xai"
        case .server: "server"
        case .phoneElevenLabs: "eleven"
        case .device: "device"
        }
    }

    func audio(for text: String, speaker: CallSpeaker?) -> CallSpeechAudio {
        let sources = routes(speaker).filter { !disabled.contains(Self.key($0)) }
        let settings = settings()
        let thread = threadId()
        return CallSpeechAudio { continuation in
            let task = Task { @MainActor in
                var lastError: Error?
                for source in sources {
                    do {
                        try await self.produce(source, text: text, speaker: speaker, settings: settings, threadId: thread, into: continuation)
                        continuation.finish()
                        return
                    } catch {
                        if Task.isCancelled { continuation.finish(); return }
                        lastError = error
                        if Self.permanent(error) { self.disabled.insert(Self.key(source)) }
                        if source != .device { self.onFallback?(error.localizedDescription) }
                    }
                }
                continuation.finish(throwing: lastError ?? CancellationError())
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// A refusal every later sentence would get too.
    private static func permanent(_ error: Error) -> Bool {
        if case let APIError.status(code, _) = error { return [401, 402, 403, 404, 409].contains(code) }
        if let failure = error as? ElevenLabs.Failure, let status = failure.status { return [401, 402, 403].contains(status) }
        return false
    }

    private func produce(_ source: CallVoiceSource, text: String, speaker: CallSpeaker?, settings: VoiceModeSettings, threadId: String?, into continuation: CallSpeechAudio.Continuation) async throws {
        switch source {
        case .xai:
            guard let client, let botId else { throw APIError.transport("no voice mode") }
            guard let audio = try await client.voiceModeStream(botId: botId, text: text, settings: settings, threadId: threadId) else { return }
            var carry = Data()
            for try await chunk in audio.chunks {
                try Task.checkCancellation()
                var bytes = carry + chunk
                carry = Data()
                if bytes.count % 2 == 1 {
                    carry = bytes.suffix(1)
                    bytes = bytes.dropLast()
                }
                if let buffer = AVAudioPCMBuffer.pcm16(Data(bytes), sampleRate: audio.sampleRate) {
                    continuation.yield(buffer)
                }
            }
        case let .server(voiceId):
            guard let client else { throw APIError.transport("offline") }
            let data = try await client.speak(text: text, voiceId: voiceId)
            guard let buffer = AVAudioPCMBuffer.decode(data) else { throw APIError.transport("unreadable audio") }
            continuation.yield(buffer)
        case let .phoneElevenLabs(voiceId):
            guard let key = WalkieVoiceKey.read() else { throw APIError.transport("no ElevenLabs key") }
            let defaults = UserDefaults.standard
            let chosen = defaults.string(forKey: WalkieVoicePrefs.voiceId)
            let useAgentVoices = defaults.object(forKey: WalkieVoicePrefs.useAgentVoices) as? Bool ?? true
            let voice = [useAgentVoices ? voiceId : nil, chosen].compactMap { $0 }.first { !$0.isEmpty } ?? ElevenLabs.defaultVoiceId
            let data = try await ElevenLabs.speech(text: text, voiceId: voice, key: key)
            guard let buffer = AVAudioPCMBuffer.decode(data) else { throw APIError.transport("unreadable audio") }
            continuation.yield(buffer)
        case .device:
            for buffer in try await DeviceVoice.render(text, language: settings.language, speaker: speaker) {
                continuation.yield(buffer)
            }
        }
    }
}

/// The phone's own voice, rendered to buffers so it plays through the call's
/// engine (and its echo canceller) like any other voice.
@MainActor
enum DeviceVoice {
    static func render(_ text: String, language: String, speaker: CallSpeaker?) async throws -> [AVAudioPCMBuffer] {
        let synthesizer = AVSpeechSynthesizer()
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = voice(language: language, index: speaker?.index ?? 0)
        return await withCheckedContinuation { continuation in
            var buffers: [AVAudioPCMBuffer] = []
            var done = false
            synthesizer.write(utterance) { buffer in
                guard !done else { return }
                guard let pcm = buffer as? AVAudioPCMBuffer, pcm.frameLength > 0 else {
                    done = true
                    _ = synthesizer
                    continuation.resume(returning: buffers)
                    return
                }
                buffers.append(pcm)
            }
        }
    }

    /// The best installed voice for the language; a room's members get
    /// different ones so they can be told apart.
    static func voice(language: String, index: Int) -> AVSpeechSynthesisVoice? {
        let code = language == "auto" ? AVSpeechSynthesisVoice.currentLanguageCode() : language
        let voices = AVSpeechSynthesisVoice.speechVoices()
        let exact = voices.filter { $0.language.lowercased() == code.lowercased() }
        let pool = (exact.isEmpty ? voices.filter { $0.language.lowercased().hasPrefix(String(code.prefix(2)).lowercased()) } : exact)
            .sorted { ($0.quality.rawValue, $0.identifier) > ($1.quality.rawValue, $1.identifier) }
        guard !pool.isEmpty else { return AVSpeechSynthesisVoice(language: code) }
        return pool[index % pool.count]
    }
}

/// Queued sentences, played back to back on the call's voice node.
@MainActor
final class CallSpeechPlayer: CallSpeaking {
    private struct Sentence {
        let id = UUID()
        let text: String
        let speaker: CallSpeaker?
        let audio: CallSpeechAudio
    }

    private let io: CallAudioIO
    private let source: CallSpeechSourcing
    private var queue: [Sentence] = []
    private var pumping = false
    private var generation = 0
    private var scheduled = 0
    private var completed = 0
    private var starts: [(index: Int, text: String, speaker: CallSpeaker?)] = []
    private var active = false
    private var current: Task<Void, Never>?
    private var currentSentenceId: UUID?
    /// The sentences of the current answer, in order, with when they play
    /// (seconds on the voice node's clock): what a barge-in reports heard.
    private var ledger: [(id: UUID, text: String, start: Double?, end: Double?, complete: Bool)] = []
    /// where the next scheduled buffer starts on the voice node's clock
    private var cursor: Double = 0
    /// The speaker of the next sentences queued (a room's member).
    var speaker: CallSpeaker?
    var onSentenceStart: (String, CallSpeaker?) -> Void = { _, _ in }
    var onIdle: () -> Void = {}
    var onError: (Error) -> Void = { _ in }

    init(io: CallAudioIO, source: CallSpeechSourcing) {
        self.io = io
        self.source = source
    }

    var busy: Bool { !queue.isEmpty || pumping || completed < scheduled }

    func level() -> Float { io.outputLevel }

    func enqueue(_ sentence: String) {
        // the fetch starts now: the stream buffers while earlier sentences play
        let entry = Sentence(text: sentence, speaker: speaker, audio: source.audio(for: sentence, speaker: speaker))
        queue.append(entry)
        ledger.append((entry.id, sentence, nil, nil, false))
        active = true
        if !pumping { Task { await pump() } }
    }

    func duck() { io.voice.volume = 0.12 }
    func unduck() { io.voice.volume = 1 }

    func cancel() {
        let wasBusy = busy
        generation += 1
        current?.cancel()
        queue = []
        starts = []
        scheduled = 0
        completed = 0
        cursor = 0
        if io.running {
            io.voice.stop()
            io.voice.play()
        }
        io.voice.volume = 1
        if wasBusy {
            active = false
            onIdle()
        }
    }

    func tone(_ earcon: CallEarcon) { io.tone(earcon) }

    /// The voice node's clock now (seconds since it last started playing).
    private var clock: Double {
        guard io.running, let nodeTime = io.voice.lastRenderTime,
              let time = io.voice.playerTime(forNodeTime: nodeTime) else { return 0 }
        return Double(time.sampleTime) / time.sampleRate
    }

    func playback(speed: Double) -> PlaybackCut {
        PlaybackCut.measure(ledger.map { ($0.text, $0.start, $0.end, $0.complete) }, now: clock, speed: speed)
    }

    func resetLedger() { ledger = [] }

    func close() { cancel() }

    private func pump() async {
        guard !pumping else { return }
        pumping = true
        while let sentence = queue.first {
            let mine = generation
            currentSentenceId = sentence.id
            // its own task, so a cut stops waiting on a slow download at once
            let consumer = Task { @MainActor [weak self] in
                var first = true
                var converter: AVAudioConverter?
                do {
                    for try await buffer in sentence.audio {
                        guard let self, mine == self.generation, !Task.isCancelled else { break }
                        guard let out = self.io.converted(buffer, using: &converter) else { continue }
                        self.schedule(out, start: first ? sentence : nil, generation: mine)
                        first = false
                    }
                } catch {
                    if let self, mine == self.generation, !(error is CancellationError) { self.onError(error) }
                }
                // all its audio arrived (or there was none: it takes no time)
                if let self, mine == self.generation, let index = self.ledger.firstIndex(where: { $0.id == sentence.id }) {
                    self.ledger[index].complete = true
                }
            }
            current = consumer
            await consumer.value
            current = nil
            if queue.first?.id == sentence.id { queue.removeFirst() }
        }
        pumping = false
        settle()
    }

    private func schedule(_ buffer: AVAudioPCMBuffer, start: Sentence?, generation mine: Int) {
        guard io.running else { return }
        let index = scheduled
        scheduled += 1
        let at = max(cursor, clock)
        cursor = at + Double(buffer.frameLength) / buffer.format.sampleRate
        if let start, let entry = ledger.firstIndex(where: { $0.id == start.id }) {
            ledger[entry].start = at
        }
        if let owner = currentSentenceId, let entry = ledger.firstIndex(where: { $0.id == owner }) {
            ledger[entry].end = cursor
        }
        if let start {
            if completed >= index {
                let text = start.text
                let speaker = start.speaker
                DispatchQueue.main.async { [weak self] in
                    guard let self, self.generation == mine else { return }
                    self.onSentenceStart(text, speaker)
                }
            } else {
                starts.append((index, start.text, start.speaker))
            }
        }
        if !io.voice.isPlaying { io.voice.play() }
        io.voice.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            DispatchQueue.main.async { self?.played(mine) }
        }
    }

    private func played(_ mine: Int) {
        guard mine == generation else { return }
        completed += 1
        let due = starts.filter { $0.index <= completed }
        starts.removeAll { $0.index <= completed }
        for start in due { onSentenceStart(start.text, start.speaker) }
        settle()
    }

    private func settle() {
        guard active, queue.isEmpty, !pumping, completed >= scheduled else { return }
        active = false
        scheduled = 0
        completed = 0
        onIdle()
    }
}
