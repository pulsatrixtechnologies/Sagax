// The call's ears: the person's turn, recognized on this phone while they
// speak. The turn detector (LiveCallEngine) decides when a turn starts and
// ends, the same endpointing as the desktop; this file only turns that turn's
// frames into words, with partials as they come.
//
//   iOS 26 and later: SpeechAnalyzer + SpeechTranscriber, on device, when the
//     language's model is installed (it is downloaded in the background the
//     first time, and the call uses the older recognizer meanwhile).
//   Otherwise: SFSpeechRecognizer, on device whenever the language allows.
//   No recognizer at all, with voice mode available: the turn is uploaded
//     whole to the server's xAI speech to text (POST /voice/transcribe), the
//     desktop's own fallback.
import AVFoundation
import CompanionCore
import Speech

/// One turn's recognition.
@MainActor
protocol UtteranceRecognition: AnyObject {
    func append(_ frame: [Float])
    func finish() async -> String
    func cancel()
}

@MainActor
final class CallRecognizer: CallTranscribing {
    enum Engine: String { case analyzer, legacy, server, scripted, none }

    private(set) var engine: Engine = .none
    var onPartial: (String) -> Void = { _ in }
    private var current: UtteranceRecognition?
    private var legacy: SFSpeechRecognizer?
    private var analyzerLocale: Locale?
    private var analyzerFormat: AVAudioFormat?
    private var upload: (([Float]) async throws -> String)?
    private var script: (() -> String)?

    /// Pick the best recognizer for these languages. False: nothing can hear.
    func prepare(locales: [Locale], upload: (([Float]) async throws -> String)?) async -> Bool {
        self.upload = upload
        let authorized = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0 == .authorized) }
        }
        if #available(iOS 26.0, *), await prepareAnalyzer(locales) {
            engine = .analyzer
            return true
        }
        if authorized, let recognizer = locales.lazy.compactMap({ SFSpeechRecognizer(locale: $0) }).first(where: { $0.isAvailable }) {
            legacy = recognizer
            engine = .legacy
            return true
        }
        if upload != nil {
            engine = .server
            return true
        }
        return false
    }

    /// Tests: the words come from the injected recording's script.
    func useScript(_ provider: @escaping () -> String) {
        script = provider
        engine = .scripted
    }

    @available(iOS 26.0, *)
    private func prepareAnalyzer(_ locales: [Locale]) async -> Bool {
        guard SpeechTranscriber.isAvailable else { return false }
        for candidate in locales {
            guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: candidate) else { continue }
            let module = SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults], attributeOptions: [])
            let status = await AssetInventory.status(forModules: [module])
            guard status == .installed else {
                // the model downloads for next time; this call uses the older recognizer
                if status == .supported || status == .downloading {
                    Task.detached {
                        if let request = try? await AssetInventory.assetInstallationRequest(supporting: [module]) {
                            try? await request.downloadAndInstall()
                        }
                    }
                }
                return false
            }
            analyzerLocale = locale
            analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module])
            return analyzerFormat != nil
        }
        return false
    }

    // MARK: - CallTranscribing

    func begin(preroll: [[Float]]) {
        guard current == nil else { return }
        current = makeUtterance()
        for frame in preroll { current?.append(frame) }
    }

    func push(_ frame: [Float]) { current?.append(frame) }

    func finish() async -> String {
        guard let utterance = current else { return "" }
        current = nil
        return await utterance.finish()
    }

    func discard() {
        current?.cancel()
        current = nil
    }

    func close() { discard() }

    private func makeUtterance() -> UtteranceRecognition? {
        let partial: (String) -> Void = { [weak self] text in self?.onPartial(text) }
        switch engine {
        case .analyzer:
            if #available(iOS 26.0, *), let locale = analyzerLocale, let format = analyzerFormat {
                return AnalyzerUtterance(locale: locale, format: format, onPartial: partial)
            }
            return nil
        case .legacy:
            return legacy.map { LegacyUtterance(recognizer: $0, onPartial: partial) }
        case .server:
            return upload.map { UploadUtterance(upload: $0) }
        case .scripted:
            return script.map { ScriptedUtterance(script: $0, onPartial: partial) }
        case .none:
            return nil
        }
    }
}

private let frameFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: CallAudio.sampleRate, channels: 1, interleaved: false)!

// MARK: - SFSpeechRecognizer

@MainActor
private final class LegacyUtterance: UtteranceRecognition {
    private let request = SFSpeechAudioBufferRecognitionRequest()
    private var task: SFSpeechRecognitionTask?
    private var text = ""
    private var done = false
    private var waiter: CheckedContinuation<Void, Never>?

