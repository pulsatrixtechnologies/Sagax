// Settings (iOS parity 12 and 14): the card sheet the account menu opens.
//
// One flat list in the desktop's order (SettingsModal.tsx `SECTIONS`, the
// sections a phone pairing can use: NavigationMenus.settings) under the
// account card, which is Pair devices (switch, add, sign out, delete). The
// phone's own settings sit in General; list density, activity and the bot
// intro in Appearance. The search at the top finds any page.
// Geometry: measure-settings.md §1 to §4.
import CompanionCore
import SwiftUI
import UIKit
import MessageUI

/// The sheet's pages.
enum SettingsRoute: Hashable {
    case account, usage, plugins, rules, timeZone, botComputer, appearance, language, haptics, general, experimental
}

struct SettingsView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @StateObject private var model = SettingsModel()
    @StateObject private var navigator = SettingsNavigator()
    private let onConnect: (() -> Void)?
    private let close: (() -> Void)?

    /// `close` set: the card sheet, with an X. Otherwise pushed inside the
    /// caller's navigation (onboarding), with a back circle.
    ///
    /// The sheet's pages slide in from its own small stack rather than a
    /// NavigationStack: the card sheet sits over the home, whose stack would
    /// take the pushes and draw them full screen.
    init(onConnect: (() -> Void)? = nil, close: (() -> Void)? = nil) {
        self.onConnect = onConnect
        self.close = close
    }

    var body: some View {
        ZStack {
            SettingsRootPage(close: close, onConnect: onConnect)
            ForEach(Array(navigator.routes.enumerated()), id: \.offset) { index, route in
                SettingsRouteView(route: route, onConnect: onConnect, closeSheet: close)
                    .environment(\.settingsPop, { navigator.pop() })
                    .transition(.move(edge: .trailing))
                    .zIndex(Double(index + 1))
                    .gesture(
                        DragGesture(minimumDistance: 20)
                            .onEnded { value in
                                if value.startLocation.x < 30, value.translation.width > 80 { navigator.pop() }
                            }
                    )
            }
        }
        .animation(.spring(response: 0.34, dampingFraction: 0.92), value: navigator.routes)
        // The references were taken with the home indicator auto-hidden.
        .persistentSystemOverlays(ParityMode.isActive ? .hidden : .automatic)
        .environmentObject(model)
        .environmentObject(navigator)
        .sheet(item: $navigator.sheet) { page in
            SettingsSheetPageView(page: page)
                .environmentObject(session)
                .environmentObject(model)
        }
        .task {
            model.attach(session)
            if let route = Self.initialRoute, navigator.routes.isEmpty {
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) { navigator.routes = [route] }
            }
            await model.load()
        }
    }

    /// The parity harness opens 15, 16 and 21 one level in.
    private static var initialRoute: SettingsRoute? {
#if DEBUG
        switch ParityLaunch.current?.screen {
        case .plugins?: return .plugins
        case .account?: return .account
        case .botComputer?: return .botComputer
        case .appearance?: return .appearance
        default: return nil
        }
#else
        return nil
#endif
    }
}

/// The sheet's page stack, and the pages drawn as lists of their own.
@MainActor
final class SettingsNavigator: ObservableObject {
    @Published var routes: [SettingsRoute] = []
    @Published var sheet: SettingsSheetPage?

    func push(_ route: SettingsRoute) { routes.append(route) }
    func pop() { if !routes.isEmpty { routes.removeLast() } }
}

private struct SettingsPopKey: EnvironmentKey {
    static let defaultValue: (() -> Void)? = nil
}

extension EnvironmentValues {
    /// Back, for a page shown by the sheet's own stack.
    var settingsPop: (() -> Void)? {
        get { self[SettingsPopKey.self] }
        set { self[SettingsPopKey.self] = newValue }
    }
}

// MARK: - Root

private struct SettingsRootPage: View {
    @Environment(\.themePalette) var themePalette
    let close: (() -> Void)?
    let onConnect: (() -> Void)?

    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: SettingsModel
    @EnvironmentObject private var navigator: SettingsNavigator
    @ObservedObject private var themes = ThemeStore.shared
    @ObservedObject private var achievements = AchievementStore.shared
    @State private var query = ""

    private var sections: [PhoneSettingsSection] {
        NavigationMenus.settings(
            gate: session.surfaceGate,
            connected: session.connection != nil,
            achievementsAvailable: achievements.status != .unavailable
        )
        // Pair devices is the account card above the list.
        .filter { $0 != .pairDevices }
    }

