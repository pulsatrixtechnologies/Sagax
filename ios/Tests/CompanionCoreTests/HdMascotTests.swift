import Foundation
import XCTest
@testable import CompanionCore

/// HD mascots (#968) on the phone: the desktop's manifests and state map
/// (generated), the asset choice of `hdAssetFor`, and every file the app
/// bundles from the desktop's own folder.
final class HdMascotTests: XCTestCase {
    func testOnlyShibaShipsArtAndTheSwitchIsOnUnlessOff() {
        XCTAssertEqual(HdMascots.characters, [.shiba])
        XCTAssertTrue(HdMascots.enabled(nil))
        XCTAssertTrue(HdMascots.enabled("on"))
        XCTAssertFalse(HdMascots.enabled("off"))
        XCTAssertEqual(HdMascots.preferenceKey, "sagax.hdMascots.v1")
    }

    func testTheStatesMapAsOnTheDesktop() {
        XCTAssertEqual(HdMascots.key(forState: "idle"), .loop(.idle))
        XCTAssertEqual(HdMascots.key(forState: nil), .loop(.idle))
        XCTAssertEqual(HdMascots.key(forState: "dragon"), .loop(.idle))
        XCTAssertEqual(HdMascots.key(forState: "celebrate"), .loop(.jump))
        XCTAssertEqual(HdMascots.key(forState: "sad"), .loop(.sad))
        XCTAssertEqual(HdMascots.key(forState: "thinking"), .still(.thinking))
        XCTAssertEqual(HdMascots.key(forState: "sleeping"), .still(.sleepy))
        XCTAssertEqual(HdMascots.key(forState: "shy"), .still(.love))
        XCTAssertEqual(Set(HdMascotData.stateMap.keys), MascotStates.all)
    }

    func testALoopPlaysOnlyWhenMovingAndLargeEnough() throws {
        let shiba = try XCTUnwrap(HdMascots.manifest(for: .shiba))
        XCTAssertEqual(HdMascots.asset(shiba, .loop(.idle), moving: true, size: 85), HdAsset(kind: .loop, file: "loop-idle", still: "still-neutral"))
        XCTAssertEqual(HdMascots.asset(shiba, .loop(.idle), moving: false, size: 85), HdAsset(kind: .still, file: "still-neutral", still: "still-neutral"))
        XCTAssertEqual(HdMascots.asset(shiba, .loop(.idle), moving: true, size: 47), HdAsset(kind: .still, file: "still-neutral", still: "still-neutral"))
        XCTAssertEqual(HdMascots.asset(shiba, .loop(.turn), moving: false, size: 85)?.file, "still-look-left")
        XCTAssertEqual(HdMascots.asset(shiba, .still(.sleepy), moving: true, size: 120), HdAsset(kind: .still, file: "still-sleepy", still: "still-sleepy"))
    }

    func testEveryFileTheManifestNamesIsInTheDesktopsFolder() throws {
        // ios/Tests/CompanionCoreTests/ -> the repository's src/assets/mascots/<character>/
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        for (_, manifest) in HdMascotData.manifests {
            let folder = root.appendingPathComponent("src/assets/mascots/\(manifest.folder)")
            XCTAssertEqual(Set(manifest.loops.keys), Set(HdLoop.allCases))
            XCTAssertEqual(Set(manifest.stills.keys), Set(HdStill.allCases))
            for file in Array(manifest.loops.values) + Array(manifest.stills.values) {
                XCTAssertTrue(FileManager.default.fileExists(atPath: folder.appendingPathComponent("\(file).webp").path), "\(manifest.folder)/\(file).webp")
            }
        }
    }
}
