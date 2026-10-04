// Settings > General (the phone's own settings, which the desktop keeps
// nowhere: notifications, language, haptics, the bot's time zone and
// auto-review, quick replies, the call voice, the links and feedback) and
// Settings > Experimental (SettingsModal.tsx "experimental": the
// installation's early features, an admin pairing only), plus the picker
// rows Appearance gains (list density, activity, bot intro).
import CompanionCore
import MessageUI
import SwiftUI
import UIKit

struct GeneralSettingsView: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.locale) private var locale
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: SettingsModel
    @EnvironmentObject private var navigator: SettingsNavigator
    @AppStorage(PrefKey.language) private var language = AppLanguage.system.rawValue
    @AppStorage(PrefKey.haptics) private var haptics = true
    @State private var link: URL?
    @State private var composingMail = false
    @State private var enablingNotifications = false

    private var french: Bool {
        (AppLanguage.resolved(language).locale ?? locale).language.languageCode?.identifier == "fr"
    }

    var body: some View {
        SettingsPage(title: "General") {
            SettingsCard {
                SettingsRow(
                    title: "Notifications",
                    accessory: .toggle(Binding(get: { notificationsOn }, set: { setNotifications($0) })),
                    height: 53.67,
                    identifier: "settings-notifications"
                )
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(title: "Language", accessory: .valueChevron(AppLanguage.resolved(language).shortLabel), height: 43.33, identifier: "settings-language") { navigator.push(.language) }
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(title: "Haptics", accessory: .valueChevron(haptics ? String(localized: "On") : String(localized: "Off")), height: 43.67, identifier: "settings-haptics") { navigator.push(.haptics) }
            }
            if session.connection != nil {
                SettingsSectionLabel(text: "Bot")
                botCard
            }
            SettingsSectionLabel(text: "Chat")
            SettingsCard {
                SettingsRow(title: "Quick Replies", accessory: .chevron, height: 43.67, identifier: "settings-quick-replies") { navigator.sheet = .quickReplies }
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(title: "Walkie voice", accessory: .chevron, height: 43.67, identifier: "settings-walkie-voice") { navigator.sheet = .walkieVoice }
            }
            SettingsSpacer(SettingsMetrics.cardGap)
            SettingsCard {
                SettingsRow(title: "Help Center", accessory: .chevron, height: 44.33, identifier: "settings-help") { link = SettingsLinks.helpCenter(french: french) }
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(title: "Privacy Policy", accessory: .chevron, height: 43.33, identifier: "settings-privacy") { link = SettingsLinks.privacy(french: french) }
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(title: "Terms of Service", accessory: .chevron, height: 43.67, identifier: "settings-terms") { link = SettingsLinks.terms(french: french) }
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(title: "Sagax Terms", accessory: .chevron, height: 43.33, identifier: "settings-sagax-terms") { link = SettingsLinks.sagaxTerms }
            }
            SettingsSpacer(SettingsMetrics.cardGap)
            SettingsCard {
                SettingsRow(title: "Send Feedback", accessory: .chevron, height: 44.67, identifier: "settings-feedback") { sendFeedback() }
            }
            SettingsSpacer(40)
        }
        .task { await session.refreshNotificationAuthorization() }
        .sheet(item: Binding(get: { link.map(IdentifiedURL.init) }, set: { link = $0?.url })) { item in
            SafariSheet(url: item.url).ignoresSafeArea()
        }
        .sheet(isPresented: $composingMail) {
            MailComposeSheet(recipient: SettingsLinks.supportEmail, subject: feedbackSubject, body: feedbackBody) {
                composingMail = false
            }
            .ignoresSafeArea()
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
                navigator.push(.rules)
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
                    navigator.push(.timeZone)
                }
            }
        }
    }

    private var notificationsOn: Bool {
        switch session.notificationAuthorization {
        case .authorized, .provisional, .ephemeral: true
        default: false
        }
    }

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

// MARK: - Experimental

