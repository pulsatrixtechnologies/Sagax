// The face of a communication notification (docs/ios-push.md): a bot's
// mascot, drawn on the phone from the look its push carries, or the picture
// it chose (a crop other than `mascot`), or a person's photo. Kept out of
// the extension so `swift test` covers the choice, the cache and the
// fallback; the drawing itself is SwiftUI (MascotAvatarRenderer.swift).
import CryptoKit
import Foundation

/// Where the banner's face comes from.
public enum NotificationAvatarPlan: Equatable, Sendable {
    /// Download this server path with the pairing bearer (a person's photo,
    /// or a bot's picture with a crop that shows it). A bot falls back to
    /// its mascot when the picture does not load.
    case picture(String, fallbackToMascot: Bool)
    /// Draw the bot's mascot (from the cache when it is there).
    case mascot
    /// Nothing to show: the app icon stays, as before.
    case none

    /// The same rule as the app's avatars (`resolveBotAvatarOutcome`): a
    /// bot shows its picture only with a crop other than `mascot`.
    public static func plan(for sender: PushSenderIdentity) -> NotificationAvatarPlan {
        if let look = sender.look {
            let crop = look.avatarCrop ?? .mascot
            if crop != .mascot, let url = sender.avatarUrl {
                return .picture(url, fallbackToMascot: true)
            }
            return .mascot
        }
        if let url = sender.avatarUrl { return .picture(url, fallbackToMascot: false) }
        return .none
    }
}

/// Rendered mascots in the App Group, one PNG per bot and per version of
/// its look, so the app and the extension draw a face once. The oldest
/// files go past `limit`; a new look of a bot replaces its older ones.
public struct NotificationAvatarCache: Sendable {
    public let directory: URL
    public var limit: Int

    /// Bumped when the drawing changes, so every face is drawn again.
    public static let rendererRevision = "r1"

    public init(directory: URL, limit: Int = 96) {
        self.directory = directory
        self.limit = limit
    }

