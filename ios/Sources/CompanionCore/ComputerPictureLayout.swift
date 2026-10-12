// Sizes a 16:10 remote-computer picture to fit a window without forcing
// width-first sizing (which overflows in landscape and leaves a black stage).
import CoreGraphics

public enum ComputerPictureLayout {
    /// Width divided by height of the remote frame (Sagax uses 16:10).
    public static let defaultAspect: CGFloat = 1.6

    /// Largest size with `aspect` that fits inside `bounds`.
    public static func fit(aspect: CGFloat = defaultAspect, in bounds: CGSize) -> CGSize {
        let w = bounds.width
        let h = bounds.height
        guard w > 0, h > 0, aspect > 0 else { return .zero }
        var width = w
        var height = w / aspect
        if height > h {
            height = h
            width = h * aspect
        }
        return CGSize(width: width, height: height)
    }
}
