import Foundation
import UserNotifications
import CompanionCore

/// The on-device notification surface. Delivery comes from live or replayed
/// companion frames, and from APNs pushes the server sends while the app is
/// closed (PushRegistrar.swift), which carry the same categories and userInfo.
final class NotificationCoordinator: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationCoordinator()
    private let center = UNUserNotificationCenter.current()
    /// Set by `Session`; kept as an id-only value so the notification layer
    /// does not know about SwiftUI navigation or mutable fleet state.
    var responseHandler: ((NotificationTarget) -> Void)?

    private override init() {
        super.init()
        center.delegate = self
    }

    func authorizationStatus() async -> UNAuthorizationStatus {
        await center.notificationSettings().authorizationStatus
    }

    func requestAuthorization() async -> Bool {
        (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) == true
    }

    func deliver(_ notification: NotificationFrame, sequence: Int?) {
        // the conversation on a live call is heard, not buzzed
        if CallQuiet.shared.silences(threadId: notification.threadId) { return }
        let content = UNMutableNotificationContent()
        content.title = notification.title
        content.body = notification.body
        // Settings > Haptics > Notification sounds: off keeps the banner.
        content.sound = NotificationSounds.isEnabled ? .default : nil
        content.categoryIdentifier = notification.isBlocking ? "SAGAX_APPROVAL" : "SAGAX_UPDATE"
        content.threadIdentifier = notification.threadId
        content.userInfo = [
            "threadId": notification.threadId,
            "botId": notification.botId,
            "kind": notification.kind,
        ]
        if notification.isBlocking { content.interruptionLevel = .timeSensitive }

        // One conversation, one banner: a replayed frame, the next line of
        // the same conversation and the APNs push for it (whose
        // apns-collapse-id is this same identifier) replace it.
        let identifier = PushCollapse.identifier(threadId: notification.threadId, kind: notification.kind)
        center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
    }

    /// Settings > Notifications > Unread count on the app icon (#222).
    func setBadge(_ count: Int) {
        center.setBadgeCount(Attention.badge(count, settings: AttentionPrefs.settings))
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // nothing for the conversation on a live call: no banner, no sound
        let userInfo = notification.request.content.userInfo
        let threadId = userInfo["threadId"] as? String
        if CallQuiet.shared.silences(threadId: threadId) { return completionHandler([]) }
        // An APNs push while the app is in front: the live stream usually
        // got there first. A nudge rings once; a conversation already on
        // screen shows nothing.
        if let push = PushPayload(userInfo: userInfo) {
            Task { @MainActor in
                completionHandler(AttentionCenter.shared.presentation(for: push))
            }
            return
        }
        completionHandler(NotificationSounds.isEnabled ? [.banner, .list, .sound, .badge] : [.banner, .list, .badge])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let strings = response.notification.request.content.userInfo.reduce(into: [String: String]()) { result, pair in
            guard let key = pair.key as? String, let value = pair.value as? String else { return }
            result[key] = value
        }
        if let target = NotificationTarget(payload: strings) { responseHandler?(target) }
        completionHandler()
    }
}
