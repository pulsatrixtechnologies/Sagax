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
}

@MainActor
public final class LiveCallEngine {
    public struct Events {
        public var state: (CallState) -> Void = { _ in }
        /// An accepted turn: send it to the bot. `interrupted`: the person
        /// cut the bot since the last turn sent (Message.voiceCall).
        public var utterance: (_ text: String, _ interrupted: Bool) -> Void = { _, _ in }
        /// Stop the bot's running turn on the server.
        public var interruptBot: () -> Void = {}
        /// The bot's speech was cut (barge-in, interrupt, hold, end).
        public var speechCancelled: () -> Void = {}
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
    private static let prerollFrames = 10 // 320 ms before the first voiced frame

    public init(transcriber: CallTranscribing, player: CallSpeaking, settings: @escaping () -> CallSettings) {
        self.transcriber = transcriber
        self.player = player
        self.settings = settings
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
        for sentence in stream.feed(SpokenText.spokenPart(text)) { enqueue(sentence) }
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
            dispatch(.speechEnd)
        }
    }

    // MARK: - The microphone

    /// One 32 ms frame of 16 kHz audio.
    public func frame(_ frame: [Float]) {
        guard !closed, !state.muted, state.phase != .held else { return }
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
            dispatch(.speechEnd)
        }
    }

    private func keepPreroll(_ frame: [Float]) {
        preroll.append(frame)
        if preroll.count > Self.prerollFrames { preroll.removeFirst() }
    }

    // MARK: - The state machine's effects

    private func dispatch(_ event: CallEvent) {
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
            player.cancel()
            reply = nil
            resolveWaiters(false)
            events.speechCancelled()
        case .interruptBot:
            events.interruptBot()
        case let .send(text):
            let interrupted = cutBot
            cutBot = false
            events.utterance(text, interrupted)
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
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            events.rejected(.empty)
            dispatch(.utteranceRejected(.empty))
            return
        }
        dispatch(.utterance(text))
    }
}
