// The Usage page's two cards beyond the month (matrix ST10): what each bot
// spent, summed from its threads like the desktop's UsageSection.tsx, and
// for an admin (or the computer's owner) the History card
// (UsageHistory.tsx): a period, a grouping, the table, and the CSV export.
import CompanionCore
import SwiftUI

struct UsageByBotSection: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session

    var body: some View {
        let rows = UsageByBot.rows(session.state.bots)
        let total = UsageByBot.total(rows)
        SettingsSectionLabel(text: "Per bot")
        SettingsCard {
            if rows.isEmpty {
                SettingsRow(title: "Nothing spent yet", identifier: "usage-bots-empty")
            } else {
                UsageTableHeader(tokens: total.cachedInput != nil ? "New tokens" : "Tokens")
                ForEach(rows) { row in
                    CardHairline(leadingInset: SettingsMetrics.rowInset)
                    UsageTableRow(
                        leading: AnyView(HStack(spacing: 8) {
                            BotMascotView(bot: row.bot, size: 22)
                            Text(verbatim: row.bot.name).lineLimit(1)
                        }),
                        turns: row.usage.turns,
                        tokens: BotUsageTotal.formatTokens(row.usage.headlineTokens),
                        cost: row.usage.hasCost ? BotUsageTotal.formatUsd(row.usage.costUsd ?? 0) : "—"
                    )
                    .accessibilityIdentifier("usage-bot.\(row.bot.id)")
                }
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                UsageTableRow(
                    leading: AnyView(Text("All bots")),
                    turns: total.turns,
                    tokens: BotUsageTotal.formatTokens(total.headlineTokens),
                    cost: total.hasCost ? BotUsageTotal.formatUsd(total.costUsd ?? 0) : "—",
                    bold: true
                )
                .accessibilityIdentifier("usage-bots-total")
            }
        }
        SettingsFooter(text: rows.isEmpty
            ? "Nothing spent yet. Figures appear after a bot's first turn."
            : "Tokens and cost per bot, added up from every settled turn. Only providers that report a price show one.")
    }
}

