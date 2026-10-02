// When the person starts and stops talking, from one voice probability per
// 32 ms frame and the frame's level. A port of the desktop's
// `src/lib/voice-mode/turns.ts` with the same thresholds:
//
// - Speech starts after `startMs` of voiced frames (hysteresis: a frame is
//   voiced above `positive`, unvoiced below `negative`).
// - While the bot is audible the bar is higher (`bargeIn*`), and the echo
//   guard (EchoGuard) says whether the microphone is louder than the bot's
//   own residue.
// - A turn ends after `endpointMs` of silence. The endpoint adapts to the
//   person: a pause that almost ended a turn, then went on, stretches it (up
//   to `maxEndpointMs`); turns that end cleanly shrink it back toward
//   `minEndpointMs`. Fast talkers get fast answers, slow talkers are not cut.
// - Too short to be a sentence (a cough, a click): `cancel`, never a turn.
// - A level gate keeps far-field sound out: a voiced frame must be over the
//   room's noise floor and, once known, over a share of the person's level.
import Foundation

public enum CallAudio {
    /// One frame: 512 samples at 16 kHz.
    public static let sampleRate: Double = 16_000
    public static let frameSamples = 512
    public static let frameMs: Double = 32

    public static func rms(_ frame: [Float]) -> Float {
        guard !frame.isEmpty else { return 0 }
        var sum: Float = 0
        for sample in frame { sum += sample * sample }
        return (sum / Float(frame.count)).squareRoot()
    }
}

public struct TurnOptions: Sendable {
    public var positive: Float = 0.5
    public var negative: Float = 0.35
    public var startMs: Double = 192
    /// while the bot is audible
    public var bargeInPositive: Float = 0.7
    public var bargeInStartMs: Double = 160
    public var minEndpointMs: Double = 480
    public var maxEndpointMs: Double = 900
    public var endpointMs: Double = 600
    /// shorter than this, a turn is a noise
    public var minTurnMs: Double = 250
    public var maxTurnMs: Double = 45_000
    /// the person's usual speaking level (RMS), when known
    public var nearLevel: Float?
    /// share of nearLevel a voiced frame needs (far-field rejection)
    public var nearShare: Float = 0.22

    public init() {}
}

public struct TurnFrame: Sendable {
    /// voice probability, 0...1
    public var probability: Float
    /// RMS of the frame, 0...1
    public var level: Float
    /// the bot's voice is playing now
    public var botAudible: Bool
    /// the echo guard says the microphone is only the bot's echo
    public var echo: Bool

    public init(probability: Float, level: Float, botAudible: Bool = false, echo: Bool = false) {
        self.probability = probability
        self.level = level
        self.botAudible = botAudible
        self.echo = echo
    }
}

public enum TurnEvent: Equatable, Sendable {
    /// voiced frames began: duck the bot, start streaming audio
    case candidate(bargeIn: Bool)
    /// it is speech: a turn has begun (confirm a barge-in)
    case start(bargeIn: Bool)
    /// the candidate died out before `start`, or the turn was too short
    case cancel
    /// the person stopped talking
    case end(speechMs: Double, endpointMs: Double)
}

public final class TurnDetector {
    private enum Stage { case idle, candidate, speaking }

    private var o: TurnOptions
    private var stage: Stage = .idle
    private var voicedMs: Double = 0
    private var silenceMs: Double = 0
    private var speechMs: Double = 0
    private var turnMs: Double = 0
    private var longestPauseMs: Double = 0
    private var bargeIn = false
    private var floor: Float = 0.002
    private var endpoint: Double

    public init(options: TurnOptions = TurnOptions()) {
        o = options
        endpoint = options.endpointMs
    }

    /// The current silence that ends a turn (adaptive).
    public var endpointMs: Double { endpoint }
    public var speaking: Bool { stage == .speaking }
    public var active: Bool { stage != .idle }

    /// The person's usual level, learned from accepted turns.
    public var nearLevel: Float? {
        get { o.nearLevel }
        set { o.nearLevel = (newValue ?? 0) > 0 ? newValue : nil }
    }

    /// Forget the current turn (mute, hold).
    public func reset() {
        stage = .idle
        voicedMs = 0
        silenceMs = 0
        speechMs = 0
        turnMs = 0
        longestPauseMs = 0
        bargeIn = false
    }

    private func voiced(_ frame: TurnFrame) -> Bool {
        let bar = frame.botAudible ? o.bargeInPositive : stage == .speaking ? o.negative : o.positive
        if frame.probability < bar { return false }
        if frame.botAudible && frame.echo { return false }
        // over the room, and (when known) close to the person's own level
        if frame.level < floor * 2 { return false }
        if let near = o.nearLevel, frame.level < near * o.nearShare { return false }
        return true
    }

