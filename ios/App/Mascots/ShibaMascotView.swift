// Shiba, the dog: a port of `src/components/ShibaMascot.tsx` drawn from the
// desktop's own art (`ShibaStillArt`, generated from shiba-art.ts) and a
// skin's palette (`ShibaArt.paint`). Every part is its own set of draw
// operations turned about its pivot, as on the desktop. Under 48 pt it is a
// bust. While animated it does the desktop's CSS idle (a breath, a blink, a
// lazy tail wag, an ear twitch now and then) and, when asked, the walk cycle
// (the desktop's keyframes on four legs, ears and tail trailing). Reduce
// Motion keeps it still, as on the desktop. The premium skins' effects
// (sweeps, foil, bloom, cracks) are not drawn here: `MascotSubstitution`
// records it.
import CompanionCore
import SwiftUI

struct ShibaMascotView: View {
    var skin: ShibaSkin = .plain
    /// A bot colour name (`orange`) or any hex.
    let color: String
    var size: CGFloat = 44
    var expression: ShibaExpression = .neutral
    var animated = false
    /// Walks in place (the walk cycle), standing on four legs.
    var walking = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        let live = animated && !reduceMotion && scenePhase == .active
        TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: !live)) { timeline in
            Canvas { context, canvas in
                ShibaRenderer.draw(
                    in: &context, canvas: canvas, box: size, skin: skin, hex: ShibaRenderer.hex(color), expression: expression,
                    time: live ? timeline.date.timeIntervalSinceReferenceDate : nil, walking: walking && size > ShibaStillArt.bustMax
                )
            }
            .frame(width: size * 1.2, height: size * 1.2)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

enum ShibaRenderer {
    /// The desktop's CSS idle (shiba-mascot.css).
    static let breathe = CSSKeyframes([(0, [1, 1]), (0.5, [1.015, 0.985]), (1, [1, 1])])
    static let blink = CSSKeyframes([(0, [1]), (0.93, [1]), (0.96, [0.1]), (1, [1])])
    static let wag = CSSKeyframes([(0, [-5]), (0.5, [7]), (1, [-5])])
    static let twitch = CSSKeyframes([(0, [0]), (0.88, [0]), (0.9, [12]), (0.92, [-3]), (0.94, [6]), (1, [0])])

    /// `hexOf`: a name, a `#RRGGBB`, or the breed's orange.
    static func hex(_ color: String) -> String { MausColors.hex(for: color) ?? MausColors.hex["orange"]! }

    /// The walk pose at `t` s: the keyframes, eased between.
    static func walkFrame(at t: Double) -> ShibaWalkFrame {
        let frames = ShibaStillArt.walk
        let p = (t / ShibaStillArt.walkCycle).truncatingRemainder(dividingBy: 1) * Double(frames.count)
        let i = Int(floor(p)) % frames.count
        let a = frames[i], b = frames[(i + 1) % frames.count]
        let k = p - floor(p)
        func mix(_ x: Double, _ y: Double) -> Double { x + (y - x) * k }
        var legs: [String: (Double, Double)] = [:]
        for (name, leg) in a.legs {
            let other = b.legs[name] ?? leg
            legs[name] = (mix(leg.angle, other.angle), mix(leg.lift, other.lift))
        }
        return ShibaWalkFrame(legs: legs, y: mix(a.y, b.y), sy: mix(a.sy, b.sy), headY: mix(a.headY, b.headY), headRot: mix(a.headRot, b.headRot), earL: mix(a.earL, b.earL), earR: mix(a.earR, b.earR), tail: mix(a.tail, b.tail))
    }

    static func draw(in context: inout GraphicsContext, canvas: CGSize, box: CGFloat, skin: ShibaSkin, hex: String, expression: ShibaExpression, time: Double?, walking: Bool) {
        let paint = ShibaArt.paint(skin, hex: hex)
        let bust = box <= ShibaStillArt.bustMax
        let outline = ShibaArt.outline(size: box)
        let stance: ShibaStance = walking ? .stand : .sit
        let pivots = ShibaStillArt.pivots
        func point(_ name: String) -> CGPoint { pivots[name] ?? CGPoint(x: 50, y: 50) }

        var ctx = context
        ctx.translateBy(x: (canvas.width - box) / 2, y: (canvas.height - box) / 2)
        if bust {
            let b = ShibaStillArt.bust
            ctx.scaleBy(x: box / b.width, y: box / b.height)
            ctx.translateBy(x: -b.minX, y: -b.minY)
        } else {
            ctx.scaleBy(x: box / 100, y: box / 100)
        }

        let walk = walking ? walkFrame(at: time ?? 0) : nil
        /// One value of a CSS loop at the current time, or its rest value when still.
        func loop(_ frames: CSSKeyframes, _ duration: Double, rest: [Double]) -> [Double] {
            guard let time, let value = frames.value(at: time, duration: duration, timing: .easeInOut) else { return rest }
            return value
        }
        let breath = loop(breathe, 3.4, rest: [1, 1])
        let eyes: Double = expression == .sleepy ? 1 : loop(blink, 4.6, rest: [1])[0]
        let tail: Double = walk?.tail ?? loop(wag, expression == .happy ? 0.7 : 2.8, rest: [0])[0]
        let earR: Double = walk?.earR ?? loop(twitch, 7.4, rest: [0])[0]
        let earL: Double = walk?.earL ?? 0

        // the whole body: the walk's bob, the breath, about the ground
        var whole = ctx
        if let walk { whole.translateBy(x: 0, y: walk.y) }
        whole.pivot(point("ground"), scaleX: breath[0], scaleY: breath[1] * (walk?.sy ?? 1))

        func shading(_ role: ShibaRole, _ path: Path) -> GraphicsContext.Shading {
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
        func draw(_ ops: [ShibaOp], in base: GraphicsContext) {
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
        func turned(_ base: GraphicsContext, about pivot: CGPoint, by degrees: Double, dx: Double = 0, dy: Double = 0) -> GraphicsContext {
            var c = base
            c.translateBy(x: dx, y: dy)
            c.pivot(pivot, rotate: degrees)
            return c
        }

        let tailPivot = stance == .stand ? point("standTail") : point("tail")
        if !bust { draw(ShibaStillArt.tail[stance] ?? [], in: turned(whole, about: tailPivot, by: tail)) }
        let legs = stance == .stand ? ShibaStillArt.legs : []
        for leg in legs where leg.name.hasSuffix("Far") {
            let pose = walk?.legs[leg.name] ?? (angle: 0, lift: 0)
            draw(leg.ops, in: turned(whole, about: leg.hip, by: -pose.angle, dy: -pose.lift * 2.2))
        }
        draw(ShibaStillArt.body[stance] ?? [], in: whole)
        draw(ShibaStillArt.pawL[stance] ?? [], in: whole)
        draw(ShibaStillArt.pawR[stance] ?? [], in: whole)
        for leg in legs where leg.name.hasSuffix("Near") {
            let pose = walk?.legs[leg.name] ?? (angle: 0, lift: 0)
            draw(leg.ops, in: turned(whole, about: leg.hip, by: -pose.angle, dy: -pose.lift * 2.2))
        }

        // the head, placed on its body, then its own tilt and bob
        var head = whole
        if let place = ShibaStillArt.stanceHead[stance], place.scale != 1 || place.x != 0 || place.y != 0 {
            head.translateBy(x: place.x, y: place.y)
            head.pivot(point("neck"), scaleX: place.scale, scaleY: place.scale)
        }
        head = turned(head, about: point("neck"), by: walk?.headRot ?? 0, dy: walk?.headY ?? 0)
        draw(ShibaStillArt.earL, in: turned(head, about: point("earL"), by: -earL))
        draw(ShibaStillArt.earR, in: turned(head, about: point("earR"), by: earR))
        draw(ShibaStillArt.head, in: head)
        draw(ShibaStillArt.brows[expression] ?? [], in: head)
        for (key, ops) in [("eyeL", ShibaStillArt.eyeL[expression] ?? []), ("eyeR", ShibaStillArt.eyeR[expression] ?? [])] {
            var eye = head
            eye.pivot(point(key), scaleX: 1, scaleY: eyes)
            draw(ops, in: eye)
        }
        draw(ShibaStillArt.nose, in: head)
        draw(walking ? (ShibaStillArt.mouths["pant"] ?? []) : (ShibaStillArt.mouth[expression] ?? []), in: head)
        draw(ShibaStillArt.extras[expression] ?? [], in: head)
    }
}
