// The composer: held sends, the strips above the field, the field itself,
// and sending. Split out of ChatView.swift unchanged.
import SwiftUI
import CompanionCore
import UIKit

extension ChatView {
    /// Send the draft (or a quick reply's words). While a one-to-one
    /// conversation works, the send first asks what it should do (after,
    /// steer, parallel) unless `busyMode` already says; a failed send is
    /// kept above the field with Retry (WP3).
    func submit(_ explicitText: String? = nil, busyMode chosen: BusySendMode? = nil) {
        // This also cancels an in-flight permission prompt before it can
        // open the microphone after the message has already been sent.
        dictation.stop()
        let draftAtSend = draft
        let text = (explicitText ?? draftAtSend).trimmingCharacters(in: .whitespacesAndNewlines)
        let outgoingAttachments = attachments
        let chatAtSend = current
        let pastesAtSend = explicitText == nil ? power.pastes(chatAtSend.threadId) : []
        let replyAtSend = session.surfaceGate.allows(.replyQuote) ? replyTo : nil
        guard !text.isEmpty || !outgoingAttachments.isEmpty || !pastesAtSend.isEmpty,
              !preparingAttachments,
              !sendingMessage
        else { return }
        // "/hibou98" alone toggles Hibou 98 and is never sent, as on the
        // desktop (src/lib/retro98.ts).
        if outgoingAttachments.isEmpty, pastesAtSend.isEmpty, text.lowercased() == "/hibou98" {
            draft = ""
            Haptics.selection()
            ThemeStore.shared.toggleRetro(client: session.settingsClient)
            return
        }
        // A room's typed "/goal …" runs as a bounded team goal.
        var words = text
        var goal = false
        if case let .room(room) = chatAtSend, room.dm != true, let goalText = goalTextFromComposer(text) {
            guard !goalText.isEmpty || !outgoingAttachments.isEmpty || !pastesAtSend.isEmpty else { return }
            words = goalText
            goal = true
        }
        // Resolvable "#Title" runs leave as canonical links, then the pastes.
        let requestText = PastedText.compose(
            ThreadRefs.serialize(words, threads: session.threadRefCandidates, currentBotId: chatAtSend.id),
            pastes: pastesAtSend
        )
        var busyMode: BusySendMode?
        if BusySendChoice.offered(for: chatAtSend), session.surfaceGate.allows(.busySendChoice) {
            guard let chosen else {
                withAnimation(.easeInOut(duration: 0.15)) {
                    power.busyChoice = (chatAtSend.threadId, BusySendChoice.suggest(requestText))
                }
                return
            }
            busyMode = chosen
        }
        power.busyChoice = nil
        sendingMessage = true
        attachmentError = nil
        power.commandMenuForced = false
        showingPlus = false
        let options = SendOptions(replyToId: replyAtSend?.id, busyMode: busyMode, goal: goal)
        Task {
            let sent = await session.send(
                text: requestText,
                attachments: outgoingAttachments,
                to: chatAtSend,
                options: options
            )
            sendingMessage = false
            guard sent else {
                let failure = session.actionError ?? String(localized: "Couldn't send this message. Try again.")
                session.actionError = nil
                // Kept with Retry; the words also stay in the field, so
                // either sends them (the same send id: never twice).
                power.remember(FailedSend(
                    text: text, requestText: requestText, attachments: outgoingAttachments,
                    replyToId: replyAtSend?.id, busyMode: busyMode, goal: goal,
                    threadId: chatAtSend.threadId, error: failure
                ))
                return
            }
            // A send that went through settles an earlier failure of the
            // same words.
            for failed in power.failedSends(chatAtSend.threadId) where failed.requestText == requestText {
                power.forget(failed)
            }
            power.clearPastes(pastesAtSend.map(\.id), threadId: chatAtSend.threadId)
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
            // Compare with what was actually in the field at tap time, not
            // the sent text, so the send clears without erasing a newer edit.
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
                power.pasteCheckSuppressed = true
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
                        .onValueChangePair(of: draft) { old, new in
                            withAnimation(.easeInOut(duration: 0.15)) {
                                draftChanged(from: old, to: new)
                            }
                        }
                        // The software keyboard's Return inserts a newline,
                        // like Messages; only the send button sends. A
                        // hardware Return still sends, Shift-Return breaks
                        // the line. onKeyPress never sees the software
                        // keyboard, so this cannot turn its Return into a send.
                        .onHardwareReturn { submit(busyMode: openBusyChoice) }

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
        // the "/" menu reads the engine's commands once it opens
        .task(id: commandLoadKey) { await loadCommands() }
        // Steer needs to know whether the running engine takes words live
        .task(id: heldSends.isEmpty) {
            if !heldSends.isEmpty { await power.load(botIds: [], threadId: nil, groupId: nil, session: session) }
        }
    }

    var composerPrompt: String {
        if sendingMessage { return String(localized: "Sending…") }
        if dictation.isListening { return String(localized: "Listening…") }
        return String(localized: "Ask \(current.name)")
    }
}
