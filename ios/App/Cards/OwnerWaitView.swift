// What someone who is not a card's approval audience sees (feature parity
// CA12, OwnerWait.tsx): while it is open, who it waits on; once settled,
// who answered and the verdict. Nothing of the request, and no control.
import SwiftUI
import CompanionCore

struct OwnerWaitView: View {
    @Environment(\.themePalette) var themePalette
    let message: Message

    var body: some View {
        if let line {
            Text(line)
                .font(.system(size: 15))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 4)
                .padding(.vertical, 6)
                .accessibilityIdentifier("owner-wait-\(message.id)")
        }
    }

    private var line: String? {
        let owner = message.ownerName?.trimmingCharacters(in: .whitespaces) ?? ""
        switch message.ownerWait {
        case .waitingOnOwner:
            return String(localized: "Waiting on \(owner)")
        case .ownerSettled:
            guard let answered = message.card?.answered else { return nil }
            let name = owner.isEmpty ? String(localized: "Someone") : owner
            return answered == "allow"
                ? String(localized: "\(name) allowed this request.")
                : String(localized: "\(name) declined this request.")
        case nil:
            return nil
        }
    }
}

/// Retry under a failed turn (ChatView.tsx ErrorRow).
struct ErrorRetryButton: View {
    @Environment(\.themePalette) var themePalette
    let retry: () async -> Void
    @State private var running = false

    var body: some View {
        Button {
            Haptics.selection()
            running = true
            Task {
                await retry()
                running = false
            }
        } label: {
            Label("Retry", systemImage: "arrow.clockwise")
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(Theme.danger)
                .padding(.horizontal, 10)
                .frame(height: 28)
                .overlay(Capsule().strokeBorder(Theme.danger.opacity(0.35), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(running)
        .padding(.leading, 2)
    }
}
