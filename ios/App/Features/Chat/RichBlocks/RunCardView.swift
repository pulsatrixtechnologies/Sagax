// The bot's run in the current ask as a checklist (`VerifyCard.tsx`), above
// the composer as on the desktop: every command it ran, the control-CLI ones
// tagged verified, a summary line, collapse and dismiss, and Save as skill,
// which puts the run into the composer for the person to annotate and send.
// Nothing is sent from here. Settings > Appearance > This run turns it off
// (ST4, `run-card-preferences.ts`).
import SwiftUI
import CompanionCore

enum RunCardPreference {
    /// The desktop's `omb-show-run-card`, on unless turned off.
    static let key = "companion.prefs.showRunCard"
}

/// A dismissal is pinned to the run's last step, per thread: the card comes
/// back when the bot runs another command, and stays away across a switch
/// to another thread and back (ChatView.tsx `runDismissed`).
@MainActor
final class RunCardDismissals: ObservableObject {
    static let shared = RunCardDismissals()
    @Published private(set) var dismissed: [String: String] = [:]

    func isDismissed(threadId: String, lastStepId: String) -> Bool {
        dismissed[threadId] == lastStepId
    }

    func dismiss(threadId: String, lastStepId: String) {
        dismissed[threadId] = lastStepId
    }
}

struct RunCardView: View {
    @Environment(\.themePalette) var themePalette
    let steps: [RunStep]
    let canSave: Bool
    let staged: Bool
    let onDismiss: () -> Void
    let onSave: () -> Void
    @State private var collapsed: Bool

    init(steps: [RunStep], canSave: Bool, staged: Bool, onDismiss: @escaping () -> Void, onSave: @escaping () -> Void) {
        self.steps = steps
        self.canSave = canSave
        self.staged = staged
        self.onDismiss = onDismiss
        self.onSave = onSave
        // a long run starts folded
        _collapsed = State(initialValue: steps.count > 6)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "checklist")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.accent)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text("This run")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textPrimary)
                    Text(verbatim: Self.summaryLabel(RunSteps.summary(steps)))
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("run-card-summary")
                }
                Spacer(minLength: 4)
                iconButton(collapsed ? "chevron.up" : "chevron.down", label: collapsed ? "Expand the run" : "Collapse the run", id: "run-card-toggle") {
                    withAnimation(.easeInOut(duration: 0.15)) { collapsed.toggle() }
                }
                iconButton("xmark", label: "Dismiss the run", id: "run-card-dismiss", action: onDismiss)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            if !collapsed {
                Rectangle().fill(Theme.hairline.opacity(0.25)).frame(height: 0.5)
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(steps) { step in
                            stepRow(step)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                }
                .frame(maxHeight: 224)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel(Text("Run steps"))
                if staged {
                    Rectangle().fill(Theme.hairline.opacity(0.25)).frame(height: 0.5)
                    Text("Skill staged for your review")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                } else if canSave {
                    Rectangle().fill(Theme.hairline.opacity(0.25)).frame(height: 0.5)
                    VStack(alignment: .trailing, spacing: 2) {
                        Button(action: onSave) {
                            Label("Save as skill", systemImage: "bookmark")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(Theme.textSecondary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("run-card-save")
                        Text("Adds the run to your message; add any notes, then send.")
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.textSecondary)
                            .multilineTextAlignment(.trailing)
                    }
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                }
            }
        }
        .frame(maxWidth: 352, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.cardRaised.opacity(0.95)))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.hairline.opacity(0.4), lineWidth: 0.5))
        .shadow(color: .black.opacity(0.18), radius: 10, y: 3)
        .frame(maxWidth: .infinity, alignment: .trailing)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("This run"))
        .accessibilityIdentifier("run-card")
    }

    private func stepRow(_ step: RunStep) -> some View {
        HStack(spacing: 8) {
            Group {
                switch step.status {
                case .running: ProgressView().controlSize(.mini)
                case .passed: Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.success)
                case .failed: Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.danger)
                }
            }
            .font(.system(size: 14))
            .frame(width: 16)
            Text(verbatim: step.label)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .fixedSize()
            if step.verified {
                Text("verified")
                    .font(.system(size: 10.5))
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.success)
                    .fixedSize()
            }
            Text(verbatim: step.command)
                .font(.system(size: 11.5, design: .monospaced))
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("run-step-\(step.id)")
    }

    private func iconButton(_ icon: String, label: LocalizedStringKey, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
        .accessibilityIdentifier(id)
    }

    /// "3 steps · 2 verified · 1 failed", in the reader's language.
    static func summaryLabel(_ summary: RunSummary) -> String {
        var parts = [summary.total == 1 ? String(localized: "1 step") : String(localized: "\(summary.total) steps")]
        if summary.verified > 0 { parts.append(String(localized: "\(summary.verified) verified")) }
        if summary.failed > 0 { parts.append(String(localized: "\(summary.failed) failed")) }
        if summary.running > 0 { parts.append(String(localized: "\(summary.running) running")) }
        if summary.dryRuns == 1 {
            parts.append(String(localized: "1 dry run"))
        } else if summary.dryRuns > 1 {
            parts.append(String(localized: "\(summary.dryRuns) dry runs"))
        }
        return parts.joined(separator: " · ")
    }
}

extension ChatView {
    /// The run card above the composer, for a bot's own conversation.
    @ViewBuilder
    var runCard: some View {
        if showRunCard, case let .bot(bot) = current {
            let steps = RunSteps.steps(messages)
            if let last = steps.last, RunSteps.showRun(steps),
               !runCardDismissals.isDismissed(threadId: threadId, lastStepId: last.id) {
                let summary = RunSteps.summary(steps)
                let agents = power.abilities(bot.currentTaskModelSelection.instanceId)?.agentsMcp == true
                let canSave = power.skillAuthoring && agents && summary.passed > 0 && summary.running == 0 && bot.busy != true
                RunCardView(
                    steps: steps,
                    canSave: canSave,
                    staged: RunSteps.skillStaged(messages, steps: steps),
                    onDismiss: {
                        withAnimation(.easeInOut(duration: 0.15)) {
                            runCardDismissals.dismiss(threadId: threadId, lastStepId: last.id)
                        }
                    },
                    onSave: {
                        let prompt = RunSteps.skillPrompt(steps, ask: RunSteps.askText(messages))
                        draft = draft.isEmpty ? prompt : draft + "\n\n" + prompt
                        composerFocused = true
                    }
                )
                .id(threadId)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task {
                    // Save needs to know the engine mounts the agents tools.
                    if power.engines == nil {
                        await power.load(botIds: [], threadId: nil, groupId: nil, session: session)
                    }
                }
            }
        }
    }
}
