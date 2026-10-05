// Read one message aloud (MS4), the desktop's `SpeakButton` and `speaker`
// (src/lib/tts): one voice at a time, a new message stops the last, and the
// same menu item turns into Stop while that message is the one speaking.
//
// Audio comes from the paired computer first, as on the desktop: it holds
// the voice provider's key and the agent's voice (`POST /api/tts/prepare`
// cuts the text into utterances, `POST /api/tts/speak` renders each one).
// When the computer has no voice set up, or a request fails, the phone's
// own voice (AVSpeechSynthesizer) reads it instead, so the action always
// does something. The live call (ios/App/Call) keeps its own streaming
// voice stack; a read-aloud is one clip at a time, so it plays here.
import AVFoundation
import CompanionCore
import SwiftUI

@MainActor
final class MessageSpeaker: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    static let shared = MessageSpeaker()

    enum Status: Equatable { case idle, preparing, speaking }

    @Published private(set) var status: Status = .idle
    /// The message being read, so its menu offers Stop.
    @Published private(set) var messageId: String?

    private let player = SpeechClipPlayer()
    private let synthesizer = AVSpeechSynthesizer()
    private var task: Task<Void, Never>?
    private var deviceWaiter: CheckedContinuation<Void, Never>?

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func isSpeaking(_ id: String) -> Bool { messageId == id && status != .idle }

    /// Speak `text` for `id`, stopping whatever was speaking. The menu
    /// decides between this and `stop()` from what it showed, so a tap on
    /// Stop never restarts a reply that finished a moment before.
    func speak(_ text: String, messageId id: String, voiceId: String?, session: Session) {
        stop()
        guard VoiceNoteCenter.shared.beginPlaybackSession() else { return }
        let audio = AVAudioSession.sharedInstance()
        try? audio.setCategory(.playback, mode: .spokenAudio)
        try? audio.setActive(true)
        messageId = id
        status = .preparing
        task = Task { [weak self] in
            await self?.read(text, voiceId: voiceId, session: session)
            guard let self, !Task.isCancelled else { return }
            self.finish()
        }
    }

    func stop() {
        task?.cancel()
        task = nil
        player.stop()
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
        deviceWaiter?.resume()
        deviceWaiter = nil
        finish()
    }

    private func finish() {
        guard status != .idle || messageId != nil else { return }
        status = .idle
        messageId = nil
        VoiceNoteCenter.shared.endPlaybackSession()
    }

    private func read(_ text: String, voiceId: String?, session: Session) async {
        if let prepared = await session.prepareSpeech(text: text, voiceId: voiceId),
           prepared.ready, !prepared.utterances.isEmpty {
            if await playComputerVoice(prepared.utterances, voiceId: voiceId, session: session) { return }
        }
        guard !Task.isCancelled else { return }
        status = .speaking
        await deviceSpeak(Walkie.speakable(text, limit: 4_000))
    }

    /// True when every utterance played; false hands what is left to the
    /// phone's voice (nothing, when it was cancelled).
    private func playComputerVoice(_ parts: [String], voiceId: String?, session: Session) async -> Bool {
        var current: Data
        do { current = try await session.speechAudio(text: parts[0], voiceId: voiceId) } catch { return false }
        for index in parts.indices {
            guard !Task.isCancelled else { return true }
            var next: Task<Data, Error>?
            if index + 1 < parts.count {
                let upcoming = parts[index + 1]
                next = Task { try await session.speechAudio(text: upcoming, voiceId: voiceId) }
            }
            status = .speaking
            do { try await player.play(current) } catch { next?.cancel(); return false }
            guard let next else { return true }
            guard !Task.isCancelled else { next.cancel(); return true }
            do { current = try await next.value } catch { return Task.isCancelled }
        }
        return true
    }

    private func deviceSpeak(_ text: String) async {
        guard !text.isEmpty else { return }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: AVSpeechSynthesisVoice.currentLanguageCode())
        await withCheckedContinuation { continuation in
            deviceWaiter = continuation
            synthesizer.speak(utterance)
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.deviceDone() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.deviceDone() }
    }

    private func deviceDone() {
        deviceWaiter?.resume()
        deviceWaiter = nil
    }
}

/// Plays one clip of speech audio and returns when it has finished (the
/// clip player Walkie had, kept for read-aloud when the call replaced it).
@MainActor
final class SpeechClipPlayer: NSObject, AVAudioPlayerDelegate {
    private var player: AVAudioPlayer?
    private var waiter: CheckedContinuation<Void, Never>?

    func play(_ audio: Data) async throws {
        let player = try AVAudioPlayer(data: audio)
        player.delegate = self
        player.prepareToPlay()
        self.player = player
        await withCheckedContinuation { continuation in
            waiter = continuation
            if !player.play() { finish() }
        }
    }

    func stop() {
        player?.stop()
        player = nil
        finish()
    }

    private func finish() {
        waiter?.resume()
        waiter = nil
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let id = ObjectIdentifier(player)
        Task { @MainActor in self.finished(id) }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        let id = ObjectIdentifier(player)
        Task { @MainActor in self.finished(id) }
    }

    private func finished(_ id: ObjectIdentifier) {
        guard let player, ObjectIdentifier(player) == id else { return }
        self.player = nil
        finish()
    }
}
