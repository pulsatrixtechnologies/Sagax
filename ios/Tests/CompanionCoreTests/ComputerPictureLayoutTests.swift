import XCTest
@testable import CompanionCore

final class ComputerPictureLayoutTests: XCTestCase {
    func testFitPortraitUsesFullWidth() {
        let size = ComputerPictureLayout.fit(in: CGSize(width: 390, height: 700))
        XCTAssertEqual(size.width, 390, accuracy: 0.01)
        XCTAssertEqual(size.height, 390 / 1.6, accuracy: 0.01)
    }

    func testFitLandscapeUsesFullHeight() {
        let size = ComputerPictureLayout.fit(in: CGSize(width: 844, height: 390))
        XCTAssertEqual(size.height, 390, accuracy: 0.01)
        XCTAssertEqual(size.width, 390 * 1.6, accuracy: 0.01)
    }
}
