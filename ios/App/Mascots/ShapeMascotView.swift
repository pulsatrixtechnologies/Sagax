// The mascot shapes: a port of `src/components/ShapeMascot.tsx` (the
// clean-room set of 2026-10-08, #187). One soft body in eight shapes with
// two eyes cut through it (the surface shows through), shaded like clay on
// the Plain skin, in the thirteen skins' base finishes.
//
// What moves it is the desktop's own engine, ported in CompanionCore
// (`ShapeEngine`, numbers generated from shape-engine.ts and shape-moves.ts):
// the gaze wanders, the body drifts and breathes, the eyes blink, changes of
// shape, face and colour slide, the sixteen faces, and the fourteen moves
// play on request (`OwlMascotHandle.shape(_:)`, the editor's Moves). As on the
// desktop, the live loop runs only for an animated drawing of 44 pt or more
// (`fxDetail`); smaller ones and Reduce Motion draw the still frame, and the
// working bounce (shape-mascot.css) plays while animated. On a large layout
// with a pointer, the face turns toward it while it is over the mascot.
import Combine
import CompanionCore
import SwiftUI

struct ShapeMascotView: View {
    var shape: MascotShape = .circle
    var skin: ShapeSkin = .plain
    /// A bot colour name (`green`) or any hex.
    let color: String
    var size: CGFloat = 44
    var mood: ShapeMood = .idle
    /// A face of its own, over the mood's.
    var expression: ShapeExpression?
    /// Off draws a still frame (thumbnails, lists).
    var animated = false
    /// Plays the Shapes moves asked for (`OwlMascotHandle.shape(_:)`).
    var handle: OwlMascotHandle?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var player = ShapePlayer()

    /// `FX_FULL_MIN`: full detail (the live loop) from this size up.
    static let liveMinSize: CGFloat = 44
    /// The canvas is this much larger than the box: rings and ribbons reach past the body.
    static let overflow: CGFloat = 1.7

    var body: some View {
        let active = animated && !reduceMotion && scenePhase == .active
        let live = active && size >= Self.liveMinSize
        let face = expression ?? ShapeEngineData.moodExpression[mood] ?? .neutral
        let state = ShapeEngineState(shape: shape, expression: face, color: ShapeArt.hex(color))
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !active)) { timeline in
            Canvas { context, canvas in
                let now = timeline.date.timeIntervalSinceReferenceDate
                let frame = live ? player.frame(state, now: now) : ShapeFrames.still(shape, face, color: state.color)
                ShapeRenderer.draw(in: &context, canvas: canvas, box: size, frame: frame, skin: skin, hex: state.color,
                                   bounce: active && mood == .working ? now : nil)
            }
            .frame(width: size * Self.overflow, height: size * Self.overflow)
        }
        .frame(width: size, height: size)
        .onContinuousHover { phase in
            guard live else { return }
            switch phase {
            case let .active(at):
                // -1...1 at about three box widths away (`pointerAround`)
                let reach = max(240, size * 3)
                player.pointer(CGPoint(x: (at.x - size / 2) / reach, y: (at.y - size / 2) / reach))
            case .ended:
                player.pointer(nil)
            }
        }
        .onReceive(handle?.$shapeMove.eraseToAnyPublisher() ?? Empty().eraseToAnyPublisher()) { request in
            guard live, let request else { return }
            player.play(request, now: Date().timeIntervalSinceReferenceDate)
        }
        .accessibilityHidden(true)
    }
}

/// Holds the live engine across redraws (`engine.current`), made on the
/// first live frame; a still drawing never asks it for a frame.
final class ShapePlayer {
    private var engine: ShapeEngine?
    private var lastMove = 0
    private var pendingPointer: CGPoint??

    func frame(_ state: ShapeEngineState, now: Double) -> ShapeFrame {
        let run: ShapeEngine
        if let engine {
            if engine.state != state { engine.set(state, now: now) }
            run = engine
        } else {
            run = ShapeEngine(state, now: now)
            engine = run
        }
        if let pointer = pendingPointer {
            run.pointer(pointer)
            pendingPointer = nil
        }
        return run.frame(now)
    }

    func play(_ request: ShapeMoveRequest, now: Double) {
        guard request.key != lastMove else { return }
        lastMove = request.key
        engine?.play(request.move, now: now)
    }

    func pointer(_ at: CGPoint?) {
        if let engine { engine.pointer(at) } else { pendingPointer = .some(at) }
    }
}

