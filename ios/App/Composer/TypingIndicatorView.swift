import SwiftUI

/// Three dots breathing in turn while a bot works.
///
/// Each dot runs its own repeating animation, so the render server drives
/// the motion at the display's rate (120 Hz on ProMotion) and `body` is not
/// evaluated per frame. It used to be a `TimelineView` capped at 30 Hz that
/// rebuilt the dots on every tick.
public struct TypingIndicatorView: View {
    @Environment(\.themePalette) var themePalette
    public let tintColor: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(tintColor: Color = .purple) {
        self.tintColor = tintColor
    }

    public var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3) { index in
                TypingDot(color: tintColor.opacity(0.85), delay: Double(index) * 0.16, animated: !reduceMotion)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Theme.bubbleAssistant)
        .clipShape(Capsule())
    }
}

/// One dot: from 0.35 to full size and back, once a second, offset by
/// `delay` so the three read as a wave. Still at full size under Reduce Motion.
private struct TypingDot: View {
    let color: Color
    let delay: Double
    let animated: Bool
    @State private var up = false

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 6.5, height: 6.5)
            .scaleEffect(animated ? (up ? 1 : 0.35) : 1)
            .animation(
                animated ? .easeInOut(duration: 0.5).repeatForever(autoreverses: true).delay(delay) : nil,
                value: up
            )
            .onAppear { if animated { up = true } }
            .onValueChange(of: animated) { now in up = now }
    }
}
