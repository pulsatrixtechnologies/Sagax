// The live call's states, as on a phone: connecting, listening, the person
// talking (hearing), the bot thinking, the bot speaking, interrupted, on
// hold. A port of the desktop's `src/lib/voice-mode/call-machine.ts`, rule
// for rule: `step(state, event)` returns the next state and the effects to
// run (LiveCallEngine runs them), so the unit tests cover every transition,
// barge-in and cancellation included.
import Foundation

public enum CallPhase: String, Sendable, Equatable {
    case connecting, listening, hearing, thinking, speaking, interrupted, held, ended
}

public struct CallState: Equatable, Sendable {
    public var phase: CallPhase
    public var muted: Bool
    /// The bot's turn is still running on the server.
    public var botBusy: Bool
    /// The bot's voice is queued or audible.
    public var botAudible: Bool
    /// The person is talking over the bot and the bot is ducked.
    public var ducked: Bool

    public init(phase: CallPhase = .connecting, muted: Bool = false, botBusy: Bool = false, botAudible: Bool = false, ducked: Bool = false) {
        self.phase = phase
        self.muted = muted
        self.botBusy = botBusy
        self.botAudible = botAudible
        self.ducked = ducked
    }

    public static let initial = CallState()
}

public enum CallRejection: String, Sendable, Equatable {
    case empty, otherVoice = "other-voice", failed
}

public enum CallEarcon: String, Sendable, Equatable, CaseIterable {
    case connected, interrupted, rejected, hold, resume, ended

    /// The tones of each sound (desktop `EARCONS` in call.ts).
    public var notes: [(hz: Double, ms: Double)] {
        switch self {
        case .connected: [(660, 90), (880, 140)]
        case .interrupted: [(520, 60)]
        case .rejected: [(300, 80)]
        case .hold: [(440, 120), (440, 120)]
        case .resume: [(880, 100)]
        case .ended: [(880, 90), (660, 90), (440, 160)]
        }
    }
}

public enum CallEvent: Equatable, Sendable {
    case connected
    case failed
    /// voiced frames began (TurnDetector candidate)
    case speechCandidate
    /// it is speech (TurnDetector start)
    case speechStart
    /// the candidate was a noise
    case speechCancel
    /// the person stopped (TurnDetector end): transcribing
    case speechEnd
    /// the utterance's words, accepted
    case utterance(String)
    /// nothing usable
    case utteranceRejected(CallRejection)
    case botBusy(Bool)
    case botAudioStart
    /// every queued sentence has been heard
    case botAudioEnd
    case mute(Bool)
    case hold
    case resume
    /// the person pressed interrupt
    case interrupt
    case end
}

public enum CallEffect: Equatable, Sendable {
    case duck
    case unduck
    /// fade the bot's voice out and drop every queued sentence
    case cancelSpeech
    /// stop the bot's running turn on the server
    case interruptBot
    case send(String)
    case finalizeSTT
    case cancelSTT
    case earcon(CallEarcon)
    case mic(open: Bool)
    case release
}

public enum CallMachine {
    /// The phase to rest in when nobody is talking.
    static func idle(_ state: CallState) -> CallPhase {
        if state.botAudible { return .speaking }
        if state.botBusy { return .thinking }
        return .listening
    }

