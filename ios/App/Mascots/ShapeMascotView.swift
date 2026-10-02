// The original mascot shapes: a port of `src/components/ShapeMascot.tsx` and
// `shape-mascot.css`. A soft body in the bot's colour with two small eyes, in
// eight shapes and six skins; it breathes, blinks, bounces while working and
// looks up while thinking. Reduce Motion keeps it still, as on the desktop.
import CompanionCore
import SwiftUI

struct ShapeMascotView: View {
    var shape: MascotShape = .circle
    var skin: ShapeSkin = .plain
    /// A bot colour name (`green`) or any hex.
    let color: String
    var size: CGFloat = 44
    var mood: ShapeMood = .idle
    /// Off draws a still frame (thumbnails, lists).
    var animated = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        let live = animated && !reduceMotion && scenePhase == .active
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !live)) { timeline in
            Canvas { context, canvas in
                ShapeRenderer.draw(
                    in: &context, canvas: canvas, box: size, shape: shape, skin: skin, hex: ShapeArt.hex(color),
                    mood: mood, time: live ? timeline.date.timeIntervalSinceReferenceDate : nil
                )
            }
            .frame(width: size * 1.3, height: size * 1.3)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

enum ShapeRenderer {
    static let breathe = CSSKeyframes([(0, [1, 1]), (0.5, [1.02, 0.98]), (1, [1, 1])])
    static let bounce = CSSKeyframes([(0, [0, 1, 1]), (0.45, [-0.06, 0.98, 1.03]), (0.7, [0, 1.04, 0.96]), (1, [0, 1, 1])])
    static let blink = CSSKeyframes([(0, [1]), (0.92, [1]), (0.95, [0.1]), (1, [1])])

    /// Draws the shape centred in `canvas`, its 100 box mapped onto `box` points.
    static func draw(in context: inout GraphicsContext, canvas: CGSize, box: CGFloat, shape: MascotShape, skin: ShapeSkin, hex: String, mood: ShapeMood, time: Double?) {
        guard let art = ShapeArt.art[shape] else { return }
        let paint = ShapeArt.paint(skin, hex: hex)
        let body = MascotPaths.path(art.d)
        let bounds = body.boundingRect

        var ctx = context
        let k = box / 100
        ctx.translateBy(x: (canvas.width - box) / 2, y: (canvas.height - box) / 2)
        ctx.scaleBy(x: k, y: k)

        // .shape-body: transform-origin 50% 100% of its own box
        if let time {
            let origin = CGPoint(x: bounds.midX, y: bounds.maxY)
            if mood == .working, let v = bounce.value(at: time, duration: 0.9, timing: .easeInOut) {
                ctx.translateBy(x: 0, y: v[0] * bounds.height)
                ctx.pivot(origin, scaleX: v[1], scaleY: v[2])
            } else if let v = breathe.value(at: time, duration: 3.4, timing: .easeInOut) {
                ctx.pivot(origin, scaleX: v[0], scaleY: v[1])
            }
        }

        if let glow = paint.glow {
            // feGaussianBlur(2.4) of the body under the body itself (the radius is in the
            // context's own units, the viewBox, like the SVG filter's)
            var g = ctx
            g.addFilter(.blur(radius: 2.4))
            g.fill(body, with: .color(Color(hex: paint.fill)))
            if let stroke = paint.stroke {
                g.stroke(body, with: .color(Color(hex: stroke)), style: StrokeStyle(lineWidth: paint.strokeWidth, lineJoin: .round))
            }
            _ = glow
        }
        ctx.fill(body, with: .color(Color(hex: paint.fill)))
        if let stroke = paint.stroke {
            ctx.stroke(body, with: .color(Color(hex: stroke)), style: StrokeStyle(lineWidth: paint.strokeWidth, lineJoin: .round))
        }
        if paint.shine {
            // radialGradient cx .32 cy .26 r .75 over the body's box
            let g = Gradient(stops: [
                .init(color: .white.opacity(0.55), location: 0),
                .init(color: .white.opacity(0.08), location: 0.45),
                .init(color: .black.opacity(0.18), location: 1),
            ])
            var s = ctx
            let center = CGPoint(x: bounds.minX + 0.32 * bounds.width, y: bounds.minY + 0.26 * bounds.height)
            s.translateBy(x: center.x, y: center.y)
            s.scaleBy(x: 1, y: bounds.height / max(bounds.width, 0.001))
            s.translateBy(x: -center.x, y: -center.y)
            s.fill(
                body.applying(CGAffineTransform(translationX: center.x, y: center.y)
                    .scaledBy(x: 1, y: bounds.width / max(bounds.height, 0.001))
                    .translatedBy(x: -center.x, y: -center.y)),
                with: .radialGradient(g, center: center, startRadius: 0, endRadius: 0.75 * bounds.width)
            )
        }

        // eyes
        let eyeColor = Color(hex: paint.eyes)
        let (left, right) = ShapeArt.eyeXs(art)
        let ey = art.eyes.y
        let blinkY = time.flatMap { blink.value(at: $0, duration: 4.2, timing: .easeInOut)?[0] } ?? 1
        for x in [left, right] {
            switch mood {
            case .sleeping, .happy:
                var p = Path()
                p.move(to: CGPoint(x: x - 4, y: ey + 1))
                p.addQuadCurve(to: CGPoint(x: x + 4, y: ey + 1), control: CGPoint(x: x, y: ey + (mood == .sleeping ? 4 : -3)))
                ctx.stroke(p, with: .color(eyeColor), style: StrokeStyle(lineWidth: mood == .sleeping ? 2.2 : 2.4, lineCap: .round))
            default:
                let cy = ey + ShapeArt.look(mood)
                var e = ctx
                if blinkY != 1 { e.pivot(CGPoint(x: x, y: cy), scaleX: 1, scaleY: blinkY) }
                e.fill(Path(ellipseIn: CGRect(x: x - 3.6, y: cy - 4.6, width: 7.2, height: 9.2)), with: .color(eyeColor))
            }
        }
    }
}
