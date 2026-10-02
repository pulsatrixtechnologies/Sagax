// The Sagax owl, as numbers: a port of `src/lib/owl/owl-art.ts` (palette,
// geometry, the pure pose and wing functions), `owl-skins.ts` (the special
// editions) and `owl-state.ts` (how the app's mascot states drive the owl).
//
// Pure and view-free so `swift test` reaches every value; the drawing is
// `OwlMascotView` in the app. Same names and the same numbers as the desktop,
// so the two can be read side by side.
import CoreGraphics
import Foundation

// MARK: - Palette

/// The owl's paint, one colour per part (`OwlPalette`), as `#RRGGBB`.
public struct OwlPalette: Equatable, Sendable {
    public var plumage: String
    public var wingNear: String
    public var socket: String
    public var cream: String
    public var grey: String
    public var greyDark: String
    public var iris: String
    public var pupil: String
    public var highlight: String

    /// `OWL_REFERENCE`: the colours sampled from the reference art.
    public static let reference = OwlPalette(
        plumage: "#252226", wingNear: "#141014", socket: "#110D11", cream: "#F6F1E8", grey: "#ACA09C",
        greyDark: "#464147", iris: "#F8CA48", pupil: "#0E0B0E", highlight: "#FBF8F2"
    )
}

public enum OwlArt {
    /// The white bot's plumage: a warm light grey so the cream face still reads.
    public static let whitePlumage = (plumage: "#CFCBC4", wingNear: "#A9A59E", socket: "#3A3836")
    /// The black bot's plumage: a lifted charcoal.
    public static let blackPlumage = (plumage: "#24252B", wingNear: "#141519", socket: "#08080A")
    /// A cool light edge around the black owl so it does not sink into a dark theme.
    public static let blackRim = RGBA(r: 196, g: 214, b: 255, a: 0.42)
    /// Below this rendered size the fine details (belly spots, skin effects) are dropped.
    public static let detailMinSize: CGFloat = 36
    public static let viewBox: CGFloat = 256

    // MARK: geometry

    public static let eye = CGPoint(x: OwlTrace.iris.x, y: OwlTrace.iris.y)
    public static let irisRadius = OwlTrace.iris.r
    public static let pupilRadius = OwlTrace.pupil.r
    public static let highlightRadius = OwlTrace.highlight.r
    /// The pupil stays inside the iris.
    public static let gazeMax = max(1, OwlTrace.iris.r - OwlTrace.pupil.r - 0.4)
    public static let lidTop = round2(OwlTrace.iris.y - OwlTrace.iris.r - 1)
    public static let lidHeight = OwlTrace.iris.r * 2 + 6
    /// Rest gaze: the reference's forward look, pupil pushed toward the beak.
    public static let gazeRest = CGPoint(x: OwlTrace.pupil.x - OwlTrace.iris.x, y: OwlTrace.pupil.y - OwlTrace.iris.y)
    public static let ground = CGPoint(x: 128, y: OwlTrace.ground)
    public static let shoulder = OwlTrace.shoulder
    /// The far wing's hinge, behind the chest on the side the owl faces.
    public static let farShoulder = CGPoint(x: 158, y: OwlTrace.shoulder.y)
    /// The far wing is the near wing mirrored about this x.
    public static let farMirrorX = (OwlTrace.shoulder.x + 158) / 2
    /// The highlight's centre, relative to the iris (it moves with the pupil).
    public static let highlightCenter = CGPoint(
        x: round2(OwlTrace.iris.x + OwlTrace.highlight.x - OwlTrace.pupil.x),
        y: round2(OwlTrace.iris.y + OwlTrace.highlight.y - OwlTrace.pupil.y)
    )
    /// The lid's clip: slightly larger than the iris.
    public static let lidClipRadius = round2(OwlTrace.iris.r + 0.3)
    /// How far each wing swings when fully open (degrees).
    public static let wingOpenDegrees = (near: CGFloat(108), far: CGFloat(-110))

