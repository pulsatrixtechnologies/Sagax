// Dictation for the composer. Two ears (2026-10-28, the desktop's
// `dictationEngine` in src/lib/composer-dictation.ts):
//
// - xAI on the server (`.xai`), whenever a key serves the person
//   (Session.dictationEars asks `GET /voice/status`): the microphone is
//   recorded at 16 kHz and the clip is sent once it stops (`POST
//   /voice/transcribe`, the same ears, keyterms and formatting as the
//   call); the words join the field then ("processing" meanwhile). A
//   failure says why and about which key (VoiceWords), never a raw line.
// - Apple on this iPhone (`.apple`): `SFSpeechRecognizer` on an
//   `AVAudioEngine` tap, partials streamed into the text field, press to
//   stop, the same engine as the desktop helper. Only when no xAI key
//   serves (or the server could not be asked), and `appleReason` says so
//   under the composer: an announced fallback, never a silent one.
//
// Composer mode, not call mode: there is no silence endpointing. On-device
// when Apple's recognizer supports it, so talking to a bot does not become
// talking to Apple's servers. Locales come from `Dictation.localeCandidates`
// rather than a hardcoded en-US, for the same reason the desktop helper
// stopped hardcoding one.
//
// Lives in the app target on purpose. CompanionCore is Foundation-only so
// `swift test` can run without a simulator; Speech and AVAudioEngine are
// the opposite of that.
import AVFoundation
import Combine
import Speech
import CompanionCore
import SwiftUI

@MainActor
final class SpeechDictation: ObservableObject {
    private static let cancellationCodes: [String: Set<Int>] = [
        "kLSRErrorDomain": [209, 216],
        "kAFAssistantErrorDomain": [216],
    ]

    /// xAI's ears on the server: a turn's samples (16 kHz) to its words.
    struct ServerEars {
        /// the key the status named (the provider line)
        let key: VoiceKeyInfo?
        let transcribe: ([Float]) async throws -> VoiceTranscription
    }

    /// Who hears this dictation (Session.dictationEars).
    enum Ears {
        case xai(ServerEars)
        /// Apple on this iPhone; `reason` when xAI was wanted but could not
        /// be used (said under the composer), nil when Apple is the plain choice
        case apple(reason: String?)
    }

    enum Engine: Equatable { case apple, xai }

    @Published private(set) var isListening = false
    /// True from `start` until capture is running or the attempt fails.
    /// Publishing it keeps the frozen composer base protected while the
    /// system permission sheets are still in flight.
    @Published private(set) var isStarting = false
    /// xAI is turning the clip into words (the field waits for them).
    @Published private(set) var isProcessing = false
    /// Who heard the last or current dictation.
    @Published private(set) var engine: Engine = .apple
    /// Why Apple hears although xAI was wanted (shown while listening).
    @Published private(set) var appleReason: String?
    /// A key refused on the way to the one that heard: said once.
    @Published private(set) var keyNotice: String?
    @Published private(set) var transcript = ""
    @Published private(set) var error: LocalizedStringKey?

    /// Composer text captured when listening started. Frozen for the
    /// session so each partial replaces the last rather than stacking.
    /// ChatView reads this from `onChange(of: transcript)` and must not
    /// substitute the live draft.
    private(set) var base = ""

