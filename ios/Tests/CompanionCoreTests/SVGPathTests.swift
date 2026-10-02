// The SVG path parser the mascots are drawn with.
import CoreGraphics
import XCTest
@testable import CompanionCore

final class SVGPathTests: XCTestCase {
    private func bounds(_ d: String) -> CGRect { SVGPath.parse(d).boundingBoxOfPath }

    func testAbsoluteAndRelativeLines() {
        XCTAssertEqual(bounds("M10 10 L20 30 H40 V5 Z"), CGRect(x: 10, y: 5, width: 30, height: 25))
        XCTAssertEqual(bounds("m10 10 l10 20 h20 v-25 z"), CGRect(x: 10, y: 5, width: 30, height: 25))
        // pairs after a moveto are implicit linetos
        XCTAssertEqual(bounds("M0 0 10 0 10 10"), CGRect(x: 0, y: 0, width: 10, height: 10))
    }

    func testPackedNumbers() {
        // minus signs and dots start new numbers, as browsers read them
        XCTAssertEqual(bounds("M0-5L10.5.5"), CGRect(x: 0, y: -5, width: 10.5, height: 5.5))
        XCTAssertEqual(bounds("M1e1 0L20 0 20 10"), CGRect(x: 10, y: 0, width: 10, height: 10))
    }

    func testArcsAreCircles() {
        // a full circle from two relative half arcs, as the circle shape is drawn
        let circle = bounds("M50 8a42 42 0 1 1 0 84a42 42 0 1 1 0-84z")
        XCTAssertEqual(circle.minX, 8, accuracy: 0.01)
        XCTAssertEqual(circle.maxX, 92, accuracy: 0.01)
        XCTAssertEqual(circle.minY, 8, accuracy: 0.01)
        XCTAssertEqual(circle.maxY, 92, accuracy: 0.01)
        // a half arc bulging down (sweep 0 from left to right)
        let cup = bounds("M 48 266 A 46 46 0 0 0 140 266")
        XCTAssertEqual(cup.maxY, 312, accuracy: 0.01)
        XCTAssertEqual(cup.minY, 266, accuracy: 0.01)
        // radii too small are scaled up to fit
        let scaled = bounds("M0 0 A1 1 0 0 1 10 0")
        XCTAssertEqual(scaled.width, 10, accuracy: 0.01)
        XCTAssertEqual(scaled.height, 5, accuracy: 0.01)
    }

    func testCurves() {
        let q = SVGPath.parse("M0 0 Q10 10 20 0")
        XCTAssertEqual(q.boundingBoxOfPath.maxY, 5, accuracy: 0.01)
        let relQ = SVGPath.parse("M46 53q4 3 8 0")
        XCTAssertEqual(relQ.boundingBoxOfPath.maxY, 54.5, accuracy: 0.01)
        XCTAssertEqual(relQ.currentPoint, CGPoint(x: 54, y: 53))
        let smooth = SVGPath.parse("M0 0 C0 10 10 10 10 0 S20 -10 20 0")
        XCTAssertEqual(smooth.currentPoint, CGPoint(x: 20, y: 0))
        XCTAssertEqual(smooth.boundingBoxOfPath.minY, -7.5, accuracy: 0.01)
    }

    func testMalformedTailsStopQuietly() {
        let path = SVGPath.parse("M0 0 L10 10 L oops")
        XCTAssertEqual(path.boundingBoxOfPath, CGRect(x: 0, y: 0, width: 10, height: 10))
        XCTAssertTrue(SVGPath.parse("").isEmpty)
    }

    func testCachesByString() {
        XCTAssertTrue(SVGPath.cached("M0 0 L1 1") === SVGPath.cached("M0 0 L1 1"))
    }
}
