// The shapes in volume on the phone: a port of the desktop's
// `src/components/shape-volume.ts` (2026-10-18, #786, with the depth fix of
// #1106), its numbers generated into `ShapeVolumeData` from the desktop's
// own module, and checked against frames the desktop draws
// (Fixtures/shape-volume.json, ShapeVolumeTests).
//
// - The body is a few slices of one outline, stacked in depth and turned
//   with the pose (yaw, pitch, a little roll), so it shows a side when it
//   turns. The slices' depth scales with the body's thickness now
//   (`ShapeFrame.depth`): a body a move shrinks to a dot or a bar thins with
//   it, so it never comes apart into a pill beside its own thought dots.
// - A turn out of the picture plane bends the outline in a gentle
//   perspective (`warp`): the shape rounds into the turn, its top stays on top.
// - Two opaque eyes in a solid ink (dark, or light on a dark body): capsules
//   at rest, wide ovals while busy, full arches when pleased (`styledEyes`).
// - Every shape stands on the same ground (`groundLift`) at a size of its
//   own (`fit`), so a list of bots rests on one line.
// ShapeMascotView.swift draws it and ShapeMotion.swift moves it.
import CoreGraphics
import Foundation

/// A pose at one moment: the turn (degrees), the scale and a small lift
/// (box units, up is negative).
public struct ShapePose: Equatable, Sendable {
    public var yaw, pitch, roll, scale, lift: Double

    public init(yaw: Double, pitch: Double, roll: Double, scale: Double, lift: Double) {
        self.yaw = yaw
        self.pitch = pitch
        self.roll = roll
        self.scale = scale
        self.lift = lift
    }
}

/// How many slices a size draws (`VolumeDetail`).
public enum ShapeVolumeDetail: String, CaseIterable, Sendable {
    case tiny, small, full

    /// `volumeDetail`.
    public static func of(_ size: Double) -> ShapeVolumeDetail {
        if size < ShapeVolumeData.sizes.small { return .tiny }
        if size < ShapeVolumeData.sizes.full { return .small }
        return .full
    }
}

/// How a mood draws the eyes (`EyeStyle`).
public enum ShapeEyeStyle: String, CaseIterable, Sendable {
    case capsule, oval, arc
}

/// Every matrix of one pose: the slices behind the face (back to front),
/// the face, the eyes on its dome, and the face's outline seen from the
/// eyes' own space (they are clipped to it).
public struct ShapePoseMatrices: Sendable {
    public var slices: [CGAffineTransform]
    public var face: CGAffineTransform
    public var eyes: CGAffineTransform
    public var eyesClip: CGAffineTransform
}

/// A closed smooth outline as cubic segments (`smoothClosed`), so the bend
/// moves every point the desktop's path string holds, control points included.
public struct ShapeOutline: Sendable {
    public var start: CGPoint
    public var segments: [(c1: CGPoint, c2: CGPoint, to: CGPoint)]

    public init(start: CGPoint, segments: [(c1: CGPoint, c2: CGPoint, to: CGPoint)]) {
        self.start = start
        self.segments = segments
    }

    public init?(points: [CGPoint]) {
        guard let first = points.first else { return nil }
        start = first
        segments = ShapeMath.smoothSegments(points)
    }

    /// Every point the path names (the start, then each segment's three).
    public var allPoints: [CGPoint] { [start] + segments.flatMap { [$0.c1, $0.c2, $0.to] } }

    public func mapped(_ f: (CGPoint) -> CGPoint) -> ShapeOutline {
        ShapeOutline(start: f(start), segments: segments.map { (f($0.c1), f($0.c2), f($0.to)) })
    }

    public func add(to path: CGMutablePath) {
        path.move(to: start)
        for s in segments { path.addCurve(to: s.to, control1: s.c1, control2: s.c2) }
        path.closeSubpath()
    }

    /// As the desktop writes it (two decimals).
    public var d: String {
        let f = { (v: CGFloat) in ShapeMath.js(ShapeMath.round2(Double(v))) }
        var out = "M\(f(start.x)) \(f(start.y))"
        for s in segments { out += "C\(f(s.c1.x)) \(f(s.c1.y)) \(f(s.c2.x)) \(f(s.c2.y)) \(f(s.to.x)) \(f(s.to.y))" }
        return out + "Z"
    }
}

