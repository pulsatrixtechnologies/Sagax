// Ogre, the big green ogre: a port of the still drawing of
// `src/components/OgreMascot.tsx` (the approved head and shoulders, the
// bust under 48 points). The parts and the sixteen faces are the desktop's
// own draw operations (`OgreStillArt`, generated from ogre-art.ts), painted
// with the bot colour's palette and the skin's own colours (`OgreArt`). It
// breathes and blinks while animated; Reduce Motion keeps it still, as on
// the desktop.
import CompanionCore
import SwiftUI

struct OgreMascotView: View {
    var skin: OgreSkin = .plain
    /// A bot colour name (`green`) or any hex.
    let color: String
    var size: CGFloat = 44
    /// One of the sixteen faces (`OgreArt.expression(for:)`).
    var expression = "neutral"
    var animated = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        let live = animated && !reduceMotion && scenePhase == .active
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !live)) { timeline in
            Canvas { context, canvas in
                OgreRenderer.draw(
                    in: &context, canvas: canvas, box: size, skin: skin, hex: OgreArt.hex(color),
                    expression: expression, time: live ? timeline.date.timeIntervalSinceReferenceDate : nil
                )
            }
            .frame(width: size * 1.2, height: size * 1.2)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

enum OgreRenderer {
    /// `ogre-breathe` and `ogre-blink` in ogre-mascot.css.
    static let breathe = CSSKeyframes([(0, [1, 1]), (0.5, [1.012, 0.986]), (1, [1, 1])])
    static let blink = CSSKeyframes([(0, [1]), (0.94, [1]), (0.97, [0.1]), (1, [1])])

    /// Draws the ogre centred in `canvas`, its 100 box (or the bust) mapped onto `box` points.
    static func draw(in context: inout GraphicsContext, canvas: CGSize, box: CGFloat, skin: OgreSkin, hex: String, expression: String, time: Double?) {
        let paint = OgreArt.paint(skin, hex: hex)
        let size = Double(box)
        let ow = OgreArt.outline(size: size)
        let bust = size <= OgreArt.bustMax
        let view: CGRect = bust ? CGRect(x: OgreArt.bust.x, y: OgreArt.bust.y, width: OgreArt.bust.w, height: OgreArt.bust.h) : CGRect(x: 0, y: 0, width: 100, height: 100)

        var ctx = context
        let k = box / view.width
        ctx.translateBy(x: (canvas.width - box) / 2, y: (canvas.height - box) / 2)
        ctx.scaleBy(x: k, y: k)
        ctx.translateBy(x: -view.minX, y: -view.minY)
        if bust { ctx.clip(to: Path(view)) }
        if let time, let v = breathe.value(at: time, duration: 3.8, timing: .easeInOut) {
            ctx.pivot(CGPoint(x: 50, y: 99), scaleX: v[0], scaleY: v[1])
        }
        let shut = time.flatMap { blink.value(at: $0, duration: 5.2, timing: .easeInOut)?.first } ?? 1
        let face = OgreStillArt.faces[expression] ?? OgreStillArt.faces["neutral"]
        let eyes = Set((face?.eyeL ?? []).map(\.d) + (face?.eyeR ?? []).map(\.d))

        for op in OgreArt.ops(expression: expression, size: size, marks: paint.marks) {
            var c = ctx
            // a blink squeezes the eyes about their line
            if shut < 1, eyes.contains(op.d) { c.pivot(CGPoint(x: 50, y: 44.5), scaleY: shut) }
            if let clip = op.clip { c.clip(to: MascotPaths.path(clip)) }
            if let opacity = op.opacity { c.opacity = opacity }
            let path = MascotPaths.path(op.d)
            if let fill = op.fill, let color = paint.palette[fill] {
                c.fill(path, with: .color(Color(hex: color)))
            }
            if let stroke = op.stroke, let color = paint.palette[stroke] {
                let width = op.width.0 + op.width.1 * ow
                c.stroke(path, with: .color(Color(hex: color)), style: StrokeStyle(lineWidth: width, lineCap: op.round ? .round : .butt, lineJoin: .round))
            }
        }
    }
}
