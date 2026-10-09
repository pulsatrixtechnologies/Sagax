// Admin approvals reach the admins (#213; matrix DC25): the `org.approvals`
// frame (organization admins' streams only) carries the count of commands
// waiting for an admin and the ones that just arrived. The phone shows the
// count on the account button (it opens Settings), posts a local
// notification per arrival, and Settings > Organization reloads its list.
import CompanionCore
import SwiftUI
import UserNotifications

@MainActor
final class OrgApprovalsCenter: ObservableObject {
    static let shared = OrgApprovalsCenter()

    @Published private(set) var count = 0
    /// Bumped on each frame: the Organization page reloads its list.
    @Published private(set) var generation = 0

    func apply(_ frame: OrgApprovalsFrame) {
        count = max(0, frame.count)
        generation += 1
        for arrival in frame.added { notify(arrival) }
    }

    private func notify(_ arrival: OrgApprovalsFrame.Arrival) {
        let content = UNMutableNotificationContent()
        content.title = String(localized: "A command waits for an admin")
        let who = arrival.ownerName ?? arrival.requestedBy ?? ""
        let bot = arrival.botName ?? ""
        content.body = [who.isEmpty ? bot : (bot.isEmpty ? who : "\(who) · \(bot)"), arrival.tool ?? ""].filter { !$0.isEmpty }.joined(separator: ": ")
        content.sound = NotificationSounds.isEnabled ? .default : nil
        content.userInfo = ["kind": "org.approvals"]
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "sagax.org-approval.\(arrival.requestId)", content: content, trigger: nil))
    }
}
