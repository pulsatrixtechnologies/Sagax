// The face of a bot's communication notification (docs/ios-push.md): what a
// push carries, which face is chosen, the App Group cache, the fallback to
// the app icon, and the INPerson / INSendMessageIntent built from it.
import Foundation
import XCTest
@testable import CompanionCore
#if canImport(Intents)
import Intents
#endif

final class NotificationAvatarTests: XCTestCase {
    private let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x01])

    private func botPush(_ extra: [AnyHashable: Any] = [:]) -> [AnyHashable: Any] {
        var info: [AnyHashable: Any] = [
            "aps": ["alert": ["title": "Scout", "body": "Pushed the branch."], "mutable-content": 1, "thread-id": "t_scout"],
            "kind": "message", "threadId": "t_scout", "botId": "scout",
            "senderName": "Scout", "senderId": "scout",
            "senderLook": ["color": "teal", "mascotLook": ["character": "shape", "shape": "bean", "skins": ["shape": "glossy"]], "avatarCrop": "mascot"],
            "senderLookVersion": "0123456789ABCDEF",
        ]
        for (key, value) in extra { info[key] = value }
        return info
    }

    private func tempCache(limit: Int = 96) throws -> NotificationAvatarCache {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("notif-avatars-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        return NotificationAvatarCache(directory: dir, limit: limit)
    }

    // MARK: - Payload

    func testABotPushCarriesItsLookAndVersion() throws {
        let payload = try XCTUnwrap(PushPayload(userInfo: botPush()))
        let sender = try XCTUnwrap(payload.senderIdentity)
        XCTAssertEqual(sender.id, "scout")
        XCTAssertEqual(sender.displayName, "Scout")
        XCTAssertEqual(sender.conversationId, "t_scout")
        XCTAssertEqual(sender.lookVersion, "0123456789abcdef")
        let look = try XCTUnwrap(sender.look)
        XCTAssertEqual(look.color, "teal")
        XCTAssertEqual(look.avatarCrop, .mascot)
        XCTAssertEqual(look.resolvedLook.character, .shape)
    }

    func testAPersonOrAnOlderServerHasNoLook() throws {
        var info = botPush()
        info.removeValue(forKey: "senderLook")
        info.removeValue(forKey: "senderLookVersion")
        let sender = try XCTUnwrap(PushPayload(userInfo: info)?.senderIdentity)
        XCTAssertNil(sender.look)
        XCTAssertNil(sender.lookVersion)
        XCTAssertEqual(NotificationAvatarPlan.plan(for: sender), .none)
    }

    func testAMalformedLookOrVersionIsDropped() throws {
        let payload = try XCTUnwrap(PushPayload(userInfo: botPush(["senderLook": "nope", "senderLookVersion": "../../etc"])))
        XCTAssertNil(payload.senderLook)
        XCTAssertNil(payload.senderLookVersion)
        // an unknown character still draws a mascot (the owl), never fails the push
        var oddInfo = botPush(["senderLook": ["color": "teal", "mascotLook": ["character": "dragon"]]])
        oddInfo.removeValue(forKey: "senderLookVersion")
        let odd = try XCTUnwrap(PushPayload(userInfo: oddInfo))
        XCTAssertEqual(odd.senderLook?.resolvedLook.character, .owl)
        // without the server's version, the phone keys the look itself
        XCTAssertEqual(odd.senderIdentity?.lookVersion?.first, "l")
    }

    // MARK: - Plan

    func testTheFaceFollowsTheBotsCrop() {
        var sender = PushSenderIdentity(id: "b", displayName: "B", conversationId: "t", avatarUrl: "/api/attachments/a.png", look: PushSenderLook(color: "blue"))
        XCTAssertEqual(NotificationAvatarPlan.plan(for: sender), .mascot, "the default crop draws the mascot, as in the app")
        sender.look?.avatarCrop = .circle
        XCTAssertEqual(NotificationAvatarPlan.plan(for: sender), .picture("/api/attachments/a.png", fallbackToMascot: true))
        sender.avatarUrl = nil
        XCTAssertEqual(NotificationAvatarPlan.plan(for: sender), .mascot)
        let person = PushSenderIdentity(id: "p", displayName: "P", conversationId: "t", avatarUrl: "/api/people/p/avatar?v=1")
        XCTAssertEqual(NotificationAvatarPlan.plan(for: person), .picture("/api/people/p/avatar?v=1", fallbackToMascot: false))
    }

    // MARK: - Resolver and cache

    func testTheMascotIsDrawnOnceAndCachedPerBotAndLook() async throws {
        let cache = try tempCache()
        let sender = try XCTUnwrap(PushPayload(userInfo: botPush())?.senderIdentity)
        var renders = 0
        let render: (PushSenderLook) async -> Data? = { _ in renders += 1; return self.png }
        let first = await NotificationAvatarResolver.imageData(for: sender, cache: cache, download: { _ in XCTFail("no download"); return nil }, render: render)
        let second = await NotificationAvatarResolver.imageData(for: sender, cache: cache, download: { _ in nil }, render: render)
        XCTAssertEqual(first, png)
        XCTAssertEqual(second, png)
        XCTAssertEqual(renders, 1)
        XCTAssertNotNil(cache.image(senderId: "scout", version: "0123456789abcdef"))

        // a new look is a new face
        var changed = sender
        changed.lookVersion = "fedcba9876543210"
        _ = await NotificationAvatarResolver.imageData(for: changed, cache: cache, download: { _ in nil }, render: render)
        XCTAssertEqual(renders, 2)
        // another bot never reads this one's face
        XCTAssertNil(cache.image(senderId: "other", version: "0123456789abcdef"))
    }

    func testCacheFileNamesAreSafeForAnyId() throws {
        let cache = try tempCache()
        let url = cache.fileURL(senderId: "../../../evil/bot", version: "../x")
        XCTAssertEqual(url.deletingLastPathComponent().standardizedFileURL, cache.directory.standardizedFileURL)
        XCTAssertFalse(url.lastPathComponent.contains("/"))
        XCTAssertTrue(url.lastPathComponent.hasSuffix(".png"))
    }

    func testTheCacheKeepsItsLimit() throws {
        let cache = try tempCache(limit: 3)
        for index in 0..<6 {
            cache.store(png, senderId: "bot\(index)", version: "aa")
        }
        let files = try FileManager.default.contentsOfDirectory(atPath: cache.directory.path)
        XCTAssertEqual(files.count, 3)
        XCTAssertNotNil(cache.image(senderId: "bot5", version: "aa"))
        XCTAssertNil(cache.image(senderId: "bot0", version: "aa"))
    }

    func testWithoutAnImageTheNotificationStillGoes() async throws {
        let cache = try tempCache()
        let sender = try XCTUnwrap(PushPayload(userInfo: botPush())?.senderIdentity)
        // the drawing failed: nil, the banner keeps the app icon
        let none = await NotificationAvatarResolver.imageData(for: sender, cache: cache, download: { _ in nil }, render: { _ in nil })
        XCTAssertNil(none)
        XCTAssertNil(cache.image(senderId: "scout", version: "0123456789abcdef"))
        // no cache at all (an unsigned build): still drawn
        let drawn = await NotificationAvatarResolver.imageData(for: sender, cache: nil, download: { _ in nil }, render: { _ in self.png })
        XCTAssertEqual(drawn, png)
    }

    func testAPictureThatDoesNotLoadFallsBackToTheMascot() async throws {
        var sender = try XCTUnwrap(PushPayload(userInfo: botPush(["avatarUrl": "/api/attachments/123e4567-e89b-12d3-a456-426614174000.webp"]))?.senderIdentity)
        sender.look?.avatarCrop = .circle
        let photo = Data([1, 2, 3])
        let loaded = await NotificationAvatarResolver.imageData(for: sender, cache: nil, download: { _ in photo }, render: { _ in self.png })
        XCTAssertEqual(loaded, photo)
        let missed = await NotificationAvatarResolver.imageData(for: sender, cache: nil, download: { _ in nil }, render: { _ in self.png })
        XCTAssertEqual(missed, png)
    }

    func testTheLocalFingerprintFollowsTheLook() {
        let a = PushSenderLook(color: "teal", mascotLook: .owl)
        XCTAssertEqual(a.fingerprint(), PushSenderLook(color: "teal", mascotLook: .owl).fingerprint())
        XCTAssertNotEqual(a.fingerprint(), PushSenderLook(color: "red", mascotLook: .owl).fingerprint())
        XCTAssertNotEqual(a.fingerprint(), PushSenderLook(color: "teal", mascotLook: .owl, mascotSkin: .gold).fingerprint())
    }

    // MARK: - INPerson and INSendMessageIntent

    #if canImport(Intents)
    func testTheIntentNamesTheBotWithItsFace() throws {
        let sender = try XCTUnwrap(PushPayload(userInfo: botPush())?.senderIdentity)
        let person = CommunicationIntentFactory.person(sender, imageData: png)
        XCTAssertEqual(person.displayName, "Scout")
        XCTAssertEqual(person.customIdentifier, "scout")
        XCTAssertEqual(person.personHandle?.value, "scout")
        XCTAssertNotNil(person.image)

        let intent = CommunicationIntentFactory.intent(sender, body: "Pushed the branch.", imageData: png)
        XCTAssertEqual(intent.sender?.displayName, "Scout")
        XCTAssertNotNil(intent.sender?.image)
        XCTAssertEqual(intent.content, "Pushed the branch.")
        // grouped by conversation, like the push's thread-id
        XCTAssertEqual(intent.conversationIdentifier, "t_scout")
        XCTAssertEqual(intent.serviceName, "Sagax")
        XCTAssertEqual(CommunicationIntentFactory.interaction(intent).direction, .incoming)
    }

    func testWithoutAFaceTheIntentStillNamesTheBot() throws {
        let sender = try XCTUnwrap(PushPayload(userInfo: botPush())?.senderIdentity)
        let intent = CommunicationIntentFactory.intent(sender, body: "Hi", imageData: nil)
        XCTAssertEqual(intent.sender?.displayName, "Scout")
        XCTAssertNil(intent.sender?.image)
        XCTAssertNil(CommunicationIntentFactory.person(sender, imageData: Data()).image)
    }
    #endif
}
