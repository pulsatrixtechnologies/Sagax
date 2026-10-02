// The call's screens, ported from the desktop:
//
// - CallPillView: voice mode's pill (src/components/voice-mode/VoiceModeBar.tsx),
//   centred under the bot's name capsule: the bot's face, a dotted live
//   waveform, then Settings, Transcript, Mic and the red X. Settings or
//   Transcript expand it downward into a card of the same width that hangs
//   over the thread (the settings of VoiceModeSettingsPanel.tsx, with Hold;
//   the transcript as bubbles, the live line last).
// - GroupCallOverlay: a room's call (src/components/GroupCallView.tsx): every
//   member's face in a row, the one speaking or working in focus, the room's
//   name and state, what is being said, Interrupt and Hang up.
import CompanionCore
import SwiftUI

// MARK: - Colors of the call (the desktop's tokens on the app's Theme)

private enum CallTheme {
    static let elevated = Theme.card
    static let raised = Theme.pill
    static let inset = Theme.chip
    static let hairline = Theme.hairline
    static let ink = Theme.textPrimary
    static let inkSecondary = Theme.textSecondary
    static let inkTertiary = Theme.textTertiary
    static let accent = Theme.blue
    static let danger = Color(red: 0.89, green: 0.27, blue: 0.27)
    static let warning = Color(red: 0.96, green: 0.65, blue: 0.24)
}

extension CallState {
    /// The face the bot wears for each state (VoiceModeBar's BotAvatar state).
    var mascot: MausState {
        switch phase {
        case .listening, .hearing: .listening
        case .speaking: .sending
        case .thinking, .interrupted: .thinking
        default: .working
        }
    }
}

// MARK: - The pill

struct CallPillView: View {
    let bot: Bot
    @ObservedObject var call: CallController
    @EnvironmentObject private var session: Session
    @State private var panel: Panel?
    @State private var list: CallSettingsPanel.List?

    enum Panel { case settings, transcript }

    private var status: String { CallController.phaseLabel(call.state) }
    private var line: String {
        switch call.state.phase {
        case .hearing, .interrupted: call.heard
        case .speaking: call.caption
        default: ""
        }
    }
    private var alert: Bool { call.note != nil || call.notice != nil }
    private var expanded: Bool { panel != nil || alert }

