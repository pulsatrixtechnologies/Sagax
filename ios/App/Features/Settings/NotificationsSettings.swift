// Settings > Notifications (#222; matrix DC16 to DC18): what a new message
// or a nudge does on this phone. The desktop's rows, in its order:
// notification sounds, keep notifications on screen, unread count on the
// app icon, nudge sound, and the nudge's shake, which on a phone is a
// haptic. All on by default, kept on this device. A received nudge plays
// the wizz, buzzes and, unless its conversation is open in front, posts a
// local notification that opens it.
import AVFoundation
import CompanionCore
import SwiftUI
import UIKit
import UserNotifications

enum AttentionPrefs {
    static let badgeKey = "companion.prefs.appBadge"
    static let nudgeSoundKey = "companion.prefs.nudgeSound"
    static let nudgeHapticKey = "companion.prefs.nudgeHaptic"

    static var settings: AttentionSettings {
        let defaults = UserDefaults.standard
        return AttentionSettings(
            sound: NotificationSounds.isEnabled,
            badge: defaults.object(forKey: badgeKey) as? Bool ?? true,
            nudgeSound: defaults.object(forKey: nudgeSoundKey) as? Bool ?? true,
            nudgeHaptic: defaults.object(forKey: nudgeHapticKey) as? Bool ?? true
        )
    }
}

/// Which conversation is on screen, for the nudge's "already looking".
@MainActor
final class AttentionCenter {
    static let shared = AttentionCenter()
    var viewingThreadId: String?
    private var player: AVAudioPlayer?

    /// A `nudge` frame addressed to this person.
    func receive(_ nudge: NudgeFrame) {
        let decision = NudgeAttention.decide(
            nudge, now: Date().timeIntervalSince1970 * 1000,
            appActive: UIApplication.shared.applicationState == .active,
            viewingThreadId: viewingThreadId, settings: AttentionPrefs.settings
        )
        guard decision.fresh else { return }
        var rang = false
        if decision.sound { rang = playWizz() }
        if decision.haptic { buzz() }
        if decision.notify { NotificationCoordinator.shared.deliverNudge(nudge, ring: !rang && AttentionPrefs.settings.nudgeSound) }
    }

    /// The bundled wizz (`public/nudge.mp3`), mixed with other audio.
    @discardableResult
    func playWizz() -> Bool {
        guard let url = Bundle.main.url(forResource: "nudge", withExtension: "mp3") else { return false }
        do {
            try AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
            let player = try AVAudioPlayer(contentsOf: url)
            player.volume = 0.6
            self.player = player
            return player.play()
        } catch {
            return false
        }
    }

    /// The shake's phone equivalent: three heavy taps.
    func buzz() {
        let generator = UIImpactFeedbackGenerator(style: .heavy)
        generator.prepare()
        for step in 0..<3 {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(step) * 0.12) { generator.impactOccurred() }
        }
    }
}

extension NotificationCoordinator {
    /// A nudge's notification: opens the conversation its line went to.
    func deliverNudge(_ nudge: NudgeFrame, ring: Bool) {
        let content = UNMutableNotificationContent()
        let name = nudge.fromName.trimmingCharacters(in: .whitespacesAndNewlines)
        content.title = String(localized: "\(name.isEmpty ? String(localized: "Someone") : name) sent you a nudge")
        content.body = String(localized: "Open the conversation to answer.")
        content.sound = ring ? .default : nil
        content.interruptionLevel = .timeSensitive
        if let open = nudge.open {
            content.threadIdentifier = open.threadId
            content.userInfo = ["threadId": open.threadId, "botId": open.groupId, "kind": "nudge"]
        }
        let identifier = "sagax.nudge.\(nudge.fromId).\(Int64(nudge.at ?? Date().timeIntervalSince1970 * 1000))"
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
    }
}

struct NotificationsSettingsView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @AppStorage(NotificationSounds.key) private var sounds = true
    @AppStorage(AttentionPrefs.badgeKey) private var badge = true
    @AppStorage(AttentionPrefs.nudgeSoundKey) private var nudgeSound = true
    @AppStorage(AttentionPrefs.nudgeHapticKey) private var nudgeHaptic = true

    var body: some View {
        SettingsPage(title: "Notifications") {
            SettingsCard {
                SettingsRow(
                    title: "Notification sounds",
                    subtitle: "Play a sound when an agent finishes or needs you.",
                    accessory: .toggle(Binding(get: { sounds }, set: { value in
                        sounds = value
                        Task { await NotificationSounds.set(value, session: session) }
                    })),
                    identifier: "settings-notification-sounds"
                )
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(
                    title: "Unread count on the app icon",
                    accessory: .toggle(Binding(get: { badge }, set: { value in
                        badge = value
                        NotificationCoordinator.shared.setBadge(session.state.unreadCount)
                    })),
                    identifier: "settings-notification-badge"
                )
            }
            SettingsFooter(text: "To keep notifications on screen until you close them, choose the Persistent banner style for Sagax in the iOS Settings app.")
            SettingsCard {
                SettingsRow(
                    title: "Nudge sound",
                    subtitle: "Play the nudge sound when someone nudges you.",
                    accessory: .toggle($nudgeSound),
                    identifier: "settings-nudge-sound"
                )
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(
                    title: "Buzz on nudge",
                    subtitle: "The phone buzzes, as the desktop window shakes.",
                    accessory: .toggle($nudgeHaptic),
                    identifier: "settings-nudge-haptic"
                )
            }
            .task { await NotificationSounds.pull(session) }
        }
    }
}
