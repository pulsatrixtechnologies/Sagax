// A voice note the person records in the composer (the desktop's
// src/lib/voice-note.ts, PR #601). The clip is a 16 kHz mono 16-bit WAV
// uploaded through the ordinary attachment store (`POST /api/files`), so it
// travels as an `<attached-file>` named `voice-note-<date>.wav`. When the bot
// has speech to text, the words go through the dictation route
// (`/voice/transcribe`) in clips under that route's size limit and become the
// message's text. No new server route.
//
// Foundation only, so `swift test` covers the rules without a simulator; the
// recorder itself (AVAudioRecorder) lives in the app target.
import Foundation

public enum VoiceNoteRecording {
    /// Our recordings are named this way; the transcript shows them as a voice note.
    public static let prefix = "voice-note-"
    /// Five minutes: about 9.6 MB of WAV, under the 25 MB attachment limit.
    public static let maxSeconds: Double = 5 * 60
    /// Shorter than this is a slip of the finger, not a message.
    public static let minSeconds: Double = 0.5
    /// Bars drawn by the recorder's waveform.
    public static let bars = 24
    public static let sampleRate = 16_000
    public static let mime = "audio/wav"
    /// The transcription route's limit (shared/voice-mode.ts VOICE_MODE_MAX_AUDIO_BYTES).
    public static let maxTranscriptionBytes = 2 * 1_024 * 1_024

    private static let headerBytes = 44