    var body: some View {
        SettingsPage(leading: close.map { .close($0) } ?? .back) {
            SettingsSearchField(prompt: "Search", text: $query, identifier: "settings-search")
                .padding(.horizontal, SettingsMetrics.cardMargin)
            SettingsSpacer(18)
            if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                accountCard
                SettingsSpacer(SettingsMetrics.cardGap)
                SettingsCard {
                    ForEach(Array(sections.enumerated()), id: \.element) { index, section in
                        if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                        row(section)
                    }
                }
                footer
            } else {
                SettingsSearchResults(query: query, open: open)
            }
#if DEBUG
            if ParityLaunch.current?.screen == .settingsBottom {
                ScrollOffsetSetter(offset: 400).frame(width: 0, height: 0)
            }
#endif
        }
        .alert("Settings", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(verbatim: model.error ?? "")
        }
        .onReceive(NotificationCenter.default.publisher(for: .NSSystemTimeZoneDidChange)) { _ in
            Task { await model.syncTimeZoneIfAutomatic() }
        }
    }

    // MARK: Rows

    private var accountCard: some View {
        SettingsCard {
            AccountCardRow(name: model.displayName, detail: model.detail, photo: session.accountPhoto, chevron: true) { navigator.push(.account) }
        }
    }

    @ViewBuilder
    private func row(_ section: PhoneSettingsSection) -> some View {
        switch section {
        case .general:
            SettingsRow(title: "General", systemImage: "gearshape", accessory: .chevron, height: 44.33, identifier: "settings-general") { navigator.push(.general) }
        case .organization:
            SettingsRow(title: "Organization", systemImage: "building.2", accessory: .chevron, height: 44.33, identifier: "settings-organization") { navigator.sheet = .organization }
        case .appearance:
            SettingsRow(title: "Appearance", systemImage: "paintpalette", accessory: .valueChevron(appearanceValue), height: 44.33, identifier: "settings-appearance") { navigator.push(.appearance) }
        case .achievements:
            SettingsRow(title: "Achievements", systemImage: "trophy", accessory: .chevron, height: 44.33, identifier: "settings-achievements") { navigator.sheet = .achievements }
        case .experimental:
            SettingsRow(title: "Experimental", systemImage: "flask", accessory: .chevron, height: 44.33, identifier: "settings-experimental") { navigator.push(.experimental) }
        case .plugins:
            SettingsRow(title: "Plugins", systemImage: "puzzlepiece.extension", accessory: .chevron, height: 44.33, identifier: "settings-plugins") { navigator.push(.plugins) }
        case .pairDevices:
            SettingsRow(title: "Pair devices", systemImage: "iphone", accessory: .chevron, height: 44.33, identifier: "settings-account") { navigator.push(.account) }
        case .computer:
            SettingsRow(title: "Computer", systemImage: "desktopcomputer", accessory: .chevron, height: 44.33, identifier: "settings-bot-computer") { navigator.push(.botComputer) }
        case .usage:
            SettingsRow(title: "Usage", systemImage: "chart.bar", accessory: model.usagePercent.map { .valueChevron("\($0)%") } ?? .chevron, height: 44.33, identifier: "settings-usage") { navigator.push(.usage) }
        }
    }

    /// "System · Black": how the skin is chosen, then the one worn now.
    private var appearanceValue: String {
        let mode: String
        switch themes.effective.mode {
        case .system: mode = String(localized: "System")
        case .fixed: mode = String(localized: "Fixed")
        case .computer: mode = String(localized: "Computer")
        }
        return "\(mode) · \(themePalette.id.name)"
    }

    /// The white Sagax owl over "Sagax".
    private var footer: some View {
        VStack(spacing: 0) {
            BrandMascotView(owlColor: "white", size: 47.67, animated: false)
            Text(verbatim: "Sagax")
                .font(Theme.Font.appName)
                .foregroundStyle(Theme.textPrimary)
                .padding(.top, 15.3)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60.67)
        .padding(.bottom, 40)
    }

    // MARK: Search

    private func open(_ destination: SettingsDestination) {
        switch destination {
        case .general: navigator.push(.general)
        case .organization: navigator.sheet = .organization
        case .appearance: navigator.push(.appearance)
        case .achievements: navigator.sheet = .achievements
        case .experimental: navigator.push(.experimental)
        case .plugins: navigator.push(.plugins)
        case .account: navigator.push(.account)
        case .botComputer: navigator.push(.botComputer)
        case .usage: navigator.push(.usage)
        case .rules: navigator.push(.rules)
        case .timeZone: navigator.push(.timeZone)
        case .language: navigator.push(.language)
        case .haptics: navigator.push(.haptics)
        case .quickReplies: navigator.sheet = .quickReplies
        case .walkieVoice: navigator.sheet = .walkieVoice
        case .about: navigator.sheet = .about
        }
    }
}

