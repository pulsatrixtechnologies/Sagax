import Foundation
import UIKit
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

    func deliver(_ notification: NotificationFrame, sequence: Int?, confidential: Bool = false) {
        // the conversation on a live call is heard, not buzzed
        if CallQuiet.shared.silences(threadId: notification.threadId) { return }
        let content = UNMutableNotificationContent()
        // a confidential thread's banner never carries its words nor its
        // title (taken from its first message); the bot's name replaces
        // the title below when there is one
        content.title = confidential ? ConfidentialRedaction.placeholder : notification.title
        content.body = ConfidentialRedaction.notificationBody(notification.body, confidential: confidential)
        // Settings > Haptics > Notification sounds: off keeps the banner.
        content.sound = NotificationSounds.isEnabled ? .default : nil
        content.categoryIdentifier = notification.isBlocking ? "SAGAX_APPROVAL" : "SAGAX_UPDATE"
        content.threadIdentifier = notification.threadId
        content.userInfo = [
            "threadId": notification.threadId,
            "botId": notification.botId,
            "kind": notification.kind,
            // a person's message or a room tag names its conversation (#262, #274)
            "groupId": notification.groupId ?? "",
        ]
        if notification.isBlocking { content.interruptionLevel = .timeSensitive }

        let posted = communicationContent(content, name: notification.botName, id: notification.botId, conversationId: notification.threadId)
        // One conversation, one banner: a replayed frame, the next line of
        // the same conversation and the APNs push for it (whose
        // apns-collapse-id is this same identifier) replace it.
        let identifier = PushCollapse.identifier(threadId: notification.threadId, kind: notification.kind)
        center.add(UNNotificationRequest(identifier: identifier, content: posted, trigger: nil))
    }

    /// Name the bot (or person) as the sender when we have a display name.
    private func communicationContent(
        _ content: UNMutableNotificationContent,
        name: String,
        id: String,
        conversationId: String
    ) -> UNNotificationContent {
        let display = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !display.isEmpty else { return content }
        content.title = display
        let handle = id.trimmingCharacters(in: .whitespacesAndNewlines)
        let conversation = conversationId.trimmingCharacters(in: .whitespacesAndNewlines)
        let sender = PushSenderIdentity(
            id: handle.isEmpty ? display : handle,
            displayName: display,
            conversationId: conversation.isEmpty ? display : conversation,
            avatarUrl: nil
        )
        return CommunicationNotification.applyingIntent(content, sender: sender, imageData: nil)
    }

    /// Settings > Notifications > Unread count on the app icon (#222).
    func setBadge(_ count: Int) {
        center.setBadgeCount(Attention.badge(count, settings: AttentionPrefs.settings))
    }

    /// Banners for bot conversations the person has since read or answered,
    /// on this device or another, leave Notification Center.
    func withdrawSettled(bots: [Bot]) async {
        let ids = DeliveredNotifications.settled(await delivered(), bots: bots)
        if !ids.isEmpty { center.removeDeliveredNotifications(withIdentifiers: ids) }
    }

    /// A silent "read" push: the conversation was read on another device.
    func withdraw(threadId: String) async {
        let ids = DeliveredNotifications.forThread(await delivered(), threadId: threadId)
        if !ids.isEmpty { center.removeDeliveredNotifications(withIdentifiers: ids) }
    }

    private func delivered() async -> [DeliveredNotifications.Delivered] {
        await center.deliveredNotifications().map { note in
            let info = note.request.content.userInfo
            func string(_ key: String) -> String? {
                guard let value = info[key] as? String, !value.isEmpty else { return nil }
                return value
            }
            return DeliveredNotifications.Delivered(
                id: note.request.identifier, botId: string("botId") ?? string("groupId"),
                threadId: string("threadId"), date: note.date
            )
        }
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
        // App in front: return [] (no banner, no sound). The live stream already
        // showed the line; a nudge still rings in-app once.
        Task { @MainActor in
            let appActive = UIApplication.shared.applicationState == .active
            if let push = PushPayload(userInfo: userInfo) {
                completionHandler(AttentionCenter.shared.presentation(for: push, appActive: appActive))
                return
            }
            if !ForegroundNotification.showsSystemBanner(
                appActive: appActive,
                viewingThreadId: AttentionCenter.shared.viewingThreadId,
                threadId: threadId
            ) {
                completionHandler([])
                return
            }
            completionHandler(NotificationSounds.isEnabled ? [.banner, .list, .sound, .badge] : [.banner, .list, .badge])
        }
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
