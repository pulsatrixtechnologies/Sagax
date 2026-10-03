// What the person hid from their sidebar (matrix row SB25), and the thread
// switch (SB10): the home's "Hidden (N)" row at the foot of the list
// (Sidebar.tsx HiddenEntriesRow) and Settings > Appearance
// (SidebarHiddenSettings.tsx, SettingsModal ShowThreadsRow).
import CompanionCore
import SwiftUI

/// The foot of the home list: closed by default; each entry comes back
/// with Show. Drawn only when something is hidden.
struct HomeHiddenEntries: View {
    @Environment(\.themePalette) var themePalette
    let rows: [SidebarHiddenRow]
    @ObservedObject var prefs: SidebarPrefsModel
    @EnvironmentObject private var session: Session
    @State private var open = false

    var body: some View {
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                HomeSectionHeader(title: String(localized: "Hidden (\(rows.count))"), collapsed: !open) { open.toggle() }
                    .accessibilityIdentifier("section.__hidden")
                if open {
                    ForEach(rows) { row in
                        HStack(spacing: 8) {
                            Text(verbatim: row.name)
                                .font(HomeMetrics.name)
                                .foregroundStyle(Theme.textSecondary)
                                .lineLimit(1)
                            Spacer(minLength: 8)
                            Button {
                                Haptics.selection()
                                prefs.show(session, [row.key])
                            } label: {
                                Label("Show", systemImage: "eye")
                                    .font(Theme.Font.label)
                                    .foregroundStyle(Theme.accentText)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(Text("Show \(row.name) in the sidebar"))
                            .accessibilityIdentifier("hidden-show.\(row.key)")
                        }
                        .padding(.leading, HomeMetrics.textColumn)
                        .padding(.trailing, HomeMetrics.rowTrailing)
                        .frame(minHeight: 44)
                    }
                }
            }
            .padding(.top, 8)
        }
    }
}

/// Settings > Appearance: the thread switch, then the hidden entries with
/// Show and whether a new message brings one back.
struct SidebarAppearanceSettings: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @ObservedObject private var prefs = SidebarPrefsModel.shared

    var body: some View {
        let rows = prefs.layout(session).hiddenRows
        SettingsSectionLabel(text: "Threads")
        SettingsCard {
            SettingsRow(
                title: "Show threads",
                subtitle: "Show thread lists and controls on this device.",
                accessory: .toggle(Binding(
                    get: { prefs.showThreads },
                    set: { prefs.setShowThreads(session, $0) }
                )),
                identifier: "settings.showThreads"
            )
        }
        SettingsSectionLabel(text: "Hidden from the sidebar")
        SettingsCard {
            if rows.isEmpty {
                SettingsRow(title: "Nothing hidden. Long-press a bot, a group or a person to hide it; it stays in search.")
            }
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                HStack(spacing: 8) {
                    Text(verbatim: row.name)
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text(kindLabel(row.kind))
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                    Button {
                        Haptics.selection()
                        prefs.show(session, [row.key])
                    } label: {
                        Label("Show", systemImage: "eye")
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.accentText)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Show \(row.name) in the sidebar"))
                    .accessibilityIdentifier("settings-hidden-show.\(row.key)")
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
            }
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(
                title: "Show people again when they write",
                subtitle: "A hidden person or group comes back when a new message arrives, so a colleague is never missed.",
                accessory: .toggle(Binding(
                    get: { prefs.prefs.hidden.unhidePeople },
                    set: { prefs.setUnhide(session, people: $0) }
                )),
                identifier: "settings.unhidePeople"
            )
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(
                title: "Show bots again when they post",
                subtitle: "Off by default: bots post on their own (routines, reports), so a bot you hid would come back at every run.",
                accessory: .toggle(Binding(
                    get: { prefs.prefs.hidden.unhideBots },
                    set: { prefs.setUnhide(session, bots: $0) }
                )),
                identifier: "settings.unhideBots"
            )
        }
        .task(id: session.connection?.id) { await prefs.load(session) }
    }

    private func kindLabel(_ kind: HiddenKind) -> LocalizedStringKey {
        switch kind {
        case .bot: "Bot"
        case .group: "Group"
        case .person: "Person"
        }
    }
}