    /// The lid path, in viewBox units.
    public static var lidPath: String {
        let ix = OwlTrace.iris.x, ir = OwlTrace.iris.r
        return "M\(fmt(round2(ix - ir - 3))) \(fmt(lidTop))H\(fmt(round2(ix + ir + 3)))V\(fmt(round2(lidTop + lidHeight * 0.8)))"
            + "Q\(fmt(ix)) \(fmt(round2(lidTop + lidHeight * 1.12))) \(fmt(round2(ix - ir - 3))) \(fmt(round2(lidTop + lidHeight * 0.8)))Z"
    }

    // MARK: colours

    /// Mix a colour toward black by `amount` (0...1).
    public static func shade(_ hex: String, _ amount: Double) -> String {
        let c = RGB(hex: hex)
        return RGB(r: c.r * (1 - amount), g: c.g * (1 - amount), b: c.b * (1 - amount)).hex
    }

    public static func isWhite(_ hex: String) -> Bool {
        let c = RGB(hex: hex)
        return c.r > 225 && c.g > 225 && c.b > 225
    }

    public static func isBlack(_ hex: String) -> Bool {
        let c = RGB(hex: hex)
        return c.r < 56 && c.g < 56 && c.b < 56
    }

    /// The rim light for a bot colour, or nil when its plumage needs none.
    public static func rim(_ hex: String) -> RGBA? {
        isBlack(RGB(hex: hex).hex) ? blackRim : nil
    }

    /// `owlPalette(color, "vivid")`: the bot colour as plumage, the near wing
    /// 30 % darker, the socket 70 % darker; white and black have their own.
    public static func palette(_ color: String) -> OwlPalette {
        let hex = RGB(hex: color).hex
        var p = OwlPalette.reference
        if isWhite(hex) {
            (p.plumage, p.wingNear, p.socket) = whitePlumage
        } else if isBlack(hex) {
            (p.plumage, p.wingNear, p.socket) = blackPlumage
        } else {
            p.plumage = hex
            p.wingNear = shade(hex, 0.3)
            p.socket = shade(hex, 0.7)
        }
        return p
    }

    /// The trace's dark-grey layer holds both the beak and the feet; the beak starts high.
    public static func isBeak(_ d: String) -> Bool {
        let parts = d.dropFirst().split(separator: " ")
        guard parts.count > 1, let y = Double(parts[1].prefix(while: { $0.isNumber || $0 == "." || $0 == "-" })) else { return false }
        return y < 170
    }

    public static func layer(_ role: OwlTraceRole) -> [String] {
        OwlTrace.layers.first { $0.role == role }?.d ?? []
    }

    // MARK: - Pose

    /// `owlPose`: state + time (s) -> transform parameters. `hop` scales the
    /// success hop (1 = the reference's 30 units).
    public static func pose(_ state: OwlState, _ t: Double, loop: Bool = true, hop: Double = 1) -> OwlPoseFrame {
        var pose = OwlPoseFrame()
        let tau = Double.pi * 2
        switch state {
        case .thinking:
            pose.tilt = 6 * sin(tau * t / 3.2)
            pose.gaze = CGPoint(x: 0.6, y: -0.8)
        case .working:
            pose.wing = 7 + 7 * sin(tau * 6 * t)
            pose.y = -3.5 * abs(sin(tau * 3 * t))
            pose.gaze = CGPoint(x: 0.85, y: 0.5)
        case .success:
            let period = 1.8
            let u = loop ? t.truncatingRemainder(dividingBy: period) : min(t, period)
            if !loop && t >= 1.1 { pose.done = true }
            if u < 0.14 {
                let k = sin(Double.pi / 2 * (u / 0.14))
                pose.sy = 1 - 0.12 * k
                pose.sx = 1 + 0.08 * k
            } else if u < 0.54 {
                let q = (u - 0.14) / 0.4
                pose.y = -30 * hop * 4 * q * (1 - q)
                pose.sy = 1 + 0.08 * (1 - q)
                pose.sx = 1 - 0.05 * (1 - q)
                pose.gaze = CGPoint(x: 0.6, y: -0.7)
            } else if u < 0.7 {
                let k = sin(Double.pi * ((u - 0.54) / 0.16))
                pose.sy = 1 - 0.14 * k
                pose.sx = 1 + 0.1 * k
            } else {
                let d = u - 0.7
                let w = exp(-d * 7) * sin(d * 26)
                pose.sy = 1 + 0.04 * w
                pose.sx = 1 - 0.03 * w
            }
            pose.lid = u > 0.54 && u < 1.2 ? 0.28 : 0
        case .alert:
            let period = 1.8
            let u = loop ? t.truncatingRemainder(dividingBy: period) : t
            if !loop && t >= 1.4 { pose.done = true }
            pose.eyeScale = 1 + 0.15 * easeOut(clamp(u / 0.12, 0, 1))
            pose.x = u < 0.6 ? 5 * sin(tau * 12 * u) * exp(-u * 5) : 0
            pose.gaze = CGPoint(x: 0.3, y: 0)
        case .sleepy:
            pose.lid = 0.55
            pose.sy = 1 + 0.02 * sin(tau * t / 4.6)
            pose.tilt = 2 + 2 * sin(tau * t / 4.6 - 0.6)
            pose.gaze = CGPoint(x: 0.5, y: 0.8)
        case .idle:
            pose.sy = 1 + 0.016 * sin(tau * t / 3.4)
        }
        return pose
    }