/// One drawn eye in a style: the engine's capsule, or an oval or an arch built on its box.
public enum ShapeStyledEye: Sendable {
    case outline(ShapeOutline)
    case oval(cx: Double, cy: Double, rx: Double, ry: Double)
    /// The pleased arch: an outer half ellipse over the top, then the inner one back.
    case arc(cx: Double, y: Double, hw: Double, hh: Double, ix: Double, iy: Double)
}

/// The paints of one body colour (`InkPaint`).
public struct ShapeInkPaint: Equatable, Sendable {
    public var fill: String
    /// A faint hairline for a near-white or near-black body, else nil.
    public var edge: String?
    public var eyes: String
}

public enum ShapeVolume {
    public static var rest: ShapePose { ShapeVolumeData.rest }

    private static let rad = Double.pi / 180

    // MARK: Ground

    /// Every shape stands on the same ground: its lowest point sits where the
    /// heart's does. Box units (`groundLift`).
    public static func groundLift(_ shape: MascotShape) -> Double {
        func down(_ s: MascotShape) -> Double {
            ShapeMath.radiusAt(ShapeEngineData.radii[s] ?? [], Double.pi) * (ShapeVolumeData.fit[s] ?? 1)
        }
        return ShapeVolumeData.rest.scale * 40 * (down(.blob) - down(shape))
    }

    /// A pose standing on the shared ground, at the shape's own size (`grounded` in ShapeMascot.tsx).
    public static func grounded(_ pose: ShapePose, _ shape: MascotShape) -> ShapePose {
        var out = pose
        out.scale = pose.scale * (ShapeVolumeData.fit[shape] ?? 1)
        out.lift = pose.lift + groundLift(shape)
        return out
    }

    /// The idle pose keeps the rest turn out of the picture plane, so the
    /// outline never bends at rest; a move plays its full turn (`uprightPose`).
    public static func upright(_ pose: ShapePose) -> ShapePose {
        var out = pose
        out.yaw = ShapeVolumeData.rest.yaw
        out.pitch = ShapeVolumeData.rest.pitch
        return out
    }

    // MARK: Slices

    private static func sliceScale(_ z: Double) -> Double {
        ShapeVolumeData.core + (1 - ShapeVolumeData.core) * (max(0, 1 - pow(z / ShapeVolumeData.depth, 2))).squareRoot()
    }

    private static var front: Double { ShapeVolumeData.depth * 0.82 }

    /// The slice at depth z (box units), scaled by s, around the box's middle (`sliceMatrix`).
    private static func slice(_ z: Double, _ s: Double, _ pose: ShapePose) -> CGAffineTransform {
        let k = pose.scale
        let yaw = pose.yaw * rad, pitch = pose.pitch * rad, roll = pose.roll * rad
        let squash = ShapeVolumeData.turnSquash
        let sx = s * k * (1 - squash * (1 - cos(yaw)))
        let sy = s * k * (1 - squash * (1 - cos(pitch)))
        let dx = z * sin(yaw) * k
        let dy = -z * sin(pitch) * k
        let cr = cos(roll), sr = sin(roll)
        let a = cr * sx, b = sr * sx, c = -sr * sy, d = cr * sy
        let tx = cr * dx - sr * dy
        let ty = sr * dx + cr * dy
        let e = 50 + tx - (a * 50 + c * 50)
        let f = 50 + pose.lift + ty - (b * 50 + d * 50)
        return CGAffineTransform(a: a, b: b, c: c, d: d, tx: e, ty: f)
    }

