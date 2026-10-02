// The effect layers of an owl skin: a port of `src/components/OwlSkinFx.tsx`
// and the `owl-fx-*` keyframes in `src/styles.css`.
//
// Drawn inside the owl's rig, so they move with it. With `time == nil` every
// layer shows its still look (the desktop with no animation); with a time,
// each layer runs its CSS keyframes on the same durations and delays. Below
// `OwlArt.detailMinSize` only the aura is drawn, and it never animates.
import CompanionCore
import SwiftUI

struct OwlSkinFx {
    let skin: MascotSkin
    let look: OwlSkinLook
    let detail: Bool
    /// Seconds on a continuous clock while the effects are live; nil = still.
    let time: Double?
    let art: OwlRenderer.Art

    // MARK: keyframes (src/styles.css)

    static let crackle = CSSKeyframes([(0, [0]), (0.02, [1]), (0.05, [0.25]), (0.08, [1]), (0.12, [0.55]), (0.16, [1]), (0.22, [0.3]), (0.26, [0.9]), (0.30, [0]), (1, [0])])
    static let flash = CSSKeyframes([(0, [0]), (0.02, [0.55]), (0.04, [0.08]), (0.06, [0.4]), (0.11, [0]), (1, [0])])
    static let surge = CSSKeyframes([(0, [0.7]), (0.02, [1]), (0.04, [0.8]), (0.06, [1]), (0.14, [0.7]), (1, [0.7])])
    static let pulse = CSSKeyframes([(0, [0.7]), (0.5, [1]), (1, [0.7])])
    static let buzz = CSSKeyframes([(0, [1]), (0.40, [1]), (0.42, [0.35]), (0.44, [1]), (0.455, [0.55]), (0.47, [1]), (1, [1])])
    static let flame = CSSKeyframes([(0, [1, 0.92]), (0.5, [0.9, 1.1]), (1, [1.06, 0.86])])
    static let riseMove = CSSKeyframes([(0, [0, 0]), (1, [6, -56])])
    static let riseFade = CSSKeyframes([(0, [0]), (0.15, [1]), (1, [0])])
    static let fallMove = CSSKeyframes([(0, [0, -14, 0]), (1, [8, 40, 90])])
    static let fallFade = CSSKeyframes([(0, [0]), (0.2, [0.9]), (1, [0])])
    static let sweep = CSSKeyframes([(0, [-200]), (0.55, [240]), (1, [240])])
    static let twinkle = CSSKeyframes([(0, [0.2, 0]), (0.5, [1, 1]), (1, [0.2, 0])])

    private func value(_ frames: CSSKeyframes, _ duration: Double, delay: Double = 0, timing: CSSTiming, alternate: Bool = false) -> [Double]? {
        guard let time else { return nil }
        return frames.value(at: time, duration: duration, delay: delay, timing: timing, alternate: alternate)
    }

    private func opacity(_ frames: CSSKeyframes, _ duration: Double, delay: Double = 0, timing: CSSTiming, still: Double = 1) -> Double {
        value(frames, duration, delay: delay, timing: timing)?[0] ?? still
    }

    /// The silhouette rim's opacity (`owl-fx-rim-*`).
    var rimOpacity: Double {
        guard detail, time != nil else { return 1 }
        switch skin {
        case .neon: return opacity(Self.buzz, 4.2, timing: .linear)
        case .lightning: return opacity(Self.surge, 3.4, delay: 1.9, timing: .linear)
        default: return 1
        }
    }

    // MARK: shapes

    static let sparkle = MascotPaths.path("M0 -9L2 -2L9 0L2 2L0 9L-2 2L-9 0L-2 -2Z")
    static let flake = MascotPaths.path("M0 -6V6M-5.2 -3L5.2 3M-5.2 3L5.2 -3")
    static func flamePath(_ w: Double, _ h: Double) -> Path {
        MascotPaths.path(
            "M0 0C\(-w * 0.62) 0 \(-w * 0.6) \(-h * 0.42) \(-w * 0.12) \(-h * 0.7)"
                + "C\(-w * 0.02) \(-h * 0.8) \(w * 0.1) \(-h * 0.9) \(w * 0.02) \(-h)"
                + "C\(w * 0.42) \(-h * 0.72) \(w * 0.64) \(-h * 0.34) \(w * 0.46) \(-h * 0.12)C\(w * 0.36) 0 \(w * 0.2) 0 0 0Z"
        )
    }

