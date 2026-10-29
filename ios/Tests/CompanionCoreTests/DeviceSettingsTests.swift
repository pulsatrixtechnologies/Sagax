import Foundation
import XCTest
@testable import CompanionCore

final class DeviceSettingsTests: XCTestCase {
    private func defaults() -> UserDefaults {
        let name = "device-settings-\(UUID().uuidString)"
        let store = UserDefaults(suiteName: name)!
        store.removePersistentDomain(forName: name)
        return store
    }

    func testReadsTheDefaultThenTheChange() {
        let store = defaults()
        XCTAssertEqual(DeviceSettings.answer(.init(id: "r1", op: "get", key: "device.haptics"), defaults: store), DeviceSettingAnswer(value: "true"))
        XCTAssertEqual(DeviceSettings.answer(.init(id: "r2", op: "set", key: "device.haptics", value: "false"), defaults: store), DeviceSettingAnswer(value: "false"))
        XCTAssertEqual(store.object(forKey: "companion.prefs.haptics") as? Bool, false)
    }

    func testAnswersThePreferencesItKeepsUnderTheServerKey() {
        let store = defaults()
        XCTAssertEqual(DeviceSettings.answer(.init(id: "r1", op: "set", key: "omb-dock-badge", value: "false"), defaults: store).value, "false")
        XCTAssertEqual(store.object(forKey: "companion.prefs.appBadge") as? Bool, false)
        XCTAssertEqual(DeviceSettings.answer(.init(id: "r2", op: "set", key: "sagax.notificationSound.v1", value: "blip"), defaults: store).value, "blip")
        XCTAssertNotNil(DeviceSettings.answer(.init(id: "r3", op: "set", key: "sagax.notificationSound.v1", value: "boom"), defaults: store).error)
    }

    func testLanguageEmptyFollowsTheSystem() {
        let store = defaults()
        XCTAssertEqual(DeviceSettings.answer(.init(id: "r1", op: "get", key: "omb-language"), defaults: store).value, "")
        XCTAssertEqual(DeviceSettings.answer(.init(id: "r2", op: "set", key: "omb-language", value: "fr"), defaults: store).value, "fr")
        XCTAssertEqual(DeviceSettings.answer(.init(id: "r3", op: "set", key: "omb-language", value: ""), defaults: store).value, "")
        XCTAssertEqual(store.string(forKey: "companion.prefs.language"), "system")
        XCTAssertNotNil(DeviceSettings.answer(.init(id: "r4", op: "set", key: "omb-language", value: "xx"), defaults: store).error)
    }

    func testWhatThisPhoneDoesNotKeepIsUnsupported() {
        let store = defaults()
        XCTAssertEqual(DeviceSettings.answer(.init(id: "r1", op: "get", key: "device.openAtLogin"), defaults: store), .notKept)
        XCTAssertEqual(DeviceSettings.answer(.init(id: "r2", op: "set", key: "omb-skin", value: "night"), defaults: store), .notKept)
        XCTAssertNotNil(DeviceSettings.answer(.init(id: "r3", op: "set", key: "device.haptics", value: "maybe"), defaults: store).error)
    }

    func testTheAnswerEncodesAsTheServerReadsIt() throws {
        let data = try JSONEncoder().encode(DeviceSettingAnswer.notKept)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(object?["device"] as? String, "ios")
        XCTAssertEqual(object?["unsupported"] as? Bool, true)
        XCTAssertNil(object?["value"])
    }
}