    /// Every matrix of one pose (`poseMatrices`). `depth` is the body's
    /// thickness now as a share of its resting one (`ShapeFrame.depth`).
    public static func matrices(_ detail: ShapeVolumeDetail, _ pose: ShapePose = ShapeVolumeData.rest, depth: Double = 1) -> ShapePoseMatrices {
        let n = ShapeVolumeData.slices[detail] ?? 9
        let k = min(1, max(0, depth.isFinite ? depth : 1))
        let total = ShapeVolumeData.depth
        let slices = (0..<(n - 1)).map { i -> CGAffineTransform in
            let z = -total + (front + total) * Double(i) / Double(n - 1)
            return slice(z * k, sliceScale(z), pose)
        }
        let squash = ShapeVolumeData.turnSquash
        let dz = front * k * (1 - ShapeVolumeData.eyeDome)
        let lx = dz * sin(pose.yaw * rad) / (sliceScale(front) * (1 - squash * (1 - cos(pose.yaw * rad))))
        let ly = -dz * sin(pose.pitch * rad) / (sliceScale(front) * (1 - squash * (1 - cos(pose.pitch * rad))))
        return ShapePoseMatrices(
            slices: slices,
            face: slice(front * k, sliceScale(front), pose),
            eyes: slice(front * ShapeVolumeData.eyeDome * k, sliceScale(front), pose),
            eyesClip: CGAffineTransform(translationX: lx, y: ly)
        )
    }

    // MARK: The bend

    /// One point (box units) under the pose's out-of-plane turn (`warpPoint`).
    public static func warp(_ p: CGPoint, _ pose: ShapePose) -> CGPoint {
        let sy = sin(pose.yaw * rad), cy = cos(pose.yaw * rad)
        let sp = sin(pose.pitch * rad), cp = cos(pose.pitch * rad)
        let u = (Double(p.x) - 50) / 40
        let v = (Double(p.y) - 50) / 40
        let narrow = ShapeVolumeData.outOfPlane.narrow, perspective = ShapeVolumeData.outOfPlane.perspective
        let across = 1 - narrow * (1 - cy)
        let down = 1 - narrow * (1 - cp)
        let tall = 1 + perspective * u * sy
        let wide = 1 - perspective * v * sp
        return CGPoint(x: 50 + 40 * u * across * wide, y: 50 + 40 * v * down * tall)
    }

    public static func warp(_ outline: ShapeOutline, _ pose: ShapePose) -> ShapeOutline {
        outline.mapped { warp($0, pose) }
    }

    // MARK: Eyes

    /// `eyeStyleFor`.
    public static func eyeStyle(_ mood: ShapeMood) -> ShapeEyeStyle { ShapeVolumeData.moodEyes[mood] ?? .capsule }