    public static func step(_ state: CallState, _ event: CallEvent) -> (state: CallState, effects: [CallEffect]) {
        var effects: [CallEffect] = []
        func next(_ patch: (inout CallState) -> Void) -> (state: CallState, effects: [CallEffect]) {
            var copy = state
            patch(&copy)
            return (copy, effects)
        }
        let same = (state: state, effects: [CallEffect]())
        if state.phase == .ended { return same }

        switch event {
        case .connected:
            guard state.phase == .connecting else { return same }
            effects.append(.earcon(.connected))
            return next { $0.phase = idle(state) }
        case .failed:
            return next { $0.phase = .listening }
        case .end:
            effects += [.cancelSpeech, .cancelSTT, .earcon(.ended), .release]
            return next { $0.phase = .ended; $0.botAudible = false; $0.ducked = false }
        case .hold:
            guard state.phase != .held else { return same }
            // a hold is silence both ways: nothing heard, nothing said
            effects += [.cancelSpeech, .cancelSTT, .mic(open: false), .earcon(.hold)]
            return next { $0.phase = .held; $0.botAudible = false; $0.ducked = false }
        case .resume:
            guard state.phase == .held else { return same }
            effects.append(.earcon(.resume))
            if !state.muted { effects.append(.mic(open: true)) }
            var quiet = state
            quiet.botAudible = false
            return next { $0.phase = idle(quiet) }
        case let .mute(muted):
            guard state.muted != muted else { return same }
            if state.phase == .held { return next { $0.muted = muted } }
            if muted {
                effects += [.cancelSTT, .mic(open: false)]
                if state.ducked { effects.append(.unduck) }
                return next {
                    $0.muted = true
                    $0.ducked = false
                    $0.phase = state.phase == .hearing ? idle(state) : state.phase
                }
            }
            effects.append(.mic(open: true))
            return next { $0.muted = false }
        case .speechCandidate:
            if state.muted || state.phase == .held || state.phase == .connecting { return same }
            // the person may be talking over the bot: lower it at once
            if state.botAudible && !state.ducked {
                effects.append(.duck)
                return next { $0.ducked = true }
            }
            return same
        case .speechCancel:
            if state.ducked { effects.append(.unduck) }
            effects.append(.cancelSTT)
            return next {
                $0.ducked = false
                $0.phase = state.phase == .hearing || state.phase == .interrupted ? idle(state) : state.phase
            }
        case .speechStart:
            if state.muted || state.phase == .held || state.phase == .connecting { return same }
            if state.botAudible {
                // barge-in: the bot stops talking, what it had left to say is dropped
                effects += [.cancelSpeech, .earcon(.interrupted)]
                if state.botBusy { effects.append(.interruptBot) }
                return next { $0.phase = .interrupted; $0.botAudible = false; $0.ducked = false }
            }
            if state.botBusy {
                // talking while the bot works: the new words replace its running turn
                effects.append(.interruptBot)
                return next { $0.phase = .interrupted }
            }
            return next { $0.phase = .hearing }
        case .speechEnd:
            guard state.phase == .hearing || state.phase == .interrupted else { return same }
            effects.append(.finalizeSTT)
            return next { $0.phase = .thinking }
        case let .utterance(text):
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { return step(state, .utteranceRejected(.empty)) }
            effects.append(.send(trimmed))
            return next { $0.phase = .thinking; $0.botBusy = true }
        case let .utteranceRejected(reason):
            if reason == .otherVoice { effects.append(.earcon(.rejected)) }
            if state.ducked { effects.append(.unduck) }
            return next {
                $0.ducked = false
                $0.phase = state.phase == .held ? .held : idle(state)
            }
        case let .botBusy(busy):
            var patched = state
            patched.botBusy = busy
            if [.thinking, .listening, .speaking].contains(state.phase) {
                return next { $0.botBusy = busy; $0.phase = idle(patched) }
            }
            return next { $0.botBusy = busy }
        case .botAudioStart:
            if state.phase == .held { return same }
            if state.phase == .hearing || state.phase == .interrupted { return next { $0.botAudible = true } }
            return next { $0.botAudible = true; $0.phase = .speaking }
        case .botAudioEnd:
            var patched = state
            patched.botAudible = false
            patched.ducked = false
            if state.phase == .speaking {
                return next { $0.botAudible = false; $0.ducked = false; $0.phase = idle(patched) }
            }
            return next { $0.botAudible = false; $0.ducked = false }
        case .interrupt:
            guard state.botAudible else { return same }
            effects.append(.cancelSpeech)
            return next {
                $0.botAudible = false
                $0.ducked = false
                $0.phase = state.botBusy ? .thinking : .listening
            }
        }
    }
}
