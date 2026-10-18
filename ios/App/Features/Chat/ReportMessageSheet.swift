// Report a bot's reply (MessageReport): a reason, an optional note, and the
// reply's words only if the person ticks the box. Send report opens an email
// to Pulsatrix in the person's mail app; with no mail app set up, the report
// is copied for them to paste. The app sends nothing on its own, so the same
// sheet works in the demo.
import CompanionCore
import SwiftUI

struct ReportMessageSheet: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    let message: Message
    /// The reply's words, offered for inclusion (never included by default).
    let visibleText: String
    let botName: String
    let demo: Bool

    @State private var reason: MessageReport.Reason = .harmful
    @State private var note = ""
    @State private var includeText = false
    @State private var copied = false

    static func label(_ reason: MessageReport.Reason) -> String {
        switch reason {
        case .harmful: String(localized: "Harmful or dangerous")
        case .offensive: String(localized: "Offensive or hateful")
        case .sexual: String(localized: "Sexual content")
        case .misleading: String(localized: "Wrong or misleading")
        case .privacy: String(localized: "Reveals private information")
        case .other: String(localized: "Something else")
        }
    }

    private var draft: MessageReport.Draft {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return MessageReport.Draft(
            messageId: message.id,
            reason: reason,
            reasonLabel: Self.label(reason),
            note: note,
            includedText: includeText ? visibleText : nil,
            app: "Sagax iOS \(version) (\(build))",
            demo: demo
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Tell Pulsatrix if this AI-generated reply from \(botName) is harmful, offensive or wrong. The report is an email you send from your mail app, with only what you choose below.")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textSecondary)
                }
                Section("Reason") {
                    Picker("Reason", selection: $reason) {
                        ForEach(MessageReport.Reason.allCases) { reason in
                            Text(verbatim: Self.label(reason)).tag(reason)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                    .accessibilityIdentifier("report-reason")
                }
                Section {
                    TextField("Details (optional)", text: $note, axis: .vertical)
                        .lineLimit(2...5)
                        .accessibilityIdentifier("report-note")
                    Toggle("Include the reply's text", isOn: $includeText)
                        .accessibilityIdentifier("report-include-text")
                } footer: {
                    Group {
                        if includeText {
                            Text("Sent: the reason, the message id (\(message.id)), the app version and the reply's text.")
                        } else {
                            Text("Sent: the reason, the message id (\(message.id)) and the app version. The reply's text is not included.")
                        }
                    }
                    .accessibilityIdentifier("report-summary")
                }
                if copied {
                    Section {
                        Label("No mail app is set up. The report was copied: paste it in an email to \(MessageReport.address).", systemImage: "doc.on.clipboard")
                            .font(.system(size: 14))
                            .accessibilityIdentifier("report-copied")
                    }
                }
            }
            .navigationTitle("Report reply")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(copied ? "Done" : "Cancel") { dismiss() }
                        .accessibilityIdentifier("report-cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send report") { send() }
                        .accessibilityIdentifier("report-send")
                }
            }
        }
        .presentationDetents([.large])
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("report-sheet")
    }

    private func send() {
        let draft = draft
        guard let url = draft.mailURL else { copy(draft); return }
        openURL(url) { opened in
            if opened {
                Haptics.selection()
                dismiss()
            } else {
                copy(draft)
            }
        }
    }

    private func copy(_ draft: MessageReport.Draft) {
        PlatformBridge.copyToPasteboard(draft.plainText)
        Haptics.selection()
        copied = true
    }
}
