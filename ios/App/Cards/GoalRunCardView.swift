// The goal run card (feature parity CA14, GoalRunCard.tsx): the durable
// receipt of a bounded multi-bot room goal — the goal, where it stands, the
// coordinator and how many turns it took.
import SwiftUI
import CompanionCore

struct GoalRunCardView: View {
    @Environment(\.themePalette) var themePalette
    let run: GoalRunCard

    var body: some View {
        let goal = GoalRunText.compact(run.goal, limit: GoalRunText.goalLimit)
        let detail = GoalRunText.compact(run.detail, limit: GoalRunText.detailLimit)
        HStack(alignment: .top, spacing: 11) {
            icon
                .frame(width: 32, height: 32)
                .background(Theme.inset, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 7) {
                    Text(goal.isEmpty ? String(localized: "Group goal") : goal)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(2)
                    Text(statusLabel)
                        .font(.system(size: 11.5, weight: .medium))
                        .foregroundStyle(tone)
                        .accessibilityIdentifier("goal-run-status")
                }
                if !detail.isEmpty {
                    Text(detail)
                        .font(.system(size: 12.5))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(2)
                }
                Text("\(run.coordinatorName) coordinating · \(turnsText)")
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.textTertiary)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Theme.card))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(tone.opacity(0.35), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("goal-run-card")
    }

    private var turnsText: String {
        switch GoalRunText.turns(run) {
        case let .current(turn, max): String(localized: "Turn \(turn) of \(max)")
        case let .total(count): count == 1 ? String(localized: "1 turn") : String(localized: "\(count) turns")
        }
    }

    private var statusLabel: String {
        switch run.state {
        case .working: String(localized: "Working")
        case .completed: String(localized: "Completed")
        case .needsInput: String(localized: "Needs your input")
        case .blocked: String(localized: "Blocked")
        case .limitReached: String(localized: "Turn limit reached")
        case .paused: String(localized: "Paused")
        case .stopped: String(localized: "Stopped")
        case .failed: String(localized: "Failed")
        case nil: run.status
        }
    }

    private var tone: Color {
        switch run.state {
        case .working: Theme.accent
        case .completed: Theme.success
        case .failed: Theme.danger
        case .stopped, nil: Theme.textSecondary
        default: Theme.warning
        }
    }

    @ViewBuilder
    private var icon: some View {
        switch run.state {
        case .working: ProgressView().controlSize(.small)
        case .completed: Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.success)
        case .needsInput: Image(systemName: "hand.raised.fill").foregroundStyle(Theme.warning)
        case .failed: Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.danger)
        case .stopped, nil: Image(systemName: "stop.fill").foregroundStyle(Theme.textSecondary)
        default: Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Theme.warning)
        }
    }
}
