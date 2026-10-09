// Pushes through Apple Push Notification service (docs/ios-push.md). The
// organization server sends them when the app is closed or suspended
// (server/push/); this is what the phone tells the server when it registers
// (`POST /api/push/devices`), what it reads out of a push it receives, and
// the collapse identifier both sides share so one conversation shows one
// notification.
import CryptoKit
import Foundation

/// Which APNs the build talks to. A build run from Xcode is sandbox; a
/// TestFlight or App Store build is production.
public enum APNsEnvironment: String, Codable, Sendable {
    case sandbox
    case production

    /// From the build's embedded provisioning profile: `aps-environment`
    /// `development` is sandbox. No profile (TestFlight and App Store strip
    /// it) is production. The simulator is always sandbox.
    public static func detect(provisioningProfile: Data?, isSimulator: Bool) -> APNsEnvironment {
        if isSimulator { return .sandbox }
        guard let profile = provisioningProfile else { return .production }
        // The profile is a signed CMS envelope; its plist is plain text inside.
        guard let start = profile.range(of: Data("<?xml".utf8)),
              let end = profile.range(of: Data("</plist>".utf8), in: start.lowerBound..<profile.endIndex)
        else { return .production }
        let plist = profile.subdata(in: start.lowerBound..<end.upperBound)
        guard let root = try? PropertyListSerialization.propertyList(from: plist, format: nil) as? [String: Any],
              let entitlements = root["Entitlements"] as? [String: Any],
              let aps = entitlements["aps-environment"] as? String
        else { return .production }
        return aps == "development" ? .sandbox : .production
    }
}

/// This device's Settings > Notifications, as the server applies them to a push.
public struct PushDeviceSettings: Codable, Equatable, Hashable, Sendable {
    public var sound: Bool
    public var badge: Bool
    public var nudgeSound: Bool

    public init(sound: Bool = true, badge: Bool = true, nudgeSound: Bool = true) {
        self.sound = sound
        self.badge = badge
        self.nudgeSound = nudgeSound
    }

    public init(_ attention: AttentionSettings) {
        self.init(sound: attention.sound, badge: attention.badge, nudgeSound: attention.nudgeSound)
    }
}

/// The body of `POST /api/push/devices`.
public struct PushRegistration: Codable, Equatable, Hashable, Sendable {
    public var token: String
    public var platform: String
    public var environment: APNsEnvironment
    public var appVersion: String
    public var deviceName: String
    public var settings: PushDeviceSettings

    public init(token: String, environment: APNsEnvironment, appVersion: String, deviceName: String, settings: PushDeviceSettings) {
        self.token = token
        self.platform = "ios"
        self.environment = environment
        self.appVersion = String(appVersion.prefix(40))
        self.deviceName = String(deviceName.prefix(80))
        self.settings = settings
    }
}

public enum PushToken {
    /// The device token as the server stores it: lowercase hex.
    public static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
}

public enum PushKind: String, Sendable {
    case message
    case nudge
    case approval
    case achievement
    case routine
}

/// One conversation, one notification: the server's `apns-collapse-id`
/// (server/push/payload.ts collapseId) and this app's local notification
/// identifier are the same string, so a push replaces the banner the live
/// stream already showed instead of adding a second one.
public enum PushCollapse {
    public static func identifier(threadId: String?, kind: String) -> String {
        let thread = threadId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let key = thread.isEmpty ? "sagax.\(kind)" : "sagax.t.\(thread)"
        if key.utf8.count <= 64 { return key }
        let digest = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        return "sagax.h.\(digest.prefix(48))"
    }
}

/// What a received push carries next to `aps`.
public struct PushPayload: Equatable, Sendable {
    public var kind: PushKind
    public var threadId: String?
    public var botId: String?
    public var groupId: String?
    public var fromId: String?
    public var id: String?
    /// Milliseconds since 1970.
    public var at: Double?

    public init?(userInfo: [AnyHashable: Any]) {
        guard userInfo["aps"] != nil,
              let raw = userInfo["kind"] as? String, let kind = PushKind(rawValue: raw)
        else { return nil }
        func string(_ key: String) -> String? {
            guard let value = userInfo[key] as? String else { return nil }
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        self.kind = kind
        threadId = string("threadId")
        botId = string("botId")
        groupId = string("groupId")
        fromId = string("fromId")
        id = string("id")
        at = (userInfo["at"] as? NSNumber)?.doubleValue
    }

    /// Where a tap goes (the same target a local notification carries).
    public var target: NotificationTarget? {
        NotificationTarget(botId: botId ?? groupId, threadId: threadId)
    }

    /// The same nudge from the live stream and from APNs share this key, so
    /// it rings once.
    public var nudgeKey: String? {
        guard kind == .nudge, let fromId, let at else { return nil }
        return NudgeFrame.dedupKey(fromId: fromId, at: at)
    }
}

public extension NudgeFrame {
    static func dedupKey(fromId: String, at: Double) -> String {
        "\(fromId.lowercased()).\(Int64(at))"
    }

    var dedupKey: String? {
        guard let at else { return nil }
        return Self.dedupKey(fromId: fromId, at: at)
    }
}

private struct PushRemovalBody: Encodable {
    var token: String
}

public extension CompanionClient {
    func registerPushDeviceRequest(_ registration: PushRegistration) throws -> URLRequest {
        try makeRequest("POST", "/api/push/devices", encodedBody: registration)
    }

    /// Registers (or refreshes) this phone for pushes for the signed-in person.
    func registerPushDevice(_ registration: PushRegistration) async throws {
        try await send(registerPushDeviceRequest(registration))
    }

    func unregisterPushDeviceRequest(token: String) throws -> URLRequest {
        try makeRequest("DELETE", "/api/push/devices", encodedBody: PushRemovalBody(token: token))
    }

    /// Sign-out: this phone stops getting that person's pushes.
    func unregisterPushDevice(token: String) async throws {
        try await send(unregisterPushDeviceRequest(token: token))
    }
}
