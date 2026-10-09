// Bunbu, our own collectible-vinyl little monster: a port of the still
// frame of `src/components/BunbuMascot.tsx` (the art is `BunbuArt`, from
// bunbu-art.ts). A gumdrop body with two long upright ears, arms, a heart on
// the tummy, big round eyes and a toothy grin, in the bot's colour and a
// Bunbu skin's base finish (`BunbuArt.paint`). It breathes while animated;
// Reduce Motion keeps it still, as on the desktop.
import CompanionCore
import SwiftUI

struct BunbuMascotView: View {
    var skin: BunbuSkin = .plain
    /// A bot colour name (`mint`) or any hex.
    let color: String
    var size: CGFloat = 44
    var mood: BunbuMood = .idle
    var animated = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        let live = animated && !reduceMotion && scenePhase == .active
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !live)) { timeline in
            Canvas { context, canvas in
                BunbuRenderer.draw(
                    in: &context, canvas: canvas, box: size, skin: skin, hex: BunbuArt.hex(color),
                    mood: mood, time: live ? timeline.date.timeIntervalSinceReferenceDate : nil
                )
            }
            .frame(width: size * 1.2, height: size * 1.2)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// `BunbuMood`, from the app's mascot state (`bunbuMoodFor` in Avatar.tsx):
/// listening and dictating perk up, a notification speaks, the rest reads
/// the shapes' mood.
enum BunbuMood: Sendable {
    case idle, thinking, working, happy, sleeping, listening, speaking

    init(state: MausState) {
        if state == .listening || state == .dictating {
            self = .listening
            return
        }
        if state == .notifying {
            self = .speaking
            return
        }
        switch state.shapeMood {
        case .thinking: self = .thinking
        case .working: self = .working
        case .happy: self = .happy
        case .sleeping: self = .sleeping
        case .idle: self = .idle
        }
    }
}

enum BunbuRenderer {
    static let breathe = CSSKeyframes([(0, [1, 1]), (0.5, [1.02, 0.98]), (1, [1, 1])])

    static func draw(in context: inout GraphicsContext, canvas: CGSize, box: CGFloat, skin: BunbuSkin, hex: String, mood: BunbuMood, time: Double?) {
        let paint = BunbuArt.paint(skin, hex: hex)
        let dark = BunbuArt.isDark(paint)
        let edge = paint.stroke ?? ShapeArt.mix(hex, "#000000", 0.2)
        let inner = BunbuArt.innerEar(paint: paint, hex: hex)
        let tummy = BunbuArt.tummy(skin, paint: paint, hex: hex)

        var ctx = context
        let k = box / 100
        ctx.translateBy(x: (canvas.width - box) / 2, y: (canvas.height - box) / 2)
        ctx.scaleBy(x: k, y: k)
        if let time, let v = breathe.value(at: time, duration: 3.4, timing: .easeInOut) {
            ctx.pivot(CGPoint(x: 50, y: 96), scaleX: v[0], scaleY: v[1])
        }

        func part(_ d: String) {
            let p = MascotPaths.path(d)
            ctx.fill(p, with: .color(Color(hex: paint.fill)))
            if paint.shine {
                let b = p.boundingRect
                let g = Gradient(stops: [
                    .init(color: .white.opacity(0.5), location: 0),
                    .init(color: .white.opacity(0.06), location: 0.45),
                    .init(color: .black.opacity(0.16), location: 1),
                ])
                ctx.fill(p, with: .radialGradient(g, center: CGPoint(x: b.minX + 0.32 * b.width, y: b.minY + 0.26 * b.height), startRadius: 0, endRadius: 0.75 * max(b.width, b.height)))
            }
            if let stroke = paint.stroke {
                ctx.stroke(p, with: .color(Color(hex: stroke)), style: StrokeStyle(lineWidth: paint.strokeWidth, lineJoin: .round))
            }
        }

        // ears behind the head, each with its softer inside
        part(BunbuArt.earLeft)
        ctx.fill(MascotPaths.path(BunbuArt.innerLeft), with: .color(Color(hex: inner.fill, opacity: inner.opacity)))
        part(BunbuArt.earRight)
        ctx.fill(MascotPaths.path(BunbuArt.innerRight), with: .color(Color(hex: inner.fill, opacity: inner.opacity)))
        part(BunbuArt.body)
        ctx.fill(MascotPaths.path(BunbuArt.heart), with: .color(Color(hex: tummy.fill, opacity: tummy.opacity)))
        ctx.stroke(MascotPaths.path(BunbuArt.tuft), with: .color(Color(hex: edge, opacity: 0.75)), style: StrokeStyle(lineWidth: 2, lineCap: .round))
        for arm in [BunbuArt.armLeft, BunbuArt.armRight] {
            var a = ctx
            a.pivot(CGPoint(x: arm.cx, y: arm.cy), rotate: arm.rotate)
            let oval = Path(ellipseIn: CGRect(x: arm.cx - arm.rx, y: arm.cy - arm.ry, width: arm.rx * 2, height: arm.ry * 2))
            a.fill(oval, with: .color(Color(hex: paint.fill)))
            a.stroke(oval, with: .color(Color(hex: edge, opacity: 0.55)), lineWidth: 1)
        }

        // the face
        let cheek = Color(hex: "#FF8FA3", opacity: dark ? 0.25 : 0.4)
        for c in [BunbuArt.cheekLeft, BunbuArt.cheekRight] {
            ctx.fill(Path(ellipseIn: CGRect(x: c.x - BunbuArt.cheekRx, y: c.y - BunbuArt.cheekRy, width: BunbuArt.cheekRx * 2, height: BunbuArt.cheekRy * 2)), with: .color(cheek))
        }
        let ink = Color(hex: paint.eyes)
        let highlight = Color(hex: dark ? "#1B1F27" : "#FFFFFF")
        for e in [BunbuArt.eyeLeft, BunbuArt.eyeRight] {
            switch mood {
            case .sleeping:
                var p = Path()
                p.move(to: CGPoint(x: e.x - 5.5, y: e.y + 1))
                p.addQuadCurve(to: CGPoint(x: e.x + 5.5, y: e.y + 1), control: CGPoint(x: e.x, y: e.y + 5.4))
                ctx.stroke(p, with: .color(ink), style: StrokeStyle(lineWidth: 2.8, lineCap: .round))
            case .happy:
                var p = Path()
                p.move(to: CGPoint(x: e.x - 5.5, y: e.y + 2.5))
                p.addQuadCurve(to: CGPoint(x: e.x + 5.5, y: e.y + 2.5), control: CGPoint(x: e.x, y: e.y - 4.5))
                ctx.stroke(p, with: .color(ink), style: StrokeStyle(lineWidth: 3, lineCap: .round))
            default:
                let look: CGFloat = mood == .thinking || mood == .listening ? -1.6 : 0
                let cy = e.y + look
                ctx.fill(Path(ellipseIn: CGRect(x: e.x - BunbuArt.eyeRx, y: cy - BunbuArt.eyeRy, width: BunbuArt.eyeRx * 2, height: BunbuArt.eyeRy * 2)), with: .color(ink))
                ctx.fill(Path(ellipseIn: CGRect(x: e.x + 2.2 - 2.2, y: cy - 2.6 - 2.2, width: 4.4, height: 4.4)), with: .color(highlight))
                ctx.fill(Path(ellipseIn: CGRect(x: e.x - 2 - 0.95, y: cy + 3 - 0.95, width: 1.9, height: 1.9)), with: .color(highlight.opacity(0.85)))
            }
        }
        ctx.fill(MascotPaths.path(BunbuArt.nose), with: .color(Color(hex: "#F07F7A")))
        drawMouth(&ctx, mood: mood, lip: dark ? paint.eyes : nil)
    }

    private static func drawMouth(_ ctx: inout GraphicsContext, mood: BunbuMood, lip: String?) {
        let ink = Color(hex: "#2B1420")
        switch mood {
        case .sleeping:
            var p = Path()
            p.move(to: CGPoint(x: 45, y: 64.5))
            p.addQuadCurve(to: CGPoint(x: 55, y: 64.5), control: CGPoint(x: 50, y: 67.1))
            ctx.stroke(p, with: .color(lip.map { Color(hex: $0) } ?? ink), style: StrokeStyle(lineWidth: 2, lineCap: .round))
        case .thinking:
            let o = Path(ellipseIn: CGRect(x: 51 - 2.6, y: 65.5 - 2.2, width: 5.2, height: 4.4))
            ctx.fill(o, with: .color(ink))
            if let lip { ctx.stroke(o, with: .color(Color(hex: lip)), lineWidth: 0.8) }
        default:
            let wide = mood == .happy
            let mouth = MascotPaths.path(wide ? BunbuArt.mouthWide : BunbuArt.mouth)
            ctx.fill(mouth, with: .color(ink))
            if let lip { ctx.stroke(mouth, with: .color(Color(hex: lip)), style: StrokeStyle(lineWidth: 0.8, lineJoin: .round)) }
            let t = BunbuArt.tongue
            let ty = t.cy + (wide ? 1.6 : 0)
            ctx.fill(Path(ellipseIn: CGRect(x: t.cx - t.rx, y: ty - t.ry, width: t.rx * 2, height: t.ry * 2)), with: .color(Color(hex: "#F07F7A")))
            for x in BunbuArt.teeth {
                let tx = wide ? 50 + (x - 50) * 1.18 : x
                let y = BunbuArt.lipY(tx, wide: wide) - 0.4
                var tooth = Path()
                tooth.move(to: CGPoint(x: tx - 1.7, y: y))
                tooth.addLine(to: CGPoint(x: tx + 1.7, y: y))
                tooth.addLine(to: CGPoint(x: tx, y: y + 3))
                tooth.closeSubpath()
                ctx.fill(tooth, with: .color(.white))
            }
        }
    }
}
