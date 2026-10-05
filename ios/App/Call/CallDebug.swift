// DEBUG only: drive a live call without a microphone or a voice, for the UI
// tests against the parity fixture (UITests/CallUITests.swift).
//
//   -callInjectAudio DIR   the microphone is replaced by recordings: every
//                          32 ms a frame of the next clip (DIR/*.wav, 16-bit
//                          PCM, in name order) or of a quiet room is fed to
//                          the call, through the same frames, turn detector
//                          and endpointing as the real microphone. A clip's
//                          words are its DIR/<name>.txt (the simulator has no
//                          reliable on-device recognizer), handed out by the
//                          scripted recognizer while that clip is the turn.
//   -callCaptureSpeech     the bot's voice is captured instead of fetched:
//                          each sentence is logged with the voice the call
//                          chose for it and plays as silence for a time
//                          proportional to its length, so barge-in has a
//                          speaking bot to cut.
//
// The test taps the hidden "call-debug-inject" control to say the next
// clip, and reads what was spoken and the call's counters from the hidden
// "call-debug-*" texts. Release builds compile none of this.
#if DEBUG
import AVFoundation
import CompanionCore
import SwiftUI

@MainActor
final class CallDebug: ObservableObject {
    static let shared = CallDebug()

    static var injectDirectory: URL? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-callInjectAudio"), index + 1 < arguments.count else { return nil }
        return URL(fileURLWithPath: arguments[index + 1])
    }

    static var injecting: Bool { injectDirectory != nil }
    /// `-callInjectPlan listening,speaking`: say the next clip the next time
    /// the call reaches each of these phases, in order (a barge-in lands while
    /// the bot is really speaking).
    private var plan: [String] = {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-callInjectPlan"), index + 1 < arguments.count else { return [] }
        return arguments[index + 1].split(separator: ",").map(String.init)
    }()

    /// The call moved to this phase: say the planned clip, after a beat.
    func phaseChanged(_ phase: CallPhase) {
        guard let next = plan.first, next == phase.rawValue else { return }
        plan.removeFirst()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in self?.injectNext() }
    }

    static var capturingSpeech: Bool { ProcessInfo.processInfo.arguments.contains("-callCaptureSpeech") }

    /// "speaker|route|sentence", in the order the call asked for them.
    @Published private(set) var spoken: [String] = []
    /// Counters: sent, interruptBot, cancelled, injected.
    @Published private(set) var counters: [String: Int] = [:]
    /// The words of the clip being said (the scripted recognizer's answer).
    private(set) var currentScript = ""

    private var clips: [(samples: [Float], script: String)] = []
    private var nextClip = 0
    private var pending: [Float] = []
    private var timer: Timer?
    private weak var io: CallAudioIO?
    private var seed: UInt32 = 1

    func count(_ name: String) { counters[name, default: 0] += 1 }

    func record(_ line: String) { spoken.append(line) }

    func reset() {
        spoken = []
        counters = [:]
        currentScript = ""
        nextClip = 0
        pending = []
    }

    /// Load the clips and feed a quiet room (or the next clip) every 32 ms.
    func startFeeding(_ io: CallAudioIO) {
        stopFeeding()
        self.io = io
        if clips.isEmpty, let directory = Self.injectDirectory {
            let files = ((try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? [])
                .filter { $0.pathExtension.lowercased() == "wav" }
                .sorted { $0.lastPathComponent < $1.lastPathComponent }
            for file in files {
                guard let data = try? Data(contentsOf: file), let wav = CallWav.decode(data) else { continue }
                let script = (try? String(contentsOf: file.deletingPathExtension().appendingPathExtension("txt"), encoding: .utf8)) ?? ""
                clips.append((Self.resample(wav.samples, from: wav.sampleRate), script.trimmingCharacters(in: .whitespacesAndNewlines)))
            }
            counters["clips"] = clips.count
        }
        timer = Timer.scheduledTimer(withTimeInterval: CallAudio.frameMs / 1000, repeats: true) { [weak self] _ in
            MainActor.assumeIsolatedCompat {
                guard let self, let io = self.io else { return }
                var frame: [Float]
                if self.pending.count >= CallAudio.frameSamples {
                    frame = Array(self.pending.prefix(CallAudio.frameSamples))
                    self.pending.removeFirst(CallAudio.frameSamples)
                } else {
                    // a quiet room: faint noise, never digital silence
                    frame = (0..<CallAudio.frameSamples).map { _ in
                        self.seed = self.seed &* 1_664_525 &+ 1_013_904_223
                        return (Float(self.seed >> 8) / Float(1 << 24) - 0.5) * 0.0006
                    }
                    if !self.pending.isEmpty { frame.replaceSubrange(0..<self.pending.count, with: self.pending); self.pending = [] }
                }
                io.feed(frame)
            }
        }
    }

    func stopFeeding() {
        timer?.invalidate()
        timer = nil
        pending = []
    }

    /// Say the next clip into the call.
    func injectNext() {
        guard nextClip < clips.count else {
            count("injectEmpty")
            return
        }
        let clip = clips[nextClip]
        nextClip += 1
        currentScript = clip.script
        pending += clip.samples
        count("injected")
    }

    private static func resample(_ samples: [Float], from rate: Int) -> [Float] {
        guard rate != Int(CallAudio.sampleRate), rate > 0 else { return samples }
        let ratio = Double(rate) / CallAudio.sampleRate
        let count = Int(Double(samples.count) / ratio)
        return (0..<count).map { samples[min(samples.count - 1, Int(Double($0) * ratio))] }
    }
}

