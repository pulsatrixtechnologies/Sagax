// The picture at the start of a Library row, iPhone and iPad (2026-10-28), as
// on the desktop (`bot-settings/LibraryGlyph.tsx`): an image is its own small
// square thumbnail, drawn by the server (`?thumb=1`, 96 px, never the full
// picture) and loaded lazily as the row appears; a page or an artifact is the
// colored chart mark; Markdown and text a document; a zip an archive; a PDF
// its own mark; the rest by kind. A thumbnail that cannot load keeps the
// image symbol.
import CompanionCore
import SwiftUI
import UIKit

/// Thumbnails already fetched, so scrolling back does not ask again.
private enum LibraryThumbnailCache {
    static let images: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 200
        return cache
    }()
}

struct LibraryEntryGlyph: View {
    @EnvironmentObject private var session: Session
    let threadId: String
    let entry: LibraryEntry
    /// The side of the square.
    var size: CGFloat = 24
    var secondary: Color = Theme.textSecondary

    @State private var image: UIImage?
    @State private var failed = false

    private var glyph: LibraryGlyph { entry.glyph }
    private var cacheKey: NSString { "\(threadId)/\(entry.id)" as NSString }

    var body: some View {
        Group {
            switch glyph {
            case .thumbnail:
                thumbnail
            case .page:
                PageGlyph(size: size - 4)
            case .pdf:
                Text(verbatim: "PDF")
                    .font(.system(size: size * 0.3, weight: .bold))
                    .foregroundStyle(Color.red)
                    .frame(width: size - 4, height: size - 4)
                    .background(Color.red.opacity(0.15), in: RoundedRectangle(cornerRadius: 5, style: .continuous))
            default:
                symbol(Self.symbolName(glyph), tint: glyph == .archive ? .orange : secondary)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    @ViewBuilder private var thumbnail: some View {
        if let image, !failed {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 0.5))
        } else {
            symbol("photo", tint: secondary)
                .task(id: entry.id) { await load() }
        }
    }

    private func symbol(_ name: String, tint: Color) -> some View {
        Image(systemName: name).font(.system(size: size * 0.62)).foregroundStyle(tint)
    }

    private func load() async {
        guard case let .file(file) = entry else { return }
        if let cached = LibraryThumbnailCache.images.object(forKey: cacheKey) {
            image = cached
            return
        }
        guard let client = session.profileClient else { return }
        // The server draws the small square; the picture itself is never fetched for a row.
        guard let data = try? await client.threadFileThumbData(threadId: threadId, fileId: file.id),
              let picture = UIImage(data: data) else {
            failed = true
            return
        }
        LibraryThumbnailCache.images.setObject(picture, forKey: cacheKey)
        image = picture
    }

    static func symbolName(_ glyph: LibraryGlyph) -> String {
        switch glyph {
        case .thumbnail, .image: "photo"
        case .page: "chart.bar.doc.horizontal"
        case .pdf, .document: "doc.text"
        case .archive: "doc.zipper"
        case .video: "film"
        case .audio: "music.note"
        case .code: "chevron.left.forwardslash.chevron.right"
        case .other: "doc"
        }
    }
}

/// "Show more" under the Older card: shows its first rows, then all of them.
enum LibraryOlder {
    static func shown(_ entries: [LibraryEntry], expanded: Bool) -> [LibraryEntry] {
        expanded ? entries : Array(entries.prefix(LibraryRules.olderPreview))
    }

    static func hidesRows(_ entries: [LibraryEntry], expanded: Bool) -> Bool {
        !expanded && entries.count > LibraryRules.olderPreview
    }
}
