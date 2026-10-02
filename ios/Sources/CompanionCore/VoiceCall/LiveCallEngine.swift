// A live voice call with a bot, like a phone call: the microphone stays open
// for the whole call (full duplex), the person can talk over the bot and it
// stops at once (barge-in), turns end on a short silence that adapts to the
// person, and the bot's own echo does not count as speech. A port of the
// desktop's `src/lib/voice-mode/call.ts`, without its devices: the app gives
// it 32 ms frames of 16 kHz audio (the phone's voice-processed microphone,
// or a recording in tests), a transcriber and a player, and runs what it
// decides. CallMachine holds the states; this file runs the effects.
//
//   microphone -> level VAD + echo guard -> TurnDetector
//     -> while a turn is spoken: frames to the transcriber; finalize at its end
//     -> the words go to the BOT as an ordinary message (onUtterance)
//   the bot's answer, sentence by sentence as it is written
//     -> the player (the voice the desktop would use), next sentence
//        fetched while this one plays
import Foundation

/// The person's words, from frames of one turn.
@MainActor
public protocol CallTranscribing: AnyObject {
    /// A turn may be starting: what was heard just before it too.
    func begin(preroll: [[Float]])
    func push(_ frame: [Float])
    /// The turn ended: its words ("" when none).
    func finish() async -> String
    /// The candidate was a noise, or the turn is dropped.
    func discard()
    func close()
}

/// What the person heard of the answer that was playing when it was cut
/// (the desktop's PlaybackCut, player.ts): whole sentences, then the start of
/// the one cut at a word; the rest is unheard.
public struct PlaybackCut: Equatable, Sendable {
    public var heard: String
    public var unheard: String

    public init(heard: String = "", unheard: String = "") {
        self.heard = heard
        self.unheard = unheard
    }

    /// About how fast the voice speaks at 1x (characters per second), to
    /// place the cut inside a sentence whose audio is still arriving.
    public static let spokenCharsPerSecond = 14.0

    /// The first `share` of a sentence, cut at a word boundary.
    public static func split(_ text: String, at share: Double) -> (String, String) {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        if share <= 0 { return ("", trimmed) }
        if share >= 1 { return (trimmed, "") }
        let chars = Array(text)
        let target = Int((Double(chars.count) * share).rounded())
        var cut = -1
        var i = min(target, chars.count - 1)
        while i > 0 { if chars[i] == " " { cut = i; break }; i -= 1 }
        if cut <= 0, let after = chars.indices.first(where: { $0 >= target && chars[$0] == " " }) { cut = after }
        if cut <= 0 { return share >= 0.5 ? (trimmed, "") : ("", trimmed) }
        return (String(chars[..<cut]).trimmingCharacters(in: .whitespaces), String(chars[cut...]).trimmingCharacters(in: .whitespaces))
    }

    /// What was heard of a ledger of sentences, by where the audio is now.
    /// Each entry: its text, when its first sample plays and its last ends
    /// (seconds on the player's clock, nil before scheduled), and whether
    /// all its audio has arrived.
    public static func measure(_ ledger: [(text: String, start: Double?, end: Double?, complete: Bool)], now: Double, speed: Double = 1) -> PlaybackCut {
        var heard: [String] = []
        var unheard: [String] = []
        for entry in ledger {
            guard let start = entry.start, start <= now else {
                unheard.append(entry.text)
                continue
            }
            let played = now - start
            let known = (entry.end ?? start) - start
            let estimate = Double(entry.text.count) / (spokenCharsPerSecond * max(0.5, speed))
            let length = entry.complete ? known : max(known, estimate)
            if length <= 0 || played >= length {
                heard.append(entry.text)
                continue
            }
            let (said, rest) = split(entry.text, at: played / length)
            if !said.isEmpty { heard.append(said) }
            if !rest.isEmpty { unheard.append(rest) }
        }
        return PlaybackCut(heard: heard.joined(separator: " ").trimmingCharacters(in: .whitespaces), unheard: unheard.joined(separator: " ").trimmingCharacters(in: .whitespaces))
    }
}

/// A turn said on the call, ready to send.
public struct CallTurn: Equatable, Sendable {
    public var text: String
    /// the person cut the bot since the last turn sent
    public var interrupted: Bool
    /// what they heard of the answer they cut
    public var cut: PlaybackCut?
    /// it completes the fragment sent just before (cut by a pause)
    public var continues: Bool
}

