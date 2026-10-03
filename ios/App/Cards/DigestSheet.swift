import CompanionCore
import SwiftUI

/// What a turn's digest opens onto: the tools, files and memory it
/// touched, read down a list rather than across one run-on line.
struct DigestSheet: View {
    @Environment(\.themePalette) var themePalette
    let summary: DigestSummary
    /// Which credentials paid for the turn (organization servers, CA16).
    var paidWith: String? = nil
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if let paidWith {
                    Section("Paid with") {
                        Label(paidWith, systemImage: "key")
                            .font(.system(size: 14))
                            .accessibilityIdentifier("digest-paid-with")
                    }
                }
                ForEach(Array(summary.lines.enumerated()), id: \.offset) { _, line in
                    if let label = line.label {
                        Section(label) {
                            ForEach(Array(line.items.enumerated()), id: \.offset) { _, item in
                                Text(verbatim: item)
                                    .font(.system(size: 14, design: label == "Tools" ? .monospaced : .default))
                                    .textSelection(.enabled)
                            }
                        }
                    } else {
                        Section {
                            Text(verbatim: line.value)
                                .font(.system(size: 14))
                                .textSelection(.enabled)
                        }
                    }
                }
            }
            .navigationTitle("What I did")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Copy", systemImage: "doc.on.doc") {
                        PlatformBridge.copyToPasteboard(paidWith.map { "\(String(localized: "Paid with: \($0)"))\n\n\(summary.plainText)" } ?? summary.plainText)
                        Haptics.selection()
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
