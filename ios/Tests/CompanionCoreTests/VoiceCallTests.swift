// The live call's pure logic, ported from the desktop's voice mode
// (src/lib/voice-mode/*.test.ts): the state machine, turn endpointing,
// the echo guard, sentence chunking while an answer streams, barge-in,
// turn-taking with the conversation, and rooms.
import XCTest
@testable import CompanionCore

// MARK: - State machine

final class CallMachineTests: XCTestCase {
    private func run(_ events: [CallEvent], from state: CallState = .initial) -> (CallState, [CallEffect]) {
        var state = state
        var effects: [CallEffect] = []
        for event in events {
            let step = CallMachine.step(state, event)
            state = step.state
            effects += step.effects
        }
        return (state, effects)
    }

    func testConnectingThenListeningWithTheConnectedTone() {
        let (state, effects) = run([.connected])
        XCTAssertEqual(state.phase, .listening)
        XCTAssertEqual(effects, [.earcon(.connected)])
    }

    func testATurnIsHeardTranscribedAndSent() {
        let (state, effects) = run([.connected, .speechCandidate, .speechStart, .speechEnd, .utterance("  Bonjour  ")])
        XCTAssertEqual(state.phase, .thinking)
        XCTAssertTrue(state.botBusy)
        XCTAssertTrue(effects.contains(.finalizeSTT))
        XCTAssertEqual(effects.last, .send("Bonjour"))
    }

    func testAnEmptyTurnGoesBackToListening() {
        let (state, effects) = run([.connected, .speechStart, .speechEnd, .utterance("   ")])
        XCTAssertEqual(state.phase, .listening)
        XCTAssertFalse(effects.contains { if case .send = $0 { return true } else { return false } })
    }

    func testBargeInDucksAtOnceThenCutsTheBotAndItsRunningTurn() {
        var (state, _) = run([.connected, .botBusy(true), .botAudioStart])
        XCTAssertEqual(state.phase, .speaking)
        var step = CallMachine.step(state, .speechCandidate)
        XCTAssertEqual(step.effects, [.duck])
        XCTAssertTrue(step.state.ducked)
        state = step.state
        step = CallMachine.step(state, .speechStart)
        XCTAssertEqual(step.effects, [.cancelSpeech, .earcon(.interrupted), .interruptBot])
        XCTAssertEqual(step.state.phase, .interrupted)
        XCTAssertFalse(step.state.botAudible)
    }

    func testANoiseOverTheBotUnducksIt() {
        let (state, effects) = run([.connected, .botAudioStart, .speechCandidate, .speechCancel])
        XCTAssertEqual(state.phase, .speaking)
        XCTAssertFalse(state.ducked)
        XCTAssertTrue(effects.contains(.unduck))
    }

    func testTalkingWhileTheBotWorksJoinsItsTurnInsteadOfStoppingIt() {
        let step = CallMachine.step(CallMachine.step(.initial, .connected).state, .botBusy(true))
        XCTAssertEqual(step.state.phase, .thinking)
        let talk = CallMachine.step(step.state, .speechStart)
        XCTAssertEqual(talk.effects, [], "the words will join the running turn (a steer), never stop it")
        XCTAssertEqual(talk.state.phase, .hearing)
    }

    func testTheInterruptButtonStopsTheVoiceButNotTheTurn() {
        let (state, effects) = run([.connected, .botBusy(true), .botAudioStart, .interrupt])
        XCTAssertEqual(state.phase, .thinking)
        XCTAssertEqual(effects.last, .cancelSpeech)
        XCTAssertFalse(effects.contains(.interruptBot))
    }

    func testMuteClosesTheMicAndDropsTheTurnBeingHeard() {
        let (state, effects) = run([.connected, .speechStart, .mute(true)])
        XCTAssertTrue(state.muted)
        XCTAssertEqual(state.phase, .listening)
        XCTAssertTrue(effects.contains(.mic(open: false)))
        XCTAssertTrue(effects.contains(.cancelSTT))
        let unmuted = CallMachine.step(state, .mute(false))
        XCTAssertEqual(unmuted.effects, [.mic(open: true)])
        // muted: speech is ignored
        XCTAssertEqual(CallMachine.step(state, .speechStart).state, state)
    }

    func testHoldIsSilenceBothWaysAndResumeReopens() {
        let (held, effects) = run([.connected, .botAudioStart, .hold])
        XCTAssertEqual(held.phase, .held)
        XCTAssertEqual(effects.suffix(4), [.cancelSpeech, .cancelSTT, .mic(open: false), .earcon(.hold)])
        XCTAssertEqual(CallMachine.step(held, .botAudioStart).state, held, "nothing is said on hold")
        let resumed = CallMachine.step(held, .resume)
        XCTAssertEqual(resumed.state.phase, .listening)
        XCTAssertEqual(resumed.effects, [.earcon(.resume), .mic(open: true)])
    }

    func testEndReleasesEverythingAndNothingFollows() {
        let (ended, effects) = run([.connected, .end])
        XCTAssertEqual(ended.phase, .ended)
        XCTAssertEqual(effects.suffix(4), [.cancelSpeech, .cancelSTT, .earcon(.ended), .release])
        XCTAssertEqual(CallMachine.step(ended, .speechStart).effects, [])
    }

