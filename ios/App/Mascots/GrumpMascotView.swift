// Grump, the grumpy cat: a port of the still frame of
// `src/components/GrumpMascot.tsx`. The drawing is the desktop's own paint
// operations (`GrumpStillArt`, generated from grump-art.ts): the sitting
// loaf, the point markings in the bot's colour (or a coat of its own), the
// slanted blue eyes, one of the sixteen faces. Under 48 pt it is the bust.
// Each skin is its flat palette (`GrumpArt.palette`); the premium effects
// stay on the desktop. It breathes while animated; Reduce
// Motion keeps it still, as on the desktop.
import CompanionCore
import SwiftUI

struct GrumpMascotView: View {
    var skin: GrumpSkin = .plain
    /// A bot colour name (`brown`) or any hex.
    let color: String
    var size: CGFloat = 44
    /// One of the sixteen faces (`GrumpStillArt.expressions`).
    var expression: String = "neutral"
    var animated = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        let live = animated && !reduceMotion && scenePhase == .active
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !live)) { timeline in
            Canvas { context, canvas in
                GrumpRenderer.draw(
                    in: &context, canvas: canvas, box: size, skin: skin, hex: GrumpArt.hex(color),
                    expression: expression, time: live ? timeline.date.timeIntervalSinceReferenceDate : nil
                )
            }
            .frame(width: size * 1.2, height: size * 1.2)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// Grump's face for the app's mascot states (`shibaExpressionFor` in
/// Avatar.tsx, which the desktop uses for both dog and cat: their sixteen
/// faces carry the Shapes ids).
enum GrumpFace {
    static func expression(for state: MausState) -> String {
        switch state.rawValue {
        case "sleeping", "drowsy", "powering-down": return "sleepy"
        case "thinking", "searching", "loading", "curious": return "curious"
        case "listening", "dictating", "waking", "working", "progress", "orbit", "radar", "writing", "uploading", "sending", "receiving", "humming": return "attentive"
        case "excited", "celebrate", "playful", "bouncing": return "excited"
        case "surprised", "alerting", "notifying": return "surprised"
        case let own where GrumpStillArt.expressions.contains(own): return own
        default: return "neutral"
        }
    }
}

enum GrumpRenderer {
    static let breathe = CSSKeyframes([(0, [1, 1]), (0.5, [1.012, 0.988]), (1, [1, 1])])

    /// Draws Grump centred in `canvas`, its 100 box (or the bust) mapped onto `box` points.
    static func draw(in context: inout GraphicsContext, canvas: CGSize, box: CGFloat, skin: GrumpSkin, hex: String, expression: String, time: Double?) {
        let bust = box <= 48
        let layers = bust ? GrumpStillArt.bust : GrumpStillArt.full
        let palette = GrumpArt.palette(skin: skin.rawValue, hex: hex)
        let crop = bust ? GrumpStillArt.bustCrop : (x: 0, y: 0, w: 100, h: 100)

        var ctx = context
        let k = box / CGFloat(crop.w)
        ctx.translateBy(x: (canvas.width - box) / 2, y: (canvas.height - box) / 2)
        ctx.scaleBy(x: k, y: k)
        ctx.translateBy(x: -CGFloat(crop.x), y: -CGFloat(crop.y))

        if let time, let v = breathe.value(at: time, duration: 3.8, timing: .easeInOut) {
            ctx.pivot(CGPoint(x: 50, y: 98.5), scaleX: v[0], scaleY: v[1])
        }
        let faceOps = layers.faces[expression] ?? layers.faces["neutral"] ?? []
        for op in layers.under + faceOps + layers.over {
            paint(op, in: &ctx, palette: palette)
        }
    }

    static func paint(_ op: GrumpStillOp, in context: inout GraphicsContext, palette: [GrumpRole: String]) {
        var ctx = context
        if let clip = op.clip { ctx.clip(to: MascotPaths.path(clip)) }
        if op.opacity < 1 { ctx.opacity = op.opacity }
        let path = MascotPaths.path(op.d)
        if let fill = op.fill, let color = palette[fill] { ctx.fill(path, with: .color(Color(hex: color))) }
        if let stroke = op.stroke, let color = palette[stroke] {
            ctx.stroke(path, with: .color(Color(hex: color)), style: StrokeStyle(lineWidth: op.width, lineCap: op.round ? .round : .butt, lineJoin: .round))
        }
    }
}