    /// The pose a still owl holds: success rests as idle, alert keeps wide eyes.
    public static func stillPose(_ state: OwlState, hop: Double = 1) -> OwlPoseFrame {
        switch state {
        case .success: return pose(.idle, 0, hop: hop)
        case .alert: return pose(.alert, 0.6, hop: hop)
        default: return pose(state, 0, hop: hop)
        }
    }

    /// `owlWingPose`: a wing move at time t (s).
    public static func wingPose(_ move: OwlWingMove, _ t: Double, hop: Double = 1) -> OwlWingFrame {
        let end = move.duration
        var f = OwlWingFrame(done: t >= end)
        if t >= end || t < 0 { return f }
        let tau = Double.pi * 2
        func envelope(_ t: Double, _ a: Double, _ b: Double, _ end: Double) -> Double { smooth(t / a) * smooth((end - t) / b) }
        switch move {
        case .spread:
            let e = envelope(t, 0.32, 0.42, end)
            f.open = e
            f.flap = 3 * sin(tau * 5 * t) * e
            f.sy = 1 + 0.03 * e
        case .flap:
            let e = envelope(t, 0.12, 0.25, end)
            let beat = 0.5 - 0.5 * cos(tau * 2.8 * t)
            f.open = e * (0.18 + 0.82 * beat)
            f.y = -5 * hop * e * (1 - beat)
        case .takeoff:
            if t < 0.22 {
                let k = sin(Double.pi / 2 * (t / 0.22))
                f.sy = 1 - 0.08 * k
                f.open = 0.2 * k
                break
            }
            let u = t - 0.22
            let e = envelope(u, 0.1, 0.35, end - 0.22)
            let beat = 0.5 - 0.5 * cos(tau * 3.6 * u)
            f.open = e * (0.25 + 0.75 * beat)
            let rise = smooth(u / 0.55) * smooth((end - 0.22 - u) / 0.6)
            f.y = -hop * (30 * rise + 3 * (1 - beat) * e)
            f.sy = 1 + 0.03 * e
        case .shake:
            let e = envelope(t, 0.08, 0.25, end)
            f.open = e * (0.3 + 0.12 * sin(tau * 13 * t))
            f.flap = 5 * sin(tau * 11 * t) * e
            f.x = 2.2 * sin(tau * 12 * t) * e
        case .hoot:
            func puff(_ a: Double) -> Double {
                max(0, sin(Double.pi * (t - a) / 0.42)) * (t > a && t < a + 0.42 ? 1 : 0)
            }
            let k = max(puff(0.1), puff(0.68))
            f.open = 0.34 * k
            f.sy = 1 + 0.06 * k
            f.y = -2 * k
        }
        return f
    }

    /// Gaze (gazeMax units) -> pupil offset in viewBox units. nil = rest look.
    public static func gazeOffset(_ gaze: CGPoint?) -> CGPoint {
        guard let gaze else { return gazeRest }
        var x = gaze.x, y = gaze.y
        let l = hypot(x, y)
        if l > 1 {
            x /= l
            y /= l
        }
        return CGPoint(x: x * gazeMax, y: y * gazeMax)
    }

