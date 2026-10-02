// The call's microphone and speaker: one AVAudioEngine with Apple's voice
// processing on (the same echo canceller FaceTime and phone calls use), so
// the microphone stays open while the bot speaks and the bot does not hear
// itself. The desktop asks Chromium for the same thing (getUserMedia with
// echoCancellation, noiseSuppression, autoGainControl).
//
// Capture is converted to the call's 32 ms frames of 16 kHz mono and handed
// to the main actor; the bot's voice is scheduled on a player node through
// the same engine (the echo canceller's reference), and earcons on a second
// node so cutting the bot never cuts a tone. A tap on the output measures
// what is audible for the echo guard and the waveform.
import AVFoundation
import CompanionCore

final class CallAudioIO: @unchecked Sendable {
    enum Failure: Error { case noInput, converter }

    let engine = AVAudioEngine()
    let voice = AVAudioPlayerNode()
    let tones = AVAudioPlayerNode()
    /// The format every voice buffer is converted to before it is scheduled.
    let playFormat = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1)!

    private let lock = NSLock()
    private var _outputLevel: Float = 0
    private var _micLevel: Float = 0
    private var _micOpen = true
    private var pending: [Float] = []
    private var captureConverter: AVAudioConverter?
    private let frameFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: CallAudio.sampleRate, channels: 1, interleaved: false)!
    private(set) var capturing = false
    private(set) var running = false

    /// 32 ms frames of 16 kHz audio, on the main actor.
    var onFrame: (@MainActor ([Float]) -> Void)?

    var outputLevel: Float { lock.withLock { _outputLevel } }
    var micLevel: Float { lock.withLock { _micLevel } }
    var micOpen: Bool {
        get { lock.withLock { _micOpen } }
        set {
            lock.withLock { _micOpen = newValue }
            if capturing { engine.inputNode.isVoiceProcessingInputMuted = !newValue }
        }
    }

    /// The call's audio session: play and record, voice chat (Apple's echo
    /// cancellation and gain), speaker unless a headset or AirPods are on,
    /// Bluetooth headsets with their microphone.
    static func configureSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP, .defaultToSpeaker])
        try? session.setPreferredIOBufferDuration(0.02)
    }

    /// Start the engine. `capture` false (an injected recording in tests):
    /// the speaker only.
    func start(capture: Bool) throws {
        guard !running else { return }
        engine.attach(voice)
        engine.attach(tones)
        engine.connect(voice, to: engine.mainMixerNode, format: playFormat)
        engine.connect(tones, to: engine.mainMixerNode, format: playFormat)
        if capture {
            let input = engine.inputNode
            try? input.setVoiceProcessingEnabled(true)
            let format = input.outputFormat(forBus: 0)
            guard format.channelCount > 0, format.sampleRate > 0 else { throw Failure.noInput }
            guard let converter = AVAudioConverter(from: format, to: frameFormat) else { throw Failure.converter }
            captureConverter = converter
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
                self?.captured(buffer)
            }
            capturing = true
        }
        let mixer = engine.mainMixerNode
        mixer.installTap(onBus: 0, bufferSize: 1024, format: mixer.outputFormat(forBus: 0)) { [weak self] buffer, _ in
            guard let self, let data = buffer.floatChannelData?[0] else { return }
            var sum: Float = 0
            let count = Int(buffer.frameLength)
            for i in 0..<count { sum += data[i] * data[i] }
            let level = count > 0 ? (sum / Float(count)).squareRoot() : 0
            self.lock.withLock { self._outputLevel = level }
        }
        engine.prepare()
        try engine.start()
        voice.play()
        tones.play()
        running = true
    }

    func stop() {
        guard running else { return }
        running = false
        voice.stop()
        tones.stop()
        engine.mainMixerNode.removeTap(onBus: 0)
        if capturing {
            engine.inputNode.removeTap(onBus: 0)
            capturing = false
        }
        engine.stop()
        lock.withLock { _outputLevel = 0; _micLevel = 0 }
    }

    /// Restart after a route or configuration change (AirPods in or out).
    func restart() {
        guard running else { return }
        let capture = capturing
        stop()
        engine.reset()
        try? start(capture: capture)
    }

    // MARK: - Capture

    private func captured(_ buffer: AVAudioPCMBuffer) {
        guard let converter = captureConverter else { return }
        let ratio = CallAudio.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio + 64)
        guard let out = AVAudioPCMBuffer(pcmFormat: frameFormat, frameCapacity: capacity) else { return }
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
        guard error == nil, let data = out.floatChannelData?[0] else { return }
        feed(Array(UnsafeBufferPointer(start: data, count: Int(out.frameLength))))
    }

    /// Samples at 16 kHz in, 512-sample frames out (also the injection path).
    func feed(_ samples: [Float]) {
        var frames: [[Float]] = []
        lock.withLock {
            pending += samples
            while pending.count >= CallAudio.frameSamples {
                frames.append(Array(pending.prefix(CallAudio.frameSamples)))
                pending.removeFirst(CallAudio.frameSamples)
            }
        }
        guard !frames.isEmpty, micOpen else { return }
        let level = CallAudio.rms(frames[frames.count - 1])
        lock.withLock { _micLevel = level }
        let deliver = onFrame
        // FIFO: frames reach the turn detector in the order they were heard
        DispatchQueue.main.async {
            for frame in frames { deliver?(frame) }
        }
    }

    // MARK: - Playback helpers

    /// A buffer in the player's format (any rate, mono or the first channel).
    func converted(_ buffer: AVAudioPCMBuffer, using converter: inout AVAudioConverter?) -> AVAudioPCMBuffer? {
        if buffer.format == playFormat { return buffer }
        if converter == nil || converter?.inputFormat != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: playFormat)
        }
        guard let converter else { return nil }
        let ratio = playFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio + 256)
        guard let out = AVAudioPCMBuffer(pcmFormat: playFormat, frameCapacity: capacity) else { return nil }
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
        return error == nil && out.frameLength > 0 ? out : nil
    }

    /// A short sine tone or two (earcons), beside the bot's voice.
    func tone(_ earcon: CallEarcon, volume: Float = 0.08) {
        guard running else { return }
        let rate = playFormat.sampleRate
        var samples: [Float] = []
        for note in earcon.notes {
            let count = Int(rate * note.ms / 1000)
            for i in 0..<count {
                let t = Double(i) / rate
                let attack = min(1, Double(i) / (rate * 0.012))
                let decay = exp(-5 * Double(i) / Double(count))
                samples.append(Float(sin(2 * .pi * note.hz * t) * attack * decay) * volume)
            }
        }
        guard let buffer = AVAudioPCMBuffer(pcmFormat: playFormat, frameCapacity: AVAudioFrameCount(samples.count)),
              let data = buffer.floatChannelData?[0] else { return }
        for (i, sample) in samples.enumerated() { data[i] = sample }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        if !tones.isPlaying { tones.play() }
        tones.scheduleBuffer(buffer, completionHandler: nil)
    }
}