    public func feed(_ frame: TurnFrame, frameMs: Double = CallAudio.frameMs) -> TurnEvent? {
        let isVoiced = voiced(frame)
        switch stage {
        case .idle:
            // follow the room while nobody speaks
            if frame.probability < o.negative { floor = floor * 0.97 + min(frame.level, 0.05) * 0.03 }
            guard isVoiced else { return nil }
            stage = .candidate
            voicedMs = frameMs
            silenceMs = 0
            bargeIn = frame.botAudible
            return .candidate(bargeIn: bargeIn)
        case .candidate:
            if isVoiced {
                voicedMs += frameMs
                silenceMs = 0
                let need = bargeIn ? o.bargeInStartMs : o.startMs
                if voicedMs >= need {
                    stage = .speaking
                    speechMs = voicedMs
                    turnMs = voicedMs
                    longestPauseMs = 0
                    return .start(bargeIn: bargeIn)
                }
                return nil
            }
            silenceMs += frameMs
            // a voiced run must be (almost) continuous to become speech
            if silenceMs >= 96 {
                reset()
                return .cancel
            }
            return nil
        case .speaking:
            turnMs += frameMs
            if isVoiced {
                if silenceMs > 0 { longestPauseMs = max(longestPauseMs, silenceMs) }
                silenceMs = 0
                speechMs += frameMs
            } else {
                silenceMs += frameMs
            }
            if silenceMs >= endpoint || turnMs >= o.maxTurnMs {
                let spoke = speechMs
                let usedEndpoint = endpoint
                let longest = longestPauseMs
                reset()
                if spoke < o.minTurnMs { return .cancel }
                adapt(longest)
                return .end(speechMs: spoke, endpointMs: usedEndpoint)
            }
            return nil
        }
    }

    /// A pause close to the endpoint inside a turn means this person thinks
    /// between phrases: give them more room. A turn without one: tighten.
    private func adapt(_ longestPause: Double) {
        if longestPause >= endpoint * 0.6 {
            endpoint = min(o.maxEndpointMs, max(endpoint, longestPause + 160))
        } else {
            endpoint = max(o.minEndpointMs, endpoint - 24)
        }
    }
}

/// Is the microphone hearing the person, or only the bot's own voice coming
/// back from the speaker? The phone's voice processing (AEC) removes most of
/// it; this guard handles the residue so the bot never interrupts itself.
/// A port of `src/lib/voice-mode/echo.ts`: it learns the echo path's
/// coupling (microphone level / playback level) while the bot speaks, and a
/// frame is echo when the microphone is not clearly louder (`marginDb`) than
/// the bot's recent voice times that coupling.
public final class EchoGuard {
    private let margin: Float
    private let playbackFloor: Float
    private let prior: Float
    private var recent: [Float] = []
    private var ratios: [Float] = []

    public init(marginDb: Float = 9, playbackFloor: Float = 0.004, coupling: Float = 0.1) {
        prior = coupling
        margin = Float(pow(10, Double(marginDb) / 20))
        self.playbackFloor = playbackFloor
    }

    /// The learned coupling.
    public var estimate: Float {
        guard ratios.count >= 8 else { return prior }
        let sorted = ratios.sorted()
        return sorted[sorted.count / 2]
    }

    /// Feed one frame; true when the microphone is only echo.
    public func update(micLevel: Float, playbackLevel: Float) -> Bool {
        recent.append(playbackLevel)
        if recent.count > 8 { recent.removeFirst() }
        // the loudest playback of the last ~250 ms bounds what can come back now
        let playback = recent.max() ?? 0
        if playback < playbackFloor { return false }
        let coupling = max(0.01, estimate)
        let echo = micLevel < playback * coupling * margin
        // learn from the bot's voiced frames; a barge-in counts only as
        // twice the estimate, so it cannot teach the guard
        if playbackLevel >= playback * 0.5 {
            ratios.append(min(micLevel / playback, coupling * 2))
            if ratios.count > 64 { ratios.removeFirst() }
        }
        return echo
    }

    public func reset() { recent = [] }
}

/// A voice probability from the frame's level over the room's noise floor:
/// the desktop's `LevelVad` (its fallback when the neural detector cannot
/// load). On the phone the hardware voice processing has already removed
/// the bot's echo and most of the room, which is what makes a level
/// detector enough here.
public final class LevelVad {
    private var floor: Float = 0.004

    public init() {}

    public func probability(_ frame: [Float]) -> Float {
        probability(level: CallAudio.rms(frame))
    }

    public func probability(level: Float) -> Float {
        let threshold = max(0.012, floor * 3)
        if level < threshold { floor = floor * 0.95 + level * 0.05 }
        return max(0, min(1, level / (threshold * 2)))
    }

    public func reset() { floor = 0.004 }
}
