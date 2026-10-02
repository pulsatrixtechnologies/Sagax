import Foundation
import XCTest
@testable import CompanionCore

/// The app's mascot: the Sagax owl until connected, then the Primary Bot.
final class BrandMascotTests: XCTestCase {
    private let fleet = DemoServer(now: Date(timeIntervalSince1970: 1_790_000_000), chunkDelay: 0).fleet

    func testTheOwlWhenNotConnected() {
        XCTAssertEqual(BrandMascot.resolve(connected: false, bots: fleet.bots, cached: fleet.bots[0]), .sagaxOwl)
    }

    func testTheOwlWithoutAPrimaryBot() {
        let noPrimary = fleet.bots.map { bot -> Bot in var b = bot; b.chiefOfStaff = false; return b }
        XCTAssertEqual(BrandMascot.resolve(connected: true, bots: noPrimary, cached: nil), .sagaxOwl)
        // a hidden Primary Bot does not count
        var hidden = fleet.bots
        hidden[0].hidden = true
        XCTAssertEqual(BrandMascot.resolve(connected: true, bots: hidden, cached: nil), .sagaxOwl)
    }

    func testThePrimaryBotsOwnLook() {
        guard case let .primary(bot) = BrandMascot.resolve(connected: true, bots: fleet.bots, cached: nil) else {
            return XCTFail("the demo has a Primary Bot")
        }
        XCTAssertEqual(bot.name, "Atlas")
        XCTAssertNil(bot.messages)
        XCTAssertEqual(bot.color, "blue")
    }

    func testALookChangeChangesTheMascotAndAMessageDoesNot() {
        let before = BrandMascot.resolve(connected: true, bots: fleet.bots, cached: nil)
        var talked = fleet.bots
        let line = talked[0].messages![0]
        talked[0].messages?.append(line)
        XCTAssertEqual(BrandMascot.resolve(connected: true, bots: talked, cached: nil), before)
        var restyled = fleet.bots
        restyled[0].mascotLook = MascotLook(character: .trombi)
        restyled[0].mascotSkin = .gold
        restyled[0].color = "red"
        guard case let .primary(bot) = BrandMascot.resolve(connected: true, bots: restyled, cached: nil) else { return XCTFail() }
        XCTAssertEqual(bot.mascotLook?.character, .trombi)
        XCTAssertEqual(bot.mascotSkin, .gold)
        XCTAssertNotEqual(.primary(bot), before)
        // another bot becoming Primary moves the mascot to it
        var moved = fleet.bots
        moved[0].chiefOfStaff = false
        moved[2].chiefOfStaff = true
        guard case let .primary(next) = BrandMascot.resolve(connected: true, bots: moved, cached: nil) else { return XCTFail() }
        XCTAssertEqual(next.name, "Pixel")
    }

    func testTheCachedLookCoversAnOfflineLaunchOnly() {
        let cached = fleet.bots[3].brandLook
        XCTAssertEqual(BrandMascot.resolve(connected: true, bots: [], cached: cached), .primary(cached))
        // once the fleet is there, it wins over the cache
        guard case let .primary(live) = BrandMascot.resolve(connected: true, bots: fleet.bots, cached: cached) else { return XCTFail() }
        XCTAssertEqual(live.name, "Atlas")
        // the cache round-trips through JSON
        let data = try! JSONEncoder().encode(cached)
        XCTAssertEqual(try! JSONDecoder().decode(Bot.self, from: data), cached)
    }
}
