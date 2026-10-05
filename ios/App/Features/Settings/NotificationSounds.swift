// Notification sounds (matrix ST3), the desktop's NotificationSoundsRow:
// one switch, on unless turned off. Off keeps the banners and loses the
// sound (src/lib/notify.ts `silent`), for the bots' notifications and the
// achievement banners alike. On an organization server it follows the
// person between devices as the desktop's `omb-notification-sounds`
// (shared/user-preferences.ts, GET/PUT /api/me/preferences).
import CompanionCore
import SwiftUI

enum NotificationSounds {
    /// Per device, as `omb-notification-sounds` is in a desktop's storage.
    static let key = "companion.prefs.notificationSounds"
    /// The synced preference's name on an organization server.
    static let syncedKey = "omb-notification-sounds"

    /// Read by NotificationCoordinator, which has no SwiftUI environment.
    static var isEnabled: Bool {
        UserDefaults.standard.object(forKey: key) as? Bool ?? true
    }

    /// The person's synced value, when the server keeps one.
    @MainActor static func pull(_ session: Session) async {
        guard session.surfaceGate.organization, let client = session.settingsClient,
              let record = try? await client.preferences(), let value = record.preferences[syncedKey] else { return }
        UserDefaults.standard.set(value != "0", forKey: key)
    }

    /// Saves on this device, then in the person's record (merged: PUT
    /// replaces the whole record).
    @MainActor static func set(_ on: Bool, session: Session) async {
        UserDefaults.standard.set(on, forKey: key)
        guard session.surfaceGate.organization, let client = session.settingsClient,
              let record = try? await client.preferences() else { return }
        var values = record.preferences
        values[syncedKey] = on ? "1" : "0"
        _ = try? await client.putPreferences(values)
    }
}

/// The Haptics page's second card: Notification sounds.
struct NotificationSoundsCard: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @AppStorage(NotificationSounds.key) private var on = true

    var body: some View {
        SettingsCard {
            SettingsRow(
                title: "Notification sounds",
                subtitle: "Play a sound when an agent finishes or needs you.",
                accessory: .toggle(Binding(get: { on }, set: { value in
                    on = value
                    Task { await NotificationSounds.set(value, session: session) }
                })),
                identifier: "settings-notification-sounds"
            )
        }
        SettingsFooter(text: "Turn it off to keep the banners but lose the chime, handy on a call where the agent is already talking to you.")
            .task { await NotificationSounds.pull(session) }
    }
}