enum ShapeRenderer {
    /// shape-mascot.css `shape-bounce`, 0.9 s, on the body (`.shape-body`).
    static let bounce = CSSKeyframes([(0, [0, 1, 1]), (0.45, [-0.06, 0.98, 1.03]), (0.7, [0, 1.04, 0.96]), (1, [0, 1, 1])])

    /// Draws one frame centred in `canvas`, its 100 box mapped onto `box` points.
    static func draw(in context: inout GraphicsContext, canvas: CGSize, box: CGFloat, frame: ShapeFrame, skin: ShapeSkin, hex: String, bounce time: Double?) {
        let paint = ShapeArt.paint(skin, hex: hex)
        let clay = skin == .plain
        let affine = frame.affine

        let outline = CGMutablePath()
        ShapeMath.smoothClosedPath(frame.body, into: outline)
        let eyes = CGMutablePath()
        for eye in frame.eyes { ShapeMath.smoothClosedPath(eye, into: eyes) }
        let body = Path(outline)
        var cut = body
        cut.addPath(Path(eyes))
        let evenOdd = FillStyle(eoFill: true)

        var ctx = context
        let k = box / 100
        ctx.translateBy(x: (canvas.width - box) / 2, y: (canvas.height - box) / 2)
        ctx.scaleBy(x: k, y: k)

        // rings behind the body
        for (i, ring) in frame.rings.enumerated() { stroke(ring.back, ring: ring, index: i, in: ctx) }

        // .shape-body: the bounce while working, transform-origin 50% 100% of its own box
        var group = ctx
        if let time, let v = bounce.value(at: time, duration: 0.9, timing: .easeInOut) {
            let bounds = body.applying(affine).boundingRect
            let origin = CGPoint(x: bounds.midX, y: bounds.maxY)
            group.translateBy(x: 0, y: v[0] * bounds.height)
            group.pivot(origin, scaleX: v[1], scaleY: v[2])
        }

        // the body, its eyes cut out, and its dots, under the move's transform
        var shaped = group
        shaped.concatenate(affine)
        if let badge = frame.badge {
            // the notch: the body steps aside around the badge
            var keep = Path(CGRect(x: -60, y: -60, width: 220, height: 220))
            keep.addEllipse(in: CGRect(x: badge.x - badge.r - badge.notch, y: badge.y - badge.r - badge.notch,
                                       width: 2 * (badge.r + badge.notch), height: 2 * (badge.r + badge.notch)))
            shaped.clip(to: keep, style: evenOdd)
        }
        if paint.glow != nil {
            // the still neon's soft glow: the body blurred under itself
            var g = shaped
            g.addFilter(.blur(radius: 2.4))
            g.fill(cut, with: .color(Color(hex: paint.fill)), style: evenOdd)
            if let stroke = paint.stroke {
                g.stroke(body, with: .color(Color(hex: stroke)), style: StrokeStyle(lineWidth: paint.strokeWidth, lineJoin: .round))
            }
        }
        if clay {
            // the clay finish: a radial light from the upper left to a dark rim
            let stops = ShapeArt.clayStops(frame.color).map { Gradient.Stop(color: Color(hex: $0.color), location: $0.offset) }
            shaped.fill(cut, with: .radialGradient(Gradient(stops: stops), center: CGPoint(x: frame.light.x, y: frame.light.y), startRadius: 0, endRadius: frame.light.r), style: evenOdd)
        } else {
            shaped.fill(cut, with: .color(Color(hex: paint.fill)), style: evenOdd)
        }
        if paint.shine {
            let g = Gradient(stops: [
                .init(color: .white.opacity(0.55), location: 0),
                .init(color: .white.opacity(0.08), location: 0.45),
                .init(color: .black.opacity(0.18), location: 1),
            ])
            let bounds = body.boundingRect
            let center = CGPoint(x: bounds.minX + 0.32 * bounds.width, y: bounds.minY + 0.26 * bounds.height)
            shaped.fill(cut, with: .radialGradient(g, center: center, startRadius: 0, endRadius: 0.75 * max(bounds.width, bounds.height)), style: evenOdd)
        }
        if let stroke = paint.stroke {
            // the outline runs round the body and round each cut-out eye
            shaped.stroke(cut, with: .color(Color(hex: stroke)), style: StrokeStyle(lineWidth: paint.strokeWidth, lineJoin: .round))
        }
        for dot in frame.dots where dot.r > 0 {
            let rect = CGRect(x: dot.x - dot.r, y: dot.y - dot.r, width: 2 * dot.r, height: 2 * dot.r)
            var d = shaped
            d.opacity = dot.opacity
            if clay {
                // the dot's own clay light (objectBoundingBox 0.36, 0.3, r 0.85)
                let stops = ShapeArt.clayStops(frame.color).map { Gradient.Stop(color: Color(hex: $0.color), location: $0.offset) }
                d.fill(Path(ellipseIn: rect), with: .radialGradient(Gradient(stops: stops), center: CGPoint(x: rect.minX + 0.36 * rect.width, y: rect.minY + 0.3 * rect.height),
                                                                     startRadius: 0, endRadius: 0.85 * rect.width))
            } else {
                d.fill(Path(ellipseIn: rect), with: .color(Color(hex: paint.fill)))
            }
        }
        if let badge = frame.badge, badge.r > 0 {
            group.fill(Path(ellipseIn: CGRect(x: badge.x - badge.r, y: badge.y - badge.r, width: 2 * badge.r, height: 2 * badge.r)), with: .color(Color(hex: "#2a8fe8")))
        }

        // specks, rings in front, ribbons
        let speckColor = Color(hex: ShapeMath.mixHex(frame.color, "#0b0b0e", 0.62))
        for speck in frame.specks where speck.opacity > 0 {
            var s = ctx
            s.opacity = speck.opacity
            s.fill(Path(ellipseIn: CGRect(x: speck.x - speck.r, y: speck.y - speck.r, width: 2 * speck.r, height: 2 * speck.r)), with: .color(speckColor))
        }
        for (i, ring) in frame.rings.enumerated() { stroke(ring.front, ring: ring, index: i, in: ctx) }
        for ribbon in frame.ribbons where ribbon.opacity > 0 {
            guard let visible = ribbon.visible else { continue }
            var path = Path()
            path.move(to: ribbon.from)
            path.addQuadCurve(to: ribbon.to, control: ribbon.control)
            var r = ctx
            r.opacity = ribbon.opacity
            r.stroke(path.trimmedPath(from: visible.lowerBound, to: visible.upperBound),
                     with: rainbow(ribbon.hue, ribbon.hueSpan, x1: ribbon.x1, x2: ribbon.x2),
                     style: StrokeStyle(lineWidth: ribbon.width, lineCap: .round))
        }
    }

