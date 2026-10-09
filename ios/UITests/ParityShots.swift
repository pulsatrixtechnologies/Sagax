import XCTest

/// Screenshots a run keeps outside the result bundle: when the runner gets
/// SAGAX_SHOTS (TEST_RUNNER_SAGAX_SHOTS), each one is also written there as
/// a PNG, so a review reads them without opening the .xcresult.
enum ParityShots {
    static func save(_ name: String, _ app: XCUIApplication) {
        guard let dir = ProcessInfo.processInfo.environment["SAGAX_SHOTS"], !dir.isEmpty else { return }
        let folder = URL(fileURLWithPath: dir, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = name.lowercased().map { $0.isLetter || $0.isNumber ? $0 : "-" }
        try? app.screenshot().pngRepresentation.write(to: folder.appendingPathComponent(String(file) + ".png"))
    }
}
