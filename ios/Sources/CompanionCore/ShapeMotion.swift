// The shapes' motion library on the phone: a port of the desktop's
// `src/components/shape-motion.ts` (2026-10-18), its numbers generated into
// `ShapeVolumeData` and its poses checked against the desktop's
// (Fixtures/shape-volume.json, ShapeVolumeTests).
//
// - At rest a shape sits on its base: it holds a pose still, then turns to a
//   new one over `glance.move` s and holds it, and breathes from the base;
//   busy moods use continuous loops, each a sum of three sines (loopNoise).
// - A change of mood slides every number over `motionBlend` s (smoothstep).
// - A pointer near the mascot turns the body a little toward it; a tap gives
//   a quick squash and hop (`poke`).
// - Every mascot has its own seed, so two of them never move in step.
// - Pure functions of time: the live loop and the tests draw the same pose
//   for the same t.
import CoreGraphics
import Foundation

/// One mood's motion (`MotionSpec`).
public struct ShapeMotionSpec: Sendable {
    public typealias Triple = (yaw: Double, pitch: Double, roll: Double)
    public var sway: Triple
    public var period: Triple
    public var lean: Triple
    public var breath: (amount: Double, period: Double)
    public var bob: (amount: Double, period: Double)
    /// How much of the sway is "settle and glance" (1) rather than a loop (0).
    public var settle: Double

    public init(sway: Triple, period: Triple, lean: Triple, breath: (amount: Double, period: Double), bob: (amount: Double, period: Double), settle: Double) {
        self.sway = sway
        self.period = period
        self.lean = lean
        self.breath = breath
        self.bob = bob
        self.settle = settle
    }

    func mixed(_ b: ShapeMotionSpec, _ t: Double) -> ShapeMotionSpec {
        func m(_ x: Double, _ y: Double) -> Double { x + (y - x) * t }
        func mix3(_ x: Triple, _ y: Triple) -> Triple { (m(x.yaw, y.yaw), m(x.pitch, y.pitch), m(x.roll, y.roll)) }
        return ShapeMotionSpec(sway: mix3(sway, b.sway), period: mix3(period, b.period), lean: mix3(lean, b.lean),
                               breath: (m(breath.amount, b.breath.amount), m(breath.period, b.breath.period)),
                               bob: (m(bob.amount, b.bob.amount), m(bob.period, b.bob.period)), settle: m(settle, b.settle))
    }
}

public enum ShapeMotionMath {
    /// A value kept inside [min, max] with a smooth knee (`softLimit`).
    public static func softLimit(_ v: Double, _ lo: Double, _ hi: Double) -> Double {
        let mid = (lo + hi) / 2, half = (hi - lo) / 2
        return mid + half * tanh((v - mid) / half)
    }

    static func smooth(_ t: Double) -> Double {
        let x = min(1, max(0, t))
        return x * x * (3 - 2 * x)
    }

    /// The pose at a phase (in cycles) of a mood, with a seed (`poseAt`).
    public static func poseAt(_ motion: ShapeMotionSpec, phase: (yaw: Double, pitch: Double, roll: Double, breath: Double, bob: Double), seed: Double,
                              glance: ShapeMotionSpec.Triple = (0, 0, 0)) -> ShapePose {
        func n(_ p: Double, _ s: Double) -> Double { ShapeIdle.loopNoise(p, 1, s) }
        let w = motion.settle
        func swing(_ loop: Double, _ held: Double) -> Double { loop * (1 - w) + held * w }
        let rest = ShapeVolumeData.rest
        let breath = 1 + motion.breath.amount * sin(phase.breath * Double.pi * 2)
        return ShapePose(
            yaw: rest.yaw + motion.lean.yaw + motion.sway.yaw * swing(n(phase.yaw, seed), glance.yaw),
            pitch: rest.pitch + motion.lean.pitch + motion.sway.pitch * swing(n(phase.pitch, seed * 1.7 + 0.4), glance.pitch),
            roll: rest.roll + motion.lean.roll + motion.sway.roll * swing(n(phase.roll, seed * 2.3 + 1.1), glance.roll),
            scale: rest.scale * breath,
            // the breath swells from the base: the bottom stays on its ground, only the top rises
            lift: rest.lift - motion.bob.amount * (0.5 - 0.5 * cos(phase.bob * Double.pi * 2)) - (breath - 1) * rest.scale * ShapeVolumeData.baseDrop
        )
    }
}

/// The phase of a loop whose period may slide: integrated over time, so a
/// change of period never makes the body jump.
private struct ShapePhase {
    var value = 0.0
    var last: Double?

    mutating func step(_ t: Double, _ period: Double) -> Double {
        if let last { value += max(0, t - last) / max(0.2, period) }
        last = t
        return value
    }
}

/// One mascot's motion: its mood (sliding), the pointer's pull and a tap, on one clock (s).
public final class ShapeMotion {
    public let seed: Double
    private var from: ShapeMotionSpec
    private var to: ShapeMotionSpec
    private var at = -Double.infinity
    public private(set) var mood: ShapeMotionMood
    private var yaw = ShapePhase(), pitch = ShapePhase(), roll = ShapePhase(), breath = ShapePhase(), bob = ShapePhase()
    private var turn = (yaw: 0.0, pitch: 0.0)
    private var target = (yaw: 0.0, pitch: 0.0)
    private var poke = -Double.infinity
    private var last: Double?
    private let glanceRandom: () -> Double
    private var glanceFrom: ShapeMotionSpec.Triple = (0, 0, 0)
    private var glanceTo: ShapeMotionSpec.Triple = (0, 0, 0)
    private var glanceAt = -Double.infinity
    private var nextGlance: Double

