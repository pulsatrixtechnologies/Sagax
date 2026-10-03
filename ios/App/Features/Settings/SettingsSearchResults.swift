// Settings search (matrix ST11): the field of the Advanced sheet finds any
// page of Settings by its name or the desktop's keywords for it
// (SettingsDestination), and opens it there. The Settings root keeps its
// reference look (parity 12 and 14), so the field lives one level in.
import CompanionCore
import SwiftUI

struct SettingsSearchResults: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let query: String
    let closeSheet: (() -> Void)?

    var body: some View {
        let results = SettingsSearch.results(query, available: available, label: Self.label)
        if results.isEmpty {
            Section {
                Text("Nothing matches “\(query.trimmingCharacters(in: .whitespacesAndNewlines))”")
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("settings-search-empty")
            }
        } else {
            Section {
                ForEach(results, id: \.self) { destination in
                    NavigationLink {
                        SettingsDestinationView(destination: destination, closeSheet: closeSheet)
                    } label: {
                        Label { Text(verbatim: Self.label(destination)) } icon: { Image(systemName: Self.symbol(destination)) }
                    }
                    .accessibilityIdentifier("settings-search.\(destination.rawValue)")
                }
            }
        }
    }

    /// The pages this pairing shows; the sheets (Walkie voice, Updates) and
    /// the Advanced page itself are not destinations.
    private var available: [SettingsDestination] {
        let gate = session.surfaceGate
        return SettingsDestination.allCases.filter { destination in
            switch destination {
            case .walkieVoice, .updates, .chat: return false
            case .connectedApps: return gate.allows(.connectedApps) && session.connection != nil
            case .routines: return session.connection != nil
            case .achievements: return gate.allows(.achievements) && AchievementStore.shared.status != .unavailable
            case .organization: return gate.allows(.organizationSettings)
            default: return true
            }
        }
    }

    static func label(_ destination: SettingsDestination) -> String {
        switch destination {
        case .account: String(localized: "Account")
        case .usage: String(localized: "Usage")
        case .plugins: String(localized: "Plugins")
        case .rules: String(localized: "Auto-review Rules")
        case .timeZone: String(localized: "Time Zone")
        case .botComputer: String(localized: "Bot Computer")
        case .appearance: String(localized: "Appearance")
        case .language: String(localized: "Language")
        case .haptics: String(localized: "Haptics")
        case .computers: String(localized: "Computers")
        case .routines: String(localized: "Threads & Routines")
        case .quickReplies: String(localized: "Quick Replies")
        case .connectedApps: String(localized: "Connected Apps")
        case .walkieVoice: String(localized: "Walkie voice")
        case .updates: String(localized: "Updates")
        case .chat: String(localized: "Chat")
        case .achievements: String(localized: "Achievements")
        case .organization: String(localized: "Organization")
        case .about: String(localized: "About")
        }
    }

    static func symbol(_ destination: SettingsDestination) -> String {
        switch destination {
        case .account: "person.crop.circle"
        case .usage: "chart.bar"
        case .plugins: "puzzlepiece.extension"
        case .rules: "checklist"
        case .timeZone: "clock"
        case .botComputer: "desktopcomputer"
        case .appearance: "paintpalette"
        case .language: "globe"
        case .haptics: "speaker.wave.2"
        case .computers: "laptopcomputer"
        case .routines: "calendar.badge.clock"
        case .quickReplies: "bolt"
        case .connectedApps: "link"
        case .walkieVoice: "waveform"
        case .updates: "bell.badge"
        case .chat: "bubble.left"
        case .achievements: "trophy"
        case .organization: "building.2"
        case .about: "info.circle"
        }
    }
}

/// A Settings page opened from the search or the Advanced sheet.
struct SettingsDestinationView: View {
    @Environment(\.themePalette) var themePalette
    let destination: SettingsDestination
    let closeSheet: (() -> Void)?

    var body: some View {
        switch destination {
        case .account: AccountSettingsView(closeSheet: closeSheet)
        case .usage: UsageSettingsView()
        case .plugins: PluginsView()
        case .rules: AutoReviewRulesView()
        case .timeZone: TimeZonePickerView()
        case .botComputer: BotComputerSettingsView()
        case .appearance: AppearanceSettingsView()
        case .language: LanguageSettingsView()
        case .haptics: HapticsSettingsView()
        case .computers: ConnectedComputersView()
        case .routines: TasksRoutinesView()
        case .quickReplies: QuickRepliesEditor()
        case .connectedApps: ConnectedAppsView()
        case .achievements: AchievementsPage()
        case .organization: OrganizationSettingsPage()
        case .about, .walkieVoice, .updates, .chat: AboutPage()
        }
    }
}
