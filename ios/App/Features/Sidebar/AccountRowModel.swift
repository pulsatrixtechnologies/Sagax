// The desktop sidebar's account row on the phone (#194, #215; matrix DC14,
// DC15). The phone has no account row: the account button carries the
// routines badge (active routines, accent, never red; a small accent dot for
// a failed run nobody has seen), and the account menu opens on a line with
// the person's own title and points, each while its switch is on.
import CompanionCore
import SwiftUI

@MainActor
final class AccountRowModel: ObservableObject {
    static let shared = AccountRowModel()

    @Published private(set) var activeRoutines = 0
    @Published private(set) var routineAttention = false
    private var loading = false

    /// `GET /api/routines`, counted the desktop's way.
    func refresh(_ session: Session) async {
        guard !loading, let client = session.settingsClient else { return }
        loading = true
        defer { loading = false }
        guard let (routines, runs) = try? await client.routines() else { return }
        let viewer = SidebarPrefsModel.shared.viewerID(session)
        activeRoutines = AccountRow.activeRoutines(routines, bots: session.state.bots, viewerId: viewer)
        routineAttention = AccountRow.routineAttention(runs)
    }
}

/// The routines badge on the account button: a small accent capsule with
/// the count, never red; a failed unseen run adds an accent dot.
struct AccountRoutinesBadge: View {
    @Environment(\.themePalette) var themePalette
    let count: Int
    let attention: Bool

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "calendar")
                .font(.system(size: 9, weight: .semibold))
            Text(verbatim: "\(count)")
                .font(.system(size: 11, weight: .semibold))
                .monospacedDigit()
            if attention {
                Circle().fill(Theme.accentText).frame(width: 4, height: 4)
                    .accessibilityIdentifier("routines-attention-dot")
            }
        }
        .foregroundStyle(Theme.accentText)
        .padding(.horizontal, 5)
        .frame(height: 17)
        .background(Theme.card, in: Capsule())
        .overlay(Capsule().strokeBorder(Theme.accent.opacity(0.55), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(Self.words(count: count, attention: attention)))
        .accessibilityIdentifier("routines-badge")
    }

    static func words(count: Int, attention: Bool) -> String {
        let base = count == 1 ? String(localized: "1 active routine") : String(localized: "\(count) active routines")
        return attention ? String(localized: "\(base), one needs a look") : base
    }
}

/// The account menu's first line: the person's name, their title and their
/// points (each while its switch is on), as on the desktop's own row.
struct AccountMenuHeader: View {
    @EnvironmentObject private var session: Session
    @ObservedObject private var achievements = AchievementStore.shared
    @ObservedObject private var people = PeopleDirectory.shared

    var body: some View {
        let snapshot = achievements.status == .ready ? achievements.snapshot : nil
        let name = session.account?.name ?? session.account?.email ?? session.connection?.name ?? String(localized: "You")
        var parts: [String] = []
        if let title = AccountRow.title(snapshot) {
            parts.append(title.resolved(AchievementLanguage.current ?? Locale.current.language.languageCode?.identifier))
        }
        if let points = AccountRow.points(snapshot) {
            let formatter = NumberFormatter()
            formatter.numberStyle = .decimal
            parts.append(String(localized: "\(formatter.string(from: NSNumber(value: points)) ?? String(points)) points"))
        }
        var subtitle = parts.joined(separator: " · ")
        if let id = session.account?.principalId, let entry = people.presence.entry(id) {
            let words = PresenceDot.words(entry)
            subtitle = subtitle.isEmpty ? words : "\(subtitle) · \(words)"
        }
        return Group {
            if subtitle.isEmpty {
                Text(verbatim: name)
            } else {
                Text(verbatim: "\(name)\n\(subtitle)")
            }
        }
        .accessibilityIdentifier("account-menu.header")
    }
}