    static let flames: [(x: Double, y: Double, h: Double, tilt: Double)] = [
        (58, 236, 58, -18), (40, 190, 64, -24), (42, 140, 60, -20), (62, 86, 56, -14), (104, 34, 50, -6),
        (160, 22, 46, 6), (206, 70, 50, 16), (214, 150, 56, 22), (196, 222, 58, 18),
    ]
    static let embers: [(x: Double, y: Double, r: Double, delay: Double)] = [
        (52, 150, 2.6, 0), (78, 58, 2.2, 0.8), (132, 18, 2.4, 1.6), (196, 48, 2, 0.4), (220, 130, 2.6, 1.2),
        (36, 210, 2.2, 2), (210, 200, 2, 2.6),
    ]
    static let flakes: [(x: Double, y: Double, s: Double, delay: Double)] = [
        (30, 60, 0.9, 0), (226, 40, 0.75, 1.1), (18, 150, 0.7, 2.2), (238, 170, 0.95, 0.6), (70, 18, 0.65, 1.7),
        (196, 250, 0.8, 2.8), (48, 244, 0.7, 3.4),
    ]
    static let glints: [(x: Double, y: Double, s: Double, delay: Double)] = [(72, 58, 0.9, 0), (196, 36, 0.7, 1.3), (58, 196, 0.8, 2.1)]
    static let crawl = OwlSkins.lightningCrawl.map { (path: MascotPaths.path($0.d), duration: $0.duration, delay: $0.delay) }
    static let arcs = OwlSkins.lightningArcs.map { (path: MascotPaths.path($0.d), duration: $0.duration, delay: $0.delay) }
    static let facets = MascotPaths.path("M62 64L96 40L104 70Z M44 150L70 128L66 170Z M176 30L204 50L184 60Z")

    /// The carbon twill, a 9-unit 2x2 weave turned 45°: the horizontal tows,
    /// the vertical tows, and the lighter centre line of each.
    static let weave: (h: Path, v: Path, hShine: Path, vShine: Path) = {
        var h = Path(), v = Path(), hs = Path(), vs = Path()
        let cell: CGFloat = 4.5
        // pattern space covering the 256 box once rotated
        for i in stride(from: -2, through: 82, by: 1) {
            for j in stride(from: -42, through: 42, by: 1) {
                let x = CGFloat(i) * cell, y = CGFloat(j) * cell
                let horizontal = (i + j) % 2 == 0
                let rect = CGRect(x: x, y: y, width: cell, height: cell)
                if horizontal {
                    h.addRect(rect)
                    hs.addRect(CGRect(x: x, y: y + cell * 0.3, width: cell, height: cell * 0.4))
                } else {
                    v.addRect(rect)
                    vs.addRect(CGRect(x: x + cell * 0.3, y: y, width: cell * 0.4, height: cell))
                }
            }
        }
        let turn = CGAffineTransform(rotationAngle: .pi / 4)
        return (h.applying(turn), v.applying(turn), hs.applying(turn), vs.applying(turn))
    }()

    private func drawWeave(_ ctx: inout GraphicsContext, opacity: Double, clip: Path) {
        var w = ctx
        w.clip(to: clip)
        w.opacity = opacity
        w.fill(Self.weave.h, with: .color(Color(hex: "#24262B")))
        w.fill(Self.weave.hShine, with: .color(Color(hex: "#43464F")))
        w.fill(Self.weave.v, with: .color(Color(hex: "#17181C")))
        w.fill(Self.weave.vShine, with: .color(Color(hex: "#2A2D33")))
    }

    private static func gradient(_ stops: [(String, Double, Double)]) -> Gradient {
        Gradient(stops: stops.map { Gradient.Stop(color: Color(hex: $0.0, opacity: $0.2), location: $0.1) })
    }

