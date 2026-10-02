// A live call with a bot or a room, as on the desktop's voice mode
// (src/components/voice-mode/LiveCall.tsx, GroupCallView.tsx): a phone call.
// The microphone stays open, the person can talk over the bot, and the bot's
// answer is spoken sentence by sentence while it is written.
//
// The BOT answers: every accepted turn is an ordinary message through the
// normal send route (its engine, instructions, memory, tools, approvals, and
// the transcript in the thread), marked as a call turn (`voiceCall`) so the
// server gives it the hidden phone-call instruction. The phone only hears
// (on-device recognition) and reads the bot's own words aloud with the voice
// the desktop would use for that bot.
//
// LiveCallEngine (CompanionCore) decides; CallConversation decides what to
// say about the thread; this object runs the devices (CallAudioIO, the
// recognizer, the player, CallKit) and talks to the Session.
import AVFoundation
import Combine
import CompanionCore
import SwiftUI

@MainActor
final class CallController: ObservableObject {
    static let shared = CallController()

    /// A call that could not start: the server's access card (voice mode on
    /// an organization server), or why there is no call here.
    struct Unavailable: Identifiable, Equatable {
        let id = UUID()
        let title: String
        let lines: [String]
        let keysUrl: URL?
    }

    @Published private(set) var target: Chat?
    @Published private(set) var state = CallState.initial
    /// The words recognized so far in the person's turn.
    @Published private(set) var heard = ""
    /// The bot's sentence now audible.
    @Published private(set) var caption = ""
    @Published private(set) var note: String?
    @Published private(set) var notice: String?
    @Published private(set) var startedAt = Date()
    @Published private(set) var interrupted: Set<String> = []
    /// A room: the member whose voice is audible.
    @Published private(set) var speakingMemberId: String?
    @Published var unavailable: Unavailable?
    @Published private(set) var voiceModeAvailable = false
    @Published private(set) var voices: [VoiceModeVoice]?
    @Published private(set) var voicesError: String?
    @Published private(set) var previewing: String?
    @Published private(set) var recognizerName = ""

    @Published var voiceSettings: VoiceModeSettings {
        didSet {
            guard voiceSettings != oldValue else { return }
            UserDefaults.standard.set(voiceSettings.encoded, forKey: VoiceModeSettings.storageKey)
            syncVoiceSettings()
        }
    }

    @Published var callSettings: CallSettings {
        didSet { UserDefaults.standard.set(callSettings.encoded, forKey: CallSettings.storageKey) }
    }

    private(set) var threadId = ""
    private weak var session: Session?
    private var engine: LiveCallEngine?
    private var io: CallAudioIO?
    private var player: CallSpeechPlayer?
    private var recognizer: CallRecognizer?
    private var callKit: CallKitBridge?
    private var conversation = CallConversation(existing: [])
    private var stateSink: AnyCancellable?
    private var observers: [NSObjectProtocol] = []
    private var callId = ""
    private var devicesStarted = false
    private var lastBusy: Bool?
    private var members: [Bot] = []
    private var organization = false
    private var previewVoice: String?

    private init() {
        voiceSettings = VoiceModeSettings.decode(UserDefaults.standard.string(forKey: VoiceModeSettings.storageKey))
        callSettings = CallSettings.decode(UserDefaults.standard.string(forKey: CallSettings.storageKey))
    }

    var active: Bool { target != nil }

    func isOnCall(_ chat: Chat) -> Bool { target?.id == chat.id }

    var levels: (mic: Float, bot: Float) { (io?.micLevel ?? 0, io?.outputLevel ?? 0) }

    private var injecting: Bool {
        #if DEBUG
        CallDebug.injecting
        #else
        false
        #endif
    }

    // MARK: - Starting and ending