extension AVAudioPCMBuffer {
    /// Mono float buffer of 16-bit little-endian PCM bytes.
    static func pcm16(_ data: Data, sampleRate: Double) -> AVAudioPCMBuffer? {
        let count = data.count / 2
        guard count > 0,
              let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)),
              let out = buffer.floatChannelData?[0] else { return nil }
        data.withUnsafeBytes { raw in
            for i in 0..<count {
                let value = Int16(littleEndian: raw.loadUnaligned(fromByteOffset: i * 2, as: Int16.self))
                out[i] = Float(value) / 32768
            }
        }
        buffer.frameLength = AVAudioFrameCount(count)
        return buffer
    }

    /// Mono float buffer of samples.
    static func mono(_ samples: [Float], sampleRate: Double) -> AVAudioPCMBuffer? {
        guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(max(1, samples.count))),
              let out = buffer.floatChannelData?[0] else { return nil }
        for (i, sample) in samples.enumerated() { out[i] = sample }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        return buffer
    }

    /// Decode compressed audio (mp3, wav, m4a) bytes to one PCM buffer.
    static func decode(_ data: Data) -> AVAudioPCMBuffer? {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("call-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: url) }
        guard (try? data.write(to: url)) != nil, let file = try? AVAudioFile(forReading: url),
              let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)),
              (try? file.read(into: buffer)) != nil else { return nil }
        return buffer
    }
}
