// The conversation-wide lightbox (feature parity matrix CA31), the port of
// src/components/ConversationGallery.tsx and conversation-gallery-context.ts:
// every picture of a conversation in reading order, so the viewer opened on
// one steps through all of them, not only the message that was tapped.
import Foundation

/// One picture of the conversation: a generated image or an attached one,
/// always fetched through the route of the message that carries it.
public struct GalleryImage: Hashable, Identifiable, Sendable {
    public let messageId: String
    public let path: String
    public let name: String

    public init(messageId: String, path: String, name: String) {
        self.messageId = messageId
        self.path = path
        self.name = name
    }

    public var id: String { "\(messageId)\u{1F}\(path)" }
}

public enum ConversationGallery {
    /// The pictures of these messages in the order the transcript draws
    /// them: a message's generated images, then the images a person attached.
    /// The same picture twice in a row is one stop (`orderGalleryEntries`).
    public static func images(in messages: [Message]) -> [GalleryImage] {
        var out: [GalleryImage] = []
        for message in messages {
            var pictures = message.generatedImages
            if message.role == .user {
                pictures += AttachedMessageContent.parse(message.text ?? "").attachments.filter { $0.kind == .image }
            }
            for picture in pictures {
                let image = GalleryImage(messageId: message.id, path: picture.path, name: picture.name)
                if out.last?.id == image.id { continue }
                out.append(image)
            }
        }
        return out
    }

    /// `wrappedImageIndex`: previous of the first is the last, next of the
    /// last is the first.
    public static func wrapped(_ index: Int, step: Int, count: Int) -> Int {
        guard count > 0 else { return 0 }
        return ((index + step) % count + count) % count
    }
}

/// `previewKeyAction`: what a key does in the lightbox. Arrows page only
/// when there is more than one picture.
public enum LightboxKeyAction: Equatable, Sendable {
    case close, previous, next, zoomIn, zoomOut, zoomReset

    public static func action(for key: String, count: Int) -> LightboxKeyAction? {
        switch key {
        case "Escape": return .close
        case "ArrowLeft": return count > 1 ? .previous : nil
        case "ArrowRight": return count > 1 ? .next : nil
        case "+", "=": return .zoomIn
        case "-", "_": return .zoomOut
        case "0": return .zoomReset
        default: return nil
        }
    }
}

/// The find bar's position line and stepping (src/components/ChatFindBar.tsx).
public enum FindInConversation {
    /// `limit=100` and the 180 ms pause before a query is sent.
    public static let limit = 100
    public static let debounceMilliseconds = 180

    /// `move`: Return and the down chevron step forward, Shift-Return and the
    /// up chevron back, wrapping at both ends.
    public static func step(_ index: Int, by delta: Int, count: Int) -> Int? {
        guard count > 0 else { return nil }
        return ConversationGallery.wrapped(index, step: delta, count: count)
    }
}
