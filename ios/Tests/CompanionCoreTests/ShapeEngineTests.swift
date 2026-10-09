import CoreGraphics
import Foundation
import XCTest
@testable import CompanionCore

/// The Shapes engine on the phone draws what the desktop's engine draws:
/// Fixtures/shape-frames.json holds frames from `stillFrame` and
/// `ShapeEngine.frame` (src/components/ios-mascot-export.test.ts) for every
/// face, every move at three moments, the idle loop and a morph. Paths are
/// compared number by number (both sides round to two decimals; the two
/// platforms' sine and cosine may land a rounding step apart).
final class ShapeEngineTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Still: Decodable { let shape, expression, body, eyes: String }
        struct Dot: Decodable { let x, y, r, opacity: Double }
        struct Badge: Decodable { let x, y, r, notch: Double }
        struct Ring: Decodable { let back, front: String; let hue, hueSpan, width, opacity, x1, x2: Double }
        struct Ribbon: Decodable { let d: String; let hue, hueSpan, width, opacity, dash, offset, x1, x2: Double }
        struct Frame: Decodable {
            let body, eyes, transform, color: String
            let morphed: Double
            let dots, specks: [Dot]
            let badge: Badge?
            let rings: [Ring]
            let ribbons: [Ribbon]
        }
        struct SetChange: Decodable { let at: Double; let shape, expression, color: String }
        struct Live: Decodable {
            let name, shape, expression, color: String
            let seed, now: Double
            let move: String?
            let moveAt: Double?
            let set: SetChange?
            let frame: Frame
        }
        struct Blinks: Decodable { let seed, until: Double; let times: [Double] }
        let still: [Still]
        let live: [Live]
        let blinks: Blinks
    }

    private func fixture() throws -> Fixture {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "shape-frames", withExtension: "json", subdirectory: "Fixtures"))
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    private static let number = try! NSRegularExpression(pattern: #"-?[0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?"#)

    private func numbers(_ text: String) -> [Double] {
        let range = NSRange(text.startIndex..., in: text)
        return Self.number.matches(in: text, range: range).compactMap { Range($0.range, in: text).flatMap { Double(text[$0]) } }
    }

    private func letters(_ text: String) -> String { text.filter { $0.isLetter } }

    private func assertPath(_ swift: String, _ desktop: String, tolerance: Double = 0.03, _ message: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(letters(swift), letters(desktop), "\(message): commands", file: file, line: line)
        let a = numbers(swift), b = numbers(desktop)
        XCTAssertEqual(a.count, b.count, "\(message): number count", file: file, line: line)
        guard a.count == b.count else { return }
        let worst = zip(a, b).map { abs($0 - $1) }.max() ?? 0
        XCTAssertLessThanOrEqual(worst, tolerance, "\(message): largest difference", file: file, line: line)
    }

    private func state(_ shape: String, _ expression: String, _ color: String) throws -> ShapeEngineState {
        ShapeEngineState(shape: try XCTUnwrap(MascotShape(rawValue: shape)), expression: try XCTUnwrap(ShapeExpression(rawValue: expression)), color: color)
    }

    func testTheDataCoversEveryFaceAndMove() {
        XCTAssertEqual(ShapeExpression.allCases.count, 16)
        XCTAssertEqual(ShapeMove.allCases.count, 14)
        XCTAssertEqual(Set(ShapeEngineData.expressions.keys), Set(ShapeExpression.allCases))
        XCTAssertEqual(Set(ShapeEngineData.moveTiming.keys), Set(ShapeMove.allCases))
        XCTAssertEqual(Set(ShapeEngineData.radii.keys), Set(MascotShape.allCases))
        XCTAssertTrue(ShapeEngineData.radii.values.allSatisfy { $0.count == ShapeEngineData.radiiCount })
        XCTAssertEqual(ShapeEngineData.moodExpression[.thinking], .curious)
        XCTAssertEqual(ShapeEngineData.moodExpression[.sleeping], .sleepy)
    }

    func testStillFramesMatchTheDesktopForEveryFace() throws {
        let fixture = try fixture()
        XCTAssertGreaterThanOrEqual(Set(fixture.still.map(\.expression)).count, 16)
        for entry in fixture.still {
            let frame = ShapeFrames.still(try XCTUnwrap(MascotShape(rawValue: entry.shape)), try XCTUnwrap(ShapeExpression(rawValue: entry.expression)))
            assertPath(frame.bodyD, entry.body, "\(entry.shape) body")
            assertPath(frame.eyesD, entry.eyes, "\(entry.shape) \(entry.expression) eyes")
        }
    }

    func testTheGeneratedMoodStillsAreTheEngineStills() {
        for shape in MascotShape.allCases {
            for mood in ShapeMood.allCases {
                let frame = ShapeFrames.still(shape, ShapeEngineData.moodExpression[mood]!)
                assertPath(frame.eyesD, ShapeStillArt.eyes[shape]?[mood] ?? "", "\(shape) \(mood)")
            }
            assertPath(ShapeFrames.still(shape, .neutral).bodyD, ShapeStillArt.body[shape] ?? "", "\(shape) body")
        }
    }

    func testTheBlinkScheduleIsTheDesktopOne() throws {
        let blinks = try fixture().blinks
        let times = ShapeIdle.blinkSchedule(blinks.seed, until: blinks.until)
        XCTAssertEqual(times.count, blinks.times.count)
        for (a, b) in zip(times, blinks.times) { XCTAssertEqual(a, b, accuracy: 1e-9) }
    }

    func testLiveFramesMatchTheDesktopForTheIdleLoopEveryMoveAndAMorph() throws {
        let fixture = try fixture()
        XCTAssertEqual(Set(fixture.live.compactMap(\.move)), Set(ShapeMove.allCases.map(\.rawValue)))
        for entry in fixture.live {
            let engine = ShapeEngine(try state(entry.shape, entry.expression, entry.color), now: 0, seed: entry.seed)
            if let change = entry.set { engine.set(try state(change.shape, change.expression, change.color), now: change.at) }
            if let id = entry.move, let at = entry.moveAt { engine.play(try XCTUnwrap(ShapeMove(rawValue: id)), now: at) }
            let frame = engine.frame(entry.now)
            let want = entry.frame
            let name = entry.name
            assertPath(frame.bodyD, want.body, "\(name) body")
            assertPath(frame.eyesD, want.eyes, "\(name) eyes")
            assertPath(frame.transform, want.transform, tolerance: 0.003, "\(name) transform")
            XCTAssertEqual(frame.color, want.color, name)
            XCTAssertEqual(frame.morphed, want.morphed, accuracy: 1e-6, name)
            XCTAssertEqual(frame.dots.count, want.dots.count, "\(name) dots")
            for (a, b) in zip(frame.dots + frame.specks, want.dots + want.specks) {
                XCTAssertEqual(a.x, b.x, accuracy: 1e-6, name)
                XCTAssertEqual(a.y, b.y, accuracy: 1e-6, name)
                XCTAssertEqual(a.r, b.r, accuracy: 1e-6, name)
                XCTAssertEqual(a.opacity, b.opacity, accuracy: 1e-6, name)
            }
            XCTAssertEqual(frame.specks.count, want.specks.count, "\(name) specks")
            XCTAssertEqual(frame.badge == nil, want.badge == nil, "\(name) badge")
            if let a = frame.badge, let b = want.badge {
                XCTAssertEqual(a.x, b.x, accuracy: 1e-6, name)
                XCTAssertEqual(a.y, b.y, accuracy: 1e-6, name)
                XCTAssertEqual(a.r, b.r, accuracy: 1e-6, name)
                XCTAssertEqual(a.notch, b.notch, accuracy: 1e-6, name)
            }
            XCTAssertEqual(frame.rings.count, want.rings.count, "\(name) rings")
            for (a, b) in zip(frame.rings, want.rings) {
                assertPath(ShapeRingDraw.d(a.back), b.back, "\(name) ring back")
                assertPath(ShapeRingDraw.d(a.front), b.front, "\(name) ring front")
                XCTAssertEqual(a.width, b.width, accuracy: 1e-9, name)
                XCTAssertEqual(a.opacity, b.opacity, accuracy: 1e-9, name)
                XCTAssertEqual(a.hue, b.hue, name)
                XCTAssertEqual(a.x1, b.x1, accuracy: 1e-6, name)
                XCTAssertEqual(a.x2, b.x2, accuracy: 1e-6, name)
            }
            XCTAssertEqual(frame.ribbons.count, want.ribbons.count, "\(name) ribbons")
            for (a, b) in zip(frame.ribbons, want.ribbons) {
                assertPath(a.d, b.d, "\(name) ribbon")
                XCTAssertEqual(a.hue, b.hue, name)
                XCTAssertEqual(a.width, b.width, accuracy: 1e-9, name)
                XCTAssertEqual(a.opacity, b.opacity, accuracy: 1e-9, name)
                XCTAssertEqual(a.dash, b.dash, accuracy: 1e-9, name)
                XCTAssertEqual(a.offset, b.offset, accuracy: 1e-9, name)
                XCTAssertEqual(a.x1, b.x1, accuracy: 0.011, name)
                XCTAssertEqual(a.x2, b.x2, accuracy: 0.011, name)
            }
        }
    }

    func testMovesSlideInHoldAndSlideBack() {
        for move in ShapeMove.allCases {
            let timing = ShapeEngineData.moveTiming[move]!
            XCTAssertEqual(ShapeMoves.weight(move, -0.1), 0)
            XCTAssertEqual(ShapeMoves.weight(move, timing.duration * 0.9), 1, accuracy: 1e-9, "\(move) holds")
            XCTAssertEqual(ShapeMoves.weight(move, timing.duration + timing.morph + 0.01), 0)
            XCTAssertEqual(ShapeMoves.length(move), timing.duration + timing.morph, accuracy: 1e-12)
        }
        let engine = ShapeEngine(ShapeEngineState(shape: .circle, expression: .neutral, color: "#3b93f0"), now: 0, seed: 1)
        engine.play(.orbit, now: 1)
        XCTAssertTrue(engine.playing(2))
        XCTAssertFalse(engine.playing(1 + ShapeMoves.length(.orbit) + 0.01))
    }

    func testThePointerTurnsTheGazeAndLetsGo() {
        let engine = ShapeEngine(ShapeEngineState(shape: .circle, expression: .neutral, color: "#3b93f0"), now: 0, seed: 3)
        let rest = engine.frame(0)
        engine.pointer(CGPoint(x: 1, y: 0))
        var turned = rest
        for step in 1...60 { turned = engine.frame(Double(step) / 30) }
        // the eyes slide toward the pointer's side
        let mid = { (frame: ShapeFrame) in frame.eyes.flatMap { $0 }.map(\.x).reduce(0, +) / Double(max(1, frame.eyes.flatMap { $0 }.count)) }
        XCTAssertGreaterThan(mid(turned), mid(rest) + 1)
        XCTAssertEqual(ShapeIdle.hoverGaze(2, -2).yaw, ShapeEngineData.hover.yaw)
        XCTAssertEqual(ShapeIdle.hoverGaze(2, -2).pitch, ShapeEngineData.hover.pitch)
    }
}