    private var recognizer: SFSpeechRecognizer?
    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var tapInstalled = false
    private var stopping = false
    /// Bumped on every start/stop so an authorization that finishes after
    /// the user already cancelled cannot open the mic.
    private var generation = 0
    private var startTask: Task<Void, Never>?
    /// xAI: the samples recorded so far (16 kHz mono) and their converter.
    private var samples: [Float] = []
    private var captureConverter: AVAudioConverter?
    private var serverEars: ServerEars?
    private var processingTask: Task<Void, Never>?
    private static let serverFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: CallAudio.sampleRate, channels: 1, interleaved: false)!

    /// Tap: start or stop. `ears` says who hears, asked when it starts
    /// (the server's answer is cached a minute by the session).
    func toggle(capturing base: String, ears: @escaping () async -> Ears = { .apple(reason: nil) }) {
        if isListening || isStarting {
            stop()
        } else if isProcessing {
            // the words are on their way: a second tap waits for them
        } else {
            start(base: base, ears: ears)
        }
    }

    private func start(base: String, ears: @escaping () async -> Ears) {
        guard !isListening, !isStarting else { return }
        error = nil
        keyNotice = nil
        self.base = base.trimmingCharacters(in: .whitespacesAndNewlines)
        transcript = ""
        isStarting = true
        generation += 1
        let gen = generation
        startTask = Task {
            let chosen = await ears()
            guard gen == generation, !Task.isCancelled else { return }
            switch chosen {
            case let .xai(server):
                engine = .xai
                appleReason = nil
                serverEars = server
                await actuallyStartServer(generation: gen)
            case let .apple(reason):
                engine = .apple
                appleReason = reason
                serverEars = nil
                await actuallyStart(generation: gen)
            }
        }
    }

    /// Stop listening. With xAI's ears the clip goes to the server now and
    /// the words come back into the field (`isProcessing` meanwhile).
    func stop() {
        startTask?.cancel()
        startTask = nil
        generation += 1
        isStarting = false
        stopping = true
        let wasListening = isListening
        isListening = false
        let recorded = samples
        samples = []
        teardown()
        if wasListening, engine == .xai, let serverEars, !recorded.isEmpty {
            send(recorded, to: serverEars)
        }
    }

    /// Stop and drop what was recorded (the chat closes, a call starts).
    func cancel() {
        processingTask?.cancel()
        processingTask = nil
        isProcessing = false
        samples = []
        stop()
        samples = []
    }

    private func send(_ recorded: [Float], to ears: ServerEars) {
        processingTask?.cancel()
        isProcessing = true
        processingTask = Task { [weak self] in
            do {
                let heard = try await ears.transcribe(recorded)
                guard let self, !Task.isCancelled else { return }
                if let line = heard.key.fallbackLine { keyNotice = line }
                let words = heard.text.trimmingCharacters(in: .whitespacesAndNewlines)
                if !words.isEmpty { transcript = words }
            } catch {
                guard let self, !Task.isCancelled else { return }
                if let failure = error as? VoiceFailure { self.error = LocalizedStringKey(VoiceWords.line(failure)) }
                else { self.error = LocalizedStringKey(String(localized: "xAI could not hear that (\(error.localizedDescription)). Try again.")) }
            }
            self?.isProcessing = false
            self?.processingTask = nil
        }
    }

    // MARK: - xAI on the server

    private func actuallyStartServer(generation gen: Int) async {
        let mic = await MicrophonePermission.request()
        guard gen == generation, !Task.isCancelled else { return }
        guard mic else {
            isStarting = false
            error = Self.micDeniedMessage
            return
        }
        do {
            try beginServerCapture()
            isStarting = false
        } catch {
            isStarting = false
            self.error = "Couldn't start the microphone."
            teardown()
        }
    }

    /// The microphone to 16 kHz mono samples (the call's capture), kept
    /// until the person stops.
    private func beginServerCapture() throws {
        VoiceNoteCenter.shared.beginInputOwnership(.dictation)
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement)
        try session.setActive(true, options: .notifyOthersOnDeactivation)
        let engine = AVAudioEngine()
        audioEngine = engine
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.channelCount > 0, format.sampleRate > 0 else { throw CaptureError.silentInput }
        guard let converter = AVAudioConverter(from: format, to: Self.serverFormat) else { throw CaptureError.silentInput }
        captureConverter = converter
        samples = []
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self, let out = Self.resampled(buffer, with: converter) else { return }
            Task { @MainActor in self.samples += out }
        }
        tapInstalled = true
        engine.prepare()
        try engine.start()
        stopping = false
        isListening = true
    }

    nonisolated private static func resampled(_ buffer: AVAudioPCMBuffer, with converter: AVAudioConverter) -> [Float]? {
        let ratio = CallAudio.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio + 64)
        guard let out = AVAudioPCMBuffer(pcmFormat: serverFormat, frameCapacity: capacity) else { return nil }
        var fed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if fed {
                status.pointee = .noDataNow
                return nil
            }
            fed = true
            status.pointee = .haveData
            return buffer
        }
        guard error == nil, let data = out.floatChannelData?[0] else { return nil }
        return Array(UnsafeBufferPointer(start: data, count: Int(out.frameLength)))
    }

    // MARK: - Authorization

    private func actuallyStart(generation gen: Int) async {
        let speech = await requestSpeechAuthorization()
        guard gen == generation, !Task.isCancelled else {
            return
        }
        guard speech == .authorized else {
            isStarting = false
            error = Self.speechDeniedMessage
            return
        }

        let mic = await MicrophonePermission.request()
        guard gen == generation, !Task.isCancelled else {
            return
        }
        guard mic else {
            isStarting = false
            error = Self.micDeniedMessage
            return
        }

        do {
            try beginCapture(generation: gen)
            isStarting = false
        } catch CaptureError.noRecognizer {
            isStarting = false
            error = "Dictation isn't available for this language."
            teardown()
        } catch {
            isStarting = false
            self.error = "Couldn't start the microphone."
            teardown()
        }
    }

    private func requestSpeechAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
    }

    // MARK: - Capture

    private func beginCapture(generation gen: Int) throws {
        let recognizer = Dictation.localeCandidates()
            .compactMap { SFSpeechRecognizer(locale: $0) }
            .first { $0.isAvailable }
        guard let recognizer else {
            throw CaptureError.noRecognizer
        }
        self.recognizer = recognizer

        // Take ownership of the shared session before reconfiguring it:
        // the audible voice note (if any) pauses here, and transcript
        // playback stays off until teardown() returns the session.
        VoiceNoteCenter.shared.beginInputOwnership(.dictation)

        let session = AVAudioSession.sharedInstance()
        // `.record` rather than `.playAndRecord`: this is composer
        // dictation, not a call, and holding the playback route would
        // duck whatever else is on the phone for no reason.
        try session.setCategory(.record, mode: .measurement)
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let engine = AVAudioEngine()
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        // The desktop helper does not set this (it is a CLI talking to an
        // older Speech.framework), but a chat message is better with the
        // commas the recognizer already knows about.
        request.addsPunctuation = true
        request.taskHint = .dictation
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }

        // Keep the engine on self before start() so a throw still has
        // something for teardown to remove the tap from. A local engine
        // that fails to start would leave tapInstalled true and the next
        // teardown would removeTap on a new engine that has none — which
        // is an exception, not a no-op.
        audioEngine = engine
        recognitionRequest = request

        // The tap format is only valid after the session is active.
        // Installing against a 0-channel format is the usual "it works
        // in the sample and fails here" failure.
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.channelCount > 0 else {
            throw CaptureError.silentInput
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
        }
        tapInstalled = true
        engine.prepare()
        try engine.start()

        stopping = false
        isListening = true

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, recognitionError in
            Task { @MainActor in
                self?.handle(
                    result: result,
                    recognitionError: recognitionError,
                    generation: gen
                )
            }
        }
    }

    private func handle(
        result: SFSpeechRecognitionResult?,
        recognitionError: Error?,
        generation gen: Int
    ) {
        // A cancelled task can still deliver a partial or a 209 after the
        // next session has already started. `isListening` is true then too,
        // so generation is what keeps this callback from rewriting the
        // new draft or stopping the new capture.
        guard gen == generation, !stopping, isListening else { return }
        if let result {
            transcript = Dictation.updateTranscript(transcript, new: result.bestTranscription.formattedString)
            // Composer dictation does not wait for isFinal — the last
            // partial is what you send. If the recognizer finalizes on
            // its own (rare without endAudio), just stop listening.
            if result.isFinal {
                stop()
                return
            }
        }
        guard let recognitionError else { return }
        let ns = recognitionError as NSError
        // Speech uses separate internal domains for local-recognizer and
        // assistant cancellation. Keep the observed codes scoped to their
        // domains: other values (notably assistant 1110, no speech) are real
        // recognition failures and should remain visible.
        if Self.cancellationCodes[ns.domain]?.contains(ns.code) == true {
            stop()
            return
        }
        self.error = "Couldn't transcribe that."
        stop()
    }

    private func teardown() {
        // Drop the tap before ending the request: a buffer that arrives
        // after endAudio() can fail the task instead of being ignored.
        if let engine = audioEngine {
            if tapInstalled {
                engine.inputNode.removeTap(onBus: 0)
                tapInstalled = false
            }
            if engine.isRunning { engine.stop() }
        }
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        audioEngine = nil
        recognizer = nil
        captureConverter = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        VoiceNoteCenter.shared.endInputOwnership(.dictation)
    }

    private enum CaptureError: Error {
        case silentInput
        case noRecognizer
    }

    static let speechDeniedMessage: LocalizedStringKey =
        "Dictation needs Speech Recognition access. Enable it in Settings, then Sagax."
    static let micDeniedMessage: LocalizedStringKey =
        "Dictation needs Microphone access. Enable it in Settings, then Sagax."
}
