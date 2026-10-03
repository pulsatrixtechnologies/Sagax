// The widget extension: the bot's Live Activity in the Dynamic Island and
// on the lock screen, and the home-screen widgets that render the updates
// snapshot. The face is the mascot engine's resting face for the state —
// the system renders a snapshot, so it cannot move here, but it changes
// with every update.
import ActivityKit
import CompanionCore
import SwiftUI
import WidgetKit

@main
struct SagaxWidgets: WidgetBundle {
    var body: some Widget {
        BotActivityWidget()
        NeedsYouWidget()
        UpdatesDigestWidget()
        WorkingMonitorWidget()
        if #available(iOS 17.0, *) {
            BotWidget()
        }
    }
}

struct BotActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: BotActivityAttributes.self) { context in
            // The lock-screen banner wears the app's skin (app group,
            // SharedTheme); the Dynamic Island below is always black.
            let palette = SharedTheme.palette(for: SharedTheme.pinnedScheme ?? .dark)
            LockScreenView(context: context)
                .activityBackgroundTint(palette.bg.color)
                .activitySystemActionForegroundColor(palette.textPrimary.color)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    OrbitingFace(context: context, size: 68)
                        .padding(.leading, 2)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.state.headline)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(.white)
                        Text(context.state.line)
                            .font(.system(size: 13))
                            .foregroundStyle(.white.opacity(0.7))
                            .lineLimit(2)
                        // the one clock iOS keeps ticking for us
                        Text(timerInterval: context.state.since...context.state.since.addingTimeInterval(86_400), countsDown: false)
                            .font(.system(size: 12, weight: .medium).monospacedDigit())
                            .foregroundStyle(.white.opacity(0.5))
                    }
                    .padding(.top, 2)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if let threadId = context.state.approvalThreadId, let requestId = context.state.requestId {
                        AnswerButtons(context: context, threadId: threadId, requestId: requestId)
                            .padding(.top, 4)
                    }
                }
            } compactLeading: {
                MascotStill(color: context.attributes.color, look: context.attributes.look, skin: context.attributes.mascotSkin ?? .none, state: MausState(rawValue: context.state.face) ?? .idle, size: 24)
            } compactTrailing: {
                compactTrailing(context)
            } minimal: {
                MascotStill(color: context.attributes.color, look: context.attributes.look, skin: context.attributes.mascotSkin ?? .none, state: MausState(rawValue: context.state.face) ?? .idle, size: 22)
            }
            .keylineTint(MausPalette.color(context.attributes.color))
        }
    }

    @ViewBuilder
    private func compactTrailing(_ context: ActivityViewContext<BotActivityAttributes>) -> some View {
        switch context.state.kind {
        case "needsYou":
            Image(systemName: "hand.raised.fill")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(MausPalette.color(context.attributes.color))
        case "working":
            Image(systemName: "circle.dotted")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white.opacity(0.8))
        default:
            Circle().fill(MausPalette.color(context.attributes.color)).frame(width: 8, height: 8)
        }
    }
}

private struct LockScreenView: View {
    let context: ActivityViewContext<BotActivityAttributes>
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let palette = SharedTheme.palette(for: SharedTheme.pinnedScheme ?? scheme)
        HStack(alignment: .top, spacing: 12) {
            OrbitingFace(context: context, size: 60)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    if context.state.kind == "needsYou" {
                        Image(systemName: "hand.raised.fill")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(MausPalette.color(context.attributes.color))
                    }
                    Text(context.state.headline)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(palette.textPrimary.color)
                }
                Text(context.state.line)
                    .font(.system(size: 13))
                    .foregroundStyle(palette.textSecondary.color)
                    .lineLimit(2)
                if let threadId = context.state.approvalThreadId, let requestId = context.state.requestId {
                    AnswerButtons(
                        context: context, threadId: threadId, requestId: requestId,
                        refusalInk: palette.textPrimary.color, refusalFill: palette.cardRaised.color,
                        hintInk: palette.textSecondary.color
                    )
                        .padding(.top, 4)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
    }
}

/// The card's options, as pills — exactly the options the card offered.
private struct AnswerButtons: View {
    let context: ActivityViewContext<BotActivityAttributes>
    let threadId: String
    let requestId: String
    /// The island is black: white ink and a faint white refusal pill. The
    /// lock-screen banner passes its skin's.
    var refusalInk: Color = .white
    var refusalFill: Color = .white.opacity(0.16)
    var hintInk: Color = .white.opacity(0.7)

    var body: some View {
        // Answering from the activity itself is an interactive-widget feature,
        // and those arrived in iOS 17. Below that the buttons would be dead
        // pills, so say where the answer lives instead of pretending.
        if #available(iOS 17.0, *) {
            buttons
        } else {
            Text("Open Sagax to answer")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(hintInk)
        }
    }

    @available(iOS 17.0, *)
    private var buttons: some View {
        HStack(spacing: 8) {
            ForEach(context.state.options, id: \.self) { option in
                Button(intent: AnswerApprovalIntent(
                    threadId: threadId,
                    requestId: requestId,
                    choice: option,
                    isPermission: context.state.isPermission
                )) {
                    let refusal = option.caseInsensitiveCompare("Deny") == .orderedSame
                    Text(option)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(refusal ? refusalInk : .white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 34)
                        .background(
                            Capsule().fill(
                                refusal
                                    ? refusalFill
                                    : MausPalette.color(context.attributes.color)
                            )
                        )
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// The face with comets around it and a rainbow ring filling up behind it.
/// The system renders a snapshot, so the comets are a frame — a different
/// one each update — and the ring is a timer-driven `ProgressView`, which is
/// the one kind of motion iOS keeps animating in a Live Activity on its own.
private struct OrbitingFace: View {
    let context: ActivityViewContext<BotActivityAttributes>
    let size: CGFloat

    var body: some View {
        ZStack {
            ProgressView(timerInterval: context.state.since...context.state.since.addingTimeInterval(60), countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
                .progressViewStyle(.circular)
                .tint(AngularGradient(colors: [
                    Color(hex: "#A855F7"), Color(hex: "#38BDF8"), Color(hex: "#34D399"),
                    Color(hex: "#FACC15"), Color(hex: "#FB923C"), Color(hex: "#F43F5E"), Color(hex: "#A855F7"),
                ], center: .center))
                .frame(width: size + 4, height: size + 4)
            MascotStill(color: context.attributes.color, look: context.attributes.look, skin: context.attributes.mascotSkin ?? .none, state: MausState(rawValue: context.state.face) ?? .idle, size: size, comets: true, at: Date())
        }
    }
}
