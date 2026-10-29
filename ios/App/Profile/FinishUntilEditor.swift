import CompanionCore
import SwiftUI

/// #1329 (2026-10-29): the bot's "do not finish until" condition and its
/// relaunch bound, same as the desktop's FinishUntilSettings.tsx. After each
/// reply in a 1:1 with this bot, Sagax checks the condition; while it is not
/// met, Sagax relaunches the bot on its own, up to the bound. Saved through
/// the paired profile route (`finishUntil`, `finishUntilMaxRounds`).
struct FinishUntilEditor: View {
    @EnvironmentObject private var session: Session
    let bot: Bot
    /// The ink of the surrounding page (the phone's or the iPad panel's).
    var ink: Color = .primary
    var inkSecondary: Color = .secondary

    @State private var draft = ""
    @State private var saving = false

    private var stored: String { bot.finishUntil ?? "" }
    private var rounds: Int { FinishUntilLine.rounds(bot.finishUntilMaxRounds) }
    private var cleaned: String {
        draft.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    }
    private var changed: Bool { cleaned != stored }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Do not finish until")
                .font(.headline)
                .foregroundStyle(ink)
            Text("One sentence that must be true before this bot finishes. While it is not, Sagax relaunches the bot on its own in the same conversation. Each relaunch is a normal turn. Stop ends the relaunches.")
                .font(.footnote)
                .foregroundStyle(inkSecondary)
            TextField(String(localized: "For example: the tests pass and the branch is pushed"), text: $draft, axis: .vertical)
                .lineLimit(1...4)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("finish-until-condition")
                .onValueChange(of: draft) { value in
                    if value.count > 400 { draft = String(value.prefix(400)) }
                }
            Stepper(value: Binding(get: { rounds }, set: { next in
                Task { await save(BotProfilePatch(finishUntilMaxRounds: next == FinishUntilLine.defaultRounds ? .clear : .set(next))) }
            }), in: 1...FinishUntilLine.maxRounds) {
                Text("Relaunches at most: \(rounds)")
                    .foregroundStyle(ink)
            }
            .disabled(saving)
            .accessibilityIdentifier("finish-until-rounds")
            Text(stored.isEmpty
                 ? String(localized: "Off. The bot finishes when it decides it is done.")
                 : String(localized: "On. Sagax relaunches the bot up to \(rounds) times while the condition is not met."))
                .font(.footnote)
                .foregroundStyle(inkSecondary)
            HStack(spacing: 10) {
                Button(String(localized: "Save")) {
                    Task { await save(BotProfilePatch(finishUntil: cleaned)) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!changed || saving)
                .accessibilityIdentifier("finish-until-save")
                if !stored.isEmpty {
                    Button(String(localized: "Clear"), role: .destructive) {
                        Task { await save(BotProfilePatch(finishUntil: "")) }
                    }
                    .buttonStyle(.bordered)
                    .disabled(saving)
                    .accessibilityIdentifier("finish-until-clear")
                }
            }
        }
        .onValueChange(of: stored, initial: true) { value in draft = value }
    }

    private func save(_ patch: BotProfilePatch) async {
        saving = true
        defer { saving = false }
        _ = await session.updateProfile(patch, for: bot)
    }
}

/// The chat's row for a "do not finish until" check, in the reader's language.
struct FinishUntilRow: View {
    @Environment(\.themePalette) var themePalette
    let line: FinishUntilLine

    var body: some View {
        Label {
            Text(Self.text(line))
        } icon: {
            Image(systemName: line.status == "relaunch" ? "arrow.clockwise" : line.status == "met" ? "checkmark.circle" : "pause.circle")
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 2)
        .accessibilityIdentifier("finish-until-row")
    }

    static func text(_ line: FinishUntilLine) -> String {
        let condition = line.condition
        let round = line.round ?? 0
        let max = line.max ?? 0
        let base: String
        switch line.status {
        case "relaunch": base = String(localized: "Relaunch \(round)/\(max): not finished until \(condition)")
        case "met": base = String(localized: "Condition met: \(condition)")
        case "blocked": base = String(localized: "Waiting for you before the condition is met: \(condition)")
        case "limit": base = String(localized: "Stopped after \(round) relaunches, the condition is not met yet: \(condition). Send a message to continue.")
        default: base = String(localized: "Relaunches stopped: \(condition)")
        }
        if let detail = line.detail, !detail.isEmpty, line.status == "met" || line.status == "blocked" {
            return "\(base) (\(detail))"
        }
        return base
    }
}