    /// Success-hop amplitude for a rendered size: small list avatars hop less.
    public static func hop(forSize size: CGFloat) -> Double {
        if size <= 24 { return 0.35 }
        if size <= 44 { return 0.55 }
        if size <= 72 { return 0.8 }
        return 1
    }

    /// The rim's stroke in viewBox units: about 1.6 pt on screen, never thinner than 5 units.
    public static func rimWidth(_ size: CGFloat) -> CGFloat {
        (max(5, 1.6 * 256 / max(size, 1)) * 100).rounded() / 100
    }

    /// The near wing's rotation and scale for its flutter and spread.
    public static func nearWing(_ wing: Double, open: Double) -> (degrees: Double, scale: Double) {
        guard open > 0 else { return (wing, 1) }
        let k = clamp(open, 0, 1)
        return (wing + Double(wingOpenDegrees.near) * k, 1 + 0.14 * k)
    }

    /// The far wing (behind the body, mirrored); hidden while folded.
    public static func farWing(_ wing: Double, open: Double) -> (degrees: Double, scale: Double, visible: Bool) {
        let k = clamp(open, 0, 1)
        return (Double(wingOpenDegrees.far) * k - wing * 0.8, 0.92 + 0.2 * k, open > 0.02)
    }

    // MARK: helpers

    static func clamp(_ v: Double, _ a: Double, _ b: Double) -> Double { max(a, min(b, v)) }
    static func easeOut(_ u: Double) -> Double { 1 - (1 - u) * (1 - u) }
    static func smooth(_ u: Double) -> Double {
        let k = clamp(u, 0, 1)
        return k * k * (3 - 2 * k)
    }
    static func round2(_ v: CGFloat) -> CGFloat { (v * 100).rounded() / 100 }
    static func fmt(_ v: CGFloat) -> String {
        let s = String(format: "%.2f", Double(v))
        var t = s
        while t.contains(".") && (t.hasSuffix("0") || t.hasSuffix(".")) { t.removeLast() }
        return t
    }
}

/// A colour with alpha, for the rims and glows (`rgba(...)` on the desktop).
public struct RGBA: Equatable, Sendable {
    public var r: Double
    public var g: Double
    public var b: Double
    public var a: Double

    public init(r: Double, g: Double, b: Double, a: Double = 1) {
        self.r = r
        self.g = g
        self.b = b
        self.a = a
    }

    public init(hex: String, alpha: Double = 1) {
        let c = RGB(hex: hex)
        self.init(r: c.r, g: c.g, b: c.b, a: alpha)
    }
}

public enum OwlState: String, CaseIterable, Sendable {
    case idle, thinking, working, success, alert, sleepy

    public var isOneShot: Bool { self == .success || self == .alert }

    /// `owlStateForMaus`: a MausState (or a legacy/junk stored value) -> the
    /// owl state. success and alert are one-shots: they play when the bot
    /// enters the state, then the owl rests as idle.
    public static func forMaus(_ value: String?) -> OwlState {
        guard let normalized = MascotStates.normalize(value) else { return .idle }
        return mapping[normalized] ?? .idle
    }

    static let mapping: [String: OwlState] = [
        "working": .working, "loading": .working, "writing": .working, "dictating": .working,
        "sending": .working, "receiving": .working, "uploading": .working, "progress": .working,
        "orbit": .working, "humming": .working, "dragging": .working,
        "thinking": .thinking, "curious": .thinking, "searching": .thinking, "listening": .thinking,
        "confused": .thinking, "suspicious": .thinking, "radar": .thinking,
        "happy": .success, "proud": .success, "excited": .success, "celebrate": .success,
        "laughing": .success, "bouncing": .success,
        "alerting": .alert, "surprised": .alert, "scared": .alert, "angry": .alert, "notifying": .alert,
        "drowsy": .sleepy, "sleeping": .sleepy, "bored": .sleepy, "powering-down": .sleepy,
    ]
}

