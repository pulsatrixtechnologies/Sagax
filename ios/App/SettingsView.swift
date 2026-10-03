// Settings (iOS parity 12 and 14): the card sheet the home's photo opens.
//
// Account card and Usage, Plugins, the Bot section (auto-review default,
// its rules, the time zone and the bot computer), the App section
// (notifications, appearance, language, haptics), the Pulsatrix links,
// Send Feedback, Sign Out and the Sagax footer. Everything the earlier
// settings screen offered stays reachable under "Advanced" at the bottom.
// Geometry: measure-settings.md §1 to §4.
import CompanionCore
import SwiftUI
import UIKit
import MessageUI

/// The sheet's pages.
enum SettingsRoute: Hashable {
    case account, usage, plugins, rules, timeZone, botComputer, appearance, language, haptics, advanced
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

/// The sheet's page stack.
@MainActor
final class SettingsNavigator: ObservableObject {
    @Published var routes: [SettingsRoute] = []

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
    @Environment(\.locale) private var locale
    @ObservedObject private var themes = ThemeStore.shared
    @AppStorage(PrefKey.language) private var language = AppLanguage.system.rawValue
    @AppStorage(PrefKey.haptics) private var haptics = true
    @State private var link: URL?
    @State private var composingMail = false
    @State private var confirmingSignOut = false
    @State private var enablingNotifications = false

    private var french: Bool {
        (AppLanguage.resolved(language).locale ?? locale).language.languageCode?.identifier == "fr"
    }

