// The held sends above the composer.
import SwiftUI
import CompanionCore

/// The held sends for one thread, as the desktop's composer shows them: one
/// line each, editable and deletable, with a note when the harness held them
/// for thread capacity rather than because a turn is running.
struct QueuedSendList: View {
    @Environment(\.themePalette) var themePalette
    let sends: [QueuedSend]
    let edit: (QueuedSend) -> Void
    let cancel: (QueuedSend) -> Void

    private var showsCapacityNote: Bool {
        sends.contains { $0.reason == "capacity" }
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
            }
        }
        .padding(.horizontal, 4)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(sends.count == 1 ? "1 queued message" : "\(sends.count) queued messages")
    }
}