    var body: some View {
        VStack(spacing: 0) {
            row
            if expanded {
                Rectangle().fill(CallTheme.hairline.opacity(0.6)).frame(height: 0.5)
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            if panel == .settings {
                                CallSettingsPanel(call: call, open: $list)
                                holdButton
                            }
                            if panel == .transcript {
                                CallTranscriptPanel(bot: bot, call: call, status: status, line: line)
                            }
                            alerts
                            Color.clear.frame(height: 1).id("call-card-bottom")
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                    }
                    .frame(maxHeight: min(UIScreen.main.bounds.height * 0.55, 360))
                    .fixedSize(horizontal: false, vertical: true)
                    .onValueChange(of: panel == .transcript ? "\(session.state.visibleTranscript(forThread: call.threadId).count)|\(line)" : "") { _ in
                        if panel == .transcript { proxy.scrollTo("call-card-bottom", anchor: .bottom) }
                    }
                }
                .accessibilityIdentifier("call-card")
            }
        }
        .frame(maxWidth: 420)
        .background(CallTheme.elevated, in: RoundedRectangle(cornerRadius: expanded ? 22 : 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: expanded ? 22 : 24, style: .continuous).strokeBorder(CallTheme.hairline.opacity(0.7), lineWidth: 0.5))
        .shadow(color: .black.opacity(0.28), radius: 14, y: 8)
        .animation(.easeOut(duration: 0.15), value: expanded)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(String(localized: "Voice call with \(bot.name)")))
        .accessibilityIdentifier("call-pill")
        .onValueChange(of: panel) { open in
            if open == .settings { call.loadVoices() }
        }
    }

    private var row: some View {
        HStack(spacing: 6) {
            Button {
                if call.state.botAudible { call.interrupt() }
            } label: {
                BotMascotView(bot: bot, size: 30, state: call.state.mascot, animated: true)
                    .frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(call.state.botAudible ? Text(String(localized: "Interrupt")) : Text(bot.name))
            .accessibilityIdentifier("call-avatar")

            // the state, for VoiceOver and the tests
            Text(verbatim: line.isEmpty ? status : line)
                .font(.system(size: 1))
                .opacity(0.01)
                .frame(width: 1, height: 1)
                .accessibilityLabel(Text(verbatim: line.isEmpty ? status : line))
                .accessibilityIdentifier("call-status")

            CallWaveform(call: call)
                .frame(maxWidth: .infinity)
                .frame(height: 24)
                .padding(.horizontal, 2)

            HStack(spacing: 6) {
                if call.callSettings.input == .push { pushButton }
                round(systemImage: "gearshape", label: String(localized: "Voice settings"), id: "call-settings", selected: panel == .settings) {
                    toggle(.settings)
                }
                Button { toggle(.transcript) } label: {
                    Image(systemName: "text.bubble")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(panel == .transcript ? Theme.bg : CallTheme.inkSecondary)
                        .frame(width: 32, height: 32)
                        .background(panel == .transcript ? CallTheme.ink : CallTheme.raised, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(String(localized: "Transcript")))
                .accessibilityIdentifier("call-transcript-toggle")
                Button {
                    Haptics.selection()
                    call.setMuted(!call.state.muted)
                } label: {
                    Image(systemName: call.state.muted ? "mic.slash" : "mic")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(call.state.muted ? CallTheme.danger : CallTheme.inkSecondary)
                        .frame(width: 32, height: 32)
                        .background(CallTheme.raised, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(call.state.muted ? Text(String(localized: "Unmute microphone")) : Text(String(localized: "Mute microphone")))
                .accessibilityAddTraits(call.state.muted ? .isSelected : [])
                .accessibilityIdentifier("call-mute")
                Button {
                    Haptics.impact(.medium)
                    call.end()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color.white)
                        .frame(width: 32, height: 32)
                        .background(CallTheme.danger, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(String(localized: "End voice mode")))
                .accessibilityIdentifier("call-end")
            }
        }
        .padding(.horizontal, 8)
        .frame(height: 48)
    }

    private var pushButton: some View {
        Image(systemName: "hand.raised")
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(call.state.phase == .hearing ? Color.white : CallTheme.inkSecondary)
            .frame(width: 32, height: 32)
            .background(call.state.phase == .hearing ? CallTheme.accent : CallTheme.raised, in: Circle())
            .opacity(call.state.muted || call.state.phase == .held ? 0.4 : 1)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in if call.state.phase != .hearing { call.pushToTalk(true) } }
                    .onEnded { _ in call.pushToTalk(false) }
            )
            .accessibilityElement()
            .accessibilityLabel(Text(String(localized: "Hold to talk")))
            .accessibilityIdentifier("call-ptt")
    }

    private func round(systemImage: String, label: String, id: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(selected ? CallTheme.ink : CallTheme.inkSecondary)
                .frame(width: 32, height: 32)
                .background(CallTheme.raised, in: Circle())
                .overlay(Circle().strokeBorder(selected ? CallTheme.ink.opacity(0.4) : .clear, lineWidth: 2))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
        .accessibilityIdentifier(id)
    }

    private func toggle(_ next: Panel) {
        Haptics.selection()
        withAnimation(.easeOut(duration: 0.15)) { panel = panel == next ? nil : next }
        list = nil
    }

    private var holdButton: some View {
        let held = call.state.phase == .held
        return Button {
            held ? call.resume() : call.hold()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: held ? "play.fill" : "pause.fill").font(.system(size: 12))
                Text(held ? String(localized: "Resume the call") : String(localized: "Put the call on hold"))
                    .font(.system(size: 13))
            }
            .foregroundStyle(held ? CallTheme.warning : CallTheme.ink)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 7)
            .background(CallTheme.raised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .padding(.bottom, 4)
        .accessibilityIdentifier("call-hold")
    }

    @ViewBuilder
    private var alerts: some View {
        if let note = call.note {
            HStack(spacing: 8) {
                Text(note).font(.system(size: 12.5)).foregroundStyle(CallTheme.warning)
                Spacer(minLength: 4)
                Button(String(localized: "Try again")) { call.retry() }
                    .font(.system(size: 12))
                    .foregroundStyle(CallTheme.warning)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 3)
                    .overlay(Capsule().strokeBorder(CallTheme.warning.opacity(0.4)))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(CallTheme.warning.opacity(0.1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(.vertical, 4)
            .accessibilityIdentifier("call-note")
        } else if let notice = call.notice {
            Text(notice)
                .font(.system(size: 12.5))
                .foregroundStyle(CallTheme.inkSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(CallTheme.raised.opacity(0.6), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .padding(.vertical, 4)
                .onTapGesture { call.dismissNotice() }
                .accessibilityIdentifier("call-notice")
        }
    }
}

// MARK: - The waveform

/// Both sides of the call as a row of dots: each column grows taller and
/// brighter with the loudest side at that point (the bot's voice in the
/// accent, the person's in ink); a quiet line is one dim dot per column.
struct CallWaveform: View {
    @ObservedObject var call: CallController
    @State private var history = WaveHistory()

    private static let dot: CGFloat = 4
    private static let rows = 5

    var body: some View {
        let quiet = call.state.phase == .held || call.state.phase == .connecting
        let muted = call.state.muted
        TimelineView(.animation(minimumInterval: 1 / 30)) { timeline in
            Canvas { context, size in
                let columns = max(1, Int(size.width / Self.dot))
                let levels = call.levels
                history.push(mic: quiet || muted ? 0 : levels.mic, bot: quiet ? 0 : levels.bot, columns: columns)
                let time = timeline.date.timeIntervalSinceReferenceDate
                let middle = size.height / 2
                let offset = (size.width - CGFloat(columns - 1) * Self.dot) / 2
                for i in 0..<columns {
                    let theirs = history.bot[i]
                    let mine = history.mic[i]
                    let shimmer = quiet ? 0 : 0.08 * abs(sin(time * 1000 / 600 + Double(i) * 0.45))
                    let level = Double(max(theirs, mine))
                    let reach = Int((level * Double(Self.rows - 1) / 2).rounded())
                    let color = theirs >= mine && level > 0.05 ? CallTheme.accent : CallTheme.ink
                    for row in -reach...reach {
                        let alpha = min(1, 0.22 + shimmer + level * 0.75 - Double(abs(row)) * 0.08)
                        let center = CGPoint(x: offset + CGFloat(i) * Self.dot, y: middle + CGFloat(row) * Self.dot)
                        context.fill(Path(ellipseIn: CGRect(x: center.x - 1.1, y: center.y - 1.1, width: 2.2, height: 2.2)), with: .color(color.opacity(alpha)))
                    }
                }
            }
        }
        .accessibilityHidden(true)
    }
}

/// The levels of the last columns, newest on the right.
final class WaveHistory {
    private(set) var mic: [Float] = []
    private(set) var bot: [Float] = []

    func push(mic level: Float, bot output: Float, columns: Int) {
        if mic.count != columns {
            mic = Array(repeating: 0, count: columns)
            bot = Array(repeating: 0, count: columns)
        }
        mic.removeFirst()
        bot.removeFirst()
        mic.append(min(1, level * 9))
        bot.append(min(1, output * 9))
    }
}

// MARK: - Settings (VoiceModeSettingsPanel)

struct CallSettingsPanel: View {
    enum List { case voice, speed, language }

    @ObservedObject var call: CallController
    @Binding var open: List?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if call.voiceModeAvailable {
                row(String(localized: "Voice"), value: voiceName, list: .voice)
                if open == .voice { voiceList }
                row(String(localized: "Speed"), value: VoiceModeSettings.speedLabel(call.voiceSettings.speed), list: .speed)
                if open == .speed {
                    options(VoiceModeSettings.speeds.map { (String($0), VoiceModeSettings.speedLabel($0)) }, selected: String(call.voiceSettings.speed)) {
                        call.voiceSettings.speed = Double($0) ?? 1
                    }
                }
            }
            row(String(localized: "Language"), value: languageName, list: .language)
            if open == .language {
                ScrollView {
                    options(VoiceModeSettings.languages.map { ($0.code, $0.code == "auto" ? String(localized: "Auto-detect") : $0.label) }, selected: call.voiceSettings.language) {
                        call.voiceSettings.language = $0
                    }
                }
                .frame(maxHeight: 224)
            }
            Rectangle().fill(CallTheme.hairline.opacity(0.5)).frame(height: 0.5).padding(.vertical, 6)
            HStack {
                Text(String(localized: "Microphone")).font(.system(size: 13)).foregroundStyle(CallTheme.inkSecondary)
                Spacer()
                Picker(String(localized: "Microphone"), selection: $call.callSettings.input) {
                    Text(String(localized: "Hands-free")).tag(CallSettings.Input.auto)
                    Text(String(localized: "Push to talk")).tag(CallSettings.Input.push)
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 200)
                .accessibilityIdentifier("call-input")
            }
            .padding(.vertical, 6)
            Toggle(isOn: $call.callSettings.earcons) {
                Text(String(localized: "Call sounds")).font(.system(size: 13)).foregroundStyle(CallTheme.inkSecondary)
            }
            .tint(Theme.toggleOn)
            .padding(.vertical, 4)
            .accessibilityIdentifier("call-earcons")
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 8)
    }

    private var voiceName: String {
        let id = call.voiceSettings.voice
        guard !id.isEmpty else { return String(localized: "Not set") }
        return call.voices?.first { $0.id == id }?.label ?? id
    }

    private var languageName: String {
        call.voiceSettings.language == "auto" ? String(localized: "Auto-detect") : VoiceModeSettings.languageLabel(call.voiceSettings.language)
    }

    private func row(_ label: String, value: String, list: List) -> some View {
        HStack(spacing: 12) {
            Text(label).font(.system(size: 13)).foregroundStyle(CallTheme.inkSecondary)
            Spacer()
            Button {
                withAnimation(.easeOut(duration: 0.12)) { open = open == list ? nil : list }
            } label: {
                HStack(spacing: 8) {
                    Text(value).lineLimit(1)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .rotationEffect(.degrees(open == list ? 180 : 0))
                }
                .font(.system(size: 13))
                .foregroundStyle(CallTheme.ink)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .frame(minWidth: 136)
                .background(CallTheme.raised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("call-list-\(list)")
        }
        .padding(.vertical, 6)
    }

    private var voiceList: some View {
        ScrollView {
            VStack(spacing: 0) {
                option(id: "", label: String(localized: "Not set"), selected: call.voiceSettings.voice.isEmpty) { call.voiceSettings.voice = "" }
                if call.voices == nil && call.voicesError == nil {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text(String(localized: "Loading voices")).font(.system(size: 12.5)).foregroundStyle(CallTheme.inkTertiary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                }
                if let error = call.voicesError {
                    Text(error).font(.system(size: 12.5)).foregroundStyle(CallTheme.danger).padding(8)
                }
                ForEach(call.voices ?? []) { voice in
                    HStack(spacing: 8) {
                        Button { call.preview(voice) } label: {
                            Image(systemName: call.previewing == voice.id ? "stop.fill" : "play.fill")
                                .font(.system(size: 10))
                                .foregroundStyle(CallTheme.inkSecondary)
                                .frame(width: 24, height: 24)
                                .background(CallTheme.raised, in: Circle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(String(localized: "Preview \(voice.label)")))
                        option(id: voice.id, label: voice.label, selected: call.voiceSettings.voice == voice.id) {
                            call.voiceSettings.voice = voice.id
                        }
                    }
                }
            }
            .padding(4)
        }
        .frame(maxHeight: 224)
        .background(Theme.bg, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(CallTheme.hairline.opacity(0.6)))
    }

    private func options(_ values: [(String, String)], selected: String, choose: @escaping (String) -> Void) -> some View {
        VStack(spacing: 0) {
            ForEach(values, id: \.0) { value in
                option(id: value.0, label: value.1, selected: value.0 == selected) { choose(value.0) }
            }
        }
        .padding(4)
        .background(Theme.bg, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(CallTheme.hairline.opacity(0.6)))
    }

    private func option(id: String, label: String, selected: Bool, choose: @escaping () -> Void) -> some View {
        Button {
            choose()
            withAnimation(.easeOut(duration: 0.12)) { open = nil }
        } label: {
            HStack {
                Text(label).font(.system(size: 13)).foregroundStyle(CallTheme.ink).lineLimit(1)
                Spacer()
                if selected { Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(CallTheme.accent) }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(selected ? CallTheme.raised.opacity(0.6) : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// MARK: - Transcript

struct CallTranscriptPanel: View {
    let bot: Bot
    @ObservedObject var call: CallController
    let status: String
    let line: String
    @EnvironmentObject private var session: Session

    private struct Entry: Identifiable {
        let id: String
        let you: Bool
        let text: String
        let interrupted: Bool
    }

    private var entries: [Entry] {
        session.state.visibleTranscript(forThread: call.threadId)
            .filter { $0.kind == .text && !($0.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .suffix(8)
            .map { Entry(id: $0.id, you: $0.role == .user, text: ($0.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines), interrupted: call.interrupted.contains($0.id)) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(bot.name).lineLimit(1)
                Spacer()
                TimelineView(.periodic(from: call.startedAt, by: 1)) { context in
                    Text(verbatim: "\(formatCallTime(context.date.timeIntervalSince(call.startedAt))) · \(status)")
                        .monospacedDigit()
                        .accessibilityIdentifier("call-timer")
                }
            }
            .font(.system(size: 11.5))
            .foregroundStyle(CallTheme.inkTertiary)
            let entries = entries
            if entries.isEmpty && line.isEmpty {
                Text(String(localized: "Nothing said yet.")).font(.system(size: 13)).foregroundStyle(CallTheme.inkTertiary)
            } else {
                VStack(spacing: 6) {
                    ForEach(entries) { entry in
                        bubble(entry.text, you: entry.you, interrupted: entry.interrupted)
                            .accessibilityIdentifier(entry.you ? "call-line-you" : "call-line-bot")
                    }
                    if !line.isEmpty {
                        bubble(line, you: call.state.phase != .speaking, interrupted: false)
                            .opacity(0.7)
                            .accessibilityIdentifier("call-line-live")
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("call-transcript")
    }

    private func bubble(_ text: String, you: Bool, interrupted: Bool) -> some View {
        HStack {
            if you { Spacer(minLength: 40) }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(text).font(.system(size: 13)).foregroundStyle(CallTheme.ink)
                if interrupted {
                    Text(String(localized: "interrupted"))
                        .font(.system(size: 11))
                        .foregroundStyle(CallTheme.inkTertiary)
                        .padding(.horizontal, 4)
                        .background(CallTheme.elevated.opacity(0.6), in: RoundedRectangle(cornerRadius: 4))
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(you ? CallTheme.raised : CallTheme.inset, in: UnevenBubble(you: you))
            if !you { Spacer(minLength: 40) }
        }
    }
}

/// A bubble with the tail corner tucked (rounded-2xl with br-md / bl-md).
private struct UnevenBubble: Shape {
    let you: Bool
    func path(in rect: CGRect) -> Path {
        let big: CGFloat = 16, small: CGFloat = 6
        let tl = big, tr = big, bl = you ? big : small, br = you ? small : big
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + tl, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - tr, y: rect.minY))
        path.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.minY), tangent2End: CGPoint(x: rect.maxX, y: rect.minY + tr), radius: tr)
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - br))
        path.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.maxY), tangent2End: CGPoint(x: rect.maxX - br, y: rect.maxY), radius: br)
        path.addLine(to: CGPoint(x: rect.minX + bl, y: rect.maxY))
        path.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.maxY), tangent2End: CGPoint(x: rect.minX, y: rect.maxY - bl), radius: bl)
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + tl))
        path.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.minY), tangent2End: CGPoint(x: rect.minX + tl, y: rect.minY), radius: tl)
        path.closeSubpath()
        return path
    }
}

// MARK: - A room's call (GroupCallView)

struct GroupCallOverlay: View {
    let room: Room
    @ObservedObject var call: CallController
    @EnvironmentObject private var session: Session

    private var members: [Bot] { room.memberIds.compactMap { session.state.bot($0) } }
    private var workingMember: Bot? { room.busyBotId.flatMap { id in members.first { $0.id == id } } }
    private var speakingMember: Bot? { call.speakingMemberId.flatMap { id in members.first { $0.id == id } } }

    private var status: String {
        let state = call.state
        if state.phase == .held { return String(localized: "On hold") }
        if state.muted { return String(localized: "Muted") }
        switch state.phase {
        case .connecting: return String(localized: "Connecting")
        case .listening, .hearing, .interrupted:
            return call.callSettings.input == .push ? String(localized: "Push to talk") : String(localized: "Listening")
        case .speaking:
            return String(localized: "\(speakingMember?.name ?? String(localized: "Group member")) is speaking")
        default:
            if let workingMember { return String(localized: "\(workingMember.name) is working") }
            return String(localized: "Bringing the group in")
        }
    }

    private var working: Bool { [.thinking].contains(call.state.phase) }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Theme.bg.opacity(0.96).ignoresSafeArea()
            VStack(spacing: 24) {
                Spacer(minLength: 0)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .bottom, spacing: 12) {
                        ForEach(members) { member in memberCard(member) }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .frame(minWidth: UIScreen.main.bounds.width)
                }
                VStack(spacing: 6) {
                    Text(room.name).font(.system(size: 20, weight: .medium)).foregroundStyle(CallTheme.ink)
                    HStack(spacing: 8) {
                        if working { ProgressView().controlSize(.small).tint(CallTheme.inkSecondary) }
                        Text(status).font(.system(size: 13.5)).foregroundStyle(CallTheme.inkSecondary)
                            .accessibilityIdentifier("call-status")
                    }
                }
                caption
                    .frame(minHeight: 56)
                    .padding(.horizontal, 24)
                if let note = call.note ?? call.notice {
                    VStack(spacing: 8) {
                        Text(note).font(.system(size: 12.5)).foregroundStyle(CallTheme.warning).multilineTextAlignment(.center)
                        if call.note != nil {
                            Button(String(localized: "Try microphone again")) { call.retry() }
                                .font(.system(size: 12))
                                .foregroundStyle(CallTheme.warning)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .overlay(Capsule().strokeBorder(CallTheme.warning.opacity(0.4)))
                        }
                    }
                    .padding(.horizontal, 32)
                }
                HStack(spacing: 12) {
                    if call.state.botAudible {
                        Button(String(localized: "Interrupt")) { call.interrupt() }
                            .font(.system(size: 13.5))
                            .foregroundStyle(CallTheme.ink)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .overlay(Capsule().strokeBorder(CallTheme.hairline))
                            .accessibilityIdentifier("call-interrupt")
                    }
                    Button { call.setMuted(!call.state.muted) } label: {
                        Image(systemName: call.state.muted ? "mic.slash.fill" : "mic.fill")
                            .font(.system(size: 15))
                            .foregroundStyle(call.state.muted ? CallTheme.danger : CallTheme.ink)
                            .frame(width: 40, height: 40)
                            .background(CallTheme.raised, in: Circle())
                    }
                    .accessibilityLabel(call.state.muted ? Text(String(localized: "Unmute microphone")) : Text(String(localized: "Mute microphone")))
                    .accessibilityIdentifier("call-mute")
                    Button {
                        Haptics.impact(.medium)
                        call.end()
                    } label: {
                        Label(String(localized: "Hang up"), systemImage: "phone.down.fill")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Color.white)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 10)
                            .background(CallTheme.danger, in: Capsule())
                    }
                    .accessibilityIdentifier("call-end")
                }
                Text(String(localized: "Say a member's name to direct the turn · Talk over a member to interrupt"))
                    .font(.system(size: 11.5))
                    .foregroundStyle(CallTheme.inkTertiary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                Spacer(minLength: 0)
            }
            Button {
                call.end()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(CallTheme.inkSecondary)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel(Text(String(localized: "Hang up")))
            .padding(.top, 8)
            .padding(.trailing, 12)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("group-call")
    }

    @ViewBuilder
    private var caption: some View {
        switch call.state.phase {
        case .listening, .hearing, .interrupted:
            if call.heard.isEmpty {
                Text(String(localized: "Say a name, say \u{201C}everyone,\u{201D} or just talk to the group…"))
                    .foregroundStyle(CallTheme.inkSecondary)
            } else {
                Text(call.heard).foregroundStyle(CallTheme.ink)
            }
        case .speaking:
            Text(call.caption).foregroundStyle(CallTheme.ink)
        default:
            Text(workingMember == nil ? "" : String(localized: "You'll hear each response in turn."))
                .foregroundStyle(CallTheme.inkSecondary)
        }
    }

    private func memberCard(_ member: Bot) -> some View {
        let focused = member.id == (speakingMember?.id ?? workingMember?.id)
        let state: MausState = speakingMember?.id == member.id
            ? .sending
            : workingMember?.id == member.id ? .working
            : [.listening, .hearing].contains(call.state.phase) ? .listening
            : MausState.normalize(member.mascotExpression) ?? .happy
        return VStack(spacing: 8) {
            BotMascotView(bot: member, size: 94, state: state, animated: true)
            Text(member.name)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(focused ? CallTheme.ink : CallTheme.inkSecondary)
        }
        .frame(width: 124)
        .padding(.vertical, 12)
        .padding(.horizontal, 2)
        .background(focused ? CallTheme.raised.opacity(0.7) : .clear, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: focused ? .black.opacity(0.3) : .clear, radius: 10, y: 4)
        .scaleEffect(focused ? 1.05 : 1)
        .opacity(focused ? 1 : 0.75)
        .animation(.easeOut(duration: 0.2), value: focused)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(focused ? "call-member-focused" : "call-member")
    }
}
