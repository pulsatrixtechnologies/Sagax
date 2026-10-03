// The strips above the composer field: held sends, progress, errors, the
// slash-command HUD or quick replies, and the pending attachments. One seam
// for the strips the parity packages add (reply quote, find bar, suggestions:
// WP1, WP3, WP4); drawn exactly as when they were inline in the composer.
import SwiftUI
import CompanionCore

extension ChatView {
    @ViewBuilder
    var composerAccessories: some View {
        if !heldSends.isEmpty {
            QueuedSendList(sends: heldSends, edit: editQueued) { send in
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

        if showCommandHUD {
            CommandSkillHUDView(
                text: $draft,
                isVisible: $showCommandHUD,
                commands: current.isBot
                    ? CommandSkillHUDView.defaultCommands
                    : CommandSkillHUDView.defaultCommands.filter {
                        $0.id != "computer" && (current.supportsTasks || $0.id != "tasks")
                    },
                accentColor: MausPalette.color(current.color)
            ) { command in
                switch command.id {
                case "computer":
                    draft = ""
                    showingComputer = true
                case "tasks":
                    draft = ""
                    showingTasks = true
                default: submit(command.command)
                }
            }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        } else if composerFocused && draft.isEmpty && attachments.isEmpty && !current.busy
                    && !hasPendingApproval && !storedChips.isEmpty {
            // Quick replies while the keyboard is up: the resting
            // screen is the reference's bare composer.
            PredictiveActionChipsView(chips: storedChips, accentColor: MausPalette.color(current.color)) { chip in
                submit(chip.prompt)
            }
            .transition(.opacity)
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
    }
}
