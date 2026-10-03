// The approval dock (feature parity CA2-CA5, PendingApproval.tsx): an open
// permission ask does not wait in the transcript to be noticed, it sits on
// the composer. One request at a time with an "n of N" stepper, the detail
// in a monospace block that scrolls instead of truncating, "Allow all
// read-only (N)" when several reads wait, and the decisions ordered
// least-destructive-last so the primary sits under the thumb: Cancel turn,
// Deny, the one remembering choice that applies, Allow once.
//
// Layout-agnostic: it takes the conversation and its open asks, so the
// iPhone mounts it above the composer and the iPad's desktop chat can mount
// the same view in its own composer.
import SwiftUI
import CompanionCore

struct ApprovalDock: View {
    @Environment(\.themePalette) var themePalette
    let chat: Chat
    /// This conversation's open asks, then its parallel tasks' (oldest first).
    let approvals: [PendingApproval]
    @EnvironmentObject private var session: Session
    @State private var requestId: String?
    @State private var answering = false

    private var tint: Color { MausPalette.color(chat.color) }

    var body: some View {
        if !approvals.isEmpty {
            let index = ApprovalDockRules.stepperIndex(approvals, requestId: requestId)
            let pending = approvals[index]
            let readOnly = ApprovalDockRules.readOnly(approvals)
            VStack(alignment: .leading, spacing: 9) {
                if let title = pending.parallelTitle {
                    Label(String(localized: "Parallel task · \(title)"), systemImage: "arrow.triangle.branch")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.attentionSecondary)
                        .lineLimit(1)
                }
                HStack(alignment: .top, spacing: 8) {
                    Text(heading(pending))
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.attentionText)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("approval-dock-title")
                    Spacer(minLength: 4)
                    if approvals.count > 1 {
                        VStack(alignment: .trailing, spacing: 3) {
                            stepper(index: index)
                            if readOnly.count > 1 {
                                Button {
                                    Haptics.selection()
                                    run { await session.allowAll(readOnly, in: chat) }
                                } label: {
                                    Text("Allow all read-only (\(readOnly.count))")
                                        .font(.system(size: 12.5, weight: .semibold))
                                        .foregroundStyle(Theme.readable(tint))
                                }
                                .buttonStyle(.plain)
                                .disabled(answering)
                                .accessibilityHint(Text("Allows only the waiting requests that just read data"))
                                .accessibilityIdentifier("approval-allow-read-only")
                            }
                        }
                    }
                }

                if let detail = ApprovalHeading.detail(pending.card) {
                    ScrollView(.vertical) {
                        Text(detail)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(Theme.attentionText)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityIdentifier("approval-dock-detail")
                    }
                    .frame(maxHeight: 120)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(Theme.inset, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }

                if let held = pending.card.held, !held.isEmpty {
                    Label(held, systemImage: "exclamationmark.shield")
                        .font(.system(size: 12.5))
                        .foregroundStyle(Theme.warning)
                        .fixedSize(horizontal: false, vertical: true)
                }

                actions(pending)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(Theme.attentionSurface)
                    .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(tint.opacity(0.08)))
            )
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(tint, lineWidth: 1.5)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("approval-dock")
        }
    }

    // MARK: Parts

    private func heading(_ pending: PendingApproval) -> String {
        switch ApprovalHeading.of(pending.card) {
        case let .wantsTo(action):
            let name = pending.message.from?.name ?? chat.name
            return String(localized: "\(name) wants to \(Self.phrase(action))")
        case .confirmRoutine: return String(localized: "Confirm this routine")
        case .confirmRoutineChange: return String(localized: "Confirm this routine change")
        case .enableSkill: return String(localized: "Enable this learned skill")
        case .updateSkill: return String(localized: "Update this learned skill")
        case .confirmProfileChange: return String(localized: "Confirm this profile change")
        case let .teamSetup(title): return title
        }
    }

    static func phrase(_ action: ApprovalToolAction) -> String {
        switch action {
        case .runCommand: String(localized: "run a command")
        case .readFile: String(localized: "read a file")
        case .writeFile: String(localized: "write a file")
        case .editFile: String(localized: "edit a file")
        case .fetchWebPage: String(localized: "fetch a web page")
        case .searchWeb: String(localized: "search the web")
        case .scheduleRoutine: String(localized: "schedule a routine")
        case .changeRoutine: String(localized: "change a routine")
        case .enableSkill: String(localized: "enable a learned skill")
        case .updateSkill: String(localized: "update a learned skill")
        case .updateProfile: String(localized: "update its profile")
        case .deleteFile: String(localized: "delete a file")
        case .think: String(localized: "think")
        case .takeAction: String(localized: "take an action")
        case .useTool: String(localized: "use a tool")
        case let .named(words): words
        }
    }

    private func stepper(index: Int) -> some View {
        HStack(spacing: 2) {
            Button {
                Haptics.selection()
                requestId = approvals[max(0, index - 1)].requestId
            } label: {
                Image(systemName: "chevron.left").frame(width: 28, height: 28)
            }
            .disabled(index == 0)
            .accessibilityLabel(Text("Previous request"))
            .accessibilityIdentifier("approval-previous")
            Text("\(index + 1) of \(approvals.count)")
                .font(.system(size: 12.5).monospacedDigit())
                .accessibilityIdentifier("approval-position")
            Button {
                Haptics.selection()
                requestId = approvals[min(approvals.count - 1, index + 1)].requestId
            } label: {
                Image(systemName: "chevron.right").frame(width: 28, height: 28)
            }
            .disabled(index >= approvals.count - 1)
            .accessibilityLabel(Text("Next request"))
            .accessibilityIdentifier("approval-next")
        }
        .buttonStyle(.plain)
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(Theme.attentionSecondary)
    }

    @ViewBuilder
    private func actions(_ pending: PendingApproval) -> some View {
        let actions = ApprovalDockRules.actions(
            for: pending,
            ownerOrAdmin: session.canAdminister,
            hasBot: session.askingBotId(pending, in: chat) != nil
        )
        VStack(alignment: .leading, spacing: 8) {
            if actions.waitingForAdmin {
                Text("This command runs on the server: waiting for an admin to approve it.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.attentionSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                HStack(spacing: 8) {
                    decisionButton(
                        actions.denyIsCancel ? String(localized: "Cancel") : String(localized: "Deny"),
                        style: .refusal, id: "approval-deny"
                    ) { await session.decide(.deny, on: pending, in: chat) }
                    decisionButton(primaryLabel(actions.primary, pending), style: .primary, id: "approval-allow-once") {
                        await session.decide(.allowOnce, on: pending, in: chat)
                    }
                    .disabled(actions.primaryDisabled)
                }
                if actions.alwaysAllowTool || actions.alwaysAllowSession || actions.alwaysAllowCommand {
                    remember(actions, pending)
                }
            }
            if actions.cancelTurn {
                Button {
                    Haptics.selection()
                    run { await session.cancelTurn(for: pending, in: chat) }
                } label: {
                    Text("Cancel turn")
                        .font(.system(size: 12.5))
                        .underline()
                        .foregroundStyle(Theme.attentionSecondary)
                }
                .buttonStyle(.plain)
                .disabled(answering)
                .accessibilityIdentifier("approval-cancel-turn")
            }
        }
        .padding(.top, 2)
    }

    /// The remembering choice under the two main buttons: one applies.
    @ViewBuilder
    private func remember(_ actions: ApprovalDockActions, _ pending: PendingApproval) -> some View {
        if actions.alwaysAllowTool {
            quietButton(String(localized: "Always allow"), id: "approval-always-allow") {
                await session.decide(.alwaysAllowTool, on: pending, in: chat)
            }
        } else if actions.alwaysAllowCommand {
            quietButton(String(localized: "Always allow this command"), id: "approval-always-command") {
                await session.decide(.alwaysAllowCommand, on: pending, in: chat)
            }
            .accessibilityHint(Text(
                "Remember this exact command for this bot and provider in \(pending.card.commandAllowlist?.cwd ?? ""), including other threads using that folder"
            ))
        } else if actions.alwaysAllowSession {
            quietButton(String(localized: "Always allow this session"), id: "approval-always-session") {
                await session.decide(.alwaysAllowSession, on: pending, in: chat)
            }
            .accessibilityHint(Text("The provider stops asking about this action until the session ends"))
        }
    }

    private func primaryLabel(_ primary: ApprovalPrimary, _ pending: PendingApproval) -> String {
        switch primary {
        case .allowOnce: String(localized: "Allow once")
        case .confirm: String(localized: "Confirm")
        case .enable: String(localized: "Enable")
        case .update: String(localized: "Update")
        case let .option(label): label
        }
    }

    private enum ButtonStyleKind { case primary, refusal }

    private func decisionButton(
        _ title: String, style: ButtonStyleKind, id: String, _ action: @escaping () async -> Void
    ) -> some View {
        Button {
            Haptics.selection()
            run(action)
        } label: {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(style == .refusal ? Theme.attentionText : .white)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity)
                .frame(height: 40)
                .background(Capsule().fill(style == .refusal ? Theme.cardRaised : Theme.readable(tint)))
        }
        .buttonStyle(.plain)
        .disabled(answering)
        .accessibilityIdentifier(id)
    }

    private func quietButton(_ title: String, id: String, _ action: @escaping () async -> Void) -> some View {
        Button {
            Haptics.selection()
            run(action)
        } label: {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.attentionText)
                .frame(maxWidth: .infinity)
                .frame(height: 34)
                .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(answering)
        .accessibilityIdentifier(id)
    }

    private func run(_ action: @escaping () async -> Void) {
        answering = true
        Task {
            await action()
            answering = false
        }
    }
}