    var body: some View {
        SettingsPage(leading: close.map { .close($0) } ?? .back) {
            accountCard
            SettingsSpacer(SettingsMetrics.cardGap)
            SettingsCard {
                SettingsRow(title: "Plugins", subtitle: "Tools and skills for Sagax", accessory: .chevron, height: 61, identifier: "settings-plugins") {
                    push(.plugins)
                }
            }
            SettingsSectionLabel(text: "Bot")
            botCard
            SettingsSpacer(SettingsMetrics.cardGap)
            appCard
            SettingsSpacer(SettingsMetrics.cardGap)
            linksCard
            SettingsSpacer(SettingsMetrics.cardGap)
            SettingsCard {
                SettingsRow(title: "Send Feedback", accessory: .chevron, height: 44.67, identifier: "settings-feedback") { sendFeedback() }
            }
            SettingsSpacer(26.67)
            SettingsCard {
                SettingsRow(title: "Sign Out", style: .destructive, height: 44.67, identifier: "settings-sign-out") {
                    confirmingSignOut = true
                }
            }
            footer
            SettingsCard {
                SettingsRow(title: "Advanced", accessory: .chevron, height: 44.67, identifier: "settings-advanced") { showingAdvanced = true }
            }
#if DEBUG
            if ParityLaunch.current?.screen == .settingsBottom {
                // 14-settings-bottom: the Notifications card's top at y 197.
                ScrollOffsetSetter(offset: 573.67).frame(width: 0, height: 0)
            }
#endif
        }
        .task { await session.refreshNotificationAuthorization() }
        .sheet(isPresented: $showingAdvanced) {
            NavigationStack {
                AdvancedSettingsView(onConnect: onConnect, closeSheet: close)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { showingAdvanced = false }
                        }
                    }
            }
            .environmentObject(session)
        }
        .sheet(item: Binding(get: { link.map(IdentifiedURL.init) }, set: { link = $0?.url })) { item in
            SafariSheet(url: item.url).ignoresSafeArea()
        }
        .sheet(isPresented: $composingMail) {
            MailComposeSheet(recipient: SettingsLinks.supportEmail, subject: feedbackSubject, body: feedbackBody) {
                composingMail = false
            }
            .ignoresSafeArea()
        }
        .confirmationDialog("Sign out of this computer?", isPresented: $confirmingSignOut, titleVisibility: .visible) {
            Button("Sign Out", role: .destructive) {
                close?()
                session.signOut()
            }
            .accessibilityIdentifier("settings-sign-out-confirm")
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This phone forgets this computer. Pair it again to come back.")
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

    @EnvironmentObject private var navigator: SettingsNavigator
    @State private var showingAdvanced = false

    private func push(_ route: SettingsRoute) {
        navigator.push(route)
    }

    // MARK: Cards

    private var accountCard: some View {
        SettingsCard {
            AccountCardRow(name: model.displayName, detail: model.detail, photo: session.accountPhoto, chevron: true) { push(.account) }
            if let percent = model.usagePercent {
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(title: "Usage", accessory: .valueChevron("\(percent)%"), height: 43.5, identifier: "settings-usage") { push(.usage) }
            }
        }
    }

    private var botCard: some View {
        SettingsCard {
            SettingsRow(
                title: "Auto-review",
                subtitle: "Require approval for risky shell, MCP, and computer actions.",
                accessory: .toggle(Binding(get: { model.autoReview }, set: { on in Task { await model.setAutoReview(on) } })),
                height: 75,
                identifier: "settings-auto-review"
            )
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(title: "Auto-review Rules", accessory: .valueChevron(model.rules.map { "\($0.total)" } ?? ""), height: 43.33, identifier: "settings-rules") {
                push(.rules)
            }
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(
                title: "Set Time Zone Automatically",
                subtitle: "Your Bot's computer follows this device's time zone.",
                accessory: .toggle(Binding(get: { model.timeZoneAuto }, set: { on in Task { await model.setTimeZoneAuto(on) } })),
                height: 74,
                identifier: "settings-time-zone-auto",
                textTop: 13.4
            )
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            if model.timeZoneAuto {
                SettingsRow(title: "Time Zone", accessory: .value(model.timeZone ?? ""), height: 43.67, identifier: "settings-time-zone")
            } else {
                SettingsRow(title: "Time Zone", accessory: .valueChevron(model.timeZone ?? ""), height: 43.67, identifier: "settings-time-zone") {
                    push(.timeZone)
                }
            }
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(title: "Bot Computer", accessory: .chevron, height: 43.33, identifier: "settings-bot-computer") { push(.botComputer) }
        }
    }

    private var notificationsOn: Bool {
        switch session.notificationAuthorization {
        case .authorized, .provisional, .ephemeral: true
        default: false
        }
    }

    private var appCard: some View {
        SettingsCard {
            SettingsRow(
                title: "Notifications",
                accessory: .toggle(Binding(get: { notificationsOn }, set: { on in setNotifications(on) })),
                height: 53.67,
                identifier: "settings-notifications"
            )
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(title: "Appearance", accessory: .valueChevron(appearanceValue), height: 43.67, identifier: "settings-appearance") { push(.appearance) }
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(title: "Language", accessory: .valueChevron(AppLanguage.resolved(language).shortLabel), height: 43.33, identifier: "settings-language") { push(.language) }
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(title: "Haptics", accessory: .valueChevron(haptics ? String(localized: "On") : String(localized: "Off")), height: 43.67, identifier: "settings-haptics") { push(.haptics) }
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

    private var linksCard: some View {
        SettingsCard {
            SettingsRow(title: "Help Center", accessory: .chevron, height: 44.33, identifier: "settings-help") { link = SettingsLinks.helpCenter(french: french) }
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(title: "Privacy Policy", accessory: .chevron, height: 43.33, identifier: "settings-privacy") { link = SettingsLinks.privacy(french: french) }
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(title: "Terms of Service", accessory: .chevron, height: 43.67, identifier: "settings-terms") { link = SettingsLinks.terms(french: french) }
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(title: "Sagax Terms", accessory: .chevron, height: 43.33, identifier: "settings-sagax-terms") { link = SettingsLinks.sagaxTerms }
        }
    }

    /// The white Sagax owl over "Sagax": 60.67 pt below Sign Out.
    private var footer: some View {
        VStack(spacing: 0) {
            // The Primary Bot once connected, else the white Sagax owl.
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

    // MARK: Actions

    private func setNotifications(_ on: Bool) {
        if on {
            guard !enablingNotifications else { return }
            enablingNotifications = true
            Task {
                await session.enableNotifications()
                enablingNotifications = false
            }
        } else if let url = URL(string: UIApplication.openSettingsURLString) {
            // iOS lets only the person turn an app's notifications off.
            UIApplication.shared.open(url)
        }
    }

    private var feedbackSubject: String { String(localized: "Sagax feedback") }

    private var feedbackBody: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        return "\n\n—\nSagax iOS \(version) (\(build)), iOS \(UIDevice.current.systemVersion)"
    }

    private func sendFeedback() {
        if MFMailComposeViewController.canSendMail() {
            composingMail = true
            return
        }
        var components = URLComponents()
        components.scheme = "mailto"
        components.path = SettingsLinks.supportEmail
        components.queryItems = [URLQueryItem(name: "subject", value: feedbackSubject), URLQueryItem(name: "body", value: feedbackBody)]
        if let url = components.url { UIApplication.shared.open(url) }
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
        case .advanced: AdvancedSettingsView(onConnect: onConnect, closeSheet: closeSheet)
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
        }
    }
}

// MARK: - Advanced (the earlier settings, kept)

struct AdvancedSettingsView: View {
    @Environment(\.themePalette) var themePalette
    let onConnect: (() -> Void)?
    let closeSheet: (() -> Void)?

    @EnvironmentObject private var session: Session
    @AppStorage(PrefKey.activityDetail) private var activityDetail = ActivityDetail.full.rawValue
    @AppStorage(PrefKey.islandIntro) private var islandIntro = IslandIntro.oncePerBot.rawValue
    @AppStorage(PrefKey.rosterDensity) private var rosterDensity = RosterDensity.default.rawValue
    @State private var showingUpdates = false
    @State private var showingWalkieVoice = false

    var body: some View {
        ThemedForm {
            Section("Computer") {
                if let connection = session.connection {
                    NavigationLink {
                        ConnectedComputersView()
                    } label: {
                        ComputerSettingsRow(
                            name: Text(verbatim: connection.name),
                            status: computerStatusText,
                            connected: session.status == .live
                        )
                    }
                } else {
                    Button {
                        onConnect?()
                    } label: {
                        ComputerSettingsRow(name: Text("Connect a computer"), status: Text("Not connected"), connected: false)
                    }
                    .disabled(onConnect == nil)
                }
            }

            Section {
                Picker(selection: $activityDetail) {
                    ForEach(ActivityDetail.allCases, id: \.rawValue) { level in
                        Text(LocalizedStringKey(level.label)).tag(level.rawValue)
                    }
                } label: {
                    Label { Text("Activity") } icon: { SettingsIcon(symbol: "wrench.and.screwdriver.fill", color: .purple) }
                }

                Picker(selection: $islandIntro) {
                    ForEach(IslandIntro.allCases, id: \.rawValue) { option in
                        Text(LocalizedStringKey(option.label)).tag(option.rawValue)
                    }
                } label: {
                    Label { Text("Bot intro animation") } icon: { SettingsIcon(symbol: "sparkles", color: .pink) }
                }

                NavigationLink {
                    QuickRepliesEditor()
                } label: {
                    Label { Text("Quick Replies") } icon: { SettingsIcon(symbol: "bolt.fill", color: .yellow) }
                }
            } header: {
                Text("Chat")
            } footer: {
                Text(LocalizedStringKey(ActivityDetail(rawValue: activityDetail)?.caption ?? ""))
            }

            Section {
                Picker(selection: Binding(
                    get: { RosterDensity(stored: rosterDensity) },
                    set: { rosterDensity = $0.rawValue }
                )) {
                    ForEach(RosterDensity.allCases, id: \.self) { density in
                        Text(LocalizedStringKey(density.label)).tag(density)
                    }
                } label: {
                    Label { Text("List density") } icon: { SettingsIcon(symbol: "list.bullet", color: .indigo) }
                }
                .accessibilityIdentifier("list-density")
            } footer: {
                Text(LocalizedStringKey(RosterDensity(stored: rosterDensity).caption))
            }

            Section("Voice") {
                Button {
                    showingWalkieVoice = true
                } label: {
                    Label { Text("Walkie voice") } icon: { SettingsIcon(symbol: "waveform", color: .green) }
                }
                .foregroundStyle(Theme.textPrimary)
            }

            if session.connection != nil {
                Section("Workspace") {
                    Button {
                        showingUpdates = true
                    } label: {
                        Label { Text("Updates") } icon: { SettingsIcon(symbol: "bell.badge.fill", color: .red) }
                    }
                    .foregroundStyle(Theme.textPrimary)

                    NavigationLink {
                        TasksRoutinesView()
                    } label: {
                        Label { Text("Threads & Routines") } icon: { SettingsIcon(symbol: "calendar.badge.clock", color: .orange) }
                    }

                    // Composio accounts (Work, Personal, client accounts).
                    if session.canAdminister {
                        NavigationLink {
                            ConnectedAppsView()
                        } label: {
                            Label { Text("Connected Apps") } icon: { SettingsIcon(symbol: "link", color: .blue) }
                        }
                    }
                }
            }
        }
        .navigationTitle("Advanced")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .sheet(isPresented: $showingUpdates) {
            UpdatesSheet { chat in
                showingUpdates = false
                closeSheet?()
                session.openChat(threadId: chat.threadId)
            }
            .environmentObject(session)
            .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showingWalkieVoice) {
            WalkieVoiceSheet(onSample: {})
        }
    }

    private var computerStatusText: Text {
        guard session.connections.count > 1 else { return session.status.settingsText }
        return session.status.settingsText + Text(verbatim: " · ") + Text("\(session.connections.count) saved")
    }
}

private struct ComputerSettingsRow: View {
    @Environment(\.themePalette) var themePalette
    let name: Text
    let status: Text
    let connected: Bool

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(MausPalette.color("blue").opacity(0.14))
                    .frame(width: 38, height: 38)
                Image(systemName: "laptopcomputer")
                    .foregroundStyle(MausPalette.color("blue"))
            }
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                name
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                HStack(spacing: 5) {
                    Circle()
                        .fill(connected ? Theme.success : Theme.textSecondary)
                        .frame(width: 7, height: 7)
                    status
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

private struct SettingsIcon: View {
    @Environment(\.themePalette) var themePalette
    let symbol: String
    let color: Color

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 28, height: 28)
            .background(color, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            .accessibilityHidden(true)
    }
}

struct ConnectedComputersView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @State private var pendingRemoval: Connection?

    /// The dialog interpolates the computer's own name. With no name there is
    /// copy to fall back to, rather than an English word inside a translated
    /// sentence.
    private var removalTitle: LocalizedStringKey {
        guard let name = pendingRemoval?.name else { return "Remove this computer?" }
        return "Remove \(name)?"
    }

    private var otherComputers: [Connection] {
        session.connections.filter { $0.id != session.connection?.id }
    }

    var body: some View {
        ThemedList {
            if let active = session.connection {
                Section("Current computer") {
                    NavigationLink {
                        ConnectionSecurityView()
                    } label: {
                        ComputerSettingsRow(
                            name: Text(verbatim: active.name),
                            status: session.status.settingsText,
                            connected: session.status == .live
                        )
                    }
                }
            }

            if !otherComputers.isEmpty {
                Section("Other computers") {
                    ForEach(otherComputers) { computer in
                        Button {
                            Haptics.selection()
                            session.switchComputer(to: computer.id)
                        } label: {
                            HStack(spacing: 12) {
                                ProfileAvatar(name: computer.name, size: 38)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(computer.name)
                                        .foregroundStyle(Theme.textPrimary)
                                        .lineLimit(1)
                                    Text("Tap to switch")
                                        .font(.footnote)
                                        .foregroundStyle(Theme.textSecondary)
                                }
                                Spacer()
                                Text("Use")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(MausPalette.color("blue"))
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .swipeActions {
                            Button("Remove", role: .destructive) {
                                pendingRemoval = computer
                            }
                        }
                        .accessibilityHint("Switches Sagax to this computer")
                    }
                }
            }

            Section {
                Button {
                    Haptics.selection()
                    session.beginPairing()
                } label: {
                    Label("Connect another computer", systemImage: "plus.circle.fill")
                }
            } footer: {
                Text("Each computer is paired separately. Only the selected computer is active at a time.")
            }
        }
        .navigationTitle("Computers")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(
            removalTitle,
            isPresented: Binding(
                get: { pendingRemoval != nil },
                set: { if !$0 { pendingRemoval = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Remove from this device", role: .destructive) {
                guard let pendingRemoval else { return }
                session.forgetConnection(id: pendingRemoval.id)
                self.pendingRemoval = nil
            }
            Button("Cancel", role: .cancel) { pendingRemoval = nil }
        } message: {
            Text("This removes the saved connection from this device only.")
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
