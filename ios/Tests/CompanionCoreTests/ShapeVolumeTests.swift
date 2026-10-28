import CoreGraphics
import Foundation
import XCTest
@testable import CompanionCore

/// The shapes in volume on the phone are the desktop's: Fixtures/shape-volume.json
/// holds what shape-volume.ts and shape-motion.ts compute (src/components/
/// ios-mascot-export.test.ts): the slices' matrices for every detail, three
/// poses and four depths, the bent outlines and the styled eyes, the inks,
/// the ground, and each mood's poses over twelve seconds with a mood change,
/// a pointer and a tap.
final class ShapeVolumeTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Pose: Decodable { let yaw, pitch, roll, scale, lift: Double }
        struct Matrices: Decodable {
            let detail, pose: String
            let depth: Double
            let slices: [String]
            let face, eyes, eyesClip: String
        }
        struct Motion3: Decodable { let x, y, rot, sx, sy: Double }
        struct Warp: Decodable {
            let shape, expression, pose, style: String
            let open: Double
            let motion: Motion3
            let body, eyes, flatEyes: String
            let stem: String?
        }
        struct Ink: Decodable { let hex, fill, eyes: String; let edge: String? }
        struct Step: Decodable { let t: Double; let pose: Pose }
        struct Motion: Decodable { let mood: String; let seed: Double; let poses: [Step] }
        let matrices: [Matrices]
        let warps: [Warp]
        let ground: [String: Double]
        let inks: [Ink]
        let upright: Pose
        let motion: [Motion]
    }

    static let poses: [String: ShapePose] = [
        "rest": ShapeVolumeData.rest,
        "turned": ShapePose(yaw: 28, pitch: 18, roll: 8, scale: ShapeVolumeData.rest.scale, lift: ShapeVolumeData.rest.lift),
        "away": ShapePose(yaw: -22, pitch: -6, roll: -14, scale: 0.79, lift: -3.1),
    ]

    private func fixture() throws -> Fixture {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "shape-volume", withExtension: "json", subdirectory: "Fixtures"))
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    private static let number = try! NSRegularExpression(pattern: #"-?[0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?"#)

    static func numbers(_ text: String) -> [Double] {
        let range = NSRange(text.startIndex..., in: text)
        return number.matches(in: text, range: range).compactMap { Range($0.range, in: text).flatMap { Double(text[$0]) } }
    }

    private func assertMatrix(_ t: CGAffineTransform, _ svg: String, _ message: String, file: StaticString = #filePath, line: UInt = #line) {
        let want = Self.numbers(svg)
        let got = svg.hasPrefix("translate") ? [Double(t.tx), Double(t.ty)] : [t.a, t.b, t.c, t.d, t.tx, t.ty].map(Double.init)
        XCTAssertEqual(got.count, want.count, message, file: file, line: line)
        for (a, b) in zip(got, want) { XCTAssertEqual(a, b, accuracy: 1e-3, message, file: file, line: line) }
    }

    private func assertPath(_ swift: String, _ desktop: String, tolerance: Double = 0.04, _ message: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(swift.filter(\.isLetter), desktop.filter(\.isLetter), "\(message): commands", file: file, line: line)
        let a = Self.numbers(swift), b = Self.numbers(desktop)
        XCTAssertEqual(a.count, b.count, "\(message): number count", file: file, line: line)
        guard a.count == b.count else { return }
        let worst = zip(a, b).map { abs($0 - $1) }.max() ?? 0
        XCTAssertLessThanOrEqual(worst, tolerance, "\(message): largest difference", file: file, line: line)
    }

    func testTheSlicesFaceAndEyesMatricesAreTheDesktops() throws {
        let fixture = try fixture()
        XCTAssertEqual(fixture.matrices.count, 3 * 3 * 4)
        for entry in fixture.matrices {
            let detail = try XCTUnwrap(ShapeVolumeDetail(rawValue: entry.detail))
            let pose = try XCTUnwrap(Self.poses[entry.pose])
            let m = ShapeVolume.matrices(detail, pose, depth: entry.depth)
            let name = "\(entry.detail) \(entry.pose) \(entry.depth)"
            XCTAssertEqual(m.slices.count, entry.slices.count, name)
            for (t, svg) in zip(m.slices, entry.slices) { assertMatrix(t, svg, "\(name) slice") }
            assertMatrix(m.face, entry.face, "\(name) face")
            assertMatrix(m.eyes, entry.eyes, "\(name) eyes")
            assertMatrix(m.eyesClip, entry.eyesClip, "\(name) eyes clip")
        }
    }

    func testTheBentOutlineAndTheStyledEyesAreTheDesktops() throws {
        for entry in try fixture().warps {
            let shape = try XCTUnwrap(MascotShape(rawValue: entry.shape))
            let face = try XCTUnwrap(ShapeExpression(rawValue: entry.expression))
            let pose = try XCTUnwrap(Self.poses[entry.pose])
            let style = try XCTUnwrap(ShapeEyeStyle(rawValue: entry.style))
            let frame = ShapeFrames.still(shape, face, color: "#000000", open: entry.open)
            let body = try XCTUnwrap(ShapeOutline(points: frame.body))
            let eyes = frame.eyes.compactMap { ShapeOutline(points: $0) }
            let name = "\(entry.shape) \(entry.expression) \(entry.pose) \(entry.style)"
            assertPath(ShapeVolume.warp(body, pose).d, entry.body, "\(name) body")
            let m = entry.motion
            assertPath(ShapeVolume.d(ShapeVolume.eyesOnPose(frame, pose, style: style, motion: (m.x, m.y, m.rot, m.sx, m.sy))), entry.eyes, tolerance: 0.06, "\(name) eyes")
            XCTAssertEqual(frame.stem == nil, entry.stem == nil, "\(name) stem")
            if let stem = frame.stem, let wanted = entry.stem, let outline = ShapeOutline(points: stem.points) {
                assertPath(ShapeVolume.warp(outline, pose).d, wanted, "\(name) stem")
            }
            assertPath(ShapeVolume.d(ShapeVolume.styledEyes(eyes, style)), entry.flatEyes, tolerance: 0.06, "\(name) flat eyes")
        }
    }

    func testTheInksTheGroundAndTheUprightPoseAreTheDesktops() throws {
        let fixture = try fixture()
        for ink in fixture.inks {
            let paint = ShapeVolume.ink(ink.hex)
            XCTAssertEqual(paint.fill, ink.fill.lowercased(), ink.hex)
            XCTAssertEqual(paint.edge, ink.edge, ink.hex)
            XCTAssertEqual(paint.eyes, ink.eyes, ink.hex)
        }
        XCTAssertEqual(Set(fixture.ground.keys), Set(MascotShape.allCases.map(\.rawValue)))
        for (shape, lift) in fixture.ground {
            XCTAssertEqual(ShapeVolume.groundLift(try XCTUnwrap(MascotShape(rawValue: shape))), lift, accuracy: 1e-9, shape)
        }
        let upright = ShapeVolume.upright(try XCTUnwrap(Self.poses["away"]))
        XCTAssertEqual(upright.yaw, fixture.upright.yaw)
        XCTAssertEqual(upright.pitch, fixture.upright.pitch)
        XCTAssertEqual(upright.roll, fixture.upright.roll)
    }

    func testEveryMoodMovesAsOnTheDesktopThroughAMoodChangeAPointerAndATap() throws {
        let fixture = try fixture()
        XCTAssertEqual(Set(fixture.motion.map(\.mood)), Set(ShapeMotionMood.allCases.map(\.rawValue)))
        for entry in fixture.motion {
            let mood = try XCTUnwrap(ShapeMotionMood(rawValue: entry.mood))
            let run = ShapeMotion(mood, seed: entry.seed, start: 0)
            for (k, step) in entry.poses.enumerated() {
                if k == 20 { run.setMood(mood == .working ? .idle : .working, now: step.t) }
                if k == 30 { run.pointer(CGPoint(x: 0.8, y: -0.5)) }
                if k == 40 { run.pointer(nil) }
                if k == 45 { run.pokeAt(step.t) }
                let pose = run.pose(step.t)
                let name = "\(entry.mood) t=\(step.t)"
                XCTAssertEqual(pose.yaw, step.pose.yaw, accuracy: 1e-6, "\(name) yaw")
                XCTAssertEqual(pose.pitch, step.pose.pitch, accuracy: 1e-6, "\(name) pitch")
                XCTAssertEqual(pose.roll, step.pose.roll, accuracy: 1e-6, "\(name) roll")
                XCTAssertEqual(pose.scale, step.pose.scale, accuracy: 1e-9, "\(name) scale")
                XCTAssertEqual(pose.lift, step.pose.lift, accuracy: 1e-6, "\(name) lift")
            }
        }
    }

    func testEveryShapeMoodHasAMotionAndEyes() {
        for mood in ShapeMood.allCases {
            XCTAssertNotNil(ShapeVolumeData.moodMotion[mood], mood.rawValue)
            XCTAssertNotNil(ShapeVolumeData.moodEyes[mood], mood.rawValue)
        }
        XCTAssertEqual(ShapeMood.working.motion, .working)
        XCTAssertEqual(ShapeMood.happy.motion, .done)
        XCTAssertEqual(ShapeVolume.eyeStyle(.streaming), .oval)
        XCTAssertEqual(ShapeVolume.eyeStyle(.happy), .arc)
        XCTAssertEqual(ShapeVolume.eyeStyle(.idle), .capsule)
    }
}