    static let metal = gradient([("#FFF8D6", 0, 0.9), ("#FFE38A", 0.22, 0.35), ("#FFD24D", 0.46, 0), ("#FFF1B0", 0.62, 0.35), ("#8A5600", 0.8, 0.3), ("#3A2200", 1, 0.6)])
    static let ice = gradient([("#FFFFFF", 0, 0.6), ("#E0F7FF", 0.45, 0.08), ("#1E5A86", 1, 0.3)])
    static let heat = gradient([("#FF6A1A", 0, 0.85), ("#E23A0B", 0.45, 0.35), ("#E23A0B", 1, 0)])
    static let coat = gradient([("#FFFFFF", 0, 0.28), ("#FFFFFF", 0.4, 0), ("#000000", 1, 0.35)])

    /// A gradient across a box, from (x1, y1) to (x2, y2) in its unit square
    /// (SVG's default `objectBoundingBox`).
    private static func across(_ box: CGRect, _ g: Gradient, _ x1: CGFloat, _ y1: CGFloat, _ x2: CGFloat, _ y2: CGFloat) -> GraphicsContext.Shading {
        .linearGradient(g, startPoint: CGPoint(x: box.minX + x1 * box.width, y: box.minY + y1 * box.height),
                        endPoint: CGPoint(x: box.minX + x2 * box.width, y: box.minY + y2 * box.height))
    }

    // MARK: layers

    /// Behind the whole owl: the glow, the aura, and the inferno's flames.
    func back(_ ctx: inout GraphicsContext) {
        guard skin != .none else { return }
        if detail, let rim = look.rim, skin == .neon || skin == .lightning || skin == .inferno {
            var g = ctx
            switch skin {
            case .neon: g.opacity = time == nil ? 1 : opacity(Self.buzz, 4.2, timing: .linear)
            case .lightning: g.opacity = time == nil ? 1 : opacity(Self.surge, 3.4, delay: 1.9, timing: .linear)
            default: g.opacity = time == nil ? 1 : opacity(Self.pulse, 1.3, timing: .easeInOut)
            }
            for p in art.body {
                g.stroke(p, with: .color(Color(rim, opacity: 0.1)), style: StrokeStyle(lineWidth: 26, lineJoin: .round))
                g.stroke(p, with: .color(Color(rim, opacity: 0.18)), style: StrokeStyle(lineWidth: 15, lineJoin: .round))
            }
        }
        if let aura = look.aura {
            var a = ctx
            if detail, time != nil {
                a.opacity = skin == .lightning
                    ? opacity(Self.surge, 3.4, delay: 1.9, timing: .linear)
                    : opacity(Self.pulse, 2.8, timing: .easeInOut)
            }
            let rx: CGFloat = detail ? 134 : 150, ry: CGFloat = detail ? 138 : 150
            // objectBoundingBox radial gradient: an ellipse, centred at (0.5, 0.52) of the box
            let center = CGPoint(x: 128, y: 136 - ry + 0.52 * 2 * ry)
            a.translateBy(x: center.x, y: center.y)
            a.scaleBy(x: 1, y: ry / rx)
            let g = Gradient(stops: [
                .init(color: Color(hex: aura.color, opacity: aura.strength), location: 0),
                .init(color: Color(hex: aura.color, opacity: aura.strength * 0.4), location: 0.55),
                .init(color: Color(hex: aura.color, opacity: 0), location: 1),
            ])
            let dy = (136 - center.y) * rx / ry
            a.fill(
                Path(ellipseIn: CGRect(x: -rx, y: dy - rx, width: rx * 2, height: rx * 2)),
                with: .radialGradient(g, center: .zero, startRadius: 0, endRadius: rx)
            )
        }
        if detail && skin == .inferno {
            for (i, f) in Self.flames.enumerated() {
                var g = ctx
                g.translateBy(x: f.x, y: f.y)
                g.rotate(by: .degrees(f.tilt))
                for (j, spec) in [(w: f.h * 0.62, h: f.h, color: "#F4511E", dur: 0.55 + Double(i % 4) * 0.12, delay: Double(i) * 0.09),
                                  (w: f.h * 0.36, h: f.h * 0.66, color: "#FFB02E", dur: 0.42 + Double(i % 3) * 0.1, delay: Double(i) * 0.13)].enumerated() {
                    _ = j
                    let path = Self.flamePath(spec.w, spec.h)
                    var t = g
                    if let s = value(Self.flame, spec.dur, delay: spec.delay, timing: .easeInOut, alternate: true) {
                        // transform-origin 50% 100% of the flame's own box
                        let b = path.boundingRect
                        t.pivot(CGPoint(x: b.midX, y: b.maxY), scaleX: s[0], scaleY: s[1])
                    }
                    t.fill(path, with: .color(Color(hex: spec.color)))
                }
            }
        }
    }

