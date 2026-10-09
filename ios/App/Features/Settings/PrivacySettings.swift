// Settings > Privacy (#167; matrix DC11): "Show when I am online", the
// synced preference `sagax.presenceVisible.v1` ("0" hides). Hidden, the
// person reads as offline with no last-seen time for everyone, admins
// included; they still see their own state "(hidden from others)".
// Organization servers only.
import CompanionCore
import SwiftUI

struct PrivacySettingsView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @State private var visible = true
    @State private var loaded = false

    static let key = "sagax.presenceVisible.v1"

    var body: some View {
        SettingsPage(title: "Privacy") {
            SettingsCard {
                SettingsRow(
                    title: "Show when I am online",
                    subtitle: "People of your organization see a green, amber or grey dot on your picture. Off: you appear offline to everyone, with no last-seen time.",
                    accessory: .toggle(Binding(get: { visible }, set: { value in
                        visible = value
                        Task { await save(value) }
                    })),
                    identifier: "settings-presence-visible"
                )
            }
            .disabled(!loaded)
        }
        .task {
            if let record = try? await session.settingsClient?.preferences() {
                visible = record.preferences[Self.key] != "0"
            }
            loaded = true
        }
    }

    /// PUT replaces the whole record: read, change one key, write back.
    private func save(_ on: Bool) async {
        guard let client = session.settingsClient, let record = try? await client.preferences() else { return }
        var values = record.preferences
        values[Self.key] = on ? "1" : "0"
        _ = try? await client.putPreferences(values)
        await PeopleDirectory.shared.load(session, force: true)
    }
}
