// The composer: held sends, the strips above the field, the field itself,
// and sending. Split out of ChatView.swift unchanged.
import SwiftUI
import CompanionCore
import UIKit

extension ChatView {
    func submit(_ explicitText: String? = nil) {
        // This also cancels an in-flight permission prompt before it can
        // open the microphone after the message has already been sent.
        dictation.stop()
        let draftAtSend = draft
        let text = (explicitText ?? draftAtSend).trimmingCharacters(in: .whitespacesAndNewlines)
        let outgoingAttachments = attachments
        let chatAtSend = current
        let replyAtSend = session.surfaceGate.allows(.replyQuote) ? replyTo : nil
        guard !text.isEmpty || !outgoingAttachments.isEmpty,
              !preparingAttachments,
              !sendingMessage
        else { return }
        // "/hibou98" alone toggles Hibou 98 and is never sent, as on the
        // desktop (src/lib/retro98.ts).
        if outgoingAttachments.isEmpty, text.lowercased() == "/hibou98" {
            draft = ""
            Haptics.selection()
            ThemeStore.shared.toggleRetro(client: session.settingsClient)
            return
        }
        sendingMessage = true
        attachmentError = nil
        showCommandHUD = false
        showingPlus = false
        Task {
            let sent = await session.send(
                text: text,
                attachments: outgoingAttachments,
                to: chatAtSend,
                options: SendOptions(replyToId: replyAtSend?.id)
            )
            sendingMessage = false
            guard sent else {
                let failure = session.actionError ?? "Couldn't send this message. Try again."
                if threadId == chatAtSend.threadId { attachmentError = failure }
                else { threadDrafts[chatAtSend.threadId]?.error = failure }
                session.actionError = nil
                return
            }
            // The quote was sent: it leaves with the words, unless another
            // one was picked while the send was in flight.
            if threadId != chatAtSend.threadId {
                if let replyAtSend, threadDrafts[chatAtSend.threadId]?.replyTo?.id == replyAtSend.id {
                    threadDrafts[chatAtSend.threadId]?.replyTo = nil
                }
                if threadDrafts[chatAtSend.threadId]?.text == draftAtSend { threadDrafts[chatAtSend.threadId]?.text = "" }
                if threadDrafts[chatAtSend.threadId]?.attachments.map(\.id) == outgoingAttachments.map(\.id) {
                    threadDrafts[chatAtSend.threadId]?.attachments = []
                }
                return
            }
            // HUD commands expand `/diff` into a longer prompt. Compare with
            // what was actually in the field at tap time, not the expanded
            // text, so the command clears without erasing a newer edit.
            if draft == draftAtSend {
                draft = ""
            }
            if let replyAtSend, replyTo?.id == replyAtSend.id {
                replyTo = nil
            }
            if attachments.map(\.id) == outgoingAttachments.map(\.id) {
                attachments = []
            }
            SoundEffects.playSent()
            Haptics.impact(.medium)
        }
    }

    // MARK: - Composer

    /// Pull a held send back into the composer to tweak or extend it. The
    /// computer drops it from the queue first; only a confirmed removal hands
    /// the words back, so a send that already joined the turn is never resent.
    func editQueued(_ send: QueuedSend) {
        let targetThread = threadId
        let chat = current
        Task {
            guard await session.cancelQueued(send, threadId: targetThread, in: chat) else { return }
            if threadId == targetThread {
                draft = send.editDraft(keeping: draft)
                composerFocused = true
            } else {
                // The person switched tasks while the cancel was in flight.
                var snapshot = threadDrafts[targetThread] ?? ComposerSnapshot()
                snapshot.text = send.editDraft(keeping: snapshot.text)
                threadDrafts[targetThread] = snapshot
            }
        }
    }