public enum OwlWingMove: String, CaseIterable, Sendable {
    case spread, flap, takeoff, shake, hoot

    /// `OWL_WING_MOVE_MS`, in seconds.
    public var duration: Double {
        switch self {
        case .spread: return 1.8
        case .flap: return 1.5
        case .takeoff: return 2.3
        case .shake: return 0.9
        case .hoot: return 1.3
        }
    }

    /// The app's wing motions (`MAUS_WING_MOTIONS`) by their desktop names.
    public init?(motion: String) {
        switch motion {
        case "spread-wings": self = .spread
        case "flap": self = .flap
        case "take-off": self = .takeoff
        case "shake": self = .shake
        case "hoot": self = .hoot
        default: return nil
        }
    }
}

public struct OwlPoseFrame: Equatable, Sendable {
    public var x: Double = 0
    public var y: Double = 0
    public var sx: Double = 1
    public var sy: Double = 1
    public var tilt: Double = 0
    public var wing: Double = 0
    /// 0 folded (the resting art) to 1 fully open.
    public var open: Double = 0
    public var eyeScale: Double = 1
    public var lid: Double = 0
    /// Gaze in gazeMax units; nil is the rest gaze.
    public var gaze: CGPoint?
    /// A one-shot finished; the caller returns to idle.
    public var done = false

    public init() {}
}

public struct OwlWingFrame: Equatable, Sendable {
    public var open: Double = 0
    public var flap: Double = 0
    public var x: Double = 0
    public var y: Double = 0
    public var sy: Double = 1
    public var done: Bool

    public init(done: Bool = false) { self.done = done }
}

/// `OwlBeat`: what a one-shot app motion does to the owl.
public struct OwlBeat: Equatable, Sendable {
    public var play: OwlState?
    public var blink = false
    public var wings: OwlWingMove?

    public init(play: OwlState? = nil, blink: Bool = false, wings: OwlWingMove? = nil) {
        self.play = play
        self.blink = blink
        self.wings = wings
    }

    /// `OWL_BEAT_OF`, keyed by the desktop's `MausMotion` names.
    public static let byMotion: [String: OwlBeat] = [
        "arrive": OwlBeat(play: .success),
        "switch": OwlBeat(blink: true),
        "customize": OwlBeat(play: .success, blink: true),
        "alert": OwlBeat(play: .alert),
        "thinking": OwlBeat(play: .thinking),
        "working": OwlBeat(play: .working),
        "launch": OwlBeat(play: .working, wings: .takeoff),
        "success": OwlBeat(play: .success, wings: .spread),
        "celebrate": OwlBeat(play: .success, wings: .flap),
        "blink": OwlBeat(blink: true),
        "surprise": OwlBeat(play: .alert, blink: true),
        "failure": OwlBeat(play: .sleepy),
        "spread-wings": OwlBeat(wings: .spread),
        "flap": OwlBeat(wings: .flap),
        "take-off": OwlBeat(wings: .takeoff),
        "shake": OwlBeat(blink: true, wings: .shake),
        "hoot": OwlBeat(blink: true, wings: .hoot),
    ]

    public static func forMotion(_ motion: String?) -> OwlBeat? {
        guard let motion, motion != "none" else { return nil }
        return byMotion[motion]
    }

    /// How long a held beat (thinking/working/sleepy) lasts, in seconds.
    public static let heldDuration: Double = 1.4
}

// MARK: - Skins

/// `OwlSkinLook`: aura, eye glow and rim of a skin.
public struct OwlSkinLook: Equatable, Sendable {
    public var aura: (color: String, strength: Double)?
    public var eyeGlow: String?
    public var rim: RGBA?

    public static func == (a: OwlSkinLook, b: OwlSkinLook) -> Bool {
        a.aura?.color == b.aura?.color && a.aura?.strength == b.aura?.strength && a.eyeGlow == b.eyeGlow && a.rim == b.rim
    }
}

public enum OwlSkins {
    /// The glow of a skin that burns in the bot's own colour (neon): lifted
    /// toward white; black and white glow electric cyan.
    public static func accent(_ hex: String) -> String {
        if OwlArt.isBlack(hex) || OwlArt.isWhite(hex) { return "#22D3EE" }
        return tint(hex, toward: "#FFFFFF", 0.3)
    }