/// Words that are a sound, not speech (call.ts isNoiseFragment): a single
/// short token no one says alone on a call ("dwad", "hm"), or anything under
/// two letters. Real one-word answers ("yes", "oui", "merci") pass.
public enum CallNoise {
    private static let shortWords: Set<String> = [
        "yes", "yeah", "yep", "no", "nope", "ok", "okay", "stop", "wait", "hi", "hey", "bye", "thanks", "sure", "go", "next",
        "why", "how", "what", "who", "when", "where", "right", "cool", "nice", "great",
        "oui", "non", "ouais", "nan", "merci", "salut", "allo", "bonjour", "attends", "arrete", "vas", "quoi", "comment",
        "pourquoi", "parfait", "super", "bien", "daccord",
    ]

    public static func isFragment(_ text: String, confidence: Double? = nil) -> Bool {
        let words = ClauseCheck.words(text.replacingOccurrences(of: "'", with: "").replacingOccurrences(of: "\u{2019}", with: ""))
        if words.joined().count < 2 { return true }
        if words.count <= 2, let confidence, confidence < 0.45 { return true }
        guard words.count == 1, let word = words.first else { return false }
        if word.allSatisfy(\.isNumber) || shortWords.contains(word) { return false }
        return word.count <= 5
    }
}

/// The bot's voice: sentences queued, played back to back.
@MainActor
public protocol CallSpeaking: AnyObject {
    /// Something is queued or audible.
    var busy: Bool { get }
    /// RMS of what is playing now, 0...1.
    func level() -> Float
    func enqueue(_ sentence: String)
    /// Lower the bot at once (the person may be talking).
    func duck()
    func unduck()
    /// Fade out and drop every queued sentence.
    func cancel()
    func tone(_ earcon: CallEarcon)
    func close()
    /// What has been heard of the current answer, by the audio clock.
    func playback(speed: Double) -> PlaybackCut
    /// A new answer begins: forget what the last one played.
    func resetLedger()
}

@MainActor
public final class LiveCallEngine {
    public struct Events {
        public var state: (CallState) -> Void = { _ in }
        /// An accepted turn: send it to the bot. `interrupted`: the person
        /// cut the bot since the last turn sent (Message.voiceCall).
        public var utterance: (CallTurn) -> Void = { _ in }
        /// Stop the bot's running turn on the server.
        public var interruptBot: () -> Void = {}
        /// The bot's speech was cut (barge-in, interrupt, hold, end), with
        /// what the person heard of it and what they did not.
        public var speechCancelled: (PlaybackCut) -> Void = { _ in }
        public var rejected: (CallRejection) -> Void = { _ in }
        /// The sentence now audible.
        public var caption: (String) -> Void = { _ in }
        /// Open or close the microphone (mute, hold).
        public var microphone: (Bool) -> Void = { _ in }
        public init() {}
    }

    public var events = Events()
    public private(set) var state = CallState.initial
    private let transcriber: CallTranscribing
    private let player: CallSpeaking
    private let settings: () -> CallSettings
    private let speed: () -> Double
    private let now: () -> TimeInterval
    private let turns = TurnDetector()
    private let guardEcho = EchoGuard()
    private let vad = LevelVad()
    private var preroll: [[Float]] = []
    private var closed = false
    private var pushing = false
    private var reply: SentenceStream?
    private var speechWaiters: [CheckedContinuation<Bool, Never>] = []
    /// the person cut the bot since the last turn sent
    private var cutBot = false
    /// what they heard of the answer they cut (told to the bot)
    private var lastCut: PlaybackCut?
    /// the answer's text so far, as last handed to replyProgress
    private var replyText = ""
    /// the last utterance sent, and whether the bot has spoken since
    private var lastSent: (text: String, endedAt: TimeInterval, botSpoke: Bool)?
    /// the turn being heard continues the last one (it was cut by a pause)
    private var continuing = false
    /// when the current turn ended (the person's last silence began)
    private var turnEndedAt: TimeInterval = 0
    /// A turn that starts this soon after the last one ended, before the
    /// bot said anything, continues it: one utterance cut by a pause.
    public static let continuationSeconds: TimeInterval = 1.5
    private static let prerollFrames = 10 // 320 ms before the first voiced frame

