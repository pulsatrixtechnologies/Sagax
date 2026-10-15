// Settings > Usage for the signed-in person (#518, `UsageSection.tsx`):
// Cost (this month, the trend against the same days of last month, the
// last 30 days as a small line), then by bot and by model. Every figure is
// the person's own (`GET /api/usage?mine=1`); per-person tables,
// organization totals and budgets are Sagax Business's.
import CompanionCore
import SwiftUI

@MainActor
final class PersonalUsageModel: ObservableObject {
    @Published private(set) var usage: PersonalUsage?
    @Published private(set) var failed = false
    @Published private(set) var loaded = false

    func load(_ client: CompanionClient?) async {
        guard let client else { loaded = true; return }
        do {
            usage = try await client.personalUsage()
            failed = false
        } catch {
            failed = true
        }
        loaded = true
    }

    static func cost(_ usd: Double) -> String {
        usd.formatted(.currency(code: "USD").precision(.fractionLength(usd > 0 && usd < 0.01 ? 3 : 2)))
    }

    /// "This month, 12 turns", then the trend.
    static func monthLine(_ usage: PersonalUsage) -> String {
        let turns = usage.month.total?.turns ?? 0
        var line = String(format: AppStrings.localized("This month, %lld turns"), turns)
        if let trend = usage.trend {
            let part: String
            if trend > 0 {
                part = String(format: AppStrings.localized("%lld%% more than last month"), trend)
            } else if trend < 0 {
                part = String(format: AppStrings.localized("%lld%% less than last month"), -trend)
            } else {
                part = AppStrings.localized("Same as last month")
            }
            line += " · " + part
        }
        return line
    }
}

/// The last 30 days' cost, oldest at the left.
struct UsageSparkline: View {
    let values: [Double]
    var color: Color

    var body: some View {
        GeometryReader { geo in
            let peak = values.max() ?? 0
            if values.count >= 2, peak > 0 {
                Path { path in
                    let step = geo.size.width / CGFloat(values.count - 1)
                    for (index, value) in values.enumerated() {
                        let point = CGPoint(x: CGFloat(index) * step,
                                            y: geo.size.height - 2 - CGFloat(value / peak) * (geo.size.height - 4))
                        if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
                    }
                }
                .stroke(color, style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
            } else {
                Rectangle().fill(color.opacity(0.25)).frame(height: 1).frame(maxHeight: .infinity, alignment: .bottom)
            }
        }
        .frame(width: 120, height: 28)
        .accessibilityHidden(true)
    }
}

/// The phone's Usage page body.
struct PersonalUsageSection: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @StateObject private var model = PersonalUsageModel()
    @State private var allBots = false
    @State private var allModels = false

    var body: some View {
        SettingsSectionLabel(text: "Cost")
        SettingsCard {
            costBody
                .padding(.horizontal, SettingsMetrics.rowInset)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityIdentifier("usage-personal-cost")
        if let usage = model.usage, !usage.isEmpty {
            groups(title: "By bot", PersonalUsageRules.ranked(usage.byBot), all: $allBots, id: "bot")
            groups(title: "By model", PersonalUsageRules.ranked(usage.byModel), all: $allModels, id: "model")
        }
        SettingsSpacer(40)
            .task(id: session.connection?.id) { await model.load(session.settingsClient) }
    }

    @ViewBuilder
    private var costBody: some View {
        if model.failed {
            Text("Your usage could not be loaded. Try again later.")
                .font(Theme.Font.label)
                .foregroundStyle(Theme.danger)
        } else if let usage = model.usage {
            if usage.isEmpty {
                Text("Nothing spent yet. Your cost shows after your bots' first turns.")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
            } else {
                HStack(alignment: .bottom, spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: PersonalUsageModel.cost(usage.cost))
                            .font(.system(size: 22, weight: .semibold).monospacedDigit())
                            .foregroundStyle(Theme.textPrimary)
                            .accessibilityIdentifier("usage-personal-cost-value")
                        Text(verbatim: PersonalUsageModel.monthLine(usage))
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.textSecondary)
                        if usage.estimated {
                            Text("Part of it is estimated from public prices.")
                                .font(.caption)
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                    Spacer(minLength: 0)
                    VStack(alignment: .trailing, spacing: 2) {
                        UsageSparkline(values: PersonalUsageRules.dailyCosts(usage.days30, range: PersonalUsagePeriods().days30),
                                       color: Theme.accentText)
                        Text("Last 30 days").font(.caption2).foregroundStyle(Theme.textSecondary)
                    }
                }
            }
        } else {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Loading…").font(Theme.Font.label).foregroundStyle(Theme.textSecondary)
            }
        }
    }

    @ViewBuilder
    private func groups(title: LocalizedStringKey, _ rows: [UsageGroup], all: Binding<Bool>, id: String) -> some View {
        SettingsSectionLabel(text: title)
        SettingsCard {
            if rows.isEmpty {
                SettingsRow(title: "Nothing this month.", identifier: "usage-personal-\(id)-empty")
            } else {
                let shown = all.wrappedValue ? rows : Array(rows.prefix(5))
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, row in
                    if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                    HStack(spacing: 10) {
                        Text(verbatim: row.label).lineLimit(1).foregroundStyle(Theme.textPrimary)
                        Spacer(minLength: 8)
                        Text("\(row.turns) turns").foregroundStyle(Theme.textSecondary).monospacedDigit()
                        Text(verbatim: row.costUsd.map(PersonalUsageModel.cost) ?? "·")
                            .foregroundStyle(Theme.textPrimary)
                            .monospacedDigit()
                            .frame(minWidth: 64, alignment: .trailing)
                    }
                    .font(Theme.Font.rowTitle)
                    .padding(.horizontal, SettingsMetrics.rowInset)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("usage-personal-\(id).\(row.key)")
                }
                if rows.count > 5 {
                    CardHairline(leadingInset: SettingsMetrics.rowInset)
                    SettingsRow(title: all.wrappedValue ? "Show less" : "Show all (\(rows.count))", identifier: "usage-personal-\(id)-all") {
                        all.wrappedValue.toggle()
                    }
                }
            }
        }
    }
}
