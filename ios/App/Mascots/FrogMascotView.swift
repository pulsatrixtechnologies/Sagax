// Frog, the smug sad frog: a port of `src/components/FrogMascot.tsx` drawn
// from the desktop's own art (`FrogStillArt`, generated from frog-art.ts and
// frog-moves.ts) and a skin's palette (`FrogArt.paint`). Every part is its own
// set of draw operations moved about its pivot, as on the desktop. Under
// 48 pt it is a bust. While animated it does the desktop's CSS idle (a breath
// with the throat fluttering along, one eye blinking a beat after the other)
// and, when asked, the hop (the desktop's jump arc, crouch to landing squash,
// the hind legs out) or the throat puff of a thinking frog. Reduce Motion
// keeps it still, as on the desktop. The premium skins' effects and the
// patterned coats are drawn as their base tones: `MascotSubstitution`
// records it.
import CompanionCore
import SwiftUI

struct FrogMascotView: View {
    var skin: FrogSkin = .plain
    /// A bot colour name (`green`) or any hex.
    let color: String
    var size: CGFloat = 44
    var expression: FrogExpression = .neutral
    var animated = false
    /// Hops in place, over and over (the gallery's check of the jump arc).
    var hopping = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        let live = animated && !reduceMotion && scenePhase == .active
        TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: !live)) { timeline in
            Canvas { context, canvas in
                FrogRenderer.draw(
                    in: &context, canvas: canvas, box: size, skin: skin, hex: FrogRenderer.hex(color), expression: expression,
                    time: live ? timeline.date.timeIntervalSinceReferenceDate : nil, hopping: hopping && size > FrogStillArt.bustMax
                )
            }
            .frame(width: size * 1.6, height: size * 1.6)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

enum FrogRenderer {
    /// The desktop's CSS idle (frog-mascot.css).
    static let breathe = CSSKeyframes([(0, [1, 1]), (0.5, [1.012, 0.988]), (1, [1, 1])])
    static let throat = CSSKeyframes([(0, [0]), (0.5, [0.16]), (1, [0])])
    static let blink = CSSKeyframes([(0, [1]), (0.92, [1]), (0.95, [0.08]), (1, [1])])

    /// `frogHexOf`: a name, a `#RRGGBB`, or the frog's green.
    static func hex(_ color: String) -> String { MausColors.hex(for: color) ?? MausColors.hex["green"]! }

    /// A move's pose at `t` s: its keyframes, eased between.
    static func frame(_ frames: [FrogFrame], cycle: Double, at t: Double) -> FrogFrame {
        let p = (t / cycle).truncatingRemainder(dividingBy: 1) * Double(frames.count)
        let i = Int(floor(p)) % frames.count
        return frames[i].mixed(frames[(i + 1) % frames.count], p - floor(p))
    }

    static func draw(in context: inout GraphicsContext, canvas: CGSize, box: CGFloat, skin: FrogSkin, hex: String, expression: FrogExpression, time: Double?, hopping: Bool) {
        let paint = FrogArt.paint(skin, hex: hex)
        let bust = box <= FrogStillArt.bustMax
        let outline = FrogArt.outline(size: box)
        func point(_ name: String) -> CGPoint { FrogStillArt.pivots[name] ?? CGPoint(x: 50, y: 50) }

        var ctx = context
        ctx.translateBy(x: (canvas.width - box) / 2, y: (canvas.height - box) / 2)
        if bust {
            let b = FrogStillArt.bust
            ctx.scaleBy(x: box / b.width, y: box / b.height)
            ctx.translateBy(x: -b.minX, y: -b.minY)
        } else {
            ctx.scaleBy(x: box / 100, y: box / 100)
        }

        /// One value of a CSS loop at the current time, or its rest value when still.
        func loop(_ frames: CSSKeyframes, _ duration: Double, delay: Double = 0, rest: [Double]) -> [Double] {
            guard let time, let value = frames.value(at: time, duration: duration, delay: delay, timing: .easeInOut) else { return rest }
            return value
        }
        // the hop, or the throat puff of a thinking frog, or the idle breath
        let move: FrogFrame? = hopping ? frame(FrogStillArt.hop, cycle: FrogStillArt.hopCycle, at: time ?? 0) : (expression == .curious && time != nil ? frame(FrogStillArt.puff, cycle: FrogStillArt.puffCycle, at: time ?? 0) : nil)
        let breath = loop(breathe, expression == .sleepy ? 4.6 : 3.4, rest: [1, 1])
        let puff = move?.puff ?? loop(throat, expression == .sleepy ? 4.6 : 3.4, rest: [0])[0]
        let sleeping = expression == .sleepy
        let eyeL: Double = sleeping ? 1 : 1 - (move?.blinkL ?? 0) * 0.92 - (1 - loop(blink, 5.2, rest: [1])[0])
        let eyeR: Double = sleeping ? 1 : 1 - (move?.blinkR ?? 0) * 0.92 - (1 - loop(blink, 5.2, delay: 0.22, rest: [1])[0])

        // the whole frog: the hop's lift and lean, the squash, the breath, about the ground
        var whole = ctx
        if let move { whole.translateBy(x: 0, y: move.y) }
        whole.pivot(point("ground"), rotate: move?.rot ?? 0, scaleX: breath[0] * (move?.sx ?? 1), scaleY: breath[1] * (move?.sy ?? 1))

        func shading(_ role: FrogRole, _ path: Path) -> GraphicsContext.Shading {
            switch paint[role] ?? .solid("#000000") {
            case let .solid(hex):
                return .color(Color(hex: hex))
            case let .linear(stops, from, to):
                let r = path.boundingRect
                return .linearGradient(Gradient(stops: stops.map { .init(color: Color(hex: $0.color), location: $0.offset) }), startPoint: CGPoint(x: r.minX + from.x * r.width, y: r.minY + from.y * r.height), endPoint: CGPoint(x: r.minX + to.x * r.width, y: r.minY + to.y * r.height))
            case let .radial(stops, center, radius):
                let r = path.boundingRect
                return .radialGradient(Gradient(stops: stops.map { .init(color: Color(hex: $0.color), location: $0.offset) }), center: CGPoint(x: r.minX + center.x * r.width, y: r.minY + center.y * r.height), startRadius: 0, endRadius: radius * max(r.width, r.height))
            }
        }
        func draw(_ ops: [FrogOp], in base: GraphicsContext) {
            for op in ops where !bust || op.bust {
                var c = base
                if let clip = op.clip { c.clip(to: MascotPaths.path(clip)) }
                if op.opacity < 1 { c.opacity = op.opacity }
                let p = MascotPaths.path(op.d)
                if let fill = op.fill { c.fill(p, with: shading(fill, p)) }
                if let stroke = op.stroke {
                    c.stroke(p, with: shading(stroke, p), style: StrokeStyle(lineWidth: op.strokeWidth(outline: outline), lineCap: op.round ? .round : .butt, lineJoin: .round))
                }
            }
        }

        // the hind legs grow out from the hips as the hop pushes off; the haunches cover the body's corners
        let legs = move?.legs ?? 0
        if legs > 0.02, !bust {
            for (hip, ops) in [(point("hipL"), Array(FrogStillArt.legs.prefix(FrogStillArt.legs.count / 2))), (point("hipR"), Array(FrogStillArt.legs.suffix(FrogStillArt.legs.count / 2)))] {
                var leg = whole
                leg.pivot(hip, scaleX: min(1, legs), scaleY: min(1, legs))
                draw(ops, in: leg)
            }
        }
        draw(FrogStillArt.body, in: whole)
        if legs > 0.02, !bust {
            for (hip, ops) in [(point("hipL"), Array(FrogStillArt.haunches.prefix(FrogStillArt.haunches.count / 2))), (point("hipR"), Array(FrogStillArt.haunches.suffix(FrogStillArt.haunches.count / 2)))] {
                var haunch = whole
                haunch.pivot(hip, scaleX: min(1, legs * 3), scaleY: min(1, legs * 3))
                draw(ops, in: haunch)
            }
        }

        // the head and its face, nodding with the move
        var head = whole
        head.translateBy(x: 0, y: move?.headY ?? 0)
        head.pivot(point("neck"), rotate: move?.headRot ?? 0)
        draw(FrogStillArt.head, in: head)
        if puff > 0.01, !bust {
            var sac = head
            sac.pivot(point("throatTop"), scaleX: puff, scaleY: puff)
            draw(FrogStillArt.throat, in: sac)
        }
        for (key, ops, open) in [("eyeL", FrogStillArt.eyeL[expression] ?? [], eyeL), ("eyeR", FrogStillArt.eyeR[expression] ?? [], eyeR)] {
            var eye = head
            eye.pivot(point(key), scaleX: 1, scaleY: max(0.08, open))
            draw(ops, in: eye)
        }
        draw(FrogStillArt.mouth[expression] ?? [], in: head)
        draw(FrogStillArt.extras[expression] ?? [], in: head)
        draw(FrogStillArt.handL, in: whole)
        draw(FrogStillArt.handR, in: whole)
    }
}
