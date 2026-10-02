// SVG path data to `CGPath`, for the Sagax mascots the phone draws from the
// desktop's own art (the owl trace, the shapes, Trombi's wire).
//
// `MausSilhouette.parse` reads only the absolute `M C Z` the body catalog
// emits. The mascots use the rest of the grammar: relative commands, `H V L`,
// quadratic curves and elliptical arcs (Trombi's wire is three arcs, the
// circle shape two). This is the whole SVG 1.1 path grammar, implicit
// repeats included, so a path copied from a `.tsx` file parses as it is.
import CoreGraphics
import Foundation

public enum SVGPath {
    private static var cache: [String: CGPath] = [:]
    private static let lock = NSLock()

    /// The path for `d`, parsed once per distinct string.
    public static func cached(_ d: String) -> CGPath {
        lock.lock()
        if let hit = cache[d] {
            lock.unlock()
            return hit
        }
        lock.unlock()
        let path = parse(d)
        lock.lock()
        cache[d] = path
        lock.unlock()
        return path
    }

    /// Parses SVG path data. Malformed tails are dropped, never thrown: what
    /// parsed so far is drawn, the way a browser draws a path up to its error.
    public static func parse(_ d: String) -> CGPath {
        let path = CGMutablePath()
        var scanner = Scanner(Array(d.utf8))
        var current = CGPoint.zero
        var start = CGPoint.zero
        var lastControl: CGPoint?
        var lastQuad: CGPoint?
        var command: UInt8 = 0

        while true {
            scanner.skipSeparators()
            guard let byte = scanner.peek() else { break }
            if Scanner.isCommand(byte) {
                command = byte
                scanner.index += 1
            } else if command == 0 {
                break
            }
            let relative = command >= 97 // lowercase
            let base = relative ? current : .zero
            func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: base.x + x, y: base.y + y) }