/// MS5: the picker offers the Clay palette where the desktop does
/// (`colorGroupsFor` in floating-bots/editor-tabs.ts) and opens on the row of
/// the colour worn (`colorTabFor`).
final class ClayPickerTests: XCTestCase {
    func testClayIsOfferedForShapesShibaGrumpOgreFrogOrAClayColour() {
        for character in [MascotCharacter.shape, .shiba, .grump, .ogre, .frog] {
            XCTAssertTrue(MausColors.offersClay(character, color: "green"), "\(character)")
        }
        for character in [MascotCharacter.owl, .trombi, .bunbu] {
            XCTAssertFalse(MausColors.offersClay(character, color: "green"), "\(character)")
            XCTAssertTrue(MausColors.offersClay(character, color: "tomato"), "\(character) already in Clay")
            XCTAssertFalse(MausColors.offersClay(character, color: "brown"), "brown is a neutral colour")
        }
    }

    func testThePickerOpensOnTheRowOfTheColourWorn() {
        XCTAssertEqual(MausColors.pickerRow(for: "tomato", character: .shape), .clay)
        XCTAssertEqual(MausColors.pickerRow(for: "brown", character: .shape), .clay)
        XCTAssertEqual(MausColors.pickerRow(for: "green", character: .shape), .classic)
        XCTAssertEqual(MausColors.pickerRow(for: "tomato", character: .owl), .clay)
        XCTAssertEqual(MausColors.PickerRow.clay.swatches, MausColors.clay)
        XCTAssertEqual(MausColors.PickerRow.clay.swatches.count, 12)
        XCTAssertTrue(MausColors.PickerRow.clay.swatches.allSatisfy { MausColors.hex[$0] != nil })
    }
}