    /// Call this chat (the composer's call button). A second call ends the first.
    func start(_ chat: Chat, session: Session) async {
        if isOnCall(chat) { return }
        if active { end() }
        guard let client = session.callClient else {
            unavailable = Unavailable(title: String(localized: "Call unavailable"), lines: [String(localized: "This computer is offline.")], keysUrl: nil)
            return
        }
        self.session = session
        let isRoom: Bool
        if case .room = chat { isRoom = true } else { isRoom = false }

        // the server decides, every time (desktop VoiceModeCallButton)
        var status: VoiceModeStatus?
        if case let .bot(bot) = chat { status = try? await client.voiceModeStatus(botId: bot.id) }
        organization = status?.organization == true
        if case let .bot(bot) = chat, status?.organization == true, status?.available != true {
            unavailable = Self.refusal(status?.refusal, botName: bot.name)
            return
        }
        if isRoom, session.connection?.pairedWithServer == true, await roomOnOrganization(session: session, client: client) {
            unavailable = Unavailable(
                title: String(localized: "Voice mode unavailable"),
                lines: [String(localized: "On an organization server, voice mode talks with one bot at a time: open a bot's conversation to call it.")],
                keysUrl: nil
            )
            return
        }
        voiceModeAvailable = status?.available == true
        let config = await session.configStatus()
        if organization { await seedVoiceSettings(client) }

        target = chat
        threadId = chat.threadId
        CallQuiet.shared.set(threadId, live: true)
        state = .initial
        heard = ""
        caption = ""
        note = nil
        notice = nil
        interrupted = []
        speakingMemberId = nil
        voices = nil
        voicesError = nil
        startedAt = Date()
        callId = "call-" + UUID().uuidString.lowercased()
        devicesStarted = false
        lastBusy = nil
        members = []
        if case let .room(room) = chat { members = room.memberIds.compactMap { session.state.bot($0) } }
        conversation = CallConversation(existing: session.state.visibleTranscript(forThread: threadId), room: isRoom)
        #if DEBUG
        if injecting { CallDebug.shared.reset() }
        #endif

        // the ears
        let recognizer = CallRecognizer()
        recognizer.onPartial = { [weak self] text in self?.heard = text }
        #if DEBUG
        if injecting { recognizer.useScript { CallDebug.shared.currentScript } }
        #endif
        if !injecting {
            guard await MicrophonePermission.request() else {
                unavailable = Unavailable(title: String(localized: "Call unavailable"), lines: [String(localized: "Allow microphone access for Sagax in Settings, then try again.")], keysUrl: nil)
                CallQuiet.shared.set(threadId, live: false)
                target = nil
                return
            }
            let upload: (([Float]) async throws -> String)? = voiceModeAvailable && !isRoom ? { [weak self] samples in
                guard let self, case let .bot(bot)? = self.target else { return "" }
                return try await client.voiceModeTranscribe(botId: bot.id, wav: CallWav.encode(samples), language: self.voiceSettings.language, threadId: self.threadId)
            } : nil
            let ready = await recognizer.prepare(locales: voiceSettings.recognitionLocales(), upload: upload)
            guard target?.id == chat.id else { return }
            if !ready { note = String(localized: "Speech recognition isn't available for this language. Allow Speech Recognition in Settings, then try again.") }
        }
        recognizerName = recognizer.engine.rawValue

        // the voice
        let io = CallAudioIO()
        let botVoice: String? = if case let .bot(bot) = chat { bot.voice } else { nil }
        let route: (CallSpeaker?) -> [CallVoiceSource] = { speaker in
            CallVoiceSource.route(
                voiceMode: isRoom ? nil : status,
                config: config,
                agentVoice: speaker?.voice ?? botVoice,
                phoneKey: WalkieVoiceKey.read() != nil
            )
        }
        let source: CallSpeechSourcing
        #if DEBUG
        if CallDebug.capturingSpeech {
            source = CapturedSpeechSource(route: route)
        } else {
            source = routedSource(client: client, chat: chat, route: route)
        }
        #else
        source = routedSource(client: client, chat: chat, route: route)
        #endif
        let player = CallSpeechPlayer(io: io, source: source)
        if case let .bot(bot) = chat { player.speaker = CallSpeaker(id: bot.id, name: bot.name, voice: bot.voice) }

        let engine = LiveCallEngine(transcriber: recognizer, player: player, settings: { [weak self] in self?.callSettings ?? .default })
        wire(engine)
        player.onSentenceStart = { [weak self, weak engine] text, speaker in
            engine?.playerSentenceStarted(text)
            if isRoom { self?.speakingMemberId = speaker?.id }
        }
        player.onIdle = { [weak self, weak engine] in
            engine?.playerIdle()
            self?.speakingMemberId = nil
        }
        player.onError = { [weak self] _ in
            self?.notice = String(localized: "The voice didn't come through. The answer is in the chat.")
        }
        io.onFrame = { [weak engine] frame in engine?.frame(frame) }
        self.io = io
        self.player = player
        self.engine = engine
        self.recognizer = recognizer
        VoiceNoteCenter.shared.beginInputOwnership(.call)
        observeAudioSession()

        stateSink = session.$state.sink { [weak self] state in
            // @Published sends the new value before it is stored: read this one
            DispatchQueue.main.async { self?.observe(state) }
        }

        // the call itself: CallKit, or the audio session directly
        let bridge = CallKitBridge()
        bridge.onActivate = { [weak self] in self?.activateDevices() }
        bridge.onEnd = { [weak self] in self?.end(fromSystem: true) }
        bridge.onMute = { [weak self] muted in self?.engine?.setMuted(muted) }
        bridge.onHold = { [weak self] held in held ? self?.engine?.hold() : self?.engine?.resume() }
        callKit = bridge
        let placed = injecting ? false : await bridge.start(name: chat.name)
        guard target?.id == chat.id else { return }
        if placed {
            // the system activates the session for the call; if it never says
            // so (a busy route), start anyway
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
                guard let self, self.target?.id == chat.id, !self.devicesStarted else { return }
                try? AVAudioSession.sharedInstance().setActive(true)
                self.activateDevices()
            }
        } else {
            callKit = nil
            do {
                try CallAudioIO.configureSession()
                try AVAudioSession.sharedInstance().setActive(true)
            } catch {
                note = String(localized: "No microphone could be opened. Check that one is connected and not in use.")
            }
            activateDevices()
        }
    }

    private func routedSource(client: CompanionClient, chat: Chat, route: @escaping (CallSpeaker?) -> [CallVoiceSource]) -> CallSpeechSourcing {
        let botId: String? = if case let .bot(bot) = chat { bot.id } else { nil }
        let routed = RoutedSpeechSource(
            client: client,
            botId: botId,
            threadId: { [weak self] in self?.threadId },
            routes: route,
            settings: { [weak self] in
                guard let self else { return .default }
                var settings = self.voiceSettings
                if let preview = self.previewVoice { settings.voice = preview }
                return settings
            }
        )
        return routed
    }

    private func activateDevices() {
        guard let io, let engine, !devicesStarted, target != nil else { return }
        devicesStarted = true
        do {
            try io.start(capture: !injecting)
        } catch {
            note = String(localized: "No microphone could be opened. Check that one is connected and not in use.")
            engine.failed()
            return
        }
        engine.connected()
        callKit?.connected()
        #if DEBUG
        if injecting { CallDebug.shared.startFeeding(io) }
        #endif
        if let session { observe(session.state) }
    }

    /// Hang up (the red X, CallKit's end button, or another call).
    func end(fromSystem: Bool = false) {
        guard target != nil else { return }
        CallQuiet.shared.set(threadId, live: false)
        engine?.end()
        if !fromSystem { callKit?.end() }
        callKit = nil
        stateSink = nil
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers = []
        #if DEBUG
        CallDebug.shared.stopFeeding()
        #endif
        let io = self.io
        let wasCallKit = fromSystem
        // the end tone first
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
            io?.stop()
            if !wasCallKit { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
            VoiceNoteCenter.shared.endInputOwnership(.call)
        }
        engine = nil
        player = nil
        recognizer = nil
        self.io = nil
        target = nil
        state = CallState(phase: .ended)
        heard = ""
        caption = ""
        speakingMemberId = nil
    }

    // MARK: - Controls

    func setMuted(_ muted: Bool) {
        engine?.setMuted(muted)
        callKit?.setMuted(muted)
    }

    func hold() {
        engine?.hold()
        callKit?.setHeld(true)
    }

    func resume() {
        engine?.resume()
        callKit?.setHeld(false)
    }

    /// The avatar while the bot speaks: it stops talking.
    func interrupt() { engine?.interrupt() }

    func pushToTalk(_ down: Bool) { engine?.pushToTalk(down) }

    func retry() {
        note = nil
        guard let io, !io.running else { return }
        devicesStarted = false
        activateDevices()
    }

    func dismissNotice() {
        notice = nil
        note = nil
    }

    /// xAI's voices, for the settings' Voice list.
    func loadVoices() {
        guard voices == nil, voiceModeAvailable, case let .bot(bot)? = target, let client = session?.callClient else { return }
        Task {
            do { voices = try await client.voiceModeVoices(botId: bot.id) }
            catch { voicesError = error.localizedDescription }
        }
    }

    /// Hear a voice before picking it.
    func preview(_ voice: VoiceModeVoice) {
        guard let engine else { return }
        if previewing == voice.id {
            engine.interrupt()
            previewing = nil
            previewVoice = nil
            return
        }
        engine.interrupt()
        previewing = voice.id
        previewVoice = voice.id
        Task {
            await engine.say(String(localized: "Hi, I'm \(voice.label). This is how I sound."))
            if previewing == voice.id { previewing = nil }
            previewVoice = nil
        }
    }

    // MARK: - The engine's events

    private func wire(_ engine: LiveCallEngine) {
        engine.events.state = { [weak self] next in
            self?.state = next
            #if DEBUG
            CallDebug.shared.phaseChanged(next.phase)
            #endif
        }
        engine.events.caption = { [weak self] text in self?.caption = text }
        engine.events.microphone = { [weak self] open in self?.io?.micOpen = open }
        engine.events.rejected = { _ in }
        engine.events.speechCancelled = { [weak self] in
            guard let self else { return }
            self.caption = ""
            self.conversation.speechCancelled(currentStream: self.session?.state.streaming[self.threadId])
            #if DEBUG
            CallDebug.shared.count("cancelled")
            #endif
        }
        engine.events.interruptBot = { [weak self] in
            guard let self, let session = self.session, let target = self.target else { return }
            guard self.conversation.mayInterruptBot(busy: self.lastBusy ?? false) else { return }
            #if DEBUG
            CallDebug.shared.count("interruptBot")
            #endif
            let threadId = self.threadId
            Task {
                switch target {
                case let .bot(bot): await session.interruptQuietly(botId: bot.id, threadId: threadId)
                case let .room(room): await session.interrupt(room: room)
                }
            }
        }
        engine.events.utterance = { [weak self] text, interrupted in self?.utterance(text, interrupted: interrupted) }
    }

    private func utterance(_ text: String, interrupted: Bool) {
        guard let session, let target, let engine, let client = session.callClient else { return }
        heard = ""
        notice = nil
        let mentionsOnly: Bool = if case let .room(room) = target { room.defaultResponder.kind == "mentions" } else { false }
        let action = conversation.utterance(text, memberNames: members.map(\.name), mentionsOnly: mentionsOnly)
        let threadId = self.threadId
        switch action {
        case let .decide(requestId, allow):
            resync()
            Task {
                do {
                    _ = try await client.respond(threadId: threadId, requestId: requestId, behavior: allow ? "allow" : "deny", message: allow ? nil : "Denied by the user, on a call.")
                } catch {
                    if let prompt = conversation.decisionFailed(requestId: requestId) { await engine.say(self.words(prompt)) }
                }
            }
        case let .answer(requestId, _, words):
            resync()
            Task { _ = try? await client.respond(threadId: threadId, requestId: requestId, behavior: "answer", message: words) }
        case let .say(prompt):
            resync()
            Task { await engine.say(self.words(prompt)) }
        case .needsName:
            resync()
            let names = members.map(\.name).joined(separator: ", ")
            notice = names.isEmpty ? String(localized: "Say a member's name, or say everyone.") : String(localized: "Say a member's name (\(names)), or say everyone.")
        case let .send(words):
            #if DEBUG
            CallDebug.shared.count("sent")
            #endif
            Task {
                let sent: Bool
                switch target {
                case let .bot(bot):
                    let language = voiceSettings.language
                    sent = await session.sendCallTurn(words, to: bot, threadId: threadId, voiceCall: VoiceCallMeta(callId: callId, interrupted: interrupted, language: language))
                case let .room(room):
                    await session.send(words, to: .room(room))
                    sent = session.actionError == nil
                }
                if !sent, self.target?.id == target.id {
                    self.note = session.actionError ?? String(localized: "That didn't come through. Try again.")
                    session.actionError = nil
                    self.resync()
                }
            }
        }
    }

    /// After a turn that started no run, follow the bot's real state again.
    private func resync() {
        engine?.setBotBusy(lastBusy ?? false)
    }

    // MARK: - The thread, as it changes

    private func observe(_ state: CompanionState) {
        guard let target, let engine, let player else { return }
        let messages = state.visibleTranscript(forThread: threadId)
        let busy: Bool
        let name: String
        switch target {
        case let .bot(bot):
            busy = state.bot(bot.id)?.projected(forThread: threadId)?.busy ?? false
            name = bot.name
        case let .room(room):
            let live = state.rooms.first { $0.id == room.id }
            busy = live?.busyBotId != nil
            name = room.name
            members = (live?.memberIds ?? room.memberIds).compactMap { state.bot($0) }
        }
        if busy != lastBusy {
            lastBusy = busy
            engine.setBotBusy(busy)
        }
        if let live = conversation.stream(state.streaming[threadId]) {
            engine.replyProgress(live)
        }
        let actions = conversation.settle(messages: messages, botName: name, thinking: engine.state.phase == .thinking, playerBusy: player.busy)
        interrupted = conversation.interrupted
        for action in actions {
            switch action {
            case let .say(prompt, speakerId):
                player.speaker = speaker(speakerId)
                engine.speakNow(words(prompt))
            case let .replyDone(text, speakerId):
                player.speaker = speaker(speakerId)
                engine.replyDoneNow(text)
            case let .reply(text, speakerId):
                player.speaker = speaker(speakerId)
                engine.speakNow(SpokenText.spokenPart(text))
            case let .narrate(text, speakerId):
                player.speaker = speaker(speakerId)
                engine.speakNow(text)
            }
        }
    }

    private func speaker(_ id: String?) -> CallSpeaker? {
        switch target {
        case let .bot(bot)?:
            return CallSpeaker(id: bot.id, name: bot.name, voice: bot.voice)
        case .room?:
            guard let id, let index = members.firstIndex(where: { $0.id == id }) else { return nil }
            let member = members[index]
            return CallSpeaker(id: member.id, name: member.name, voice: member.voice, index: index)
        case nil:
            return nil
        }
    }

    // MARK: - Words the call says on its own

    func words(_ prompt: CallPrompt) -> String {
        switch prompt {
        case let .approval(requester, kind, tool, title, detail, updating):
            switch kind {
            case .skill:
                return updating
                    ? String(localized: "\(requester) wants to update a learned skill. Open this chat to review it first. You can say no to deny it.")
                    : String(localized: "\(requester) wants to enable a learned skill. Open this chat to review it first. You can say no to deny it.")
            case .routine, .profile:
                let line = title.trimmingCharacters(in: .whitespacesAndNewlines)
                return String(localized: "\(requester) asks: \(line) Review it on screen. Should I confirm it?")
            case .command:
                let action: String = switch tool {
                case "Bash", "shell": String(localized: "run a command")
                case "Read": String(localized: "read a file")
                case "Write", "Edit", "edit": String(localized: "change a file")
                default: String(localized: "use \(tool)")
                }
                let shown = String(detail.trimmingCharacters(in: .whitespacesAndNewlines).prefix(160))
                return String(localized: "\(requester) wants to \(action). \(shown). Should I allow it?")
            }
        case let .question(requester, subtitle, options):
            let detail = subtitle.trimmingCharacters(in: .whitespacesAndNewlines)
            let end = detail.last.map { ".!?".contains($0) } == true ? "" : "."
            let choices = options.isEmpty ? "" : " " + options.joined(separator: ", ") + "."
            if case .room = target { return String(localized: "\(requester) asks: \(detail)\(end)\(choices)") }
            return "\(detail)\(end)\(choices)"
        case .yesOrNo:
            return String(localized: "Sorry, is that a yes or a no?")
        case .skillReview:
            return String(localized: "Open this chat to review the complete skill before enabling it. You can say no now to deny it.")
        case .approvalFailed:
            return String(localized: "I couldn't save that decision. Please try again.")
        }
    }

    // MARK: - Interruptions and routes

    private func observeAudioSession() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let raw = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue
            let options = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? NSNumber)?.uintValue ?? 0
            DispatchQueue.main.async {
                guard let self, self.callKit == nil else { return } // CallKit sends its own hold
                if raw == AVAudioSession.InterruptionType.began.rawValue {
                    self.engine?.hold()
                } else if AVAudioSession.InterruptionOptions(rawValue: options).contains(.shouldResume) {
                    try? AVAudioSession.sharedInstance().setActive(true)
                    self.io?.restart()
                    self.engine?.resume()
                }
            }
        })
        observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: .main) { [weak self] _ in
            // AirPods in or out, a Bluetooth headset: the engine starts over on the new route
            DispatchQueue.main.async { self?.io?.restart() }
        })
    }

    // MARK: - Settings that travel (organization servers)

    private func seedVoiceSettings(_ client: CompanionClient) async {
        guard UserDefaults.standard.string(forKey: VoiceModeSettings.storageKey) == nil,
              let preferences = try? await client.preferences(),
              let raw = preferences.preferences[VoiceModeSettings.storageKey] else { return }
        voiceSettings = VoiceModeSettings.decode(raw)
    }

    private func syncVoiceSettings() {
        guard organization, let client = session?.callClient else { return }
        let encoded = voiceSettings.encoded
        Task {
            guard var preferences = try? await client.preferences().preferences else { return }
            preferences[VoiceModeSettings.storageKey] = encoded
            _ = try? await client.putPreferences(preferences)
        }
    }

    private func roomOnOrganization(session: Session, client: CompanionClient) async -> Bool {
        guard let anyBot = session.state.bots.first else { return false }
        return (try? await client.voiceModeStatus(botId: anyBot.id))?.organization == true
    }

    private static func refusal(_ refusal: VoiceModeRefusal?, botName: String) -> Unavailable {
        let cause = refusal?.cause ?? "no_credentials"
        var lines: [String]
        switch cause {
        case "payer_disabled": lines = [String(localized: "Your account is disabled: voice mode can't run.")]
        case "perspicax_unreachable": lines = [String(localized: "Perspicax could not be reached to read your xAI key. Try again in a moment.")]
        default:
            lines = [String(localized: "You don't have xAI access for voice mode: add your xAI key in Perspicax.")]
            if refusal?.admin == true { lines.append(String(localized: "As an administrator, you can also add the organization's xAI key in Settings > Connections on the computer.")) }
        }
        return Unavailable(title: String(localized: "Voice mode unavailable"), lines: lines, keysUrl: refusal?.keysUrl.flatMap(URL.init(string:)))
    }

    /// What the bar says for each state of the call (desktop phaseLabel).
    static func phaseLabel(_ state: CallState) -> String {
        if state.phase == .held { return String(localized: "On hold") }
        if state.muted { return String(localized: "Muted") }
        switch state.phase {
        case .connecting: return String(localized: "Connecting")
        case .listening: return String(localized: "Listening")
        case .hearing: return String(localized: "Listening to you")
        case .thinking: return String(localized: "Thinking")
        case .speaking: return String(localized: "Speaking")
        case .interrupted: return String(localized: "Interrupted")
        case .held, .ended: return ""
        }
    }
}
