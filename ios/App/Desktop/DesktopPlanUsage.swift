// iPad I-sync: Settings > Usage > Plan usage (`PlanUsage.tsx`): each
// signed-in provider's remaining allowance (name 14 medium and the plan 12,
// then the 5-hour, weekly, extra and per-model windows: a 72 pt label, the
// headline "72% left · resets in 2h 30m" and a 6 pt meter in the usage
// tone), or the provider's error in red. Refresh asks the providers again;
// a window whose reset has passed refreshes on its own (checked every 30 s).
import SwiftUI
import CompanionCore

struct DesktopPlanUsageCard: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session

    @State private var report: PlanUsageReport?
    @State private var loading = true
    @State private var error = ""
    @State private var now = Date()

    var body: some View {
        DesktopSettingsCard(
            Text("Plan usage"),
            subtitle: Text("Remaining allowance on each signed-in provider. 5-hour and weekly windows, when that plan has them."),
            identifier: "usage.plan"
        ) {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Spacer(minLength: 0)
                    Button { Task { await load(refresh: true) } } label: {
                        Group {
                            if loading { ProgressView().controlSize(.small) } else { DesktopSettingsIconView(icon: .refreshCw, size: 14) }
                        }
                        .foregroundStyle(theme.inkSecondary)
                        .frame(width: 30, height: 30)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(DesktopHoverFill(radius: 6, fill: \.control))
                    .disabled(loading)
                    .accessibilityLabel(Text("Refresh"))
                }
                .padding(.bottom, 12)
                AnyView(content)
            }
        }
        .task(id: session.connection?.id) {
            await load(refresh: false)
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                now = Date()
                if let report, !loading, PlanUsageRules.hasDueReset(report, now: now) { await load(refresh: true) }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if loading && report == nil {
            DesktopText(Text("Checking plan usage…"), color: \.inkSecondary)
        }
        if !error.isEmpty {
            DesktopText(verbatim: error, size: 13, line: 18, color: \.danger).padding(.bottom, 12)
        }
        if let report {
            if report.providers.isEmpty {
                DesktopText(Text("No Claude, Codex, or Grok account is configured."), color: \.inkSecondary)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(Array(report.providers.enumerated()), id: \.element.id) { index, provider in
                        if index > 0 { Rectangle().fill(theme.hairline.opacity(0.3)).frame(height: 1) }
                        AnyView(providerView(provider))
                    }
                }
            }
        }
    }

    private func providerView(_ provider: PlanUsageReport.Provider) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(verbatim: provider.name).font(theme.font(14, .medium)).foregroundStyle(theme.ink).lineLimit(1)
                if let plan = provider.plan, !plan.isEmpty {
                    Text(verbatim: plan).font(theme.font(12)).foregroundStyle(theme.inkSecondary).lineLimit(1)
                }
            }
            if provider.ok {
                AnyView(windowRow(String(localized: "5-hour"), provider.fiveHour))
                AnyView(windowRow(String(localized: "Weekly"), provider.weekly))
                ForEach(Array(provider.extra.enumerated()), id: \.offset) { _, extra in
                    AnyView(windowRow(label(extra.label), extra.window))
                }
                if let models = provider.models, !models.isEmpty {
                    Text("By model").font(theme.font(11, .medium)).tracking(0.9).textCase(.uppercase)
                        .foregroundStyle(theme.inkSecondary).padding(.top, 4)
                    ForEach(models, id: \.name) { model in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(verbatim: model.name).font(theme.font(13, .medium)).foregroundStyle(theme.ink)
                            ForEach(Array(model.windows.enumerated()), id: \.offset) { _, entry in
                                AnyView(windowRow(label(entry.label), entry.window, usedHeadline: true))
                            }
                        }
                    }
                }
            } else {
                Text(verbatim: provider.error ?? "").font(theme.font(13)).foregroundStyle(theme.danger)
            }
        }
    }

    private func label(_ raw: String) -> String {
        switch raw {
        case "5-hour": String(localized: "5-hour")
        case "Weekly": String(localized: "Weekly")
        default: raw
        }
    }

    private func windowRow(_ label: String, _ window: PlanUsageReport.Window, usedHeadline: Bool = false) -> some View {
        let used = min(100, max(0, window.usedPercent ?? 0))
        let headline: String? = usedHeadline
            ? window.usedPercent.map { String(localized: "\(Int($0.rounded()))% used") }
            : window.remainingPercent.map { String(localized: "\(Int($0.rounded()))% left") }
        let when = window.available ? PlanUsageRules.resetDistance(window.resetsAt, now: now) : nil
        return HStack(alignment: .center, spacing: 12) {
            Text(verbatim: label).font(theme.font(12)).foregroundStyle(theme.inkSecondary).frame(width: 72, alignment: .leading)
            if window.available, let headline {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(verbatim: headline).font(theme.font(13)).monospacedDigit().foregroundStyle(theme.ink)
                        if let when {
                            Text("resets in \(when)").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                        }
                    }
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            Capsule().fill(theme.inset)
                            Capsule().fill(tone(used)).frame(width: geometry.size.width * used / 100)
                        }
                    }
                    .frame(height: 6)
                    .accessibilityLabel(Text(verbatim: label))
                    .accessibilityValue(Text(verbatim: "\(Int(used.rounded()))%"))
                }
            } else {
                Text("Not reported by this plan").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
            }
        }
    }

    private func tone(_ used: Double) -> Color {
        switch PlanUsageRules.tone(used: used) {
        case .danger: theme.danger
        case .warning: theme.warning
        case .success: theme.success
        }
    }

    private func load(refresh: Bool) async {
        guard let client = session.settingsClient else { loading = false; return }
        loading = true
        error = ""
        do {
            report = try await client.planUsage(refresh: refresh)
            now = Date()
        } catch {
            self.error = error.localizedDescription.isEmpty ? String(localized: "Could not load plan usage.") : error.localizedDescription
        }
        loading = false
    }
}