extension MainActor {
    /// The timer fires on the main run loop.
    static func assumeIsolatedCompat(_ body: @escaping @MainActor () -> Void) {
        if #available(iOS 17.0, *) {
            MainActor.assumeIsolated(body)
        } else {
            DispatchQueue.main.async { body() }
        }
    }
}

/// The bot's voice, captured: which voice was chosen, and silence as long as
/// the sentence would take to say.
@MainActor
final class CapturedSpeechSource: CallSpeechSourcing {
    private let route: (CallSpeaker?) -> [CallVoiceSource]

    init(route: @escaping (CallSpeaker?) -> [CallVoiceSource]) { self.route = route }

    func audio(for text: String, speaker: CallSpeaker?) -> CallSpeechAudio {
        let voice: String = switch route(speaker).first {
        case .xai: "xai"
        case .server: "server"
        case .phoneElevenLabs: "elevenlabs"
        case .device, nil: "device"
        }
        CallDebug.shared.record("\(speaker?.name ?? "")|\(voice)|\(text)")
        let seconds = min(10, max(3, Double(text.count) * 0.1))
        return CallSpeechAudio { continuation in
            let task = Task {
                let rate = 24_000.0
                var left = Int(seconds * rate)
                while left > 0, !Task.isCancelled {
                    let count = min(left, Int(rate / 10))
                    left -= count
                    if let buffer = AVAudioPCMBuffer.mono([Float](repeating: 0, count: count), sampleRate: rate) {
                        continuation.yield(buffer)
                    }
                    try? await Task.sleep(nanoseconds: 20_000_000)
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

/// Hidden controls and readouts the UI tests drive a call with.
struct CallDebugPanel: View {
    @ObservedObject var debug = CallDebug.shared
    @ObservedObject var call: CallController

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Button { debug.injectNext() } label: {
                Text(verbatim: "inject").frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .accessibilityIdentifier("call-debug-inject")
            Text(verbatim: debug.spoken.joined(separator: "\n"))
                .accessibilityIdentifier("call-debug-spoken")
                .accessibilityLabel(Text(verbatim: debug.spoken.joined(separator: "\n")))
            Text(verbatim: call.state.phase.rawValue)
                .accessibilityIdentifier("call-debug-phase")
                .accessibilityLabel(Text(verbatim: call.state.phase.rawValue))
            let counters = debug.counters.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: " ")
            Text(verbatim: counters)
                .accessibilityIdentifier("call-debug-counters")
                .accessibilityLabel(Text(verbatim: counters))
        }
        .font(.system(size: 6))
        .frame(width: 44, alignment: .topLeading)
        .frame(maxHeight: 120, alignment: .top)
        .clipped()
        .opacity(0.1)
    }
}
#endif