/// A move that shrinks a shape's body (thinking's dots, sleep, alert and
/// exclaim's bar, burst, comet) must still draw one solid body: its slices
/// thin with it (`ShapeFrame.depth`, #1106). The phone's own frames and
/// matrices are measured the way the desktop's shape-volume.depth.test.ts
/// measures them: how far the slices' and the face's middles spread, against
/// the body's thinnest half-width (about 0.4 at rest), for every shape, every
/// move and every size the app draws a shape at, in two poses.
final class ShapeVolumeDepthTests: XCTestCase {
    /// Every size a shape is drawn at on the phone (lists, chips, headers, panel, editor, gallery, call bar).
    static let sizes: [Double] = [14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 38, 42, 44, 46, 52, 56, 64, 85, 96, 104, 112, 120, 142, 160, 220, 256]
    static let poses: [ShapePose] = [ShapeVolumeData.rest, ShapePose(yaw: 28, pitch: 18, roll: 8, scale: ShapeVolumeData.rest.scale, lift: ShapeVolumeData.rest.lift)]
    static let shrinking: [ShapeMove] = [.thinking, .sleep, .alert, .exclaim, .burst, .comet]

    private func midMove(_ shape: MascotShape, _ move: ShapeMove) -> ShapeFrame {
        let run = ShapeEngine(ShapeEngineState(shape: shape, expression: .neutral, color: "#F4F4F4"), now: 0, seed: 1)
        run.play(move, now: 0)
        let timing = ShapeEngineData.moveTiming[move]!
        // the move fully in, before it slides back
        return run.frame(min(timing.duration, timing.morph + 0.6))
    }