    static func tint(_ hex: String, toward: String, _ t: Double) -> String {
        let a = RGB(hex: hex), b = RGB(hex: toward)
        return RGB(r: a.r * (1 - t) + b.r * t, g: a.g * (1 - t) + b.g * t, b: a.b * (1 - t) + b.b * t).hex
    }

    /// `owlSkinPalette`: the palette a skin paints the traced owl with.
    public static func palette(_ skin: MascotSkin, base: OwlPalette, hex: String) -> OwlPalette {
        var p = base
        switch skin {
        case .none:
            break
        case .lightning:
            p.iris = "#D9F7FF"; p.pupil = "#0A1A2E"; p.highlight = "#FFFFFF"
        case .gold:
            p.plumage = "#E2AE34"; p.wingNear = "#B07A12"; p.socket = "#4A3106"; p.cream = "#FFF3CF"
            p.grey = "#C9994A"; p.greyDark = "#6B4A10"; p.iris = "#FFE27A"; p.pupil = "#2A1A02"
        case .neon:
            let a = accent(hex)
            p.plumage = "#11131F"; p.wingNear = "#0B0C15"; p.socket = "#05060B"; p.cream = "#21253A"
            p.grey = a; p.greyDark = "#2B2F45"; p.iris = a; p.pupil = "#05060B"
        case .inferno:
            p.plumage = "#2E0F0A"; p.wingNear = "#1D0805"; p.socket = "#120302"; p.cream = "#FFE0B8"
            p.grey = "#FF7A2E"; p.greyDark = "#3D1A10"; p.iris = "#FF8A1F"; p.pupil = "#1A0500"; p.highlight = "#FFF4D0"
        case .frost:
            p.plumage = "#A7D8F2"; p.wingNear = "#6FA9D4"; p.socket = "#1D4868"; p.cream = "#F4FBFF"
            p.grey = "#86B8D8"; p.greyDark = "#4E7C9C"; p.iris = "#C8F3FF"; p.pupil = "#0B2536"
        case .carbon:
            p.plumage = "#2A2C31"; p.wingNear = "#1A1B1F"; p.socket = "#0A0A0C"; p.greyDark = "#4A4C53"; p.iris = "#F8CA48"
        }
        return p
    }

    /// `owlSkinLook`.
    public static func look(_ skin: MascotSkin, hex: String) -> OwlSkinLook {
        switch skin {
        case .none:
            return OwlSkinLook()
        case .lightning:
            return OwlSkinLook(aura: ("#38BDF8", 0.55), eyeGlow: "#7DD3FC", rim: RGBA(r: 186, g: 230, b: 253, a: 0.55))
        case .gold:
            return OwlSkinLook(aura: ("#FBBF24", 0.45), eyeGlow: nil, rim: RGBA(r: 255, g: 226, b: 140, a: 0.6))
        case .neon:
            let a = accent(hex)
            return OwlSkinLook(aura: (a, 0.45), eyeGlow: a, rim: RGBA(hex: a))
        case .inferno:
            return OwlSkinLook(aura: ("#F97316", 0.6), eyeGlow: "#FB923C", rim: RGBA(r: 251, g: 146, b: 60, a: 0.7))
        case .frost:
            return OwlSkinLook(aura: ("#7DD3FC", 0.5), eyeGlow: "#E0F7FF", rim: RGBA(r: 186, g: 236, b: 255, a: 0.75))
        case .carbon:
            return OwlSkinLook(aura: nil, eyeGlow: nil, rim: RGBA(r: 200, g: 210, b: 225, a: 0.4))
        }
    }

    // MARK: lightning

    /// `rng` in owl-skins.ts (mulberry32), bit for bit: the bolts must be the
    /// same shape on the phone as on the desktop.
    struct Mulberry32 {
        var a: UInt32
        mutating func next() -> Double {
            a = a &+ 0x6D2B_79F5
            var t = a
            t = (t ^ (t >> 15)) &* (t | 1)
            t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
            return Double(t ^ (t >> 14)) / 4_294_967_296
        }
    }