/// A route's page.
struct SettingsRouteView: View {
    @Environment(\.themePalette) var themePalette
    let route: SettingsRoute
    let onConnect: (() -> Void)?
    let closeSheet: (() -> Void)?

    var body: some View {
        switch route {
        case .account: AccountSettingsView(closeSheet: closeSheet)
        case .usage: UsageSettingsView()
        case .plugins: PluginsView()
        case .rules: AutoReviewRulesView()
        case .timeZone: TimeZonePickerView()
        case .botComputer: BotComputerSettingsView()
        case .appearance: AppearanceSettingsView()
        case .language: LanguageSettingsView()
        case .haptics: HapticsSettingsView()
        case .general: GeneralSettingsView()
        case .experimental: ExperimentalSettingsView()
        }
    }
}

/// Vertical space between cards.
struct SettingsSpacer: View {
    @Environment(\.themePalette) var themePalette
    let height: CGFloat
    init(_ height: CGFloat) { self.height = height }
    var body: some View { Color.clear.frame(height: height) }
}

// MARK: - Usage

struct UsageSettingsView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var model: SettingsModel
    @EnvironmentObject private var session: Session

    var body: some View {
        SettingsPage(title: "Usage") {
            SettingsCard {
                SettingsRow(title: "This month", accessory: .value(model.usagePercent.map { "\($0)%" } ?? "—"), height: 44.33)
                if let budget = model.usage?.budget {
                    if let spent = budget.spentUsd {
                        CardHairline(leadingInset: SettingsMetrics.rowInset)
                        SettingsRow(title: "Spent", accessory: .value(Self.dollars(spent)), height: 43.67)
                    }
                    if let monthly = budget.monthlyUsd {
                        CardHairline(leadingInset: SettingsMetrics.rowInset)
                        SettingsRow(title: "Monthly budget", accessory: .value(Self.dollars(monthly)), height: 43.67)
                    }
                }
            }
            SettingsFooter(text: model.usage?.budget?.exceeded == true
                ? "The monthly budget is used up. Bots pause new paid work until next month or until the budget is raised on the computer."
                : "Spending on paid engines this month, against the budget set on the computer.")
            // What each bot spent (ST10), then the History for an admin.
            UsageByBotSection()
            if session.surfaceGate.allows(.usageHistory) {
                UsageHistorySection()
            }
        }
    }

    private static func dollars(_ value: Double) -> String {
        value.formatted(.currency(code: "USD").precision(.fractionLength(2)))
    }
}

// MARK: - Appearance, language, haptics

struct LanguageSettingsView: View {
    @Environment(\.themePalette) var themePalette
    @AppStorage(PrefKey.language) private var language = AppLanguage.system.rawValue

    var body: some View {
        SettingsPage(title: "Language") {
            SettingsCard {
                ForEach(Array(AppLanguage.allCases.enumerated()), id: \.element) { index, option in
                    if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                    SettingsRow(title: option.label, accessory: language == option.rawValue ? .check : .none, identifier: "language.\(option.rawValue)") {
                        language = option.rawValue
                    }
                }
            }
            SettingsFooter(text: "Changes the language inside Sagax. Buttons drawn by iOS itself follow the phone's language.")
        }
    }
}

struct HapticsSettingsView: View {
    @Environment(\.themePalette) var themePalette
    @AppStorage(PrefKey.haptics) private var haptics = true

    var body: some View {
        SettingsPage(title: "Haptics") {
            SettingsCard {
                SettingsRow(title: "On", accessory: haptics ? .check : .none, identifier: "haptics.on") { haptics = true }
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(title: "Off", accessory: haptics ? .none : .check, identifier: "haptics.off") { haptics = false }
            }
            SettingsFooter(text: "Small taps when you press buttons, switch options and send.")
            NotificationSoundsCard()
        }
    }
}

