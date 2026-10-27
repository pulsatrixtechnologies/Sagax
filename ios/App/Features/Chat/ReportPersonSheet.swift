// Report a message another person wrote (App Store guideline 1.2,
// Moderation.swift): a reason and an optional note, sent through the server
// to the organization's admins (a personal server's owner). Once sent, the
// person may also block the author, for themselves only. A bot's reply keeps
// ReportMessageSheet (an email to Pulsatrix).
import CompanionCore
import SwiftUI

struct ReportPersonSheet: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var session: Session
    let message: Message
    let chat: Chat
    let author: Moderation.Author

    @State private var reason: Moderation.Reason = .harassment
    @State private var note = ""
    @State private var sending = false
    @State private var sent = false
    @State private var blocked = false
    @State private var error: String?

    static func label(_ reason: Moderation.Reason) -> String {
        switch reason {
        case .harassment: String(localized: "Harassment or bullying")
        case .hate: String(localized: "Hate speech")
        case .sexual: String(localized: "Sexual content")
        case .violence: String(localized: "Violence or threats")
        case .spam: String(localized: "Spam or scam")
        case .privacy: String(localized: "Private information")
        case .other: String(localized: "Something else")
        }
    }

    private var alreadyBlocked: Bool { session.blockedIds.contains(author.id) }

    var body: some View {
        NavigationStack {
            Form {
                if sent {
                    Section {
                        Label("Thanks. Your report was sent to the admins, who will review it.", systemImage: "checkmark.circle")
                            .font(.system(size: 15))
                            .accessibilityIdentifier("report-person-sent")
                        if blocked {
                            Text("\(author.name) is blocked. Their messages are hidden for you.")
                                .font(.system(size: 14))
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                    if !blocked && !alreadyBlocked {
                        Section {
                            Button("Block \(author.name)", systemImage: "hand.raised", role: .destructive) {
                                Task { blocked = await session.block(author) }
                            }
                            .accessibilityIdentifier("report-person-block")
                        } footer: {
                            Text("Their messages in rooms and direct messages are hidden for you only. They are not told.")
                        }
                    }
                } else {
                    Section {
                        Text("Report this message from \(author.name). Your report and the message go to your organization's admins (the server's owner on a personal server). The person is not told who reported them.")
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    Section("Reason") {
                        Picker("Reason", selection: $reason) {
                            ForEach(Moderation.Reason.allCases) { reason in
                                Text(verbatim: Self.label(reason)).tag(reason)
                            }
                        }
                        .pickerStyle(.inline)
                        .labelsHidden()
                        .accessibilityIdentifier("report-person-reason")
                    }
                    Section {
                        TextField("Details (optional)", text: $note, axis: .vertical)
                            .lineLimit(2...5)
                            .accessibilityIdentifier("report-person-note")
                    }
                    if let error {
                        Section {
                            Text(verbatim: error)
                                .font(.system(size: 14))
                                .foregroundStyle(.red)
                        }
                    }
                }
            }
            .navigationTitle("Report message")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(sent ? "Done" : "Cancel") { dismiss() }
                        .accessibilityIdentifier("report-person-cancel")
                }
                if !sent {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Send report") { send() }
                            .disabled(sending)
                            .accessibilityIdentifier("report-person-send")
                    }
                }
            }
        }
        .presentationDetents([.large])
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("report-person-sheet")
    }

    private func send() {
        sending = true
        error = nil
        Task {
            do {
                try await session.reportPerson(message: message, in: chat, reason: reason, note: note)
                Haptics.selection()
                sent = true
            } catch {
                self.error = error.localizedDescription
            }
            sending = false
        }
    }
}

/// A blocked person's line, folded: one quiet row that opens on a tap.
struct BlockedLineRow: View {
    @Environment(\.themePalette) var themePalette
    let reveal: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "hand.raised")
                .font(.system(size: 12))
            Text("Message from a blocked person")
                .font(.system(size: 13))
            Button("Show", action: reveal)
                .font(.system(size: 13, weight: .medium))
                .buttonStyle(.borderless)
                .accessibilityIdentifier("blocked-line-show")
        }
        .foregroundStyle(Theme.textSecondary)
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(Theme.textSecondary.opacity(0.08), in: Capsule())
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("blocked-line")
    }
}