    public init(
        transcriber: CallTranscribing,
        player: CallSpeaking,
        settings: @escaping () -> CallSettings,
        speed: @escaping () -> Double = { 1 },
        now: @escaping () -> TimeInterval = { Date().timeIntervalSinceReferenceDate }
    ) {
        self.transcriber = transcriber
        self.player = player
        self.settings = settings
        self.speed = speed
        self.now = now
    }

    /// The words recognized so far in the person's turn: an unfinished
    /// clause waits longer before the turn ends.
    public func partial(_ text: String) {
        if turns.active { turns.hint(text) }
    }

    /// The current adaptive endpoint (diagnostics).
    public var endpointMs: Double { turns.endpointMs }

    // MARK: - Lifecycle

    /// The devices are open: the call is live.
    public func connected() { dispatch(.connected) }
    /// The microphone could not open.
    public func failed() { dispatch(.failed) }
    public func end() { dispatch(.end) }
    public func setMuted(_ muted: Bool) { dispatch(.mute(muted)) }
    public func hold() { dispatch(.hold) }
    public func resume() { dispatch(.resume) }
    /// The interrupt button: the bot stops talking.
    public func interrupt() { dispatch(.interrupt) }

    /// The bot's turn started or ended on the server.
    public func setBotBusy(_ busy: Bool) {
        if state.botBusy != busy { dispatch(.botBusy(busy)) }
    }

    // MARK: - Speaking

    /// Say a whole text (a prompt, a narration chip). True once heard, false when cut.
    @discardableResult
    public func say(_ text: String) async -> Bool {
        if state.phase == .held || state.phase == .ended { return false }
        let sentences = SentenceStream().finish(text)
        for sentence in sentences { enqueue(sentence) }
        if sentences.isEmpty { return true }
        return await withCheckedContinuation { speechWaiters.append($0) }
    }

    /// The bot's answer while it is written: the whole text so far.
    public func replyProgress(_ text: String) {
        if state.phase == .held || state.phase == .ended { return }
        let stream = reply ?? SentenceStream()
        reply = stream
        replyText = SpokenText.spokenPart(text)
        for sentence in stream.feed(replyText) { enqueue(sentence) }
    }

    /// The answer (or this block of it) is complete.
    @discardableResult
    public func replyDone(_ text: String) async -> Bool {
        let stream = reply ?? SentenceStream()
        reply = nil
        for sentence in stream.finish(SpokenText.spokenPart(text)) { enqueue(sentence) }
        if !player.busy { return true }
        return await withCheckedContinuation { speechWaiters.append($0) }
    }

    /// Queue a whole text at once, without waiting for it to be heard (a
    /// room's member, whose speaker is set just before).
    public func speakNow(_ text: String) {
        if state.phase == .held || state.phase == .ended { return }
        for sentence in SentenceStream().finish(text) { enqueue(sentence) }
    }

    /// The answer is complete: queue what the stream had not reached, now.
    public func replyDoneNow(_ text: String) {
        let stream = reply ?? SentenceStream()
        reply = nil
        for sentence in stream.finish(SpokenText.spokenPart(text)) { enqueue(sentence) }
    }

    private func enqueue(_ text: String) {
        if state.phase == .held || state.phase == .ended { return }
        player.enqueue(text)
    }

    /// The player's first sample of a sentence is audible now.
    public func playerSentenceStarted(_ text: String) {
        guard !closed else { return }
        events.caption(text)
        if !state.botAudible { dispatch(.botAudioStart) }
    }

    /// Everything queued has been heard.
    public func playerIdle() {
        if state.botAudible { dispatch(.botAudioEnd) }
        resolveWaiters(true)
    }

    private func resolveWaiters(_ heard: Bool) {
        let waiters = speechWaiters
        speechWaiters = []
        for waiter in waiters { waiter.resume(returning: heard) }
    }

    // MARK: - Push to talk

    public func pushToTalk(_ down: Bool) {
        guard settings().input == .push, !state.muted, state.phase != .held else { return }
        if down && !pushing {
            pushing = true
            transcriber.begin(preroll: Array(preroll.suffix(3)))
            dispatch(.speechCandidate)
            dispatch(.speechStart)
        } else if !down && pushing {
            pushing = false
            turnEndedAt = now()
            dispatch(.speechEnd)
        }
    }

    // MARK: - The microphone

