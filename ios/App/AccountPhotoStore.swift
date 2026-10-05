// The person's own photo for each saved connection (home, Settings account
// card, Account, Switch Account), kept on this phone.
//
// The image comes from the connection's own server (`AccountAvatar`: on an
// organization server, the person's Perspicax avatar that the Sagax server
// serves at a versioned route). It is kept under Caches keyed by connection
// and by that versioned route, so a launch offline still shows the last
// photo, the same version is never downloaded twice, and a new photo in
// Perspicax (a new version, a new key) replaces the old file. A connection
// whose server names no photo has none here: the views draw the initial.
import CompanionCore
import CryptoKit
import Foundation
import UIKit

@MainActor
final class AccountPhotoStore: ObservableObject {
    static let shared = AccountPhotoStore()

    /// Bumped on every change so the rows that show a saved connection's
    /// photo redraw.
    @Published private(set) var revision = 0

    private struct Entry: Codable {
        var key: String
        var data: Data
    }

    private var memory: [String: (key: String, image: UIImage)] = [:]
    private let directory: URL?

    init(directory: URL? = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
        .appendingPathComponent("account-photos", isDirectory: true)) {
        self.directory = directory
    }

    /// The last photo kept for this connection, whatever its version.
    func image(for connectionID: String?) -> UIImage? {
        guard let connectionID else { return nil }
        return load(connectionID)?.image
    }

    /// The photo for this exact version, when it is already here.
    func image(for connectionID: String, avatar: AccountAvatar) -> UIImage? {
        guard let entry = load(connectionID), entry.key == avatar.cacheKey else { return nil }
        return entry.image
    }

    /// Keep these bytes as the connection's photo. Nil when they are not an
    /// image UIKit can draw (nothing is kept then).
    @discardableResult
    func store(_ data: Data, avatar: AccountAvatar, connectionID: String) -> UIImage? {
        guard let image = UIImage(data: data) else { return nil }
        memory[connectionID] = (avatar.cacheKey, image)
        if let file = file(for: connectionID), let encoded = try? PropertyListEncoder().encode(Entry(key: avatar.cacheKey, data: data)) {
            try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? encoded.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
        revision += 1
        return image
    }

    /// The connection has no photo any more, or is gone from this phone.
    func forget(_ connectionID: String) {
        let had = memory.removeValue(forKey: connectionID) != nil
        var removed = false
        if let file = file(for: connectionID), FileManager.default.fileExists(atPath: file.path) {
            try? FileManager.default.removeItem(at: file)
            removed = true
        }
        if had || removed { revision += 1 }
    }

    private func load(_ connectionID: String) -> (key: String, image: UIImage)? {
        if let hit = memory[connectionID] { return hit }
        guard let file = file(for: connectionID),
              let raw = try? Data(contentsOf: file),
              let entry = try? PropertyListDecoder().decode(Entry.self, from: raw),
              let image = UIImage(data: entry.data)
        else { return nil }
        memory[connectionID] = (entry.key, image)
        return (entry.key, image)
    }

    /// One file per connection, named by a digest of its id.
    private func file(for connectionID: String) -> URL? {
        let digest = SHA256.hash(data: Data(connectionID.utf8)).map { String(format: "%02x", $0) }.joined()
        return directory?.appendingPathComponent("\(digest.prefix(32)).plist")
    }
}