    func testTheBotFinishingSpeakingRestsOnListeningOrThinking() {
        var (state, _) = run([.connected, .botAudioStart, .botAudioEnd])
        XCTAssertEqual(state.phase, .listening)
        (state, _) = run([.connected, .botBusy(true), .botAudioStart, .botAudioEnd])
        XCTAssertEqual(state.phase, .thinking)
    }
}

// MARK: - Endpointing

final class TurnDetectorTests: XCTestCase {
    private let voiced = TurnFrame(probability: 0.9, level: 0.1)
    private let silent = TurnFrame(probability: 0.05, level: 0.001)

    private func feed(_ detector: TurnDetector, _ frame: TurnFrame, _ count: Int) -> [TurnEvent] {
        (0..<count).compactMap { _ in detector.feed(frame) }
    }

    func testSpeechStartsAfter192MsAndEndsAfter600MsOfSilence() {
        let detector = TurnDetector()
        let start = feed(detector, voiced, 6)
        XCTAssertEqual(start, [.candidate(bargeIn: false), .start(bargeIn: false)])
        XCTAssertEqual(feed(detector, voiced, 10), [])
        // 18 silent frames = 576 ms: not yet
        XCTAssertEqual(feed(detector, silent, 18), [])
        let end = feed(detector, silent, 1)
        guard case let .end(speechMs, endpointMs) = end.first else { return XCTFail("no end: \(end)") }
        XCTAssertEqual(speechMs, 16 * 32)
        XCTAssertEqual(endpointMs, 600)
    }

    func testAClickIsNeverATurn() {
        let detector = TurnDetector()
        XCTAssertEqual(feed(detector, voiced, 2), [.candidate(bargeIn: false)])
        XCTAssertEqual(feed(detector, silent, 3), [.cancel])
        XCTAssertFalse(detector.active)
    }

    func testTooShortASpeechIsCancelledAtItsEnd() {
        let detector = TurnDetector()
        _ = feed(detector, voiced, 7) // 224 ms < 250 ms
        XCTAssertEqual(feed(detector, silent, 19).last, .cancel)
    }

    func testOverTheBotTheBarIsHigherAndEchoNeverCounts() {
        let detector = TurnDetector()
        // 0.6 is speech when the bot is quiet, not over it
        XCTAssertNil(detector.feed(TurnFrame(probability: 0.6, level: 0.1, botAudible: true)))
        // echo is never speech
        XCTAssertNil(detector.feed(TurnFrame(probability: 0.95, level: 0.1, botAudible: true, echo: true)))
        let loud = TurnFrame(probability: 0.95, level: 0.2, botAudible: true)
        let events = feed(detector, loud, 5)
        XCTAssertEqual(events, [.candidate(bargeIn: true), .start(bargeIn: true)], "a barge-in confirms after 160 ms")
    }

    func testTheEndpointStretchesForSomeoneWhoPausesAndTightensAgain() {
        let detector = TurnDetector()
        _ = feed(detector, voiced, 10)
        _ = feed(detector, silent, 15) // a 480 ms pause inside the turn
        _ = feed(detector, voiced, 10)
        _ = feed(detector, silent, 19)
        XCTAssertEqual(detector.endpointMs, 480 + 160)
        _ = feed(detector, voiced, 10)
        _ = feed(detector, silent, 21)
        XCTAssertEqual(detector.endpointMs, 640 - 24)
    }

    func testTheEchoGuardLearnsTheResidueAndLetsTheLouderPersonThrough() {
        let guardEcho = EchoGuard()
        for _ in 0..<40 { XCTAssertTrue(guardEcho.update(micLevel: 0.02, playbackLevel: 0.3)) }
        XCTAssertEqual(guardEcho.estimate, 0.02 / 0.3, accuracy: 0.01)
        XCTAssertFalse(guardEcho.update(micLevel: 0.3, playbackLevel: 0.3), "the person is far louder than the echo")
        XCTAssertFalse(EchoGuard().update(micLevel: 0.001, playbackLevel: 0), "nothing playing: nothing to guard")
    }

    func testTheLevelDetectorFollowsTheRoom() {
        let vad = LevelVad()
        for _ in 0..<50 { _ = vad.probability(level: 0.003) }
        XCTAssertLessThan(vad.probability(level: 0.003), 0.35)
        XCTAssertGreaterThan(vad.probability(level: 0.05), 0.7)
    }
}

// MARK: - Sentences

final class SentenceStreamTests: XCTestCase {
    func testSentencesComeOutWhileTheAnswerIsWritten() {
        let stream = SentenceStream()
        XCTAssertEqual(stream.feed("Bonjour JC. Je regarde"), ["Bonjour JC."])
        XCTAssertEqual(stream.feed("Bonjour JC. Je regarde ton agenda"), [])
        XCTAssertEqual(stream.feed("Bonjour JC. Je regarde ton agenda pour demain matin. "), ["Je regarde ton agenda pour demain matin."])
        XCTAssertEqual(stream.finish("Bonjour JC. Je regarde ton agenda pour demain matin. Rien de prévu."), ["Rien de prévu."])
    }

