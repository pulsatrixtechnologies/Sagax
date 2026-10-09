// "Only my voice" on the phone (the desktop's speaker-id.ts and the
// enrollment in call.ts): the person records a few seconds of speech once,
// during a call, and the call then accepts turns from that voice only.
//
// The desktop turns the recording into a 512-number voiceprint with a
// speaker embedding model (CAM++ in ONNX) and compares each turn's
// embedding to it. The phone has no ONNX runtime, so its print is the
// person's speaking level only (the desktop's far-field gate, `level`):
//
// - while "Only my voice" is on and a voice is enrolled, a frame quieter
//   than a share of that level never counts as speech (TurnDetector's
//   `nearLevel`), so a TV or a colleague across the room does not start a
//   turn;
// - a turn whose voiced frames are on average well under that level is
//   dropped as another voice (the "rejected" tone, as on the desktop);
// - accepted turns teach the level slowly (the desktop's learnLevel).
//
// Remaining gap: a second voice as close and as loud as the person's (someone
// leaning over the phone) passes; only the desktop's embedding tells two
// voices apart at the same level. The record keeps the desktop's shape and
// key (`omb.voiceCall.voiceprint.v1`) with an empty `vector`, so a model can
// be added later without a new enrollment format. It stays on this phone
// (UserDefaults), is never sent anywhere, and "Forget my voice" deletes it.
import Foundation

public struct CallVoiceprint: Codable, Equatable, Sendable {
    public var version: Int
    /// the speaker embedding (empty on the phone: no model, see above)
    public var vector: [Float]
    /// clips it was made from
    public var clips: Int
    /// the person's speaking level (median RMS of the voiced frames)
    public var level: Float
    public var createdAt: String

    public init(level: Float, clips: Int = 1, vector: [Float] = [], createdAt: Date = Date()) {
        version = 1
        self.vector = vector
        self.clips = clips
        self.level = level
        self.createdAt = ISO8601DateFormatter().string(from: createdAt)
    }

    public static let storageKey = "omb.voiceCall.voiceprint.v1"

    /// The stored print, or nil when there is none or it is not usable.
    public static func decode(_ raw: String?) -> CallVoiceprint? {
        guard let raw, let data = raw.data(using: .utf8),
              let print = try? JSONDecoder().decode(CallVoiceprint.self, from: data),
              print.version == 1, print.level.isFinite, print.level > 0 else { return nil }
        return print
    }

    public var encoded: String {
        let data = (try? JSONEncoder().encode(self)) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }

    public static func read(_ defaults: UserDefaults = .standard) -> CallVoiceprint? {
        decode(defaults.string(forKey: storageKey))
    }

    public func save(_ defaults: UserDefaults = .standard) {
        defaults.set(encoded, forKey: Self.storageKey)
    }

    public static func forget(_ defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: storageKey)
    }

    // MARK: The gate

    /// A frame must reach this share of the level to count as speech
    /// (TurnDetector's `nearShare`, the desktop's far-field gate).
    public static let frameShare: Float = 0.22
    /// A turn whose voiced frames average under this share of the level is
    /// another voice (about 9 dB under the person's usual level).
    public static let turnShare: Float = 0.35
    /// Below this much voiced speech a turn is too short to judge: accepted
    /// (the desktop's MIN_VERIFY_SECONDS).
    public static let minVerifySeconds: Double = 0.6

    /// Is a turn the enrolled person's? `level`: the mean RMS of its voiced
    /// frames; `seconds`: how much voiced speech it held.
    public func accepts(turnLevel level: Float, seconds: Double) -> Bool {
        if seconds < Self.minVerifySeconds || level <= 0 { return true }
        return level >= self.level * Self.turnShare
    }

    /// The level after one more accepted turn (slowly, 0.8 / 0.2).
    public static func learn(_ known: Float, from turnLevel: Float) -> Float {
        guard turnLevel > 0 else { return known }
        return known > 0 ? known * 0.8 + turnLevel * 0.2 : turnLevel
    }
}

/// Where "Only my voice" stands on this phone (the desktop's Enrollment).
public enum CallEnrollment: Equatable, Sendable {
    case none
    case recording(share: Double)
    case enrolled
    case failed
}

/// The frames an enrollment collects: voiced speech while the bot is
/// silent, until `seconds` of it (or the time runs out).
public struct CallEnrollmentRecorder: Sendable {
    public let seconds: Double
    public let until: TimeInterval
    public private(set) var levels: [Float] = []

    /// The desktop's: six seconds of speech within 25 seconds.
    public init(seconds: Double = 6, startedAt: TimeInterval, timeout: TimeInterval = 25) {
        self.seconds = seconds
        until = startedAt + timeout
    }

    /// A voiced frame counts (the desktop's probability over 0.6, bot silent).
    public mutating func push(level: Float, probability: Float, botAudible: Bool) {
        if probability > 0.6, !botAudible { levels.append(level) }
    }

    /// How much of the speech needed is in, 0...1.
    public var share: Double {
        min(1, Double(levels.count) * CallAudio.frameMs / (seconds * 1000))
    }

    /// Done: enough speech, or the time is up.
    public func done(now: TimeInterval) -> Bool { share >= 1 || now > until }

    /// The print, when at least 60 % of the speech was heard (the desktop's bar).
    public func voiceprint(at date: Date = Date()) -> CallVoiceprint? {
        guard share >= 0.6, !levels.isEmpty else { return nil }
        let sorted = levels.sorted()
        let median = sorted[sorted.count / 2]
        guard median > 0 else { return nil }
        return CallVoiceprint(level: median, clips: 3, createdAt: date)
    }
}
