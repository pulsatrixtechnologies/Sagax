// Comets orbiting a mascot on tilted rings: the island's "something is
// happening". Kept from the old face engine (the desktop's `trails`) when the
// mascots became the Sagax characters; it wraps any of them now. The rings go
// behind and in front of the mascot, which sits back a little so they clear it.
import SwiftUI

struct MascotComets<Content: View>: View {
    var size: CGFloat
    var active: Bool
    /// The time for a still frame (widgets); nil runs the clock.
    var at: Date?
    @ViewBuilder var content: () -> Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if active {
            let paused = at != nil || reduceMotion
            TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: paused)) { timeline in
                let date = at ?? timeline.date
                ZStack {
                    Canvas { context, canvas in CometArt.draw(in: &context, canvas: canvas, at: date, front: false) }
                    content().scaleEffect(CometArt.bodyScale)
                    Canvas { context, canvas in CometArt.draw(in: &context, canvas: canvas, at: date, front: true) }
                }
            }
            .frame(width: size, height: size)
        } else {
            content()
        }
    }

}

enum CometArt {
    /// The mascot's scale while the rings are out.
    static let bodyScale: CGFloat = 0.72

    private struct Sample { var x: CGFloat; var y: CGFloat; var h: CGFloat }

    /// The orbit spec, in a 228.5-unit face box (the old engine's units).
    private static let box: CGFloat = 228.541
    private static let count = 6, period: CGFloat = 3000, radius: CGFloat = 105, width: CGFloat = 5, span: CGFloat = 2.5

    /// One palette per comet: three neighbouring hues along its length.
    private static let colors: [[Color]] = [
        ["#A855F7", "#6366F1", "#38BDF8"], ["#22D3EE", "#34D399", "#A3E635"], ["#FB923C", "#F43F5E", "#D946EF"],
        ["#818CF8", "#C084FC", "#F472B6"], ["#FACC15", "#FB923C", "#EC4899"], ["#34D399", "#22D3EE", "#60A5FA"],
    ].map { $0.map { Color(hex: $0) } }

    private static func hash01(_ n: CGFloat) -> CGFloat {
        let x = sin(n * 127.1 + 311.7) * 43758.5453
        return x - floor(x)
    }

    static func draw(in context: inout GraphicsContext, canvas: CGSize, at date: Date, front: Bool) {
        // the old engine's viewBox had a 15-unit margin around the face box
        let side = box + 30
        let k = min(canvas.width, canvas.height) / side
        context.translateBy(x: (canvas.width - side * k) / 2 + 15 * k, y: (canvas.height - side * k) / 2 + 15 * k)
        context.scaleBy(x: k, y: k)
        let elapsed = CGFloat(date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 3600) * 1000)
        let centre = CGPoint(x: box / 2, y: box / 2)
        let samples = 22
        let span = min(Self.span, .pi - 0.05)
        let near: CGFloat = 1.1

        for i in 0..<count {
            let seedA = hash01(CGFloat(i + 3)), seedB = hash01(CGFloat(i + 29)), seedC = hash01(CGFloat(i + 71))
            let tilt = 0.3 + seedA * 0.66
            let roll = seedB * 2 * .pi
            let period = Self.period * (0.78 + seedC * 0.55)
            let direction: CGFloat = i % 2 == 0 ? 1 : -1
            let radius = Self.radius * (0.94 + seedB * 0.12)
            let head = direction * (elapsed / period) * 2 * .pi + seedA * 2 * .pi
            let cosT = cos(tilt), sinT = sin(tilt), cosR = cos(roll), sinR = sin(roll)

            var runs: [(samples: [Sample], front: Bool)] = []
            var run: [Sample] = []
            var side: CGFloat = 0
            func keep(_ r: [Sample]) -> Bool {
                guard r.count >= 3 else { return false }
                var length: CGFloat = 0
                for k in 1..<r.count { length += hypot(r[k].x - r[k - 1].x, r[k].y - r[k - 1].y) }
                return length > width * 3.5
            }
            for s in 0..<samples {
                let t = CGFloat(s) / CGFloat(samples - 1)
                let angle = head - direction * span * t
                let ox = cos(angle) * radius, oy = sin(angle) * radius
                let ty = oy * cosT, z = oy * sinT
                let n = 1 + (z / radius) * (near - 1)
                let x = centre.x + (ox * cosR - ty * sinR) * n
                let y = centre.y + (ox * sinR + ty * cosR) * n
                let h = width * n * (1 - 0.68 * pow(t, 1.5))
                let nowSide: CGFloat = z >= 0 ? 1 : -1
                if nowSide != side {
                    if keep(run) { runs.append((run, side > 0)) }
                    run = run.isEmpty ? [] : [run[run.count - 1]]
                    side = nowSide
                }
                run.append(Sample(x: x, y: y, h: h))
            }
            if keep(run) { runs.append((run, side > 0)) }
            guard let firstRun = runs.first, let lastRun = runs.last else { continue }
            let palette = colors[i % colors.count]
            let shading = GraphicsContext.Shading.linearGradient(
                Gradient(stops: [
                    .init(color: palette[0], location: 0),
                    .init(color: palette[1], location: 0.52),
                    .init(color: palette[2].opacity(0.35), location: 1),
                ]),
                startPoint: CGPoint(x: firstRun.samples[0].x, y: firstRun.samples[0].y),
                endPoint: CGPoint(x: lastRun.samples[lastRun.samples.count - 1].x, y: lastRun.samples[lastRun.samples.count - 1].y)
            )
            for (r, piece) in runs.enumerated() where piece.front == front {
                context.fill(outline(piece.samples, capHead: r == 0, capTail: r == runs.count - 1), with: shading)
            }
        }
    }

    /// Head-to-tail samples to one filled, tapered outline with half-round caps.
    private static func outline(_ s: [Sample], capHead: Bool, capTail: Bool) -> Path {
        let n = s.count
        var path = Path()
        guard n >= 2 else { return path }
        var nx: [CGFloat] = [], ny: [CGFloat] = []
        for i in 0..<n {
            let a = s[max(i - 1, 0)], b = s[min(i + 1, n - 1)]
            let tx = b.x - a.x, ty = b.y - a.y
            let len = max(hypot(tx, ty), 0.0001)
            nx.append(-ty / len)
            ny.append(tx / len)
        }
        func cap(_ i: Int, _ out: CGFloat) -> [CGPoint] {
            let x = s[i].x, y = s[i].y, h = s[i].h
            let tx = ny[i], ty = -nx[i]
            return (1..<6).map { k in
                let a = CGFloat(k) / 6 * .pi
                let dn = out * cos(a), dt = out * sin(a)
                return CGPoint(x: x + (nx[i] * dn + tx * dt) * h, y: y + (ny[i] * dn + ty * dt) * h)
            }
        }
        var points = [CGPoint(x: s[0].x - nx[0] * s[0].h, y: s[0].y - ny[0] * s[0].h)]
        if capHead { points += cap(0, -1) }
        for i in 0..<n { points.append(CGPoint(x: s[i].x + nx[i] * s[i].h, y: s[i].y + ny[i] * s[i].h)) }
        if capTail { points += cap(n - 1, 1) }
        for i in stride(from: n - 1, to: 0, by: -1) { points.append(CGPoint(x: s[i].x - nx[i] * s[i].h, y: s[i].y - ny[i] * s[i].h)) }
        path.move(to: points[0])
        for p in points.dropFirst() { path.addLine(to: p) }
        path.closeSubpath()
        return path
    }
}