    func testDecimalsAbbreviationsAndInitialsAreNotBoundaries() {
        let stream = SentenceStream()
        XCTAssertEqual(stream.finish("It costs 3.5 dollars, e.g. a coffee with M. Tremblay and J. Smith today."), [
            "It costs 3.5 dollars, e.g. a coffee with M. Tremblay and J. Smith today.",
        ])
    }

    func testShortLaterSentencesAreJoined() {
        let stream = SentenceStream()
        XCTAssertEqual(stream.finish("First a full sentence here. Yes. No. Maybe so then."), [
            "First a full sentence here.", "Yes. No. Maybe so then.",
        ])
    }

    func testALongFirstSentenceIsCutAtACommaToStartSooner() {
        let long = String(repeating: "word ", count: 20) + "and more, then the rest of it"
        let stream = SentenceStream()
        let out = stream.feed(long + " goes on")
        XCTAssertEqual(out.count, 1)
        XCTAssertTrue(out[0].hasSuffix("and more,"))
    }

    func testCodeIsSkippedAndMarkdownIsNotRead() {
        let stream = SentenceStream()
        let text = "Here is **the** fix:\n\n```swift\nlet x = 1\n```\n\n- See [the docs](https://example.com) 🎉\n- Done"
        XCTAssertEqual(stream.finish(text), ["Here is the fix:", "See the docs Done"], "the short list items are joined")
    }

    func testTheWrittenFollowUpBelowTheRuleIsNeverSpoken() {
        XCTAssertEqual(SpokenText.spokenPart("Bye for now!\n---\n## Details\n- a"), "Bye for now!\n")
        XCTAssertEqual(SpokenText.spokenPart("No rule here."), "No rule here.")
    }

    func testSpeakableDropsLinksEmojiTablesAndHeadings() {
        XCTAssertEqual(SpokenText.speakableSentence("## Title"), "Title")
        XCTAssertEqual(SpokenText.speakableSentence("Visit https://x.y/z now 🚀"), "Visit now")
        XCTAssertEqual(SpokenText.speakableSentence("| a | b |\n|---|---|\n| 1 | 2 |"), "a, b 1, 2")
        XCTAssertEqual(SpokenText.speakableSentence("```\ncode\n```"), "")
        XCTAssertEqual(SpokenText.speakableSentence("*really* `ok`"), "really ok")
    }
}

// MARK: - The engine: full duplex, barge-in, push to talk

@MainActor
private final class FakeTranscriber: CallTranscribing {
    var words = ""
    var began = 0
    var pushed = 0
    var discarded = 0
    func begin(preroll: [[Float]]) { began += 1; pushed += preroll.count }
    func push(_ frame: [Float]) { pushed += 1 }
    func finish() async -> String { words }
    func discard() { discarded += 1 }
    func close() {}
}

@MainActor
private final class FakePlayer: CallSpeaking {
    var queued: [String] = []
    var playing = false
    var ducks = 0
    var unducks = 0
    var cancels = 0
    var tones: [CallEarcon] = []
    var busy: Bool { playing || !queued.isEmpty }
    func level() -> Float { 0 }
    func enqueue(_ sentence: String) { queued.append(sentence) }
    func duck() { ducks += 1 }
    func unduck() { unducks += 1 }
    func cancel() { cancels += 1; queued = []; playing = false }
    func tone(_ earcon: CallEarcon) { tones.append(earcon) }
    func close() {}
    var played = PlaybackCut()
    var ledgerResets = 0
    func playback(speed: Double) -> PlaybackCut { played }
    func resetLedger() { ledgerResets += 1 }
}

@MainActor
final class LiveCallEngineTests: XCTestCase {
    private var transcriber: FakeTranscriber!
    private var player: FakePlayer!
    private var engine: LiveCallEngine!
    private var input = CallSettings.Input.auto
    private var sent: [(String, Bool)] = []
    private var turns: [CallTurn] = []
    private var clock: TimeInterval = 1_000
    private var cuts: [PlaybackCut] = []
    private var interrupts = 0
    private var cancelled = 0

    override func setUp() async throws {
        transcriber = FakeTranscriber()
        player = FakePlayer()
        engine = LiveCallEngine(transcriber: transcriber, player: player, settings: { [unowned self] in CallSettings(input: input) }, now: { [unowned self] in clock })
        engine.events.utterance = { [unowned self] turn in
            sent.append((turn.text, turn.interrupted))
            turns.append(turn)
        }
        engine.events.interruptBot = { [unowned self] in interrupts += 1 }
        engine.events.speechCancelled = { [unowned self] cut in
            cancelled += 1
            cuts.append(cut)
        }
        engine.connected()
    }

    private let speech = [Float](repeating: 0.15, count: 512).enumerated().map { $0.offset % 2 == 0 ? $0.element : -$0.element }
    private let quiet = [Float](repeating: 0.0005, count: 512)

    private func say(_ frames: Int) { for _ in 0..<frames { clock += 0.032; engine.frame(speech) } }
    private func silence(_ frames: Int) { for _ in 0..<frames { clock += 0.032; engine.frame(quiet) } }

    private func settle() async {
        for _ in 0..<5 { await Task.yield() }
    }