    private static func spec(_ mood: ShapeMotionMood) -> ShapeMotionSpec { ShapeVolumeData.motions[mood] ?? ShapeVolumeData.motions[.idle]! }

    public init(_ mood: ShapeMotionMood, seed: Double, start: Double = 0) {
        self.mood = mood
        self.seed = seed
        from = Self.spec(mood)
        to = Self.spec(mood)
        // each mascot starts somewhere else in its cycles (the same order as the desktop's phases)
        let random = ShapeIdle.seededRandom(seed + 3.1)
        yaw.value = random() * 10
        pitch.value = random() * 10
        roll.value = random() * 10
        breath.value = random() * 10
        bob.value = random() * 10
        last = start
        glanceRandom = ShapeIdle.seededRandom(seed + 7.7)
        let g = ShapeVolumeData.glance
        nextGlance = 0
        glanceTo = pickGlance()
        glanceFrom = glanceTo
        nextGlance = start + g.holdMin + glanceRandom() * (g.holdMax - g.holdMin)
    }

    public func setMood(_ next: ShapeMotionMood, now: Double) {
        guard next != mood else { return }
        from = specAt(now)
        to = Self.spec(next)
        at = now
        mood = next
    }

    /// The pointer around the mascot (-1...1 each axis), or nil.
    public func pointer(_ p: CGPoint?) {
        guard let p else {
            target = (0, 0)
            return
        }
        let t = ShapeVolumeData.turnToward
        target = (t.yaw * max(-1, min(1, Double(p.x))), -t.pitch * max(-1, min(1, Double(p.y))))
    }

    public func pokeAt(_ now: Double) { poke = now }

    private func pickGlance() -> ShapeMotionSpec.Triple {
        func r() -> Double { glanceRandom() * 2 - 1 }
        var next: ShapeMotionSpec.Triple = (r(), r(), r())
        var i = 0
        while i < 4, abs(next.yaw - glanceTo.yaw) < 0.5 {
            next = (r(), r(), r())
            i += 1
        }
        return next
    }

    private func glanceNow(_ now: Double) -> ShapeMotionSpec.Triple {
        if now >= nextGlance {
            let g = ShapeVolumeData.glance
            glanceFrom = glanceNowAt(now)
            glanceTo = pickGlance()
            glanceAt = now
            nextGlance = now + g.move + g.holdMin + glanceRandom() * (g.holdMax - g.holdMin)
        }
        return glanceNowAt(now)
    }

    private func glanceNowAt(_ now: Double) -> ShapeMotionSpec.Triple {
        let u = min(1, max(0, (now - glanceAt) / ShapeVolumeData.glance.move))
        // smootherstep: leaves and lands with no jolt, then holds still
        let k = u * u * u * (u * (u * 6 - 15) + 10)
        func m(_ a: Double, _ b: Double) -> Double { a + (b - a) * k }
        return (m(glanceFrom.yaw, glanceTo.yaw), m(glanceFrom.pitch, glanceTo.pitch), m(glanceFrom.roll, glanceTo.roll))
    }

    private func specAt(_ now: Double) -> ShapeMotionSpec {
        let k = ShapeMotionMath.smooth((now - at) / ShapeVolumeData.motionBlend)
        return k >= 1 ? to : from.mixed(to, k)
    }

    /// The pose at `now` (`ShapeMotion.pose`).
    public func pose(_ now: Double) -> ShapePose {
        let dt = last.map { min(0.1, max(0, now - $0)) } ?? 0
        last = now
        let motion = specAt(now)
        let phase = (
            yaw: yaw.step(now, motion.period.yaw),
            pitch: pitch.step(now, motion.period.pitch),
            roll: roll.step(now, motion.period.roll),
            breath: breath.step(now, motion.breath.period),
            bob: bob.step(now, motion.bob.period)
        )
        let k = 1 - exp(-dt * 4.6 / ShapeVolumeData.turnToward.settle)
        turn.yaw += (target.yaw - turn.yaw) * k
        turn.pitch += (target.pitch - turn.pitch) * k
        var pose = ShapeMotionMath.poseAt(motion, phase: phase, seed: seed, glance: glanceNow(now))
        // a shape stays upright enough to read at every moment
        pose.roll = ShapeMotionMath.softLimit(pose.roll, ShapeVolumeData.rollLimit.min, ShapeVolumeData.rollLimit.max)
        pose.yaw += turn.yaw
        pose.pitch += turn.pitch
        let p = ShapeVolumeData.poke
        let u = (now - poke) / p.length
        if u >= 0, u <= 1 {
            // squash on the way down, a hop and a little spin, then settle
            let squash = sin(min(1, u * 3) * Double.pi) * (u < 0.33 ? 1 : 0)
            let hop = u > 0.25 ? sin((u - 0.25) / 0.75 * Double.pi) : 0
            pose.scale *= 1 - p.squash * squash
            pose.lift -= p.hop * hop
            pose.roll += p.spin * hop
        }
        return pose
    }
}

public extension ShapeMood {
    /// `motionForMood`.
    var motion: ShapeMotionMood { ShapeVolumeData.moodMotion[self] ?? .idle }
}