    /// `owlBolt`: a jagged bolt along a quadratic curve from `a` to `b`
    /// (bent toward `c`), with one short fork. SVG path data.
    public static func bolt(_ a: CGPoint, _ c: CGPoint, _ b: CGPoint, seed: UInt32, jag: Double = 7, steps: Int = 9) -> String {
        var rand = Mulberry32(a: seed)
        var pts: [(Double, Double)] = []
        for i in 0...steps {
            let t = Double(i) / Double(steps)
            let x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x
            let y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y
            let tx = 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x)
            let ty = 2 * (1 - t) * (c.y - a.y) + 2 * t * (b.y - c.y)
            let len = hypot(tx, ty) == 0 ? 1 : hypot(tx, ty)
            let kick = i == 0 || i == steps ? 0 : (rand.next() * 2 - 1) * jag
            pts.append((Double(x) + Double(-ty / len) * kick, Double(y) + Double(tx / len) * kick))
        }
        // Math.round: halves go up, toward +infinity
        func r1(_ v: Double) -> String { jsNumber((v * 10 + 0.5).rounded(.down) / 10) }
        var d = "M\(r1(pts[0].0)) \(r1(pts[0].1))" + pts.dropFirst().map { "L\(r1($0.0)) \(r1($0.1))" }.joined()
        let at = pts[steps / 2]
        let dir: Double = rand.next() > 0.5 ? 1 : -1
        let fx = at.0 + (rand.next() * 10 + 8) * dir
        let fy = at.1 + (rand.next() * 10 + 6) * (rand.next() > 0.5 ? 1 : -1)
        let mx = (at.0 + fx) / 2 + (rand.next() * 6 - 3)
        let my = (at.1 + fy) / 2 + (rand.next() * 6 - 3)
        d += "M\(r1(at.0)) \(r1(at.1))L\(r1(mx)) \(r1(my))L\(r1(fx)) \(r1(fy))"
        return d
    }

    /// A number as JavaScript prints it: no trailing ".0".
    static func jsNumber(_ v: Double) -> String {
        if v == v.rounded() && abs(v) < 1e15 { return String(Int(v)) }
        return String(v)
    }

    /// Arcs crackling just outside the silhouette; each flickers on its own clock.
    public static let lightningArcs: [(d: String, duration: Double, delay: Double)] = [
        (bolt(CGPoint(x: 44, y: 104), CGPoint(x: 22, y: 40), CGPoint(x: 112, y: 10), seed: 11), 1.5, 0),
        (bolt(CGPoint(x: 176, y: 8), CGPoint(x: 236, y: 14), CGPoint(x: 226, y: 86), seed: 23), 1.9, 0.55),
        (bolt(CGPoint(x: 30, y: 150), CGPoint(x: 2, y: 196), CGPoint(x: 50, y: 238), seed: 37), 1.3, 0.9),
        (bolt(CGPoint(x: 224, y: 138), CGPoint(x: 252, y: 190), CGPoint(x: 200, y: 238), seed: 41), 2.1, 0.3),
        (bolt(CGPoint(x: 86, y: 254), CGPoint(x: 128, y: 266), CGPoint(x: 178, y: 250), seed: 53, jag: 5), 1.7, 1.2),
        (bolt(CGPoint(x: 16, y: 70), CGPoint(x: 4, y: 110), CGPoint(x: 22, y: 140), seed: 67, jag: 6, steps: 6), 2.5, 0.75),
    ]

    /// Short arcs crawling over the plumage (clipped to the silhouette).
    public static let lightningCrawl: [(d: String, duration: Double, delay: Double)] = [
        (bolt(CGPoint(x: 62, y: 120), CGPoint(x: 90, y: 170), CGPoint(x: 80, y: 222), seed: 71, jag: 6, steps: 7), 2.4, 0.5),
        (bolt(CGPoint(x: 120, y: 30), CGPoint(x: 100, y: 60), CGPoint(x: 70, y: 70), seed: 83, jag: 5, steps: 6), 2.9, 1.6),
    ]
}