    func testTheMicIsAlwaysOpenAndAPauseEndsTheTurn() async {
        silence(20)
        transcriber.words = "What's on my calendar?"
        say(15)
        XCTAssertEqual(engine.state.phase, .hearing)
        silence(30) // Normal: a 700 ms pause ends the turn
        await settle()
        XCTAssertEqual(sent.map(\.0), ["What's on my calendar?"])
        XCTAssertEqual(sent.first?.1, false)
        XCTAssertEqual(engine.state.phase, .thinking)
        XCTAssertGreaterThan(transcriber.pushed, 15, "the preroll and the turn reach the recognizer")
    }

    func testTheAnswerIsSpokenSentenceBySentenceWhileItStreams() async {
        engine.setBotBusy(true)
        engine.replyProgress("Sure. Let me")
        XCTAssertEqual(player.queued, ["Sure."])
        engine.replyProgress("Sure. Let me check your calendar for tomorrow. It")
        XCTAssertEqual(player.queued, ["Sure.", "Let me check your calendar for tomorrow."])
        player.playing = true
        engine.playerSentenceStarted("Sure.")
        XCTAssertEqual(engine.state.phase, .speaking)
        let done = Task { await engine.replyDone("Sure. Let me check your calendar for tomorrow. It is free, nothing is booked.") }
        await settle()
        XCTAssertEqual(player.queued.last, "It is free, nothing is booked.")
        player.playing = false
        player.queued = []
        engine.playerIdle()
        let heard = await done.value
        XCTAssertTrue(heard)
    }

    func testAPauseMidSentenceIsOneUtteranceSentWhole() async {
        silence(20)
        transcriber.words = "Give me a good prompt"
        say(15)
        silence(30)
        await settle()
        XCTAssertEqual(sent.map(\.0), ["Give me a good prompt"])
        engine.setBotBusy(true)
        // the person goes on 1 s later, before the bot said anything
        transcriber.words = "for a cover letter."
        say(15)
        silence(30)
        await settle()
        XCTAssertEqual(turns.last?.text, "Give me a good prompt for a cover letter.", "sent whole")
        XCTAssertEqual(turns.last?.continues, true)
        XCTAssertEqual(interrupts, 1, "the fragment's turn is stopped")
    }

    func testAnUnfinishedClauseWaitsLongerThanTheNormalPause() async {
        silence(20)
        transcriber.words = "I want to"
        say(15)
        engine.partial("I want to")
        silence(24) // 768 ms: past Normal's 700, inside 700 + 750
        await settle()
        XCTAssertTrue(sent.isEmpty, "\"to\" does not end a sentence")
        silence(30)
        await settle()
        XCTAssertEqual(sent.map(\.0), ["I want to"])
    }

    func testASoundTheRecognizerSpelledIsNeverATurn() async {
        silence(20)
        transcriber.words = "dwad"
        say(15)
        silence(30)
        await settle()
        XCTAssertTrue(sent.isEmpty)
        transcriber.words = "oui"
        say(15)
        silence(30)
        await settle()
        XCTAssertEqual(sent.map(\.0), ["oui"], "a real one-word answer passes")
    }

    func testTalkingOverTheBotCutsItAndTheNextTurnSaysSo() async {
        silence(20)
        engine.setBotBusy(true)
        engine.replyProgress("A long answer that goes on. And then it keeps going without")
        player.playing = true
        player.played = PlaybackCut(heard: "A long answer", unheard: "that goes on.")
        engine.playerSentenceStarted("A long answer that goes on.")
        transcriber.words = "Stop, actually do something else"
        say(1)
        XCTAssertEqual(player.ducks, 1, "the bot is lowered on the first voiced frame")
        say(6)
        XCTAssertEqual(player.cancels, 1)
        XCTAssertEqual(cancelled, 1)
        XCTAssertEqual(interrupts, 1, "the bot's running turn is interrupted")
        XCTAssertEqual(engine.state.phase, .interrupted)
        say(5)
        silence(30)
        await settle()
        XCTAssertEqual(sent.count, 1)
        XCTAssertEqual(sent.first?.1, true, "the turn is marked interrupted")
        XCTAssertEqual(turns.first?.cut?.heard, "A long answer", "the bot is told what was heard")
        XCTAssertEqual(turns.first?.cut?.unheard, "that goes on. And then it keeps going without", "and what was not, written but unsaid included")
    }