    /// The eyes drawn in a style: capsules are the engine's own; ovals and
    /// arches are built on each eye's box, so they follow it (pose, gaze,
    /// blink) (`styledEyes`).
    public static func styledEyes(_ eyes: [ShapeOutline], _ style: ShapeEyeStyle) -> [ShapeStyledEye] {
        guard style != .capsule, !eyes.isEmpty else { return eyes.map { .outline($0) } }
        let boxes = eyes.map { eye -> (cx: Double, cy: Double, w: Double, h: Double) in
            let points = eye.allPoints
            let xs = points.map { ShapeMath.round2(Double($0.x)) }, ys = points.map { ShapeMath.round2(Double($0.y)) }
            let x0 = xs.min() ?? 0, x1 = xs.max() ?? 0, y0 = ys.min() ?? 0, y1 = ys.max() ?? 0
            return ((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0)
        }
        // two eyes never touch: an oval or an arch stays within its share of the gap between them
        let gap = boxes.count > 1 ? abs(boxes[1].cx - boxes[0].cx) : Double.infinity
        return boxes.map { box in
            let size = max(box.w * 2.2, 0.01)
            // a blink still closes them: the box's height follows the lid
            let open = min(1, box.h / max(box.w * 1.6, 0.01))
            if style == .oval {
                let rx = min(size * 0.46, gap * 0.44)
                let ry = max(0.4, size * 0.33 * open)
                return .oval(cx: box.cx, cy: box.cy, rx: rx, ry: ry)
            }
            let hw = min(max(box.w * 1.35, box.h * 0.44), gap * 0.42)
            let hh = hw * 0.9 * max(0.25, open)
            let t = max(1.2, hw * 0.72)
            let y = box.cy + size * 0.36
            return .arc(cx: box.cx, y: y, hw: hw, hh: hh, ix: max(0.2, hw - t), iy: max(0.15, hh - t))
        }
    }

    /// Half an ellipse over the top, from its left end to its right one (or back), as two cubic quarters.
    private static func upperHalf(_ path: CGMutablePath, cx: Double, cy: Double, rx: Double, ry: Double, leftToRight: Bool) {
        let k = 0.5522847498
        if leftToRight {
            path.addCurve(to: CGPoint(x: cx, y: cy - ry), control1: CGPoint(x: cx - rx, y: cy - k * ry), control2: CGPoint(x: cx - k * rx, y: cy - ry))
            path.addCurve(to: CGPoint(x: cx + rx, y: cy), control1: CGPoint(x: cx + k * rx, y: cy - ry), control2: CGPoint(x: cx + rx, y: cy - k * ry))
        } else {
            path.addCurve(to: CGPoint(x: cx, y: cy - ry), control1: CGPoint(x: cx + rx, y: cy - k * ry), control2: CGPoint(x: cx + k * rx, y: cy - ry))
            path.addCurve(to: CGPoint(x: cx - rx, y: cy), control1: CGPoint(x: cx - k * rx, y: cy - ry), control2: CGPoint(x: cx - rx, y: cy - k * ry))
        }
    }

    /// The styled eyes as one path to fill.
    public static func path(_ eyes: [ShapeStyledEye]) -> CGPath {
        let path = CGMutablePath()
        for eye in eyes {
            switch eye {
            case let .outline(outline):
                outline.add(to: path)
            case let .oval(cx, cy, rx, ry):
                path.addEllipse(in: CGRect(x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry))
            case let .arc(cx, y, hw, hh, ix, iy):
                path.move(to: CGPoint(x: cx - hw, y: y))
                upperHalf(path, cx: cx, cy: y, rx: hw, ry: hh, leftToRight: true)
                path.addLine(to: CGPoint(x: cx + ix, y: y))
                upperHalf(path, cx: cx, cy: y, rx: ix, ry: iy, leftToRight: false)
                path.closeSubpath()
            }
        }
        return path
    }

    /// The styled eyes as the desktop writes them (tests).
    public static func d(_ eyes: [ShapeStyledEye]) -> String {
        let f = { (v: Double) in ShapeMath.js(ShapeMath.round2(v)) }
        return eyes.map { eye -> String in
            switch eye {
            case let .outline(outline):
                return outline.d
            case let .oval(cx, cy, rx, ry):
                return "M\(f(cx - rx)) \(f(cy))A\(f(rx)) \(f(ry)) 0 1 0 \(f(cx + rx)) \(f(cy))A\(f(rx)) \(f(ry)) 0 1 0 \(f(cx - rx)) \(f(cy))Z"
            case let .arc(cx, y, hw, hh, ix, iy):
                return "M\(f(cx - hw)) \(f(y))A\(f(hw)) \(f(hh)) 0 0 1 \(f(cx + hw)) \(f(y))L\(f(cx + ix)) \(f(y))A\(f(ix)) \(f(iy)) 0 0 0 \(f(cx - ix)) \(f(y))Z"
            }
        }.joined()
    }

    // MARK: Ink

    private static func luminance(_ hex: String) -> Double {
        let (r, g, b) = ShapeMath.rgb(hex)
        func channel(_ c: Double) -> Double {
            let v = c / 255
            return v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }

    /// One body colour's paints (`inkPaint`).
    public static func ink(_ hex: String) -> ShapeInkPaint {
        let lum = luminance(hex)
        return ShapeInkPaint(
            fill: ShapeMath.mixHex(hex, hex, 0),
            // a near-white body would vanish on a light ground, a near-black one on a dark ground
            edge: lum > 0.7 ? "#000000" : lum < 0.03 ? "#ffffff" : nil,
            eyes: lum < 0.05 ? ShapeVolumeData.eyeInkOnDark : ShapeVolumeData.eyeInk
        )
    }
}
