import CompanionCore
import Foundation
import Intents
import UserNotifications

/// Turns an APNs (or local) banner into an iOS communication notification:
/// the bot or person's name is the sender, and their avatar is the icon,
/// the way Messages and the reference design look. Without a loaded avatar the name
/// still replaces "Sagax". The Communication Notifications entitlement
/// (`com.apple.developer.usernotifications.communication`) has to be on
/// the App ID; without it `updating(from:)` throws and the title fallback
/// is what the phone shows.
enum CommunicationNotification {
    /// NSE entry: find the sender's face (the bot's mascot drawn here, or
    /// the picture it chose, or a person's photo), then donate the intent.
    /// Without a face the banner still names the sender, with the app icon.
    static func decorate(_ content: UNMutableNotificationContent) async -> UNNotificationContent {
        guard let payload = PushPayload(userInfo: content.userInfo),
              let sender = payload.senderIdentity
        else { return content }
        content.title = sender.displayName
        let imageData = await avatarData(for: sender)
        return applyingIntent(content, sender: sender, imageData: imageData)
    }

    /// The face's bytes: from the App Group cache, drawn, or downloaded.
    static func avatarData(for sender: PushSenderIdentity) async -> Data? {
        await NotificationAvatarResolver.imageData(
            for: sender,
            cache: NotificationAvatarCache.appGroup(SagaxSharedConfiguration.appGroupIdentifier),
            download: { await loadAvatar($0) },
            render: { look in await MascotAvatarRenderer.png(look) }
        )
    }

    /// Donate `INSendMessageIntent` and return `content.updating(from:)`.
    /// On failure (missing entitlement, older iOS) the content already has
    /// `title = sender.displayName`.
    static func applyingIntent(
        _ content: UNMutableNotificationContent,
        sender: PushSenderIdentity,
        imageData: Data?
    ) -> UNNotificationContent {
        let intent = CommunicationIntentFactory.intent(sender, body: content.body, imageData: imageData)
        CommunicationIntentFactory.interaction(intent).donate(completion: nil)
        do {
            let updated = try content.updating(from: intent)
            // updating(from:) has dropped the category or requestId on some
            // iOS versions. Allow and Deny read both.
            guard let mutable = updated.mutableCopy() as? UNMutableNotificationContent else { return updated }
            // the category is what carries the buttons: always the one we chose
            if !content.categoryIdentifier.isEmpty {
                mutable.categoryIdentifier = content.categoryIdentifier
            }
            var info = mutable.userInfo
            var filled = false
            for (key, value) in content.userInfo where info[key] == nil {
                info[key] = value
                filled = true
            }
            if filled { mutable.userInfo = info }
            if mutable.threadIdentifier.isEmpty {
                mutable.threadIdentifier = content.threadIdentifier
            }
            if mutable.subtitle.isEmpty, !content.subtitle.isEmpty {
                mutable.subtitle = content.subtitle
            }
            if mutable.sound == nil {
                mutable.sound = content.sound
            }
            return mutable
        } catch {
            return content
        }
    }

    /// Fetch the sender's picture from the signed-in server, with the
    /// pairing bearer. Eight seconds: the extension has about thirty, and
    /// a miss still shows the name.
    static func loadAvatar(_ raw: String?) async -> Data? {
        guard let raw, let avatar = AccountAvatar(raw) else { return nil }
        guard let connection = SagaxSharedConnectionStore.loadActiveConnection() else { return nil }
        let token: String
        do {
            guard let stored = try SagaxSharedKeychain.token(for: connection.id), !stored.isEmpty else {
                return nil
            }
            token = stored
        } catch {
            return nil
        }
        let client = CompanionClient(connection: connection, token: token, requestTimeout: 8)
        return try? await client.accountAvatar(avatar)
    }
}
