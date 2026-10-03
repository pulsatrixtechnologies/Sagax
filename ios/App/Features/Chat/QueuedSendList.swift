// The held sends above the composer.
import SwiftUI
import CompanionCore

/// The held sends for one thread, as the desktop's composer shows them
/// (ComposerQueuedMessages.tsx): one line each, editable and deletable, with
/// a note when the harness held them for thread capacity rather than
/// because a turn is running. Only the head owns Steer: a bot's queue
/// steers all of its held sends at once, a room's the next one (CO14, RM5).
struct QueuedSendList: View {
    @Environment(\.themePalette) var themePalette
    let sends: [QueuedSend]
    var isRoom = false
    var steering = false
    /// Steer is backed by an interrupt (the engine cannot steer live): the
    /// hint says what the tap really does.
    var steerInterrupts = false
    /// Nil hides Steer (nothing is running, or an approval waits).
    var steer: (() -> Void)? = nil
    let edit: (QueuedSend) -> Void
    let cancel: (QueuedSend) -> Void

    private var showsCapacityNote: Bool {
        sends.contains { $0.reason == "capacity" }
    }

    private var steerLabel: LocalizedStringKey {
        switch QueueSteer.label(count: sends.count, isRoom: isRoom, steering: steering) {
        case .steer: return "Steer"
        case .steerAll: return "Steer all"
        case .steerNext: return "Steer next"
        case .steering: return "Steering…"
        }
    }

    private var steerHint: Text {
        let multiple = sends.count > 1
        if steering { return Text("Steering queued messages") }
        if steerInterrupts {
            if !multiple { return Text("Stop the running turn and send this message now") }
            return isRoom
                ? Text("Stop the running turn and send the next queued message now")
                : Text("Stop the running turn and send all \(sends.count) queued messages now")
        }
        if !multiple { return Text("Steer queued message now") }
        return isRoom ? Text("Steer the next queued message now") : Text("Steer all \(sends.count) queued messages now")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if showsCapacityNote {
                Text("Queued — starts when this bot has a free thread slot.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
            }
            ForEach(Array(sends.enumerated()), id: \.element.queueId) { index, send in
                HStack(spacing: 8) {
                    Image(systemName: "arrow.turn.down.right")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                    Text(send.text)
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if index == 0, let steer {
                        Button(action: steer) {
                            HStack(spacing: 4) {
                                Image(systemName: "arrow.turn.down.right")
                                    .font(.system(size: 12, weight: .semibold))
                                    .opacity(steering ? 0.5 : 1)
                                Text(steerLabel)
                                    .font(.system(size: 13, weight: .medium))
                            }
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.horizontal, 8)
                            .frame(height: 30)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(steering)
                        .accessibilityLabel(steerHint)
                        .accessibilityIdentifier("queued-steer")
                    }
                    Button {
                        edit(send)
                    } label: {
                        Image(systemName: "pencil")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Theme.textSecondary)
                            .frame(width: 30, height: 30)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Edit queued message \(index + 1) of \(sends.count)")
                    Button {
                        cancel(send)
                    } label: {
                        Image(systemName: "trash")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Theme.textSecondary)
                            .frame(width: 30, height: 30)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Delete queued message \(index + 1) of \(sends.count)")
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Theme.inset, in: RoundedRectangle(cornerRadius: 12))
                // the phone's second door to the same actions
                .contextMenu {
                    if index == 0, let steer {
                        Button(action: steer) { Label(steerLabel, systemImage: "arrow.turn.down.right") }
                    }
                    Button { edit(send) } label: { Label("Edit", systemImage: "pencil") }
                    Button(role: .destructive) { cancel(send) } label: { Label("Delete", systemImage: "trash") }
                }
            }
        }
        .padding(.horizontal, 4)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(sends.count == 1 ? "1 queued message" : "\(sends.count) queued messages")
    }
}