            switch command | 0x20 { // lowercased
            case UInt8(ascii: "z"):
                path.closeSubpath()
                current = start
                lastControl = nil
                lastQuad = nil
                // Z takes no arguments; a following number restarts nothing
                command = 0
                continue
            case UInt8(ascii: "m"):
                guard let x = scanner.number(), let y = scanner.number() else { return path }
                current = point(x, y)
                start = current
                path.move(to: current)
                // further pairs after a moveto are implicit linetos
                command = relative ? UInt8(ascii: "l") : UInt8(ascii: "L")
                lastControl = nil
                lastQuad = nil
            case UInt8(ascii: "l"):
                guard let x = scanner.number(), let y = scanner.number() else { return path }
                current = point(x, y)
                ensureStart(path, current)
                path.addLine(to: current)
                lastControl = nil
                lastQuad = nil
            case UInt8(ascii: "h"):
                guard let x = scanner.number() else { return path }
                current = CGPoint(x: (relative ? current.x : 0) + x, y: current.y)
                path.addLine(to: current)
                lastControl = nil
                lastQuad = nil
            case UInt8(ascii: "v"):
                guard let y = scanner.number() else { return path }
                current = CGPoint(x: current.x, y: (relative ? current.y : 0) + y)
                path.addLine(to: current)
                lastControl = nil
                lastQuad = nil
            case UInt8(ascii: "c"):
                guard let x1 = scanner.number(), let y1 = scanner.number(),
                      let x2 = scanner.number(), let y2 = scanner.number(),
                      let x = scanner.number(), let y = scanner.number() else { return path }
                let c1 = point(x1, y1), c2 = point(x2, y2)
                current = point(x, y)
                path.addCurve(to: current, control1: c1, control2: c2)
                lastControl = c2
                lastQuad = nil
            case UInt8(ascii: "s"):
                guard let x2 = scanner.number(), let y2 = scanner.number(),
                      let x = scanner.number(), let y = scanner.number() else { return path }
                let c1 = lastControl.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) } ?? current
                let c2 = point(x2, y2)
                current = point(x, y)
                path.addCurve(to: current, control1: c1, control2: c2)
                lastControl = c2
                lastQuad = nil
            case UInt8(ascii: "q"):
                guard let x1 = scanner.number(), let y1 = scanner.number(),
                      let x = scanner.number(), let y = scanner.number() else { return path }
                let c = point(x1, y1)
                current = point(x, y)
                path.addQuadCurve(to: current, control: c)
                lastQuad = c
                lastControl = nil
            case UInt8(ascii: "t"):
                guard let x = scanner.number(), let y = scanner.number() else { return path }
                let c = lastQuad.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) } ?? current
                current = point(x, y)
                path.addQuadCurve(to: current, control: c)
                lastQuad = c
                lastControl = nil
            case UInt8(ascii: "a"):
                guard let rx = scanner.number(), let ry = scanner.number(), let rotation = scanner.number(),
                      let large = scanner.flag(), let sweep = scanner.flag(),
                      let x = scanner.number(), let y = scanner.number() else { return path }
                let end = point(x, y)
                addArc(path, from: current, to: end, rx: rx, ry: ry, rotation: rotation, large: large, sweep: sweep)
                current = end
                lastControl = nil
                lastQuad = nil
            default:
                return path
            }
        }
        return path
    }

    private static func ensureStart(_ path: CGMutablePath, _ point: CGPoint) {
        if path.isEmpty { path.move(to: point) }
    }

    /// An SVG elliptical arc as cubic Béziers (the endpoint-to-centre
    /// conversion of SVG 1.1 appendix F.6).
    static func addArc(_ path: CGMutablePath, from p0: CGPoint, to p1: CGPoint, rx rxIn: CGFloat, ry ryIn: CGFloat, rotation: CGFloat, large: Bool, sweep: Bool) {
        if p0 == p1 { return }
        var rx = abs(rxIn), ry = abs(ryIn)
        if rx == 0 || ry == 0 {
            path.addLine(to: p1)
            return
        }
        let phi = rotation * .pi / 180
        let cosPhi = cos(phi), sinPhi = sin(phi)
        let dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2
        let x1p = cosPhi * dx + sinPhi * dy
        let y1p = -sinPhi * dx + cosPhi * dy
        let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
        if lambda > 1 {
            let s = sqrt(lambda)
            rx *= s
            ry *= s
        }
        let num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
        let den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
        var coef = den == 0 ? 0 : sqrt(max(0, num / den))
        if large == sweep { coef = -coef }
        let cxp = coef * (rx * y1p / ry)
        let cyp = coef * -(ry * x1p / rx)
        let cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2
        let cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2

        func angle(_ ux: CGFloat, _ uy: CGFloat, _ vx: CGFloat, _ vy: CGFloat) -> CGFloat {
            let a = atan2(ux * vy - uy * vx, ux * vx + uy * vy)
            return a
        }
        let theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
        var delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
        if !sweep && delta > 0 { delta -= 2 * .pi }
        if sweep && delta < 0 { delta += 2 * .pi }

        let segments = max(1, Int(ceil(abs(delta) / (.pi / 2) - 0.001)))
        let step = delta / CGFloat(segments)
        let k = 4 / 3 * tan(step / 4)
        func onEllipse(_ t: CGFloat) -> (CGPoint, CGPoint) {
            let cosT = cos(t), sinT = sin(t)
            let point = CGPoint(
                x: cx + rx * cosT * cosPhi - ry * sinT * sinPhi,
                y: cy + rx * cosT * sinPhi + ry * sinT * cosPhi
            )
            let derivative = CGPoint(
                x: -rx * sinT * cosPhi - ry * cosT * sinPhi,
                y: -rx * sinT * sinPhi + ry * cosT * cosPhi
            )
            return (point, derivative)
        }
        var t = theta1
        for i in 0..<segments {
            let (a, da) = onEllipse(t)
            let (b, db) = onEllipse(t + step)
            let c1 = CGPoint(x: a.x + k * da.x, y: a.y + k * da.y)
            let c2 = CGPoint(x: b.x - k * db.x, y: b.y - k * db.y)
            path.addCurve(to: i == segments - 1 ? p1 : b, control1: c1, control2: c2)
            t += step
        }
    }

    private struct Scanner {
        let bytes: [UInt8]
        var index = 0

        init(_ bytes: [UInt8]) { self.bytes = bytes }

        func peek() -> UInt8? { index < bytes.count ? bytes[index] : nil }

        static func isCommand(_ b: UInt8) -> Bool {
            switch b {
            case UInt8(ascii: "M"), UInt8(ascii: "m"), UInt8(ascii: "L"), UInt8(ascii: "l"),
                 UInt8(ascii: "H"), UInt8(ascii: "h"), UInt8(ascii: "V"), UInt8(ascii: "v"),
                 UInt8(ascii: "C"), UInt8(ascii: "c"), UInt8(ascii: "S"), UInt8(ascii: "s"),
                 UInt8(ascii: "Q"), UInt8(ascii: "q"), UInt8(ascii: "T"), UInt8(ascii: "t"),
                 UInt8(ascii: "A"), UInt8(ascii: "a"), UInt8(ascii: "Z"), UInt8(ascii: "z"):
                return true
            default:
                return false
            }
        }

        mutating func skipSeparators() {
            while let b = peek(), b == 32 || b == 44 || b == 9 || b == 10 || b == 13 { index += 1 }
        }

        /// An arc flag: a single 0 or 1, which may be packed against the next
        /// number ("a1 1 0 01 5 5").
        mutating func flag() -> Bool? {
            skipSeparators()
            guard let b = peek(), b == UInt8(ascii: "0") || b == UInt8(ascii: "1") else { return nil }
            index += 1
            return b == UInt8(ascii: "1")
        }

        mutating func number() -> CGFloat? {
            skipSeparators()
            let begin = index
            if let b = peek(), b == UInt8(ascii: "-") || b == UInt8(ascii: "+") { index += 1 }
            var sawDigit = false
            var sawDot = false
            while let b = peek() {
                if b >= 48 && b <= 57 {
                    sawDigit = true
                    index += 1
                } else if b == UInt8(ascii: "."), !sawDot {
                    sawDot = true
                    index += 1
                } else {
                    break
                }
            }
            if sawDigit, let b = peek(), b == UInt8(ascii: "e") || b == UInt8(ascii: "E") {
                var look = index + 1
                if look < bytes.count, bytes[look] == UInt8(ascii: "-") || bytes[look] == UInt8(ascii: "+") { look += 1 }
                if look < bytes.count, bytes[look] >= 48, bytes[look] <= 57 {
                    index = look
                    while let d = peek(), d >= 48 && d <= 57 { index += 1 }
                }
            }
            guard sawDigit, let text = String(bytes: bytes[begin..<index], encoding: .ascii), let value = Double(text) else {
                index = begin
                return nil
            }
            return CGFloat(value)
        }
    }
}