    /// On the plumage, under the face mask: the skin's paint, clipped to the silhouette.
    func plumage(_ ctx: inout GraphicsContext) {
        guard detail, skin != .none else { return }
        var c = ctx
        c.clip(to: art.silhouette)
        let box = CGRect(x: 0, y: 0, width: 256, height: 256)
        let rect = Path(box)
        switch skin {
        case .gold:
            c.fill(rect, with: Self.across(box, Self.metal, 0, 0, 1, 1))
        case .carbon:
            drawWeave(&c, opacity: 0.9, clip: rect)
            c.fill(rect, with: Self.across(box, Self.coat, 0, 0, 0.4, 1))
        case .inferno:
            var h = c
            if time != nil { h.opacity = opacity(Self.pulse, 1.8, timing: .easeInOut) }
            h.fill(rect, with: Self.across(box, Self.heat, 0, 1, 0, 0))
        case .frost:
            c.fill(rect, with: Self.across(box, Self.ice, 0.1, 0, 0.7, 1))
            c.fill(Self.facets, with: .color(.white.opacity(0.3)))
        case .lightning:
            for (i, arc) in Self.crawl.enumerated() {
                var a = c
                a.opacity = time == nil ? (i == 0 ? 0.9 : 0) : opacity(Self.crackle, arc.duration, delay: arc.delay, timing: .linear, still: i == 0 ? 0.9 : 0)
                guard a.opacity > 0.001 else { continue }
                let round = StrokeStyle(lineWidth: 7, lineCap: .round, lineJoin: .round)
                a.stroke(arc.path, with: .color(Color(hex: "#38BDF8", opacity: 0.55)), style: round)
                a.stroke(arc.path, with: .color(.white), style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
            }
        default:
            break
        }
    }

    /// On the near wing, over its flat fill (so the paint follows the wing).
    func wing(_ ctx: inout GraphicsContext) {
        guard detail, skin == .gold || skin == .carbon else { return }
        let box = art.wingUnion.boundingRect
        if skin == .gold {
            var w = ctx
            w.opacity = 0.7
            for p in art.wing { w.fill(p, with: Self.across(box, Self.metal, 0, 0, 1, 1)) }
        } else {
            drawWeave(&ctx, opacity: 0.8, clip: art.wingUnion)
        }
    }

    /// Around the eye, above the socket and under the iris.
    func eyeGlow(_ ctx: inout GraphicsContext) {
        guard detail, let glow = look.eyeGlow else { return }
        var g = ctx
        if time != nil { g.opacity = opacity(Self.pulse, 1.6, timing: .easeInOut) }
        let r = OwlArt.irisRadius * 1.75
        let gradient = Gradient(stops: [
            .init(color: Color(hex: glow, opacity: 0.95), location: 0.35),
            .init(color: Color(hex: glow, opacity: 0.35), location: 0.7),
            .init(color: Color(hex: glow, opacity: 0), location: 1),
        ])
        g.fill(OwlRenderer.circle(OwlArt.eye, r), with: .radialGradient(gradient, center: OwlArt.eye, startRadius: 0, endRadius: r))
    }

    /// In front of the owl: arcs, the flash, the sweep, glints, snow and embers.
    func front(_ ctx: inout GraphicsContext) {
        guard detail, skin != .none else { return }
        switch skin {
        case .lightning:
            for (i, arc) in Self.arcs.enumerated() {
                var a = ctx
                let still: Double = i == 0 || i == 3 ? 1 : 0
                a.opacity = time == nil ? still : opacity(Self.crackle, arc.duration, delay: arc.delay, timing: .linear, still: still)
                guard a.opacity > 0.001 else { continue }
                a.stroke(arc.path, with: .color(Color(hex: "#38BDF8", opacity: 0.35)), style: StrokeStyle(lineWidth: 12, lineCap: .round, lineJoin: .round))
                a.stroke(arc.path, with: .color(Color(hex: "#7DD3FC", opacity: 0.9)), style: StrokeStyle(lineWidth: 4.4, lineCap: .round, lineJoin: .round))
                a.stroke(arc.path, with: .color(.white), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            }
            let flash = time == nil ? 0 : opacity(Self.flash, 3.4, delay: 1.9, timing: .linear, still: 0)
            if flash > 0.001 {
                var f = ctx
                f.clip(to: art.silhouette)
                f.opacity = flash
                f.fill(Path(CGRect(x: 0, y: 0, width: 256, height: 256)), with: .color(Color(hex: "#E0F7FF")))
            }
        case .gold, .carbon, .frost:
            var s = ctx
            s.clip(to: art.silhouette)
            s.pivot(CGPoint(x: 128, y: 128), rotate: 22)
            let gold = skin == .gold
            let dx = value(Self.sweep, gold ? 3.2 : 4.6, delay: gold ? 0.4 : 1.2, timing: .easeInOut)?[0] ?? 0
            let band = CGRect(x: 70 + dx, y: -80, width: gold ? 46 : 60, height: 420)
            let peak = gold ? 0.75 : 0.35
            let g = Gradient(stops: [
                .init(color: .white.opacity(0), location: 0),
                .init(color: .white.opacity(peak), location: 0.5),
                .init(color: .white.opacity(0), location: 1),
            ])
            s.fill(Path(band), with: Self.across(band, g, 0, 0, 1, 0))
            if gold {
                for glint in Self.glints {
                    var t = ctx
                    t.translateBy(x: glint.x, y: glint.y)
                    t.scaleBy(x: glint.s, y: glint.s)
                    if let v = value(Self.twinkle, 2.4, delay: glint.delay, timing: .easeInOut) {
                        t.scaleBy(x: v[0], y: v[0])
                        t.opacity = v[1]
                    }
                    t.fill(Self.sparkle, with: .color(Color(hex: "#FFF8DC")))
                }
            }
            if skin == .frost {
                for (i, flake) in Self.flakes.enumerated() {
                    var t = ctx
                    t.translateBy(x: flake.x, y: flake.y)
                    t.scaleBy(x: flake.s, y: flake.s)
                    let duration = 4.2 + Double(i % 3) * 0.6
                    if let m = value(Self.fallMove, duration, delay: flake.delay, timing: .linear) {
                        t.translateBy(x: m[0], y: m[1])
                        t.rotate(by: .degrees(m[2]))
                        t.opacity = value(Self.fallFade, duration, delay: flake.delay, timing: .linear)?[0] ?? 1
                    }
                    t.stroke(Self.flake, with: .color(.white), style: StrokeStyle(lineWidth: 2, lineCap: .round))
                }
            }
        case .inferno:
            for (i, ember) in Self.embers.enumerated() {
                var t = ctx
                t.translateBy(x: ember.x, y: ember.y)
                let duration = 2.2 + Double(i % 3) * 0.5
                if let m = value(Self.riseMove, duration, delay: ember.delay, timing: .easeOut) {
                    t.translateBy(x: m[0], y: m[1])
                    t.opacity = value(Self.riseFade, duration, delay: ember.delay, timing: .easeOut)?[0] ?? 1
                }
                t.fill(OwlRenderer.circle(.zero, ember.r), with: .color(Color(hex: i % 2 == 1 ? "#FFD166" : "#FF8A3D")))
            }
        default:
            break
        }
    }
}