    /// A real recording (a French question said by a voice): one turn,
    /// heard from its first word and ended by the pause after it.
    func testARecordedQuestionIsExactlyOneTurn() async throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "call-question", withExtension: "wav", subdirectory: "Fixtures")
            ?? Bundle.module.url(forResource: "call-question", withExtension: "wav"))
        let wav = try XCTUnwrap(CallWav.decode(Data(contentsOf: url)))
        XCTAssertEqual(wav.sampleRate, 16_000)
        transcriber.words = "Bonjour Ara, où en est le projet cette semaine?"
        silence(30)
        var samples = wav.samples
        samples += [Float](repeating: 0.0004, count: 16_000) // a second of quiet room
        var phases: [CallPhase] = []
        engine.events.state = { phases.append($0.phase) }
        stride(from: 0, to: samples.count - 511, by: 512).forEach { engine.frame(Array(samples[$0..<($0 + 512)])) }
        await settle()
        XCTAssertEqual(sent.map(\.0), ["Bonjour Ara, où en est le projet cette semaine?"], "one turn, not one per word")
        XCTAssertEqual(phases.filter { $0 == .hearing }.count, 1)
        XCTAssertEqual(transcriber.discarded, 0, "no noise was taken for speech")
    }

    func testMutedFramesAreIgnored() async {
        engine.setMuted(true)
        transcriber.words = "secret"
        say(20)
        silence(20)
        await settle()
        XCTAssertTrue(sent.isEmpty)
    }

    func testPushToTalkSendsWhatWasSaidWhileHeld() async {
        input = .push
        transcriber.words = "Push to talk works"
        say(5)
        XCTAssertEqual(engine.state.phase, .listening, "hands-free detection is off")
        engine.pushToTalk(true)
        XCTAssertEqual(engine.state.phase, .hearing)
        say(5)
        engine.pushToTalk(false)
        await settle()
        XCTAssertEqual(sent.map(\.0), ["Push to talk works"])
    }

    func testSayWaitsUntilHeardAndACutResolvesFalse() async {
        let said = Task { await engine.say("Is that a yes or a no?") }
        await settle()
        XCTAssertEqual(player.queued, ["Is that a yes or a no?"])
        player.playing = true
        engine.playerSentenceStarted("Is that a yes or a no?")
        engine.interrupt()
        let heard = await said.value
        XCTAssertFalse(heard)
    }
}

// MARK: - The conversation around the call

final class PlaybackCutTests: XCTestCase {
    func testTheCutLandsOnAWordByTheAudioClock() {
        let ledger: [(text: String, start: Double?, end: Double?, complete: Bool)] = [
            ("First sentence here.", 0, 2, true),
            ("Second one is cut halfway through.", 2, 6, true),
            ("Third never started.", nil, nil, false),
        ]
        let cut = PlaybackCut.measure(ledger, now: 4)
        XCTAssertEqual(cut.heard, "First sentence here. Second one is cut")
        XCTAssertEqual(cut.unheard, "halfway through. Third never started.")
        XCTAssertEqual(PlaybackCut.split("one", at: 0.2).1, "one")
        XCTAssertEqual(PlaybackCut.split("one", at: 0.8).0, "one")
    }