    init(recognizer: SFSpeechRecognizer, onPartial: @escaping (String) -> Void) {
        request.shouldReportPartialResults = true
        request.addsPunctuation = true
        request.taskHint = .dictation
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let words = result?.bestTranscription.formattedString
            let final = result?.isFinal == true || error != nil
            DispatchQueue.main.async {
                guard let self else { return }
                if let words, !words.isEmpty, !self.done {
                    self.text = words
                    onPartial(words)
                }
                if final { self.settle() }
            }
        }
    }

    func append(_ frame: [Float]) {
        guard let buffer = AVAudioPCMBuffer.mono(frame, sampleRate: CallAudio.sampleRate) else { return }
        request.append(buffer)
    }

    func finish() async -> String {
        request.endAudio()
        if !done {
            await withCheckedContinuation { continuation in
                waiter = continuation
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.settle() }
            }
        }
        task?.cancel()
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func cancel() {
        done = true
        task?.cancel()
        settle()
    }

    private func settle() {
        done = true
        waiter?.resume()
        waiter = nil
    }
}

// MARK: - SpeechAnalyzer (iOS 26)

@available(iOS 26.0, *)
@MainActor
private final class AnalyzerUtterance: UtteranceRecognition {
    private let analyzer: SpeechAnalyzer
    private let input: AsyncStream<AnalyzerInput>.Continuation
    private let format: AVAudioFormat
    private var converter: AVAudioConverter?
    private var started: Task<Void, Never>?
    private var results: Task<Void, Never>?
    private var finalText = ""
    private var volatile = ""

    init(locale: Locale, format: AVAudioFormat, onPartial: @escaping (String) -> Void) {
        self.format = format
        let transcriber = SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults], attributeOptions: [])
        analyzer = SpeechAnalyzer(modules: [transcriber])
        let (stream, continuation) = AsyncStream.makeStream(of: AnalyzerInput.self)
        input = continuation
        converter = AVAudioConverter(from: frameFormat, to: format)
        results = Task { @MainActor [weak self] in
            do {
                for try await result in transcriber.results {
                    guard let self else { return }
                    let words = String(result.text.characters)
                    if result.isFinal {
                        self.finalText = [self.finalText, words].filter { !$0.isEmpty }.joined(separator: " ")
                        self.volatile = ""
                    } else {
                        self.volatile = words
                    }
                    onPartial(self.words)
                }
            } catch {}
        }
        let analyzer = analyzer
        started = Task { try? await analyzer.start(inputSequence: stream) }
    }

    private var words: String {
        [finalText, volatile].filter { !$0.isEmpty }.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func append(_ frame: [Float]) {
        guard let buffer = AVAudioPCMBuffer.mono(frame, sampleRate: CallAudio.sampleRate) else { return }
        if format == frameFormat {
            input.yield(AnalyzerInput(buffer: buffer))
            return
        }
        guard let converter else { return }
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * format.sampleRate / CallAudio.sampleRate + 64)
        guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return }
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
        if error == nil, out.frameLength > 0 { input.yield(AnalyzerInput(buffer: out)) }
    }

    func finish() async -> String {
        input.finish()
        await started?.value
        let analyzer = analyzer
        let finalize = Task { try? await analyzer.finalizeAndFinishThroughEndOfInput() }
        // the final words, or what was heard after 1.5 s
        let deadline = Task { try? await Task.sleep(nanoseconds: 1_500_000_000) }
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await finalize.value }
            group.addTask { await deadline.value }
            await group.next()
            group.cancelAll()
        }
        if let results { await withTaskGroup(of: Void.self) { group in
            group.addTask { await results.value }
            group.addTask { try? await Task.sleep(nanoseconds: 300_000_000) }
            await group.next()
            group.cancelAll()
        } }
        return words
    }

    func cancel() {
        input.finish()
        results?.cancel()
        let analyzer = analyzer
        Task { await analyzer.cancelAndFinishNow() }
    }
}

// MARK: - Uploaded whole (xAI speech to text on the server)

@MainActor
private final class UploadUtterance: UtteranceRecognition {
    private var samples: [Float] = []
    private let upload: ([Float]) async throws -> String

    init(upload: @escaping ([Float]) async throws -> String) { self.upload = upload }

    func append(_ frame: [Float]) { samples += frame }

    func finish() async -> String { (try? await upload(samples)) ?? "" }

    func cancel() { samples = [] }
}

// MARK: - Scripted (tests)

@MainActor
private final class ScriptedUtterance: UtteranceRecognition {
    private let script: () -> String
    private let onPartial: (String) -> Void
    private var frames = 0

    init(script: @escaping () -> String, onPartial: @escaping (String) -> Void) {
        self.script = script
        self.onPartial = onPartial
    }

    /// Partials grow word by word as the recording plays, like a recognizer.
    func append(_ frame: [Float]) {
        frames += 1
        let words = script().split(separator: " ")
        let shown = min(words.count, frames / 6)
        if shown > 0 { onPartial(words.prefix(shown).joined(separator: " ")) }
    }

    func finish() async -> String { script() }

    func cancel() {}
}
