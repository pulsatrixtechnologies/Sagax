// 2026-10-28 (one source of truth): the level the open conversation really
// runs at, when it is not the bot's own setting, as the server judges its
// turns (`Bot.approvalApplied`). The picker shows the bot's setting; this
// line says why the conversation differs. Same words as the desktop.
import SwiftUI
import CompanionCore

struct AppliedLevelNote: View {
    let bot: Bot

    var body: some View {
        if let applied = bot.appliedLevelNote {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 12))
                    .foregroundStyle(.orange)
                Text(verbatim: AppliedLevelWords.line(applied, words: .app))
                    .font(.system(size: 13))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("approval-applied-note")
        }
    }
}