    /// `voice-note-20261016-142530.wav`, in the phone's local time like the desktop.
    public static func fileName(at date: Date = Date(), timeZone: TimeZone = .current) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        func pad(_ value: Int?) -> String { String(format: "%02d", value ?? 0) }
        return "\(prefix)\(parts.year ?? 1970)\(pad(parts.month))\(pad(parts.day))-\(pad(parts.hour))\(pad(parts.minute))\(pad(parts.second)).wav"
    }

    /// The desktop's isVoiceNoteName: `voice-note-` then digits and dashes, `.wav`.
    public static func isVoiceNoteName(_ name: String) -> Bool {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard trimmed.hasPrefix(prefix), trimmed.hasSuffix(".wav") else { return false }
        let middle = trimmed.dropFirst(prefix.count).dropLast(4)
        return !middle.isEmpty && middle.allSatisfy { $0 == "-" || ("0"..."9").contains($0) }
    }

    /// AVAudioRecorder's average power (dBFS, -160...0) as a linear loudness 0...1.
    public static func level(fromDecibels decibels: Float) -> Double {
        guard decibels.isFinite else { return 0 }
        let clamped = Swift.min(0, Swift.max(-160, Double(decibels)))
        return pow(10, clamped / 20)
    }

    /// The waveform: the last `bars` loudness values, oldest first, scaled
    /// 0...1 the way the desktop scales them (speech sits around 0.02...0.2).
    public static func waveformBars(_ history: [Double], bars: Int = bars) -> [Double] {
        let recent = Array(history.suffix(bars))
        let padded = Array(repeating: 0.0, count: Swift.max(0, bars - recent.count)) + recent
        return padded.map { value in
            guard value.isFinite else { return 0 }
            return Swift.max(0, Swift.min(1, (Swift.max(0, value) * 6).squareRoot()))
        }
    }

    /// `0:07`, `4:59`.
    public static func clock(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds > 0 else { return "0:00" }
        let whole = Int(seconds.rounded(.down))
        return String(format: "%d:%02d", whole / 60, whole % 60)
    }

    // MARK: - WAV

    /// The 16-bit PCM samples of a WAV file and its rate, whatever chunks
    /// (FLLR padding, LIST) the writer put before `data`. Nil for anything
    /// that is not 16-bit PCM WAV.
    public static func pcm(fromWAV wav: Data) -> (samples: Data, sampleRate: Int, channels: Int)? {
        let bytes = [UInt8](wav)
        guard bytes.count >= 12,
              String(decoding: bytes[0..<4], as: UTF8.self) == "RIFF",
              String(decoding: bytes[8..<12], as: UTF8.self) == "WAVE"
        else { return nil }
        func u16(_ at: Int) -> Int { Int(bytes[at]) | Int(bytes[at + 1]) << 8 }
        func u32(_ at: Int) -> Int { u16(at) | u16(at + 2) << 16 }
        var cursor = 12
        var rate: Int?
        var channels = 1
        var bits = 0
        var format = 0
        while cursor + 8 <= bytes.count {
            let id = String(decoding: bytes[cursor..<cursor + 4], as: UTF8.self)
            let size = u32(cursor + 4)
            let body = cursor + 8
            if id == "fmt ", body + 16 <= bytes.count {
                format = u16(body)
                channels = u16(body + 2)
                rate = u32(body + 4)
                bits = u16(body + 14)
            } else if id == "data" {
                guard format == 1, bits == 16, let rate, channels > 0 else { return nil }
                let end = Swift.min(bytes.count, body + size)
                let length = (end - body) / 2 * 2
                return (Data(bytes[body..<body + length]), rate, channels)
            }
            cursor = body + size + (size & 1)
        }
        return nil
    }

    /// A canonical 44-byte header WAV of 16-bit little-endian PCM.
    public static func wav(pcm: Data, sampleRate: Int = sampleRate, channels: Int = 1) -> Data {
        var out = Data(capacity: headerBytes + pcm.count)
        func append<T: FixedWidthInteger>(_ value: T) {
            var little = value.littleEndian
            withUnsafeBytes(of: &little) { out.append(contentsOf: $0) }
        }
        out.append(contentsOf: Array("RIFF".utf8))
        append(UInt32(36 + pcm.count))
        out.append(contentsOf: Array("WAVEfmt ".utf8))
        append(UInt32(16))
        append(UInt16(1))
        append(UInt16(channels))
        append(UInt32(sampleRate))
        append(UInt32(sampleRate * channels * 2))
        append(UInt16(channels * 2))
        append(UInt16(16))
        out.append(contentsOf: Array("data".utf8))
        append(UInt32(pcm.count))
        out.append(pcm)
        return out
    }

    /// Samples per transcription clip: whole seconds, each WAV under the limit.
    public static func transcriptionChunkSamples(maxBytes: Int = maxTranscriptionBytes, sampleRate: Int = sampleRate) -> Int {
        let fit = (maxBytes - headerBytes) / 2
        return Swift.max(sampleRate, fit / sampleRate * sampleRate)
    }

    /// The recording cut into WAV clips the transcription route accepts.
    public static func transcriptionClips(pcm: Data, sampleRate: Int = sampleRate, maxBytes: Int = maxTranscriptionBytes) -> [Data] {
        let chunkBytes = transcriptionChunkSamples(maxBytes: maxBytes, sampleRate: sampleRate) * 2
        var clips: [Data] = []
        var start = pcm.startIndex
        while start < pcm.endIndex {
            let end = Swift.min(pcm.endIndex, start + chunkBytes)
            clips.append(wav(pcm: pcm.subdata(in: start..<end), sampleRate: sampleRate))
            start = end
        }
        return clips
    }

    /// Duration of 16-bit mono PCM, in seconds.
    public static func duration(pcmBytes: Int, sampleRate: Int = sampleRate, channels: Int = 1) -> Double {
        guard sampleRate > 0, channels > 0 else { return 0 }
        return Double(pcmBytes / 2 / channels) / Double(sampleRate)
    }
}

/// The composer mic's press: a short tap is dictation (as before), a press
/// held past `holdThreshold` records a voice note that a release sends, and
/// a slide toward the field past `cancelDistance` throws it away.
public enum VoiceNoteHold {
    public static let holdThreshold: TimeInterval = 0.35
    public static let cancelDistance: Double = 80

    public enum Outcome: Equatable, Sendable { case tap, send, cancel }

    public static func outcome(heldFor seconds: TimeInterval, translationX: Double, recording: Bool) -> Outcome {
        guard recording || seconds >= holdThreshold else { return .tap }
        return cancels(translationX: translationX) ? .cancel : .send
    }

    /// Slid left far enough that letting go cancels.
    public static func cancels(translationX: Double) -> Bool {
        translationX <= -cancelDistance
    }
}
