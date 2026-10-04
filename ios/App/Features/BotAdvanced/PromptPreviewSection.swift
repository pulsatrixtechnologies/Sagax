// Prompt preview (BA2, bot-settings/PromptPreview.tsx): the settings-derived
// prompt from GET /api/bots/:id/system-prompt, each part folded, with its
// size. Read-only. `PromptPreviewSection` is the Form content of the bot
// panel's Overview (OverviewSection.tsx shows it there).
import CompanionCore
import SwiftUI

struct PromptPreviewSection: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @EnvironmentObject private var session: Session
    @State private var data: PromptPreview?
    @State private var failed = false

    var body: some View {
        Section {
            if let data {
                ForEach(data.sections) { part in
                    DisclosureGroup {
                        Text(verbatim: part.text)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(Theme.textPrimary)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } label: {
                        HStack {
                            Text(verbatim: part.label).foregroundStyle(Theme.textPrimary)
                            Spacer(minLength: 8)
                            Text(String(localized: "\(part.bytes.formatted()) bytes"))
                                .font(.footnote.monospacedDigit())
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                    .accessibilityIdentifier("prompt-preview-part.\(part.id)")
                }
            } else if failed {
                Text(String(localized: "Couldn’t load the prompt preview."))
                    .foregroundStyle(Theme.textSecondary)
            } else {
                Text(String(localized: "Loading…")).foregroundStyle(Theme.textSecondary)
            }
        } header: {
            if let data {
                Text(String(localized: "Prompt preview · \(data.totalBytes.formatted()) bytes ≈ \(data.approxTokens.formatted()) tokens"))
                    .accessibilityIdentifier("prompt-preview-header")
            } else {
                Text(String(localized: "Prompt preview"))
            }
        } footer: {
            if let note = data?.note, !note.isEmpty { Text(verbatim: note) }
        }
        .task(id: bot.id) { await load() }
    }

    private func load() async {
        guard let client = session.profileClient else { return }
        do {
            data = try await client.systemPrompt(botId: bot.id)
            failed = false
        } catch {
            // data wins over a failed refetch, as on the desktop
            if data == nil { failed = true }
        }
    }
}
