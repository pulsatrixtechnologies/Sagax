import SwiftUI
import CompanionCore
import UIKit

/// Offered under a failed turn whose Claude Code is too old for the model.
///
/// The computer runs Claude Code's own updater through the same route as the
/// desktop's Engines page (which refuses while another Claude turn is
/// running), or the person takes the command and runs it themselves. Either
/// way the message that failed is not resent by the update, so every ending
/// says to send it again.
struct ClaudeUpdateCard: View {
    @Environment(\.themePalette) var themePalette
    let instanceId: String
    let tint: Color
    @EnvironmentObject private var session: Session
    @State private var phase: Phase = .ask
    @State private var copied = false

    private enum Phase: Equatable {
        case ask
        case updating
        case updated(version: String)
        case manual
        case failed(error: String)
    }

    private static let updateCommand = "claude update"

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            switch phase {
            case .ask:
                Text("This model needs a newer Claude Code. I can update Claude for you.")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 8) {
                    Button(action: update) {
                        Text("Update Claude for me")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 40)
                            .background(Capsule().fill(tint))
                    }
                    .buttonStyle(.plain)
                    Button {
                        Haptics.selection()
                        phase = .manual
                    } label: {
                        Text("I'll do it myself")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.textPrimary)
                            .frame(maxWidth: .infinity)
                            .frame(height: 40)
                            .background(Capsule().fill(Theme.cardRaised))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.top, 2)
            case .updating:
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Updating Claude Code… this can take a minute.")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
            case let .updated(version):
                Label("Claude updated — \(version). Send your message again.", systemImage: "checkmark.circle")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.success)
                    .fixedSize(horizontal: false, vertical: true)
            case .manual:
                manualBlock
            case let .failed(error):
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.danger)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                manualBlock
                Button(action: update) {
                    Text("Try updating again")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                        .padding(.horizontal, 14)
                        .frame(height: 34)
                        .background(Capsule().fill(Theme.cardRaised))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Theme.card)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Update Claude Code")
    }

    private var manualBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Run this in Terminal on your computer, then send your message again:")
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                Text(Self.updateCommand)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(Theme.textPrimary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button {
                    UIPasteboard.general.string = Self.updateCommand
                    Haptics.selection()
                    copied = true
                    Task {
                        try? await Task.sleep(nanoseconds: 1_200_000_000)
                        copied = false
                    }
                } label: {
                    Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(height: 30)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Copy command")
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Theme.inset, in: RoundedRectangle(cornerRadius: 10))
        }
    }

    private func update() {
        guard phase != .updating else { return }
        Haptics.selection()
        phase = .updating
        Task {
            do {
                let version = try await session.updateClaude(instanceId: instanceId)
                phase = .updated(version: version)
            } catch {
                phase = .failed(error: error.localizedDescription)
            }
        }
    }
}
