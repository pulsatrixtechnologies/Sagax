// One voice call in the thread: a quiet line, or the spoken lines inside
// a card. Thumbs use the message reaction route on the first person line.
import SwiftUI
import UIKit
import CompanionCore

struct VoiceCallCard: View {
    let chat: Chat
    let card: VoiceCallCardModel
    var forceOpen: Bool
    @EnvironmentObject private var session: Session
    @ObservedObject private var call = CallController.shared
    @State private var open: Bool
    @State private var copied = false
    @State private var pending: Thumb?
    @State private var posting = false

    private enum Thumb: String { case up, down }

    init(chat: Chat, card: VoiceCallCardModel, forceOpen: Bool) {
        self.chat = chat
        self.card = card
        self.forceOpen = forceOpen
        _open = State(initialValue: forceOpen)
    }

    var body: some View {
        Group {
            if ticking {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    cardBody(now: context.date)
                }
            } else {
                cardBody(now: Date())
            }
        }
        .onValueChange(of: forceOpen) { value in
            if value { open = true }
        }
    }

    private var ticking: Bool {
        guard call.active, call.callId == card.callId else { return false }
        return call.callClocks[card.callId]?.endedAt == nil
    }

    private func cardBody(now: Date) -> some View {
        let heading = "\(String(localized: "voiceCall.title")) · \(duration(now: now))"
        return VStack(alignment: .leading, spacing: open ? 12 : 0) {
            if open {
                expandedBar(heading)
                lines
            } else {
                collapsedRow(heading)
            }
        }
        .padding(.horizontal, open ? 12 : 0)
        .padding(.vertical, open ? 8 : 2)
        .background(open ? Color.primary.opacity(0.04) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            if open {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.08))
            }
        }
    }

    private func collapsedRow(_ heading: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "waveform")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Button { open = true } label: {
                Text(heading)
                    .font(.system(size: 13))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(heading)
            thumbs
        }
    }

    private func expandedBar(_ heading: String) -> some View {
        HStack(spacing: 8) {
            Menu {
                Button(copied ? String(localized: "voiceCall.copied") : String(localized: "voiceCall.copy")) {
                    copyTranscript()
                }
            } label: {
                Image(systemName: "ellipsis")
                    .frame(width: 28, height: 28)
            }
            .accessibilityLabel(String(localized: "voiceCall.menu"))
            Text(heading)
                .font(.system(size: 13))
                .lineLimit(1)
                .frame(maxWidth: .infinity)
            thumbs
            Button { open = false } label: {
                Image(systemName: "xmark")
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(String(localized: "voiceCall.collapse"))
        }
    }

    private var lines: some View {
        let shown = displayedLines
        return VStack(alignment: .leading, spacing: 10) {
            if shown.isEmpty {
                Text(String(localized: "voiceCall.empty"))
                    .font(.system(size: 12.5))
                    .foregroundStyle(.secondary)
            }
            ForEach(shown, id: \.id) { line in
                VStack(alignment: .leading, spacing: 2) {
                    Text(speaker(line))
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                    Text(line.text)
                        .font(.system(size: 13))
                        .foregroundStyle(.primary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .id(line.id)
            }
        }
    }

    private var thumbs: some View {
        HStack(spacing: 2) {
            thumb(.up, symbol: "hand.thumbsup", label: String(localized: "voiceCall.up"))
            thumb(.down, symbol: "hand.thumbsdown", label: String(localized: "voiceCall.down"))
        }
    }

    private func thumb(_ side: Thumb, symbol: String, label: String) -> some View {
        let chosen = pending ?? storedThumb
        return Button {
            Task { await choose(side) }
        } label: {
            Image(systemName: chosen == side ? "\(symbol).fill" : symbol)
                .font(.system(size: 14))
                .foregroundStyle(chosen == side ? Color.accentColor : Color.secondary)
                .frame(width: 28, height: 28)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(chosen == side ? AccessibilityTraits.isSelected : AccessibilityTraits())
    }

    private var storedThumb: Thumb? {
        guard let anchor else { return nil }
        let mine = (anchor.reactions ?? []).filter { $0.by == "user" && ($0.emoji == "👍" || $0.emoji == "👎") }
        guard let last = mine.last else { return nil }
        return last.emoji == "👍" ? .up : .down
    }

    private var anchor: Message? {
        card.messages.first { $0.role == .user && !$0.id.hasPrefix("optimistic-") }
    }

    private var you: String { String(localized: "voiceCall.you") }

    private func speaker(_ line: SpokenLine) -> String {
        line.role == .user ? you : (line.name ?? chat.name)
    }

    private var displayedLines: [SpokenLine] {
        var shown = spokenLines(card.messages)
        guard open, call.active, call.callId == card.callId else { return shown }
        let heard = call.heard.trimmingCharacters(in: .whitespacesAndNewlines)
        let caption = call.caption.trimmingCharacters(in: .whitespacesAndNewlines)
        let streaming = (session.state.streaming[chat.threadId] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let botLine = caption.isEmpty ? streaming : caption
        if !heard.isEmpty, shown.last?.text != heard {
            shown.append(SpokenLine(id: "live-heard", role: .user, text: heard))
        }
        if !botLine.isEmpty, shown.last?.text != botLine {
            shown.append(SpokenLine(id: "live-caption", role: .bot, text: botLine))
        }
        return shown
    }

    private func duration(now: Date) -> String {
        let record = call.callClocks[card.callId]
        let clock = record.map {
            VoiceCallClockSpan(
                startedAt: $0.startedAt.timeIntervalSince1970 * 1000,
                endedAt: $0.endedAt.map { $0.timeIntervalSince1970 * 1000 }
            )
        }
        return formatVoiceCallDuration(voiceCallDurationMs(card.messages, now: now.timeIntervalSince1970 * 1000, clock: clock))
    }

    private func copyTranscript() {
        let text = voiceCallTranscriptText(
            displayedLines.filter { !$0.id.hasPrefix("live-") },
            you: you,
            bot: chat.name
        )
        UIPasteboard.general.string = text
        copied = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
    }

    private func choose(_ side: Thumb) async {
        let want = (pending ?? storedThumb) == side ? nil : side
        guard let anchor, !posting else {
            pending = want
            return
        }
        pending = want
        posting = true
        defer { posting = false; pending = nil }
        let emoji = side == .up ? "👍" : "👎"
        let mine = (anchor.reactions ?? []).filter { $0.by == "user" && ($0.emoji == "👍" || $0.emoji == "👎") }
        if want == nil {
            for reaction in mine {
                await session.react(to: anchor, in: chat.threadId, emoji: reaction.emoji)
            }
            return
        }
        for reaction in mine where reaction.emoji != emoji {
            await session.react(to: anchor, in: chat.threadId, emoji: reaction.emoji)
        }
        if !mine.contains(where: { $0.emoji == emoji }) {
            await session.react(to: anchor, in: chat.threadId, emoji: emoji)
        }
    }
}
