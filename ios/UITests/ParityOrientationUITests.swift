import XCTest

/// Turns the simulator for the iPad desktop-parity harness
/// (ios/parity/desktop/capture-ipad.sh). iPadOS refuses programmatic
/// orientation changes in its windowing mode (UISceneErrorDomain 101), and
/// simctl has no rotate command, so the harness runs this one test with
/// TEST_RUNNER_PARITY_ORIENTATION=landscape|portrait; the device keeps the
/// orientation after the runner exits. Skipped in every other run.
final class ParityOrientationUITests: XCTestCase {
    func testParityOrientation() throws {
        let wanted = ProcessInfo.processInfo.environment["PARITY_ORIENTATION"]
        try XCTSkipUnless(wanted != nil, "only for ios/parity/desktop/capture-ipad.sh")
        XCUIDevice.shared.orientation = wanted == "portrait" ? .portrait : .landscapeLeft
        Thread.sleep(forTimeInterval: 1)
        XCTAssertEqual(XCUIDevice.shared.orientation, wanted == "portrait" ? .portrait : .landscapeLeft)
    }
}
