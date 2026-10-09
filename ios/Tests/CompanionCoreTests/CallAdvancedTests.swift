// The call card's Advanced rows the desktop has and the phone now matches
// (matrix CB11): "Only my voice" with its enrollment and gate, and "Soft
// tone" for a slow answer. Settings keep the desktop's key and field names.
import XCTest
@testable import CompanionCore

@MainActor
private final class Ears: CallTranscribing {
    var words = ""
    func begin(preroll: [[Float]]) {}
    func push(_ frame: [Float]) {}
    func finish() async -> String { words }
    func discard() {}
    func close() {}
}

@MainActor
private final class Voice: CallSpeaking {
    var queued: [String] = []
    var tones: [CallEarcon] = []
    var busy: Bool { !queued.isEmpty }
    func level() -> Float { 0 }
    func enqueue(_ sentence: String) { queued.append(sentence) }
    func duck() {}
    func unduck() {}
    func cancel() { queued = [] }
    func tone(_ earcon: CallEarcon) { tones.append(earcon) }
    func close() {}
    func playback(speed: Double) -> PlaybackCut { PlaybackCut() }
    func resetLedger() {}
}

final class CallAdvancedSettingsTests: XCTestCase {
    func testOnlyMyVoiceAndSoftToneUseTheDesktopKeysAndDefaults() {
        XCTAssertTrue(CallSettings.default.onlyMyVoice, "on by default, as on the desktop (it waits for an enrollment)")
        XCTAssertTrue(CallSettings.default.thinkingCue)
        XCTAssertEqual(CallSettings.storageKey, "omb.voiceCall.v1")
        let off = CallSettings.decode(#"{"input":"auto","onlyMyVoice":false,"thinkingCue":false}"#)
        XCTAssertFalse(off.onlyMyVoice)
        XCTAssertFalse(off.thinkingCue)
        XCTAssertEqual(CallSettings.decode(off.encoded), off)
        let record = try? JSONSerialization.jsonObject(with: Data(off.encoded.utf8)) as? [String: Any]
        XCTAssertEqual(record?["onlyMyVoice"] as? Bool, false)
        XCTAssertEqual(record?["thinkingCue"] as? Bool, false)
        // an older phone's record keeps the defaults
        XCTAssertTrue(CallSettings.decode(#"{"input":"push"}"#).onlyMyVoice)
    }

    func testTheSoftToneIsTheDesktopsTwoLowNotesAndQuieter() {
        XCTAssertEqual(CallEarcon.thinking.notes.map(\.hz), [392, 523])
        XCTAssertEqual(CallEarcon.thinking.notes.map(\.ms), [110, 150])
        XCTAssertLessThan(CallEarcon.thinking.volume, CallEarcon.connected.volume)
    }

    func testTheVoiceprintKeepsTheDesktopShapeAndStaysLocal() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "call-voiceprint-\(UUID().uuidString)"))
        XCTAssertNil(CallVoiceprint.read(defaults))
        let print = CallVoiceprint(level: 0.12, clips: 3, createdAt: Date(timeIntervalSince1970: 0))
        print.save(defaults)
        XCTAssertEqual(CallVoiceprint.read(defaults), print)
        let raw = try XCTUnwrap(defaults.string(forKey: "omb.voiceCall.voiceprint.v1"))
        let record = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
        XCTAssertEqual(Set(record.keys), ["version", "vector", "clips", "level", "createdAt"])
        CallVoiceprint.forget(defaults)
        XCTAssertNil(CallVoiceprint.read(defaults))
        XCTAssertNil(CallVoiceprint.decode(#"{"version":1,"vector":[],"clips":1,"level":0,"createdAt":"x"}"#), "no level, no print")
    }

    func testTheGateAcceptsThePersonShortTurnsAndRejectsAFarVoice() {
        let print = CallVoiceprint(level: 0.1)
        XCTAssertTrue(print.accepts(turnLevel: 0.09, seconds: 2))
        XCTAssertTrue(print.accepts(turnLevel: 0.036, seconds: 2), "a softer sentence of the same person")
        XCTAssertFalse(print.accepts(turnLevel: 0.02, seconds: 2), "a TV across the room")
        XCTAssertTrue(print.accepts(turnLevel: 0.02, seconds: 0.4), "too short to judge: accepted")
        XCTAssertEqual(CallVoiceprint.learn(0.1, from: 0.2), 0.12, accuracy: 0.0001)
    }

    func testAnEnrollmentNeedsEnoughSpeechWhileTheBotIsSilent() {
        var recorder = CallEnrollmentRecorder(seconds: 1, startedAt: 0, timeout: 25)
        for _ in 0..<10 { recorder.push(level: 0.1, probability: 1, botAudible: true) }
        XCTAssertEqual(recorder.share, 0, "the bot's own voice is never enrolled")
        for _ in 0..<15 { recorder.push(level: 0.1, probability: 1, botAudible: false) }
        XCTAssertFalse(recorder.done(now: 1))
        XCTAssertNil(recorder.voiceprint(), "under 60 % of the speech: failed")
        for _ in 0..<20 { recorder.push(level: 0.2, probability: 1, botAudible: false) }
        XCTAssertTrue(recorder.done(now: 2))
        XCTAssertEqual(recorder.voiceprint()?.level, 0.2, "the median level")
        XCTAssertTrue(CallEnrollmentRecorder(seconds: 6, startedAt: 0, timeout: 25).done(now: 26), "the time runs out")
    }
}

@MainActor
final class CallAdvancedEngineTests: XCTestCase {
    private var ears: Ears!
    private var voice: Voice!
    private var engine: LiveCallEngine!
    private var settings = CallSettings()
    private var clock: TimeInterval = 1_000
    private var sent: [String] = []
    private var rejected: [CallRejection] = []

    private func make(voiceprint: CallVoiceprint? = nil) {
        ears = Ears()
        voice = Voice()
        sent = []
        rejected = []
        engine = LiveCallEngine(transcriber: ears, player: voice, settings: { [unowned self] in settings }, voiceprint: voiceprint, now: { [unowned self] in clock })
        engine.events.utterance = { [unowned self] turn in sent.append(turn.text) }
        engine.events.rejected = { [unowned self] reason in rejected.append(reason) }
        engine.connected()
    }

    private func wave(_ amplitude: Float) -> [Float] {
        (0..<512).map { $0 % 2 == 0 ? amplitude : -amplitude }
    }

    private func say(_ frames: Int, at amplitude: Float = 0.15) { for _ in 0..<frames { clock += 0.032; engine.frame(wave(amplitude)) } }
    private func silence(_ frames: Int) { for _ in 0..<frames { clock += 0.032; engine.frame(wave(0.0005)) } }
    private func settle() async { for _ in 0..<8 { await Task.yield() } }

    func testRecordingAVoiceMakesThePrintAndPausesTurns() async {
        make()
        XCTAssertFalse(engine.enrolled)
        var shares: [Double] = []
        let enrolling = Task { await self.engine.enroll(seconds: 1, timeout: 25) { shares.append($0) } }
        await settle()
        ears.words = "this is me reading aloud"
        say(40)
        let print = await enrolling.value
        XCTAssertEqual(print?.level ?? 0, 0.15, accuracy: 0.001)
        XCTAssertTrue(engine.enrolled)
        XCTAssertEqual(shares.last, 1)
        XCTAssertTrue(sent.isEmpty, "what is said while recording is not a turn")
    }

    func testOnlyMyVoiceDropsAQuieterVoiceAndKeepsThePersons() async {
        make(voiceprint: CallVoiceprint(level: 0.15))
        silence(10)
        ears.words = "Breaking news tonight"
        say(30, at: 0.04) // voiced, but far under the person's level
        silence(30)
        await settle()
        XCTAssertEqual(rejected, [.otherVoice])
        XCTAssertTrue(sent.isEmpty)
        XCTAssertTrue(voice.tones.contains(.rejected), "the call sounds' rejected tone, as on the desktop")

        ears.words = "What's on my calendar?"
        say(30)
        silence(30)
        await settle()
        XCTAssertEqual(sent, ["What's on my calendar?"])
    }

    func testAVoiceUnderTheFarFieldGateNeverStartsATurn() async {
        make(voiceprint: CallVoiceprint(level: 0.15))
        silence(10)
        ears.words = "television"
        say(30, at: 0.02)
        silence(30)
        await settle()
        XCTAssertEqual(engine.state.phase, .listening)
        XCTAssertTrue(sent.isEmpty)
    }

    func testWithTheSwitchOffOrNoEnrollmentEveryVoiceCounts() async {
        settings.onlyMyVoice = false
        make(voiceprint: CallVoiceprint(level: 0.15))
        XCTAssertFalse(engine.verifying)
        silence(10)
        ears.words = "a colleague asking something"
        say(30, at: 0.04)
        silence(30)
        await settle()
        XCTAssertEqual(sent, ["a colleague asking something"])

        settings.onlyMyVoice = true
        make()
        XCTAssertFalse(engine.verifying, "on, but nothing enrolled: off")
        engine.forgetVoice()
        XCTAssertFalse(engine.enrolled)
    }

    func testASlowAnswerGetsTheSoftToneOnce() async throws {
        make()
        engine.thinkingCueSeconds = 0.05
        silence(10)
        ears.words = "Summarize my inbox"
        say(20)
        silence(30)
        await settle()
        XCTAssertEqual(sent, ["Summarize my inbox"])
        try await Task.sleep(nanoseconds: 150_000_000)
        await settle()
        XCTAssertEqual(voice.tones.filter { $0 == .thinking }.count, 1)
    }

    func testNoSoftToneWhenOffOrWhenTheAnswerIsAlreadyHeard() async throws {
        settings.thinkingCue = false
        make()
        engine.thinkingCueSeconds = 0.05
        silence(10)
        ears.words = "Summarize my inbox"
        say(20)
        silence(30)
        await settle()
        try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertFalse(voice.tones.contains(.thinking))

        settings.thinkingCue = true
        make()
        // the cue waits from the person's last word, on the call's clock:
        // about 0.35 s of it has passed by the time the turn is sent
        engine.thinkingCueSeconds = 0.8
        silence(10)
        ears.words = "Summarize my inbox"
        say(20)
        silence(30)
        await settle()
        XCTAssertEqual(sent, ["Summarize my inbox"])
        engine.playerSentenceStarted("Here it is.")
        try await Task.sleep(nanoseconds: 700_000_000)
        XCTAssertFalse(voice.tones.contains(.thinking), "the answer started first")
    }
}
