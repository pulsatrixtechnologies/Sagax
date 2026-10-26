// A light animation at the opening of the app: the app's own mascot (the
// Sagax owl, or the person's Primary Bot in its own look, BrandMascotView)
// stands in the middle of the skin's ground, gives one small hop, and the
// home shows through as it fades. About a second in all.
//
// - It never holds anything up: the home is built underneath from the first
//   frame, the overlay takes no touch and goes away on its own schedule,
//   whatever the connection is doing.
// - Once per launch, not on a return from the background.
// - Reduce Motion: no overlay at all. `-noLaunchMascot` and UI tests skip it.
import CompanionCore
import SwiftUI

enum LaunchMascot {
    /// The mascot's size, pt.
    static let size: CGFloat = 112
    /// The hop, then the fade: seconds from the first frame.
    /// The window itself fades in as the app opens: the hop waits for it.
    static let delay: Double = 0.3
    static let hop: Double = 0.62
    static let fadeAt: Double = 0.8
    static let fade: Double = 0.32

    static var skipped: Bool {
        let arguments = ProcessInfo.processInfo.arguments
        return arguments.contains("-noLaunchMascot") || arguments.contains("-uiTesting")
    }

    /// The hop at `t` s: a lift (fraction of the size, up is negative) and a squash.
    static func pose(_ time: Double) -> (dy: Double, sx: Double, sy: Double) {
        let t = time - delay
        if t < 0 { return (0, 1, 1) }
        func ease(_ x: Double) -> Double { let c = min(1, max(0, x)); return c * c * (3 - 2 * c) }
        if t < 0.12 {
            // crouch
            let k = ease(t / 0.12)
            return (0, 1 + 0.05 * k, 1 - 0.06 * k)
        }
        if t < 0.44 {
            // up and down
            let k = (t - 0.12) / 0.32
            let up = sin(k * Double.pi)
            return (-0.1 * up, 1.05 - 0.08 * ease(k * 2) + 0.03 * ease(k * 2 - 1), 0.94 + 0.09 * ease(k * 2) - 0.03 * ease(k * 2 - 1))
        }
        if t < hop {
            // land and settle
            let k = ease((t - 0.44) / (hop - 0.44))
            let s = sin(k * Double.pi)
            return (0, 1 + 0.04 * s, 1 - 0.04 * s)
        }
        return (0, 1, 1)
    }
}

/// When the overlay's first frame was drawn.
final class LaunchClock {
    private var start: Date?

    func elapsed(at date: Date) -> Double {
        guard let start else {
            self.start = date
            return 0
        }
        return date.timeIntervalSince(start)
    }

    /// Seconds since the first frame, or nil before it.
    func since(_ date: Date) -> Double? { start.map { date.timeIntervalSince($0) } }
}

struct LaunchMascotOverlay: View {
    @Environment(\.themePalette) private var themePalette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Shown once per process: a scene rebuilt later (a language change) does not replay it.
    private static var played = false
    /// The first frame actually drawn: a launch that keeps the main thread busy
    /// building the home never skips the hop, it starts once it can be seen.
    @State private var clock = LaunchClock()
    @State private var gone = LaunchMascotOverlay.played || LaunchMascot.skipped

    var body: some View {
        if gone || reduceMotion {
            EmptyView()
        } else {
            TimelineView(.animation) { timeline in
                let t = clock.elapsed(at: timeline.date)
                let pose = LaunchMascot.pose(t)
                let fade = min(1, max(0, (t - LaunchMascot.fadeAt) / LaunchMascot.fade))
                ZStack {
                    themePalette.desktop.color
                    BrandMascotView(size: LaunchMascot.size, animated: true)
                        .scaleEffect(x: pose.sx, y: pose.sy, anchor: .bottom)
                        .offset(y: pose.dy * LaunchMascot.size)
                        .scaleEffect(1 + 0.06 * fade)
                }
                .opacity(1 - fade * fade)
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .task {
                Self.played = true
                let total = LaunchMascot.fadeAt + LaunchMascot.fade + 0.05
                // at most a few seconds in all, whatever happens to the frames
                for _ in 0..<80 {
                    try? await Task.sleep(nanoseconds: 50_000_000)
                    if let t = clock.since(Date()), t >= total { break }
                }
                gone = true
            }
        }
    }
}