    /// `<App Group>/Library/Caches/NotificationAvatars`, nil without the group
    /// (an unsigned build): the face is then drawn every time.
    public static func appGroup(_ identifier: String) -> NotificationAvatarCache? {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier) else {
            return nil
        }
        return NotificationAvatarCache(
            directory: container.appendingPathComponent("Library/Caches/NotificationAvatars", isDirectory: true)
        )
    }

    /// A file name from the bot id (hashed: any id is a safe name) and the
    /// look version (hex only, else hashed too).
    static func senderKey(_ senderId: String) -> String {
        SHA256.hash(data: Data(senderId.utf8)).prefix(12).map { String(format: "%02x", $0) }.joined()
    }

    static func versionKey(_ version: String) -> String {
        let clean = version.lowercased()
        if !clean.isEmpty, clean.count <= 64, clean.allSatisfy({ $0.isHexDigit || $0 == "l" }) { return clean }
        return SHA256.hash(data: Data(version.utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
    }

    public func fileURL(senderId: String, version: String) -> URL {
        directory.appendingPathComponent("\(Self.senderKey(senderId))-\(Self.rendererRevision)-\(Self.versionKey(version)).png")
    }

    public func image(senderId: String, version: String) -> Data? {
        let url = fileURL(senderId: senderId, version: version)
        guard let data = try? Data(contentsOf: url), !data.isEmpty else { return nil }
        // recently used stays
        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
        return data
    }

    public func store(_ data: Data, senderId: String, version: String) {
        guard !data.isEmpty else { return }
        let fm = FileManager.default
        try? fm.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = fileURL(senderId: senderId, version: version)
        guard (try? data.write(to: url, options: [.atomic])) != nil else { return }
        prune(keeping: url, sender: Self.senderKey(senderId))
    }

    /// The same bot's other faces of this renderer go when they are older
    /// than a day (the app and the extension may key one look two ways for
    /// a moment); past `limit`, the least recently used go.
    private func prune(keeping kept: URL, sender: String) {
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        let dated = files.filter { $0.pathExtension == "png" }.map { url -> (URL, Date) in
            let date = (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return (url, date)
        }
        let dayAgo = Date().addingTimeInterval(-86_400)
        var remaining: [(URL, Date)] = []
        for (url, date) in dated where url.lastPathComponent != kept.lastPathComponent {
            let name = url.lastPathComponent
            let sameSender = name.hasPrefix("\(sender)-")
            let staleRenderer = !name.contains("-\(Self.rendererRevision)-")
            if staleRenderer || (sameSender && date < dayAgo) {
                try? fm.removeItem(at: url)
            } else {
                remaining.append((url, date))
            }
        }
        let overflow = remaining.count + 1 - limit
        guard overflow > 0 else { return }
        for (url, _) in remaining.sorted(by: { $0.1 < $1.1 }).prefix(overflow) {
            try? fm.removeItem(at: url)
        }
    }
}

/// Picks the face and gets its bytes. Every miss returns nil: the
/// notification still goes, with the bot's name and the app icon.
public enum NotificationAvatarResolver {
    public static func imageData(
        for sender: PushSenderIdentity,
        cache: NotificationAvatarCache?,
        download: (String) async -> Data?,
        render: (PushSenderLook) async -> Data?
    ) async -> Data? {
        switch NotificationAvatarPlan.plan(for: sender) {
        case .none:
            return nil
        case let .picture(url, fallbackToMascot):
            if let data = await download(url), !data.isEmpty { return data }
            guard fallbackToMascot else { return nil }
            return await mascot(for: sender, cache: cache, render: render)
        case .mascot:
            return await mascot(for: sender, cache: cache, render: render)
        }
    }

    static func mascot(
        for sender: PushSenderIdentity,
        cache: NotificationAvatarCache?,
        render: (PushSenderLook) async -> Data?
    ) async -> Data? {
        guard let look = sender.look else { return nil }
        let version = sender.lookVersion ?? look.fingerprint(avatarUrl: sender.avatarUrl)
        if let cached = cache?.image(senderId: sender.id, version: version) { return cached }
        guard let data = await render(look), !data.isEmpty else { return nil }
        cache?.store(data, senderId: sender.id, version: version)
        return data
    }
}

#if canImport(Intents)
import Intents

/// The sender and the message iOS turns into a communication notification:
/// the bot (or person) is an `INPerson` with its face, the message an
/// incoming `INSendMessageIntent` in its conversation.
public enum CommunicationIntentFactory {
    public static func person(_ sender: PushSenderIdentity, imageData: Data?) -> INPerson {
        INPerson(
            personHandle: INPersonHandle(value: sender.id, type: .unknown),
            nameComponents: nil,
            displayName: sender.displayName,
            image: image(imageData),
            contactIdentifier: nil,
            customIdentifier: sender.id
        )
    }

    public static func intent(_ sender: PushSenderIdentity, body: String, imageData: Data?) -> INSendMessageIntent {
        let person = person(sender, imageData: imageData)
        let intent = INSendMessageIntent(
            recipients: nil,
            outgoingMessageType: .outgoingMessageText,
            content: body,
            speakableGroupName: nil,
            conversationIdentifier: sender.conversationId,
            serviceName: "Sagax",
            sender: person,
            attachments: nil
        )
        #if os(iOS) || os(watchOS)
        if let image = person.image {
            intent.setImage(image, forParameterNamed: \.sender)
        }
        #endif
        return intent
    }

    /// The incoming interaction to donate before `updating(from:)`.
    public static func interaction(_ intent: INSendMessageIntent) -> INInteraction {
        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        return interaction
    }

    static func image(_ data: Data?) -> INImage? {
        guard let data, !data.isEmpty else { return nil }
        return INImage(imageData: data)
    }
}
#endif