struct UsageHistorySection: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @State private var period: UsagePeriod = .month
    @State private var groupBy: UsageGroupBy = .bot
    @State private var history: UsageHistory?
    @State private var loading = false
    @State private var failure: String?
    @State private var export: ExportedFile?

    var body: some View {
        SettingsSectionLabel(text: "History")
        SettingsCard {
            HStack {
                Text("Period").font(Theme.Font.rowTitle).foregroundStyle(Theme.textPrimary)
                Spacer()
                Picker(selection: $period) {
                    Text("This month").tag(UsagePeriod.month)
                    Text("Last month").tag(UsagePeriod.lastMonth)
                    Text("Last 30 days").tag(UsagePeriod.days30)
                } label: { Text("Period") }
                    .tint(Theme.textSecondary)
                    .accessibilityIdentifier("usage-history-period")
            }
            .padding(.leading, SettingsMetrics.rowInset)
            .padding(.trailing, 8)
            .frame(minHeight: 44)
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            HStack {
                Text("Group by").font(Theme.Font.rowTitle).foregroundStyle(Theme.textPrimary)
                Spacer()
                Picker(selection: $groupBy) {
                    ForEach(UsageGroupBy.allCases, id: \.self) { Text(Self.groupLabel($0)).tag($0) }
                } label: { Text("Group by") }
                    .tint(Theme.textSecondary)
                    .accessibilityIdentifier("usage-history-group")
            }
            .padding(.leading, SettingsMetrics.rowInset)
            .padding(.trailing, 8)
            .frame(minHeight: 44)
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            table
        }
        SettingsSpacer(12)
        SettingsCard {
            SettingsRow(title: "Export CSV", systemImage: "square.and.arrow.up", accessory: export == nil && loading ? .progress : .chevron, identifier: "usage-history-export") {
                Task { await exportCSV() }
            }
        }
        SettingsFooter(text: "Every settled turn, kept month by month on the server. Pick a period, group it, or export it for an invoice.")
            .task(id: "\(period.rawValue).\(groupBy.rawValue)") { await load() }
            .sheet(item: $export) { file in ActivityShareSheet(items: [file.url]) }
    }

    @ViewBuilder
    private var table: some View {
        if let failure {
            SettingsRow(title: LocalizedStringKey(stringLiteral: failure))
        } else if let history {
            if history.groups.isEmpty {
                SettingsRow(title: "Nothing recorded in this period.", identifier: "usage-history-empty")
            } else {
                UsageTableHeader(tokens: "Tokens", first: Self.groupLabel(groupBy))
                ForEach(history.groups) { group in
                    CardHairline(leadingInset: SettingsMetrics.rowInset)
                    UsageTableRow(leading: AnyView(label(group).lineLimit(1)), turns: group.turns,
                                  tokens: BotUsageTotal.formatTokens(group.tokens), cost: group.costText)
                        .accessibilityIdentifier("usage-history-row.\(group.key)")
                }
                if let total = history.total {
                    CardHairline(leadingInset: SettingsMetrics.rowInset)
                    UsageTableRow(leading: AnyView(Text("Total")), turns: total.turns, tokens: BotUsageTotal.formatTokens(total.tokens),
                                  cost: total.costText, bold: true)
                        .accessibilityIdentifier("usage-history-total")
                }
            }
        } else {
            SettingsRow(title: "Checking…", accessory: .progress)
        }
    }

    private func label(_ group: UsageGroup) -> Text {
        switch group.displayLabel {
        case let .text(text): Text(verbatim: text)
        case .owner: Text("This computer")
        case .botToBot: Text("Bot to bot")
        case .notRoutine: Text("Not from a routine")
        case let .routine(name): Text("Routine: \(name)")
        }
    }

    static func groupLabel(_ group: UsageGroupBy) -> LocalizedStringKey {
        switch group {
        case .bot: "Bot"
        case .model: "Model"
        case .user: "Person"
        case .day: "Day"
        case .engine: "Provider"
        case .routine: "Routine"
        }
    }

    private func load() async {
        guard let client = session.settingsClient else { return }
        failure = nil
        do { history = try await client.usageHistory(period: period, groupBy: groupBy) } catch {
            history = nil
            failure = error.localizedDescription
        }
    }

    private func exportCSV() async {
        guard let client = session.settingsClient, !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let (data, name) = try await client.usageCSV(period: period)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
            try data.write(to: url, options: .atomic)
            export = ExportedFile(url: url)
        } catch {
            failure = error.localizedDescription
        }
    }

    struct ExportedFile: Identifiable {
        let url: URL
        var id: String { url.path }
    }
}

private struct UsageTableHeader: View {
    @Environment(\.themePalette) var themePalette
    let tokens: LocalizedStringKey
    var first: LocalizedStringKey = "Bot"

    var body: some View {
        HStack(spacing: 10) {
            Text(first).frame(maxWidth: .infinity, alignment: .leading)
            Text("Turns").frame(width: 46, alignment: .trailing)
            Text(tokens).frame(width: 74, alignment: .trailing)
            Text("Cost").frame(width: 66, alignment: .trailing)
        }
        .font(Theme.Font.labelMedium)
        .textCase(.uppercase)
        .foregroundStyle(Theme.textSecondary)
        .padding(.horizontal, SettingsMetrics.rowInset)
        .padding(.vertical, 9)
    }
}

private struct UsageTableRow: View {
    @Environment(\.themePalette) var themePalette
    let leading: AnyView
    let turns: Int
    let tokens: String
    let cost: String
    var bold = false

    var body: some View {
        HStack(spacing: 10) {
            leading.frame(maxWidth: .infinity, alignment: .leading)
            Text(verbatim: "\(turns)").frame(width: 46, alignment: .trailing).foregroundStyle(Theme.textSecondary)
            Text(verbatim: tokens).frame(width: 74, alignment: .trailing)
            Text(verbatim: cost).frame(width: 66, alignment: .trailing)
        }
        .font(bold ? Theme.Font.bodyMedium : Theme.Font.rowTitle)
        .monospacedDigit()
        .foregroundStyle(Theme.textPrimary)
        .padding(.horizontal, SettingsMetrics.rowInset)
        .padding(.vertical, 9)
        .accessibilityElement(children: .combine)
    }
}
