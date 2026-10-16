// The composer's voice note: names, waveform, WAV handling, transcription
// clips and the mic press, matching the desktop's src/lib/voice-note.ts.
import XCTest
@testable import CompanionCore

final class VoiceNoteRecordingTests: XCTestCase {
    func testFileNameIsLocalTimeAndRecognized() {
        let utc = TimeZone(identifier: "UTC")!
        let date = Date(timeIntervalSince1970: 1_792_160_730) // 2026-10-16 14:25:30 UTC
        let name = VoiceNoteRecording.fileName(at: date, timeZone: utc)
        XCTAssertEqual(name, "voice-note-20261016-142530.wav")
        XCTAssertTrue(VoiceNoteRecording.isVoiceNoteName(name))
        XCTAssertTrue(VoiceNoteRecording.isVoiceNoteName(" Voice-Note-20261016-142530.WAV "))
        XCTAssertFalse(VoiceNoteRecording.isVoiceNoteName("voice-note-.wav"))
        XCTAssertFalse(VoiceNoteRecording.isVoiceNoteName("voice-note-abc.wav"))
        XCTAssertFalse(VoiceNoteRecording.isVoiceNoteName("voice-note-2026.mp3"))
        XCTAssertFalse(VoiceNoteRecording.isVoiceNoteName("notes.wav"))
    }

    func testLevelFromDecibels() {
        XCTAssertEqual(VoiceNoteRecording.level(fromDecibels: 0), 1, accuracy: 1e-9)
        XCTAssertEqual(VoiceNoteRecording.level(fromDecibels: -20), 0.1, accuracy: 1e-9)
        XCTAssertEqual(VoiceNoteRecording.level(fromDecibels: 6), 1, accuracy: 1e-9)
        XCTAssertLessThan(VoiceNoteRecording.level(fromDecibels: -160), 1e-7)
        XCTAssertEqual(VoiceNoteRecording.level(fromDecibels: .nan), 0)
    }

    func testWaveformPadsOldestFirstAndScales() {
        let bars = VoiceNoteRecording.waveformBars([0.5, 0.0, 1.0 / 6.0], bars: 5)
        XCTAssertEqual(bars.count, 5)
        XCTAssertEqual(Array(bars.prefix(2)), [0, 0])
        XCTAssertEqual(bars[2], 1) // sqrt(3) clamps to 1
        XCTAssertEqual(bars[3], 0)
        XCTAssertEqual(bars[4], 1, accuracy: 1e-9)
        XCTAssertEqual(VoiceNoteRecording.waveformBars(Array(repeating: 0.01, count: 40)).count, VoiceNoteRecording.bars)
        XCTAssertEqual(VoiceNoteRecording.waveformBars([-1, .nan], bars: 2), [0, 0])
    }

    func testClock() {
        XCTAssertEqual(VoiceNoteRecording.clock(0), "0:00")
        XCTAssertEqual(VoiceNoteRecording.clock(7.9), "0:07")
        XCTAssertEqual(VoiceNoteRecording.clock(299.5), "4:59")
    }

    func testWavRoundTripAndPaddingChunks() {
        let pcm = Data((0..<32).map { UInt8($0) })
        let wav = VoiceNoteRecording.wav(pcm: pcm)
        XCTAssertEqual(wav.count, 44 + 32)
        let parsed = VoiceNoteRecording.pcm(fromWAV: wav)
        XCTAssertEqual(parsed?.samples, pcm)
        XCTAssertEqual(parsed?.sampleRate, 16_000)
        XCTAssertEqual(parsed?.channels, 1)

        // AVAudioRecorder writes a FLLR chunk between fmt and data
        var padded = Data(wav.prefix(36))
        padded.append(contentsOf: Array("FLLR".utf8))
        padded.append(contentsOf: [5, 0, 0, 0, 9, 9, 9, 9, 9, 0]) // odd size, one pad byte
        padded.append(wav.suffix(from: 36))
        XCTAssertEqual(VoiceNoteRecording.pcm(fromWAV: padded)?.samples, pcm)

        XCTAssertNil(VoiceNoteRecording.pcm(fromWAV: Data("not a wav".utf8)))
    }

    func testTranscriptionClipsStayUnderTheLimit() {
        let size = VoiceNoteRecording.transcriptionChunkSamples()
        XCTAssertEqual(size % 16_000, 0)
        XCTAssertLessThanOrEqual(44 + size * 2, VoiceNoteRecording.maxTranscriptionBytes)

        let pcm = Data(count: size * 2 * 2 + 100)
        let clips = VoiceNoteRecording.transcriptionClips(pcm: pcm)
        XCTAssertEqual(clips.count, 3)
        XCTAssertTrue(clips.allSatisfy { $0.count <= VoiceNoteRecording.maxTranscriptionBytes })
        XCTAssertEqual(clips.last?.count, 44 + 100)
        XCTAssertEqual(VoiceNoteRecording.transcriptionClips(pcm: Data()).count, 0)
        // a tiny limit still cuts whole seconds
        XCTAssertEqual(VoiceNoteRecording.transcriptionChunkSamples(maxBytes: 100), 16_000)
    }

    func testDuration() {
        XCTAssertEqual(VoiceNoteRecording.duration(pcmBytes: 32_000), 1)
        XCTAssertEqual(VoiceNoteRecording.duration(pcmBytes: 16_000), 0.5)
    }

    func testHoldOutcome() {
        XCTAssertEqual(VoiceNoteHold.outcome(heldFor: 0.1, translationX: 0, recording: false), .tap)
        XCTAssertEqual(VoiceNoteHold.outcome(heldFor: 0.1, translationX: -200, recording: false), .tap)
        XCTAssertEqual(VoiceNoteHold.outcome(heldFor: 1, translationX: -10, recording: true), .send)
        XCTAssertEqual(VoiceNoteHold.outcome(heldFor: 1, translationX: -80, recording: true), .cancel)
        XCTAssertEqual(VoiceNoteHold.outcome(heldFor: 0.4, translationX: 30, recording: false), .send)
    }
}
