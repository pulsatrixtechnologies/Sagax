// The strips above the composer field: failed sends, held sends, progress,
// errors, the "/" menu, "@"/"#" suggestions or quick replies, the pending
// attachments and pastes, the busy-send choice. One seam for the strips the
// parity packages add (reply quote, find bar, suggestions: WP1, WP3, WP4;
// WP4's citation chips sit above the pastes).
import SwiftUI
import CompanionCore

extension ChatView {
    @ViewBuilder
    var composerAccessories: some View {
        runCard

        ForEach(power.failedSends(threadId)) { failure in
            FailedSendBanner(
                failure: failure,
                retrying: power.retrying.contains(failure.id),
                retry: { retry(failure) },
                dismiss: { withAnimation(.easeInOut(duration: 0.15)) { power.forget(failure) } }
            )
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }

        if !heldSends.isEmpty {
            QueuedSendList(
                sends: heldSends,
                isRoom: !current.isBot,
                steering: power.steering.contains(threadId),
                steerInterrupts: canSteerLive == false,
                steer: canSteerHeld ? { steerHeld() } : nil,
                edit: editQueued
            ) { send in
                Task { await session.cancelQueued(send, threadId: threadId, in: current) }
            }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }

        if preparingAttachments || sendingMessage {
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                Text(preparingAttachments ? "Preparing attachments…" : "Sending…")
                    .font(.system(size: 13, weight: .medium))
            }
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
            .accessibilityElement(children: .combine)
        }

        if let openingFileName {
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                Text("Opening \(openingFileName)…")
                    .font(.system(size: 13, weight: .medium))
                    .lineLimit(1)
            }
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
            .accessibilityElement(children: .combine)
        }

        if let error = fileOpenError ?? attachmentError {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(Theme.warning)
                Text(error)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                Button("Dismiss") {
                    fileOpenError = nil
                    attachmentError = nil
                }
                .font(.system(size: 13, weight: .semibold))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(Theme.warning.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
            .accessibilityElement(children: .combine)
        }

        if let error = dictation.error {
            Text(error)
                .font(.system(size: 13))
                .foregroundStyle(Theme.warning)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 4)
        }

        let menuItems = desktopChat == nil ? slashMenuItems : []
        let suggestions = desktopChat == nil ? suggestionItems : []
        if desktopChat != nil {
            // the desktop pill floats these (desktopComposerPopup)
        } else if slashContext != nil, !menuItems.isEmpty || power.loadingCommands {
            ComposerCommandMenuView(
                items: menuItems,
                loading: power.loadingCommands,
                accent: MausPalette.color(current.color),
                refresh: commandTargets.contains { power.commands(botId: $0.member.id, threadId: threadId, groupId: current.isBot ? nil : current.id)?.available == true }
                    ? { Task { await loadCommands(refresh: true) } } : nil,
                close: closeCommandMenu,
                pick: pickCommand
            )
            .transition(.move(edge: .bottom).combined(with: .opacity))
        } else if !suggestions.isEmpty {
            SuggestionStrip(items: suggestions, pick: pickSuggestion)
                .transition(.opacity)
        } else if composerFocused && draft.isEmpty && attachments.isEmpty && !current.busy
                    && !hasPendingApproval && !storedChips.isEmpty {
            // Quick replies while the keyboard is up: the resting
            // screen is the reference's bare composer.
            PredictiveActionChipsView(chips: storedChips, accentColor: MausPalette.color(current.color)) { chip in
                submit(chip.prompt)
            }
            .transition(.opacity)
        }

        // Quoted selections waiting for this send (CO8, WP4).
        let quoted = citations.citations(threadId)
        if !quoted.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(quoted) { citation in
                        let thread = threadId
                        CitationChip(
                            citation: citation,
                            onChange: { citations.replace($0, threadId: thread) },
                            onRemove: {
                                guard !sendingMessage else { return }
                                citations.remove(citation.id, threadId: thread)
                            }
                        )
                    }
                }
                .padding(.horizontal, 2)
            }
            .scrollClipDisabledCompat()
            .accessibilityIdentifier("composer-citations")
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }

        let pastes = power.pastes(threadId)
        if !pastes.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 8) {
                    ForEach(pastes) { paste in
                        PastedTextChip(paste: paste, display: { displayPaste(paste) }) {
                            guard !sendingMessage else { return }
                            power.remove(paste, threadId: threadId)
                        }
                    }
                }
                .padding(.horizontal, 2)
            }
            .scrollClipDisabledCompat()
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }

        if !attachments.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(attachments) { attachment in
                        PendingAttachmentChip(attachment: attachment) {
                            guard !preparingAttachments, !sendingMessage else { return }
                            attachments.removeAll { $0.id == attachment.id }
                            attachmentError = nil
                        }
                    }
                }
                .padding(.horizontal, 2)
            }
            .scrollClipDisabledCompat()
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }

        approvalDock

        replyStrip

        if let choice = openBusyChoice {
            BusySendChooserView(
                name: busyName,
                highlighted: choice,
                pick: { submit(busyMode: $0) },
                close: { withAnimation(.easeInOut(duration: 0.15)) { power.busyChoice = nil } }
            )
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}