struct ConnectionSecurityView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var confirmingSignOut = false
    @State private var editingAddress = false
    @State private var addressText = ""
    @State private var showingFullAddress = false
    @State private var copiedAddress = false
    @State private var refreshing = false

    var body: some View {
        ThemedForm {
            if let connection = session.connection {
                Section {
                    HStack(spacing: 14) {
                        ProfileAvatar(name: connection.name, size: 46)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(connection.name)
                                .font(.headline)
                            Label {
                                session.status.settingsText
                            } icon: {
                                Image(systemName: session.status == .live ? "checkmark.circle.fill" : "circle.dotted")
                            }
                                .font(.subheadline)
                                .foregroundStyle(session.status == .live ? Theme.success : Theme.textSecondary)
                        }
                    }
                    .padding(.vertical, 4)
                    .accessibilityElement(children: .combine)
                }

                Section {
                    DisclosureGroup("Connection details") {
                        VStack(alignment: .leading, spacing: 12) {
                            Group {
                                if showingFullAddress {
                                    Text(connection.displayAddress)
                                        .textSelection(.enabled)
                                } else {
                                    Text(shortened(connection.displayAddress))
                                        .lineLimit(1)
                                        .truncationMode(.middle)
                                }
                            }
                            .font(.footnote.monospaced())
                            .foregroundStyle(Theme.textSecondary)

                            HStack(spacing: 16) {
                                Button(showingFullAddress ? "Hide full address" : "Show full address") {
                                    showingFullAddress.toggle()
                                }
                                Button(copiedAddress ? "Copied" : "Copy") {
                                    UIPasteboard.general.string = connection.displayAddress
                                    copiedAddress = true
                                    Task {
                                        try? await Task.sleep(for: .seconds(2))
                                        copiedAddress = false
                                    }
                                }
                            }
                            .font(.subheadline.weight(.medium))
                        }
                        .padding(.top, 10)
                    }

                    Button("Edit address") {
                        addressText = connection.displayAddress
                        editingAddress = true
                    }
                }

                Section("Troubleshooting") {
                    troubleshootingText
                        .font(.subheadline)
                        .foregroundStyle(Theme.textSecondary)

                    Button {
                        refreshing = true
                        Task {
                            await session.refresh()
                            refreshing = false
                        }
                    } label: {
                        HStack {
                            Text("Try reconnecting")
                            if refreshing {
                                Spacer()
                                ProgressView().controlSize(.small)
                            }
                        }
                    }
                    .disabled(refreshing)
                }

                Section {
                    Button("Remove connection from this device", role: .destructive) {
                        confirmingSignOut = true
                    }
                }
            } else {
                EmptyStateView("No computer connected", systemImage: "laptopcomputer.slash")
            }
        }
        .navigationTitle("Connection & Security")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Edit address", isPresented: $editingAddress) {
            TextField("Computer address", text: $addressText)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("Save") {
                if !session.updateAddress(addressText) {
                    session.actionError = "That address doesn't look right. Copy it from Phone settings and try again."
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Use the address shown in Phone settings on your computer. Your pairing is kept.")
        }
        .confirmationDialog(
            "Remove this connection?",
            isPresented: $confirmingSignOut,
            titleVisibility: .visible
        ) {
            Button("Remove from this device", role: .destructive) {
                session.signOut()
                dismiss()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes the connection from this device only. It does not revoke this device on your Mac. To remove Mac-side access, open Sagax, then Settings, then Phone and remove it there.")
        }
    }

    /// Our copy, except for `.offline`, whose text the computer itself sent and
    /// which is shown exactly as it arrived.
    private var troubleshootingText: Text {
        switch session.status {
        case .live:
            return Text("This computer is connected and responding normally.")
        case .connecting:
            return Text("Sagax is trying the saved connection automatically.")
        case let .offline(reason):
            return Text(verbatim: reason)
        case .unauthorized:
            return Text("This device was removed from the computer. Pair it again to reconnect.")
        case .unpaired:
            return Text("This device is not paired with a computer.")
        }
    }

    private func shortened(_ address: String) -> String {
        guard address.count > 14 else { return address }
        let leadingCount = min(20, max(8, address.count - 8))
        return "\(address.prefix(leadingCount))…\(address.suffix(6))"
    }
}

private extension Session.Status {
    var settingsText: Text {
        switch self {
        case .live: return Text("Connected")
        case .connecting: return Text("Connecting…")
        case .unpaired: return Text("Not paired")
        case .unauthorized: return Text("Needs pairing")
        case .offline: return Text("Offline")
        }
    }
}
