// The Links tab's page previews: the page's title, its icon and, when it
// has one, its Open Graph image, read by LinkPresentation
// (`LPMetadataProvider`). Kept in memory and in Caches/link-previews for a
// week, so a list scrolled again does not fetch again; a page that cannot
// be read keeps the row's own title and the domain. Computer-only links
// (`LinkReach.computer`) are never fetched.
import CryptoKit
import LinkPresentation
import SwiftUI
import UIKit

struct LinkPreview {
    var title: String?
    var icon: UIImage?
    var image: UIImage?
}

@MainActor
final class LinkPreviewStore: ObservableObject {
    static let shared = LinkPreviewStore()

    @Published private(set) var previews: [String: LinkPreview] = [:]
    private var pending: Set<String> = []
    private var unreadable: Set<String> = []
    private let directory: URL?
    private static let maxAge: TimeInterval = 7 * 24 * 3600
    private static let timeout: TimeInterval = 12

    init(directory: URL? = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appendingPathComponent("link-previews", isDirectory: true)) {
        self.directory = directory
        if let directory { try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true) }
    }

    func preview(for url: URL) -> LinkPreview? { previews[url.absoluteString] }

    /// Reads the page once per address (or the cached copy).
    func load(_ url: URL) {
        let key = url.absoluteString
        guard previews[key] == nil, !pending.contains(key), !unreadable.contains(key) else { return }
        pending.insert(key)
        Task {
            defer { pending.remove(key) }
            let metadata: LPLinkMetadata
            if let cached = cached(key) {
                metadata = cached
            } else {
                let provider = LPMetadataProvider()
                provider.timeout = Self.timeout
                provider.shouldFetchSubresources = true
                guard let fetched = try? await provider.startFetchingMetadata(for: url) else {
                    unreadable.insert(key)
                    return
                }
                metadata = fetched
                store(fetched, key)
            }
            let icon = await Self.image(metadata.iconProvider)
            let image = await Self.image(metadata.imageProvider)
            let title = metadata.title?.trimmingCharacters(in: .whitespacesAndNewlines)
            previews[key] = LinkPreview(title: title?.isEmpty == false ? title : nil, icon: icon, image: image)
        }
    }

    private static func image(_ provider: NSItemProvider?) async -> UIImage? {
        guard let provider, provider.canLoadObject(ofClass: UIImage.self) else { return nil }
        return await withCheckedContinuation { continuation in
            provider.loadObject(ofClass: UIImage.self) { object, _ in
                continuation.resume(returning: object as? UIImage)
            }
        }
    }

    // MARK: Disk cache

    private func file(_ key: String) -> URL? {
        let digest = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        return directory?.appendingPathComponent(digest + ".metadata")
    }

    private func cached(_ key: String) -> LPLinkMetadata? {
        guard let file = file(key),
              let modified = (try? file.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate,
              Date().timeIntervalSince(modified) < Self.maxAge,
              let data = try? Data(contentsOf: file)
        else { return nil }
        return try? NSKeyedUnarchiver.unarchivedObject(ofClass: LPLinkMetadata.self, from: data)
    }

    private func store(_ metadata: LPLinkMetadata, _ key: String) {
        guard let file = file(key),
              let data = try? NSKeyedArchiver.archivedData(withRootObject: metadata, requiringSecureCoding: true)
        else { return }
        try? data.write(to: file, options: .atomic)
    }
}
