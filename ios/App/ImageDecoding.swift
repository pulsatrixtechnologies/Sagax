// Pictures decoded off the main thread.
//
// `UIImage(data:)` is lazy: the bytes are decoded the first time the image
// is drawn, which is on the main thread, in the middle of a frame. For a
// screenshot in the transcript or a live browser/computer stream that is a
// dropped frame per picture. These decode on a background thread and hand
// back an image that is already prepared for display.
import UIKit

private struct DecodedImage: @unchecked Sendable {
    let value: UIImage?
}

enum ImageDecoding {
    static func prepared(_ data: Data) async -> UIImage? {
        await Task.detached(priority: .userInitiated) { () -> DecodedImage in
            guard let image = UIImage(data: data) else { return DecodedImage(value: nil) }
            return DecodedImage(value: image.preparingForDisplay() ?? image)
        }.value.value
    }
}