    private func thinnest(_ frame: ShapeFrame) -> Double {
        frame.body.map { hypot(Double($0.x) - 50, Double($0.y) - 50) }.min() ?? 0
    }

    /// How far the slices spread against the body's thinnest half-width, as the phone draws them.
    private func smear(_ frame: ShapeFrame, size: Double, pose: ShapePose) -> Double {
        let m = ShapeVolume.matrices(.of(size), pose, depth: frame.depth)
        let centres = (m.slices + [m.face]).map { CGPoint(x: 50, y: 50).applying($0) }
        XCTAssertGreaterThan(centres.count, 2)
        var spread = 0.0
        for p in centres { for q in centres { spread = max(spread, hypot(Double(p.x - q.x), Double(p.y - q.y))) } }
        return spread / (thinnest(frame) * pose.scale)
    }

    func testFullDepthForAThickBodyThinnerForAThinOneAndThinWithABodyShrunkToADotOrABar() {
        for shape in MascotShape.allCases {
            let thinnest = ShapeEngineData.radii[shape]!.min()!
            XCTAssertEqual(ShapeFrames.still(shape, .neutral).depth, min(1, thinnest / ShapeEngineData.depthFull), accuracy: 1e-12, shape.rawValue)
            XCTAssertLessThan(midMove(shape, .thinking).depth, 0.35, shape.rawValue)
            XCTAssertGreaterThan(midMove(shape, .egg).depth, 0.6, shape.rawValue)
        }
        XCTAssertEqual(ShapeFrames.bodyDepth([ShapeEngineData.depthFull / 2, ShapeEngineData.depthFull / 2]), 0.5)
        XCTAssertEqual(ShapeFrames.bodyDepth([2, 2]), 1)
    }

    func testTheRestingShapesDrawAsOneBody() {
        for shape in MascotShape.allCases {
            let frame = ShapeFrames.still(shape, .neutral)
            for size in Self.sizes {
                for pose in Self.poses { XCTAssertLessThan(smear(frame, size: size, pose: pose), 0.75, "\(shape.rawValue) \(size) pt") }
            }
        }
    }

    func testADotABarOrASpeckNeverComesApartDuringAMove() {
        for shape in MascotShape.allCases {
            for move in Self.shrinking {
                let frame = midMove(shape, move)
                for size in Self.sizes {
                    for pose in Self.poses { XCTAssertLessThan(smear(frame, size: size, pose: pose), 0.75, "\(shape.rawValue) \(move.rawValue) \(size) pt") }
                }
            }
        }
    }

    func testEveryMoveKeepsTheBodyTogetherAllAlongIt() {
        for shape in MascotShape.allCases {
            for move in ShapeMove.allCases {
                let run = ShapeEngine(ShapeEngineState(shape: shape, expression: .neutral, color: "#F4F4F4"), now: 0, seed: 2)
                run.play(move, now: 0)
                let length = ShapeMoves.length(move)
                for step in 0...12 {
                    let frame = run.frame(length * Double(step) / 12)
                    XCTAssertLessThan(smear(frame, size: 112, pose: Self.poses[1]), 0.75, "\(shape.rawValue) \(move.rawValue) at \(step)/12")
                }
            }
        }
    }

    func testWithTheRestingDepthAThoughtDotWouldComeApart() {
        // the measure catches the bug #1106 fixed: the slices at full depth on a dot
        let frame = midMove(.pill, .thinking)
        var full = frame
        full.depth = 1
        XCTAssertGreaterThan(smear(full, size: 44, pose: ShapeVolumeData.rest), 0.75)
        XCTAssertLessThan(smear(frame, size: 44, pose: ShapeVolumeData.rest), 0.75)
    }
}
