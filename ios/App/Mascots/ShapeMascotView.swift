// The mascot shapes: a port of `src/components/ShapeMascot.tsx` (the
// clean-room set of 2026-10-08, #187). One soft body in eight shapes with
// two eyes cut through it (the surface shows through), shaded like clay on
// the Plain skin, in the thirteen skins' base finishes. The outlines and the
// eyes of each mood are the desktop's own still frames (`ShapeStillArt`,
// generated from shape-engine.ts); the body breathes, and bounces while
// working. Reduce Motion keeps it still, as on the desktop.
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

    /// Draws the shape centred in `canvas`, its 100 box mapped onto `box` points.
    static func draw(in context: inout GraphicsContext, canvas: CGSize, box: CGFloat, shape: MascotShape, skin: ShapeSkin, hex: String, mood: ShapeMood, time: Double?) {
        guard let outline = ShapeStillArt.body[shape] else { return }
        let paint = ShapeArt.paint(skin, hex: hex)
        let body = MascotPaths.path(outline)
        let eyes = MascotPaths.path(ShapeStillArt.eyes[shape]?[mood] ?? "")
        var cut = body
        cut.addPath(eyes)
        let bounds = body.boundingRect
        let evenOdd = FillStyle(eoFill: true)

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

        if paint.glow != nil {
            // the still neon's soft glow: the body blurred under itself
            var g = ctx
            g.addFilter(.blur(radius: 2.4))
            g.fill(cut, with: .color(Color(hex: paint.fill)), style: evenOdd)
            if let stroke = paint.stroke {
                g.stroke(body, with: .color(Color(hex: stroke)), style: StrokeStyle(lineWidth: paint.strokeWidth, lineJoin: .round))
            }
        }
        if skin == .plain {
            // the clay finish: a radial light from the upper left to a dark rim
            let stops = ShapeArt.clayStops(hex).map { Gradient.Stop(color: Color(hex: $0.color), location: $0.offset) }
            let light = ShapeStillArt.light
            ctx.fill(cut, with: .radialGradient(Gradient(stops: stops), center: CGPoint(x: light.x, y: light.y), startRadius: 0, endRadius: light.r), style: evenOdd)
        } else {
            ctx.fill(cut, with: .color(Color(hex: paint.fill)), style: evenOdd)
        }
        if paint.shine {
            let g = Gradient(stops: [
                .init(color: .white.opacity(0.55), location: 0),
                .init(color: .white.opacity(0.08), location: 0.45),
                .init(color: .black.opacity(0.18), location: 1),
            ])
            let center = CGPoint(x: bounds.minX + 0.32 * bounds.width, y: bounds.minY + 0.26 * bounds.height)
            ctx.fill(cut, with: .radialGradient(g, center: center, startRadius: 0, endRadius: 0.75 * max(bounds.width, bounds.height)), style: evenOdd)
        }
        if let stroke = paint.stroke {
            // the outline runs round the body and round each cut-out eye
            ctx.stroke(cut, with: .color(Color(hex: stroke)), style: StrokeStyle(lineWidth: paint.strokeWidth, lineJoin: .round))
        }
    }
}
