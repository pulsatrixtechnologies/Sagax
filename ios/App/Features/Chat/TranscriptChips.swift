// The quiet chips in a transcript: tool activity and harness receipts.
import SwiftUI
import CompanionCore

/// A tool the bot ran. Deliberately quiet — these are the bulk of a busy
/// transcript and they are context, not content.
struct ActivityChip: View {
    @Environment(\.themePalette) var themePalette
    let tool: ToolActivity?
    /// The thread this chip opened, when it opened one.
    var threadRef: ThreadRef? = nil
    var openThread: ((ThreadRef) -> Void)? = nil
    /// The output is a teammate's report, not a tool log.
    var outputIsProse = false

    var body: some View {
        if let tool {
            // Only a teammate's report expands. Ordinary tool chips also
            // carry raw output, and that log stays on the computer's side.
            let output = outputIsProse ? tool.expandableOutput : nil
            let receipt = SkillExecutionReceiptView(
                skillName: tool.name,
                status: tool.ok.map { $0 ? "success" : "error" } ?? "running",
                output: output ?? "",
                outputIsProse: outputIsProse
            )
            .padding(.leading, 2)

            if output != nil, let threadRef, let openThread {
                // The receipt's own button expands the report now, so the
                // thread gets a link of its own beneath it rather than
                // taking over the whole chip.
                VStack(alignment: .leading, spacing: 4) {
                    receipt
                    Button {
                        Haptics.selection()
                        openThread(threadRef)
                    } label: {
                        HStack(spacing: 4) {
                            Text("Open thread")
                            Image(systemName: "arrow.right")
                                .font(.system(size: 10, weight: .semibold))
                        }
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.leading, 8)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open thread \(threadRef.title)")
                }
            } else if let threadRef, let openThread {
                // The receipt's own button has nothing to expand here, so the
                // whole chip is the link to the thread it names.
                Button {
                    Haptics.selection()
                    openThread(threadRef)
                } label: {
                    receipt.allowsHitTesting(false)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tool.name)
                .accessibilityHint("Opens the thread")
            } else {
                receipt
            }
        }
    }
}

/// A quiet capsule under a reply for the harness's receipts (the work
/// digest, a compaction record): one line, and the full text on tap.
struct ReceiptChip: View {
    @Environment(\.themePalette) var themePalette
    let icon: String
    let label: String
    var hint = "Shows the full text"
    var open: (() -> Void)? = nil

    var body: some View {
        if !label.isEmpty {
            Button {
                Haptics.selection()
                open?()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: icon)
                        .font(.system(size: 11, weight: .medium))
                    Text(label)
                        .font(.system(size: 12))
                        .lineLimit(1)
                }
                .foregroundStyle(Theme.textSecondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Capsule().strokeBorder(.quaternary))
                .padding(.leading, 2)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
            .accessibilityHint(hint)
        }
    }
}