struct ExperimentalSettingsView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @State private var config: DesktopSettingsConfig?
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        SettingsPage(title: "Experimental") {
            SettingsFooter(text: "Early features may change while we test them. Each one says whether it starts on or off.")
            SettingsCard {
                feature("skillAuthoring", title: "Bots may draft skills for your review",
                        detail: "On by default. Save a bot's verification run as a skill from the Verify card, or ask a supported bot to run /create-verification-skill. Every change waits for your review.",
                        on: config?.features?.skillAuthoring ?? true)
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                feature("browser", title: "Built-in browser",
                        detail: config?.features?.browser == true
                            ? "Enabled for this installation. Each bot also has its own browser switch."
                            : "Off by default. Enable it to let supported bots use a browser tab you can watch and take over.",
                        on: config?.features?.browser == true)
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                feature("templates", title: "Templates",
                        detail: "Off by default. Shows Templates in the sidebar menu, to install a ready-made team of bots.",
                        on: config?.features?.templates == true)
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                feature("connectedApps", title: "Connected apps",
                        detail: "Gmail, Slack, GitHub and more through your Composio project: the entry at the foot of the sidebar and the card in Settings > API keys. While off, your Claude account's connectors show in Settings > Model providers.",
                        on: config?.features?.connectedApps == true)
            }
            if let error {
                SettingsFooter(text: LocalizedStringKey(stringLiteral: error))
            }
            SettingsSpacer(40)
        }
        .task(id: session.connection?.id) {
            guard let client = session.settingsClient else { return }
            do { config = try await client.desktopSettingsConfig() } catch { self.error = error.localizedDescription }
        }
    }

    private func feature(_ key: String, title: LocalizedStringKey, detail: String, on: Bool) -> some View {
        SettingsRow(
            title: title,
            subtitle: detail,
            accessory: .toggle(Binding(get: { on }, set: { value in set(key, value) })),
            identifier: "settings-experimental.\(key)"
        )
        .disabled(saving || config == nil)
    }

    private func set(_ key: String, _ on: Bool) {
        guard let client = session.settingsClient else { return }
        saving = true
        Task {
            defer { saving = false }
            do {
                config = try await client.updateDesktopSettings(.feature(key, on))
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

// MARK: - Appearance's display pickers

/// List density, activity and the bot intro, moved from the old Advanced
/// page: how the home and the chats show things on this phone.
struct DisplaySettingsCard: View {
    @Environment(\.themePalette) var themePalette
    @AppStorage(PrefKey.activityDetail) private var activityDetail = ActivityDetail.full.rawValue
    @AppStorage(PrefKey.islandIntro) private var islandIntro = IslandIntro.oncePerBot.rawValue
    @AppStorage(PrefKey.rosterDensity) private var rosterDensity = RosterDensity.default.rawValue

    var body: some View {
        SettingsSectionLabel(text: "Display")
        SettingsCard {
            Menu {
                Picker(selection: Binding(get: { RosterDensity(stored: rosterDensity) }, set: { rosterDensity = $0.rawValue })) {
                    ForEach(RosterDensity.allCases, id: \.self) { density in
                        Text(LocalizedStringKey(density.label)).tag(density)
                    }
                } label: { EmptyView() }
            } label: {
                SettingsRow(title: "List density", accessory: .valueChevron(String(localized: String.LocalizationValue(RosterDensity(stored: rosterDensity).label))), height: 43.67)
            }
            .accessibilityIdentifier("list-density")
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            Menu {
                Picker(selection: $activityDetail) {
                    ForEach(ActivityDetail.allCases, id: \.rawValue) { level in
                        Text(LocalizedStringKey(level.label)).tag(level.rawValue)
                    }
                } label: { EmptyView() }
            } label: {
                SettingsRow(title: "Activity", accessory: .valueChevron(String(localized: String.LocalizationValue((ActivityDetail(rawValue: activityDetail) ?? .full).label))), height: 43.67)
            }
            .accessibilityIdentifier("settings-activity")
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            Menu {
                Picker(selection: $islandIntro) {
                    ForEach(IslandIntro.allCases, id: \.rawValue) { option in
                        Text(LocalizedStringKey(option.label)).tag(option.rawValue)
                    }
                } label: { EmptyView() }
            } label: {
                SettingsRow(title: "Bot intro animation", accessory: .valueChevron(String(localized: String.LocalizationValue((IslandIntro(rawValue: islandIntro) ?? .oncePerBot).label))), height: 43.67)
            }
            .accessibilityIdentifier("settings-bot-intro")
        }
        SettingsFooter(text: LocalizedStringKey(RosterDensity(stored: rosterDensity).caption))
    }
}