    /// One 32 ms frame of 16 kHz audio.
    public func frame(_ frame: [Float]) {
        guard !closed, !state.muted, state.phase != .held else { return }
        turns.setPause(settings().pause)
        let level = CallAudio.rms(frame)
        let probability = vad.probability(level: level)
        let playback = player.level()
        let echo = guardEcho.update(micLevel: level, playbackLevel: playback)
        let botAudible = state.botAudible || playback > 0.004

        if settings().input == .push {
            if pushing { transcriber.push(frame) }
            keepPreroll(frame)
            return
        }

        guard let event = turns.feed(TurnFrame(probability: probability, level: level, botAudible: botAudible, echo: echo)) else {
            if turns.active { transcriber.push(frame) } else { keepPreroll(frame) }
            return
        }
        switch event {
        case .candidate:
            keepPreroll(frame)
            transcriber.begin(preroll: preroll)
            preroll = []
            dispatch(.speechCandidate)
        case .start:
            transcriber.push(frame)
            dispatch(.speechStart)
        case .cancel:
            dispatch(.speechCancel)
        case .end:
            turnEndedAt = now()
            dispatch(.speechEnd)
        }
    }

    private func keepPreroll(_ frame: [Float]) {
        preroll.append(frame)
        if preroll.count > Self.prerollFrames { preroll.removeFirst() }
    }

    // MARK: - The state machine's effects

    private func dispatch(_ event: CallEvent) {
        // A turn that starts right after the last one, before the bot said a
        // word, is the same utterance cut by a pause: it is sent whole, and
        // the turn the fragment started is stopped.
        if event == .speechStart, !state.botAudible, let sent = lastSent, !sent.botSpoke,
           now() - sent.endedAt <= Self.continuationSeconds {
            continuing = true
            if state.botBusy { events.interruptBot() }
        }
        if event == .botAudioStart { lastSent?.botSpoke = true }
        let (next, effects) = CallMachine.step(state, event)
        let changed = next != state
        state = next
        // the person cut the bot: the next turn they send says so
        if (event == .speechStart && next.phase == .interrupted) || (event == .interrupt && effects.contains(.cancelSpeech)) {
            cutBot = true
        }
        for effect in effects { run(effect) }
        if changed { events.state(next) }
    }

    private func run(_ effect: CallEffect) {
        switch effect {
        case .duck:
            player.duck()
        case .unduck:
            player.unduck()
        case .cancelSpeech:
            // what played by the audio clock, plus what the bot had written
            // but not yet handed to the voice: the person heard none of that
            let played = player.playback(speed: speed())
            var unwritten = ""
            if let reply {
                let chars = Array(replyText)
                if reply.position < chars.count { unwritten = String(chars[reply.position...]).trimmingCharacters(in: .whitespacesAndNewlines) }
            }
            let cut = PlaybackCut(heard: played.heard, unheard: [played.unheard, unwritten].filter { !$0.isEmpty }.joined(separator: " "))
            if !cut.heard.isEmpty || !cut.unheard.isEmpty { lastCut = cut }
            player.resetLedger()
            player.cancel()
            reply = nil
            replyText = ""
            resolveWaiters(false)
            events.speechCancelled(cut)
        case .interruptBot:
            events.interruptBot()
        case let .send(said):
            let continues = continuing && lastSent != nil
            let text = continues ? "\(lastSent!.text) \(said)" : said
            continuing = false
            lastSent = (text, turnEndedAt == 0 ? now() : turnEndedAt, false)
            let turn = CallTurn(text: text, interrupted: cutBot, cut: cutBot ? lastCut : nil, continues: continues)
            cutBot = false
            lastCut = nil
            // a new answer starts: what it plays is measured from here
            player.resetLedger()
            events.utterance(turn)
        case .finalizeSTT:
            Task { await self.finishTurn() }
        case .cancelSTT:
            transcriber.discard()
            turns.reset()
            pushing = false
        case let .earcon(sound):
            if settings().earcons { player.tone(sound) }
        case let .mic(open):
            events.microphone(open)
            turns.reset()
            preroll = []
        case .release:
            release()
        }
    }

    private func release() {
        closed = true
        transcriber.close()
        resolveWaiters(false)
        let player = self.player
        // let the end earcon play before the voice closes
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 400_000_000)
            player.close()
        }
    }

    private func finishTurn() async {
        let text = await transcriber.finish()
        guard !closed else { return }
        // nothing, or a sound the recognizer spelled ("dwad"): never a turn
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || CallNoise.isFragment(text) {
            continuing = false
            events.rejected(.empty)
            dispatch(.utteranceRejected(.empty))
            return
        }
        dispatch(.utterance(text))
    }
}