    /// A round + and a glass pill with dictation and send inside it.
    var composer: some View {
        VStack(spacing: 6) {
            composerAccessories

            HStack(alignment: .bottom, spacing: Theme.Chat.composerGap) {
                // "+": 44 pt glass circle. Attachments, threads, slash
                // commands and the rest live in the sheet it opens.
                Button {
                    dictation.stop()
                    composerFocused = false
                    withAnimation(.snappy(duration: 0.28)) { showingPlus.toggle() }
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 20.5, weight: .medium))
                        .foregroundStyle(showingPlus ? Theme.primaryInk : Theme.textPrimary)
                        .rotationEffect(.degrees(showingPlus ? 45 : 0))
                        .frame(width: Theme.Metric.glassLarge, height: Theme.Metric.glassLarge)
                        .background(Circle().fill(showingPlus ? Theme.primaryFill : Color.clear))
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .themeGlass(Circle())
                .chatGlassRim(Circle())
                .disabled(preparingAttachments || sendingMessage)
                .accessibilityLabel(showingPlus ? "Close" : "More")
                .accessibilityIdentifier("composer-plus")

                // The field: "Ask {name}", the mic (dictation) and the white
                // capsule (voice mode, or send once there is something to send).
                HStack(alignment: .bottom, spacing: 0) {
                    TextField(
                        "",
                        text: $draft,
                        prompt: Text(composerPrompt).foregroundColor(Theme.composerPlaceholder),
                        axis: .vertical
                    )
                        .lineLimit(1...5)
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.textPrimary)
                        .padding(.leading, 16.6)
                        .padding(.top, 12.35)
                        .padding(.bottom, 13.65)
                        .focused($composerFocused)
                        .accessibilityIdentifier("message-input")
                        // Partial transcripts rebuild from a frozen base;
                        // prevent competing edits without dimming the text.
                        .allowsHitTesting(
                            !dictation.isListening && !dictation.isStarting
                                && !preparingAttachments && !sendingMessage
                        )
                        .onValueChange(of: draft) { value in
                            withAnimation(.easeInOut(duration: 0.15)) {
                                showCommandHUD = value.hasPrefix("/")
                            }
                        }
                        // The software keyboard's Return inserts a newline,
                        // like Messages; only the send button sends. A
                        // hardware Return still sends, Shift-Return breaks
                        // the line. onKeyPress never sees the software
                        // keyboard, so this cannot turn its Return into a send.
                        .onHardwareReturn { submit() }

                    Button {
                        composerFocused = false
                        dictation.toggle(capturing: draft)
                    } label: {
                        MicGlyph()
                            .fill(dictation.isListening ? Theme.danger : Theme.composerMic)
                            .frame(width: MicGlyph.size.width, height: MicGlyph.size.height)
                            .frame(width: 32, height: Theme.Metric.glassLarge)
                            .contentShape(Rectangle())
                            .pulseCompat(isActive: dictation.isListening)
                    }
                    .buttonStyle(.plain)
                    .disabled(preparingAttachments || sendingMessage)
                    .padding(.trailing, 6.3)
                    .accessibilityLabel(dictation.isListening ? "Stop dictation" : "Start dictation")

                    ComposerVoiceSendButton(
                        canSend: canSend,
                        busy: preparingAttachments || sendingMessage,
                        send: { submit() },
                        voice: startVoiceMode
                    )
                    .padding(.trailing, 9.3)
                    .padding(.bottom, (Theme.Metric.glassLarge - Theme.Chat.voiceCapsule.height) / 2)
                }
                .frame(minHeight: Theme.Metric.glassLarge)
                // 22 pt corners: a capsule at one line that keeps its
                // corners as the draft grows, the way Messages does.
                .themeGlass(RoundedRectangle(cornerRadius: 22, style: .continuous), interactive: false)
                .chatGlassRim(RoundedRectangle(cornerRadius: 22, style: .continuous))
            }
        }
        .padding(.leading, Theme.Chat.composerLeading)
        .padding(.trailing, Theme.Chat.composerInset)
        .padding(.top, Self.composerTopPadding)
        .padding(.bottom, composerFocused ? 8 : Theme.Chat.composerBottom)
        .frame(maxWidth: CompanionLayout.chatWidth)
        .frame(maxWidth: .infinity)
    }

    var composerPrompt: String {
        if sendingMessage { return String(localized: "Sending…") }
        if dictation.isListening { return String(localized: "Listening…") }
        return String(localized: "Ask \(current.name)")
    }
}