    func testUnfinishedClausesAndPausePresets() {
        XCTAssertTrue(ClauseCheck.incomplete("give me a good prompt to"))
        XCTAssertTrue(ClauseCheck.incomplete("je voudrais un rendez-vous pour"))
        XCTAssertTrue(ClauseCheck.incomplete("well,"))
        XCTAssertTrue(ClauseCheck.incomplete("so"))
        XCTAssertFalse(ClauseCheck.incomplete("What time is it?"))
        XCTAssertFalse(ClauseCheck.incomplete("book the meeting room tomorrow morning"))
        XCTAssertFalse(ClauseCheck.incomplete(""))
        let detector = TurnDetector()
        detector.setPause(.patient)
        XCTAssertEqual(detector.endpointMs, 800 + (600 - 480) / Double(900 - 480) * 700, accuracy: 1)
        XCTAssertEqual(CallSettings.decode(CallSettings(pause: .short).encoded).pause, .short)
        XCTAssertEqual(CallSettings.decode(#"{"input":"auto"}"#).pause, .normal)
    }

    func testNoiseFragments() {
        XCTAssertTrue(CallNoise.isFragment("dwad"))
        XCTAssertTrue(CallNoise.isFragment("a"))
        XCTAssertFalse(CallNoise.isFragment("Merci"))
        XCTAssertFalse(CallNoise.isFragment("42"))
        XCTAssertFalse(CallNoise.isFragment("What about tomorrow"))
    }
}

final class CallConversationTests: XCTestCase {
    private func text(_ id: String, _ body: String, role: Message.Role = .bot, from: String? = nil) -> Message {
        var message = Message(id: id, role: role, kind: .text, at: 0)
        message.text = body
        if let from { message.from = Sender(botId: from, name: from.capitalized, color: "blue") }
        return message
    }

    private func approval(_ id: String, requestId: String, skill: Bool = false) -> Message {
        var message = Message(id: id, role: .bot, kind: .options, at: 0)
        var card = OptionCard(title: "Run a command", subtitle: "ls -la", options: ["Allow", "Deny"])
        card.requestId = requestId
        card.tool = "Bash"
        message.card = card
        return message
    }

    func testTheBacklogIsNeverRecited() {
        var conversation = CallConversation(existing: [text("a", "Old answer")])
        XCTAssertEqual(conversation.settle(messages: [text("a", "Old answer")], botName: "Ara", thinking: false, playerBusy: false), [])
    }

    func testANewAnswerIsSpokenOnceAndOnlyWhatTheStreamHadNotSaid() {
        var conversation = CallConversation(existing: [])
        XCTAssertEqual(conversation.stream("Hello the"), "Hello the")
        let messages = [text("u", "Hi", role: .user), text("b", "Hello there.")]
        XCTAssertEqual(conversation.settle(messages: messages, botName: "Ara", thinking: true, playerBusy: false), [.replyDone("Hello there.", speakerId: nil)])
        XCTAssertEqual(conversation.settle(messages: messages, botName: "Ara", thinking: true, playerBusy: false), [])
    }

    func testABargeInDropsTheRestOfThatAnswerUntilTheNextTurn() {
        var conversation = CallConversation(existing: [])
        XCTAssertNotNil(conversation.stream("A long answer"))
        conversation.speechCancelled(currentStream: "A long answer", cut: PlaybackCut(heard: "A long", unheard: "answer"))
        XCTAssertNil(conversation.stream("A long answer that keeps going"), "the cut block is not spoken")
        let settled = conversation.settle(messages: [text("u", "Q", role: .user), text("b", "A long answer that keeps going.")], botName: "Ara", thinking: true, playerBusy: false)
        XCTAssertEqual(settled, [])
        XCTAssertEqual(conversation.interrupted, ["b"])
        XCTAssertEqual(conversation.unheard["b"], "answer", "the words not heard stay on the cut answer")
        XCTAssertEqual(conversation.utterance("Something else"), .send("Something else"))
        XCTAssertEqual(conversation.stream("New"), "New", "a new answer streams again")
    }

    func testAnApprovalIsAskedAndAnsweredYesOrNoOnly() {
        var conversation = CallConversation(existing: [])
        let card = approval("c", requestId: "r1")
        let actions = conversation.settle(messages: [card], botName: "Ara", thinking: true, playerBusy: false)
        guard case let .say(.approval(requester, kind, tool, _, detail, _), _) = actions.first else { return XCTFail("\(actions)") }
        XCTAssertEqual(requester, "Ara")
        XCTAssertEqual(kind, .command)
        XCTAssertEqual(tool, "Bash")
        XCTAssertEqual(detail, "ls -la")
        XCTAssertFalse(conversation.mayInterruptBot(busy: true), "an approval being answered keeps its turn")
        XCTAssertEqual(conversation.utterance("sure thing, but first tell me why"), .decide(requestId: "r1", allow: true))
        var other = CallConversation(existing: [])
        _ = other.settle(messages: [card], botName: "Ara", thinking: true, playerBusy: false)
        XCTAssertEqual(other.utterance("what does it do?"), .say(.yesOrNo))
        XCTAssertEqual(other.utterance("non merci"), .decide(requestId: "r1", allow: false))
        XCTAssertEqual(other.decisionFailed(requestId: "r1"), .approvalFailed)
    }

    func testAQuestionIsAnsweredWithTheNextWords() {
        var conversation = CallConversation(existing: [])
        var question = Message(id: "q", role: .bot, kind: .options, at: 0)
        var card = OptionCard(title: "Pick", subtitle: "Which day?", options: ["Monday", "Tuesday"])
        card.requestId = "rq"
        question.card = card
        let actions = conversation.settle(messages: [question], botName: "Ara", thinking: true, playerBusy: false)
        XCTAssertEqual(actions, [.say(.question(requester: "Ara", subtitle: "Which day?", options: ["Monday", "Tuesday"]), speakerId: nil)])
        XCTAssertEqual(conversation.utterance("Tuesday"), .answer(requestId: "rq", messageId: "q", text: "Tuesday"))
    }

    func testANarratedStepIsReadWhileTheBotWorks() {
        var conversation = CallConversation(existing: [])
        var chip = Message(id: "t", role: .bot, kind: .activity, at: 0)
        chip.tool = ToolActivity(name: "Bash", spoken: "Checking your calendar")
        XCTAssertEqual(conversation.settle(messages: [chip], botName: "Ara", thinking: true, playerBusy: false), [.narrate("Checking your calendar", speakerId: nil)])
    }

    func testARoomSpeaksEveryMemberInTurnAndRoutesNames() {
        var conversation = CallConversation(existing: [], room: true)
        XCTAssertNil(conversation.stream("partial"), "a room speaks settled replies, in turn")
        let replies = [text("u", "@everyone hi", role: .user), text("a", "Hi from Ara.", from: "ara"), text("h", "Hi from Helios.", from: "helios")]
        XCTAssertEqual(conversation.settle(messages: replies, botName: "Room", thinking: false, playerBusy: true), [
            .reply("Hi from Ara.", speakerId: "ara"), .reply("Hi from Helios.", speakerId: "helios"),
        ])
        XCTAssertEqual(conversation.utterance("Helios, what's the status?", memberNames: ["Ara", "Helios"]), .send("@Helios what's the status?"))
        XCTAssertEqual(conversation.utterance("everyone, good morning", memberNames: ["Ara", "Helios"]), .send("@everyone good morning"))
        XCTAssertEqual(conversation.utterance("good morning", memberNames: ["Ara"], mentionsOnly: true), .needsName)
    }

    func testGroupRoutingMatchesTheDesktop() {
        XCTAssertEqual(GroupCallRouting.route("hey Ara can you check", memberNames: ["Ara", "Helios"]), SpokenGroupMessage(text: "@Ara can you check", addressed: true))
        XCTAssertEqual(GroupCallRouting.route("@Helios go", memberNames: ["Ara", "Helios"]), SpokenGroupMessage(text: "@Helios go", addressed: true))
        XCTAssertEqual(GroupCallRouting.route("all", memberNames: []), SpokenGroupMessage(text: "@everyone", addressed: true))
        XCTAssertEqual(GroupCallRouting.route("what now", memberNames: ["Ara"]), SpokenGroupMessage(text: "what now", addressed: false))
    }
}

// MARK: - Settings, voices and the wire

final class VoiceModeWireTests: XCTestCase {
    func testSettingsKeepTheDesktopShapeAndDefaultWhatIsInvalid() {
        XCTAssertEqual(VoiceModeSettings.decode(#"{"voice":"eve","speed":1.25,"language":"fr"}"#), VoiceModeSettings(voice: "eve", speed: 1.25, language: "fr"))
        XCTAssertEqual(VoiceModeSettings.decode(#"{"voice":"bad id!","speed":9,"language":"xx"}"#), .default)
        XCTAssertEqual(VoiceModeSettings.decode(VoiceModeSettings(voice: "ara", speed: 0.75, language: "en").encoded).speed, 0.75)
        XCTAssertEqual(VoiceModeSettings.speedLabel(1), "1x")
        XCTAssertEqual(VoiceModeSettings.speedLabel(1.25), "1.25x")
        XCTAssertEqual(CallSettings.decode(CallSettings(input: .push, earcons: false).encoded), CallSettings(input: .push, earcons: false))
        XCTAssertEqual(formatCallTime(65), "1:05")
        XCTAssertEqual(formatCallTime(3725), "1:02:05")
    }

    func testFrenchCallsListenInTheRegionThePersonSpeaks() {
        let locales = VoiceModeSettings(language: "fr").recognitionLocales(preferred: [Locale(identifier: "fr-CA"), Locale(identifier: "en-US")])
        XCTAssertEqual(locales.first?.identifier, "fr-CA")
    }

    func testTheVoiceIsTheOneTheDesktopWouldUse() throws {
        let xai = VoiceModeStatus(available: true)
        let eleven = try JSONDecoder().decode(ConfigStatus.self, from: Data(#"{"tts":{"configured":true,"provider":"elevenlabs","voice":"w"}}"#.utf8))
        XCTAssertEqual(CallVoiceSource.route(voiceMode: xai, config: eleven, agentVoice: "v1", phoneKey: false), [.xai, .server(voiceId: "v1"), .device])
        XCTAssertEqual(CallVoiceSource.route(voiceMode: VoiceModeStatus(available: false), config: eleven, agentVoice: nil, phoneKey: true), [.server(voiceId: nil), .phoneElevenLabs(voiceId: nil), .device])
        XCTAssertEqual(CallVoiceSource.route(voiceMode: nil, config: nil, agentVoice: "v", phoneKey: false), [.device])
    }

    func testACutTurnCarriesItsUtteranceAndWhatWasHeard() {
        let meta = VoiceCallMeta(callId: "call-12345678", interrupted: true, language: "fr", utteranceId: "utt-1234567890abcdef", cut: PlaybackCut(heard: "Bonjour  tout", unheard: "le monde"), continues: true)
        XCTAssertEqual(meta.json["utteranceId"] as? String, "utt-1234567890abcdef")
        XCTAssertEqual(meta.json["heard"] as? String, "Bonjour tout")
        XCTAssertEqual(meta.json["unheard"] as? String, "le monde")
        XCTAssertEqual(meta.json["continues"] as? Bool, true)
        let plain = VoiceCallMeta(callId: "call-12345678", cut: PlaybackCut(heard: "x", unheard: "y"))
        XCTAssertNil(plain.json["heard"], "heard only means something for words that cut the bot")
        let long = VoiceCallMeta(callId: "call-12345678", interrupted: true, cut: PlaybackCut(heard: String(repeating: "a ", count: 1_000)))
        XCTAssertEqual((long.json["heard"] as? String)?.count, VoiceCallMeta.excerptMax)
    }

    func testTheCallMetaNeverSendsAuto() {
        XCTAssertNil(VoiceCallMeta(callId: "call-12345678", language: "auto").language)
        XCTAssertEqual(VoiceCallMeta(callId: "call-12345678", interrupted: true, language: "fr").json["language"] as? String, "fr")
        XCTAssertNil(VoiceCallMeta(callId: "call-12345678").json["interrupted"])
    }

    func testWavRoundTrips() throws {
        let samples: [Float] = [0, 0.5, -0.5, 0.25]
        let decoded = try XCTUnwrap(CallWav.decode(CallWav.encode(samples)))
        XCTAssertEqual(decoded.sampleRate, 16_000)
        XCTAssertEqual(decoded.samples.count, 4)
        XCTAssertEqual(decoded.samples[1], 0.5, accuracy: 0.001)
    }
}

private final class VoiceStub: URLProtocol {
    static var requests: [(URLRequest, Data?)] = []
    static var status = 200
    static var headers: [String: String] = ["Content-Type": "application/json"]
    static var body = Data("{}".utf8)

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var body = request.httpBody
        if body == nil, let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
            stream.close()
            body = data
        }
        Self.requests.append((request, body))
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: "HTTP/1.1", headerFields: Self.headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class VoiceModeClientTests: XCTestCase {
    private var client: CompanionClient!
    private var session: URLSession!

    override func setUp() {
        VoiceStub.requests = []
        VoiceStub.status = 200
        VoiceStub.headers = ["Content-Type": "application/json"]
        VoiceStub.body = Data("{}".utf8)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [VoiceStub.self]
        session = URLSession(configuration: configuration)
        client = CompanionClient(connection: Connection(name: "T", host: "127.0.0.1", port: 8810), token: "t", session: session)
    }

    func testACallTurnIsAnOrdinarySendMarkedAsSaidOnTheCall() async throws {
        VoiceStub.body = Data(#"{"ok":true}"#.utf8)
        try await client.send(text: "Bonjour", toBot: "ara", threadId: "th-1", voiceCall: VoiceCallMeta(callId: "c-12345678", interrupted: true, language: "fr", utteranceId: "utt-0123456789abcdef"))
        let (request, body) = try XCTUnwrap(VoiceStub.requests.first)
        XCTAssertEqual(request.url?.path, "/api/bots/ara/messages")
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(body)) as? [String: Any])
        XCTAssertEqual(json["text"] as? String, "Bonjour")
        XCTAssertEqual(json["threadId"] as? String, "th-1")
        let call = try XCTUnwrap(json["voiceCall"] as? [String: Any])
        XCTAssertEqual(call["callId"] as? String, "c-12345678")
        XCTAssertEqual(call["interrupted"] as? Bool, true)
        XCTAssertEqual(call["language"] as? String, "fr")
        XCTAssertEqual(call["utteranceId"] as? String, "utt-0123456789abcdef")
        XCTAssertEqual(json["sendId"] as? String, "utt-0123456789abcdef", "the utterance is the send: delivered once")
    }

    func testTheCallTellsTheServerItStartsAndEnds() async throws {
        VoiceStub.body = Data(#"{"ok":true}"#.utf8)
        let ok = await client.voiceCallSession(botId: "ara", state: .start, callId: "call-12345678", threadId: "th-1", language: "auto")
        XCTAssertTrue(ok)
        let (request, body) = try XCTUnwrap(VoiceStub.requests.last)
        XCTAssertEqual(request.url?.path, "/api/bots/ara/voice/call")
        XCTAssertEqual(request.httpMethod, "POST")
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(body)) as? [String: Any])
        XCTAssertEqual(json["state"] as? String, "start")
        XCTAssertEqual(json["callId"] as? String, "call-12345678")
        XCTAssertEqual(json["threadId"] as? String, "th-1")
        XCTAssertNil(json["language"], "auto is never sent")
        VoiceStub.status = 404
        let old = await client.voiceCallSession(botId: "ara", state: .end, callId: "call-12345678", threadId: nil, language: nil)
        XCTAssertFalse(old, "an older server without the route: best effort")
    }

    func testStatusAndStreamSpeakTheServersContract() async throws {
        VoiceStub.body = Data(#"{"provider":"xai","available":false,"organization":true,"refusal":{"cause":"no_credentials","keysUrl":"https://p/keys"}}"#.utf8)
        let status = try await client.voiceModeStatus(botId: "ara")
        XCTAssertFalse(status.available)
        XCTAssertEqual(status.refusal?.cause, "no_credentials")
        XCTAssertEqual(VoiceStub.requests.last?.0.url?.path, "/api/bots/ara/voice/status")

        VoiceStub.headers = ["Content-Type": "audio/pcm", "x-voice-sample-rate": "24000"]
        VoiceStub.body = Data(repeating: 1, count: 10_000)
        let audio = try await client.voiceModeStream(botId: "ara", text: "Hi.", settings: VoiceModeSettings(voice: "eve", speed: 1.25, language: "fr"), threadId: "th-1")
        XCTAssertEqual(audio?.sampleRate, 24_000)
        var total = 0
        for try await chunk in try XCTUnwrap(audio).chunks { total += chunk.count }
        XCTAssertEqual(total, 10_000)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(VoiceStub.requests.last?.1)) as? [String: Any])
        XCTAssertEqual(body["voice"] as? String, "eve")
        XCTAssertEqual(body["speed"] as? Double, 1.25)
        XCTAssertEqual(body["language"] as? String, "fr")
        XCTAssertEqual(body["threadId"] as? String, "th-1")

        VoiceStub.status = 204
        VoiceStub.body = Data()
        let nothing = try await client.voiceModeStream(botId: "ara", text: "```x```", settings: .default, threadId: nil)
        XCTAssertNil(nothing)
    }
}

final class CallQuietTests: XCTestCase {
    func testOnlyTheThreadOnTheCallIsQuietAndOnlyWhileItLasts() {
        let quiet = CallQuiet()
        XCTAssertFalse(quiet.silences(threadId: "th-ara"))
        quiet.set("th-ara", live: true)
        XCTAssertTrue(quiet.silences(threadId: "th-ara"), "the conversation on the call does not buzz")
        XCTAssertFalse(quiet.silences(threadId: "th-helios"), "another conversation still does")
        XCTAssertFalse(quiet.silences(threadId: nil))
        quiet.set("th-ara", live: false)
        XCTAssertFalse(quiet.silences(threadId: "th-ara"), "hung up: it notifies again")
    }
}