    private static func stroke(_ runs: [[CGPoint]], ring: ShapeRingDraw, index: Int, in context: GraphicsContext) {
        guard ring.opacity > 0, !runs.isEmpty else { return }
        var path = Path()
        for run in runs where run.count > 1 {
            path.move(to: run[0])
            for p in run.dropFirst() { path.addLine(to: p) }
        }
        var c = context
        c.opacity = ring.opacity
        c.stroke(path, with: rainbow(ring.hue, ring.hueSpan, x1: ring.x1, x2: ring.x2), style: StrokeStyle(lineWidth: ring.width, lineCap: .round, lineJoin: .round))
    }

    /// `rainbowStops` across the line: hsl(h, 55%, 62%) at 0, 0.5 and 1.
    private static func rainbow(_ hue: Double, _ span: Double, x1: Double, x2: Double) -> GraphicsContext.Shading {
        let stops = ShapeMath.rainbowStops(hue, span).enumerated().map { i, h in
            Gradient.Stop(color: hsl(h, 0.55, 0.62), location: Double(i) / 2)
        }
        return .linearGradient(Gradient(stops: stops), startPoint: CGPoint(x: x1, y: 0), endPoint: CGPoint(x: x2, y: 0))
    }

    /// An HSL colour as SwiftUI draws it.
    static func hsl(_ h: Double, _ s: Double, _ l: Double) -> Color {
        let c = (1 - abs(2 * l - 1)) * s
        let hp = (h.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360) / 60
        let x = c * (1 - abs(hp.truncatingRemainder(dividingBy: 2) - 1))
        let (r, g, b): (Double, Double, Double) = switch Int(hp) {
        case 0: (c, x, 0)
        case 1: (x, c, 0)
        case 2: (0, c, x)
        case 3: (0, x, c)
        case 4: (x, 0, c)
        default: (c, 0, x)
        }
        let m = l - c / 2
        return Color(.sRGB, red: r + m, green: g + m, blue: b + m, opacity: 1)
    }
}
