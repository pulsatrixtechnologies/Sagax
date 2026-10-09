// Grump on the phone: its colours as the desktop computes them
// (Fixtures/grump-palettes.json, generated from skin-fx/grump-skins.tsx by
// src/components/ios-mascot-export.test.ts) and its still drawing complete
// (GrumpStillArt, generated from grump-art.ts).
import XCTest
@testable import CompanionCore

final class GrumpArtTests: XCTestCase {
    private struct Fixture: Decodable {
        var skins: [String]
        var colors: [String: [String: [String: String]]]
    }

    private func fixture() throws -> Fixture {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: "grump-palettes", withExtension: "json", subdirectory: "Fixtures")
                ?? Bundle.module.url(forResource: "grump-palettes", withExtension: "json")
        )
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    /// Plain, Void, Neon and Retro 98 follow the bot colour: the phone computes each role as the desktop does.
    func testTheBotColourSkinsMatchTheDesktop() throws {
        let f = try fixture()
        XCTAssertEqual(f.skins, ["plain", "void", "neon", "retro98"])
        XCTAssertGreaterThan(f.colors.count, 40)
        for (name, skins) in f.colors {
            let hex = try XCTUnwrap(MausColors.hex(for: name), name)
            for (skin, roles) in skins {
                let palette = GrumpArt.palette(skin: skin, hex: hex)
                for role in GrumpRole.allCases {
                    XCTAssertEqual(palette[role]?.lowercased(), roles[role.rawValue]?.lowercased(), "\(name) \(skin) \(role)")
                }
            }
        }
    }

    /// Every other skin carries every role, flattened to a colour.
    func testEveryOwnSkinPaintsEveryRole() {
        XCTAssertEqual(GrumpStillArt.skinPalettes.count, 9)
        for (skin, palette) in GrumpStillArt.skinPalettes {
            for role in GrumpRole.allCases {
                let value = palette[role]
                XCTAssertNotNil(value, "\(skin) \(role)")
                XCTAssertTrue(value?.hasPrefix("#") ?? false, "\(skin) \(role)")
            }
        }
    }

    /// The still drawing has its sixteen faces at both scales, and every path parses.
    func testTheStillDrawingIsComplete() {
        XCTAssertEqual(GrumpStillArt.expressions.count, 16)
        for layers in [GrumpStillArt.full, GrumpStillArt.bust] {
            XCTAssertFalse(layers.under.isEmpty)
            XCTAssertFalse(layers.over.isEmpty)
            XCTAssertEqual(Set(layers.faces.keys), Set(GrumpStillArt.expressions))
            for op in layers.under + layers.over + layers.faces.values.flatMap({ $0 }) {
                XCTAssertFalse(SVGPath.parse(op.d).isEmpty, op.d)
                XCTAssertTrue(op.fill != nil || op.stroke != nil, op.d)
            }
        }
        // the bust leaves the tail out, so it has fewer parts under the face
        XCTAssertLessThan(GrumpStillArt.bust.under.count, GrumpStillArt.full.under.count)
    }

    /// The markings follow the bot colour and stay readable on the cream fur.
    func testTheMaskReadsOnTheFur() {
        for (name, hex) in MausColors.hex {
            let palette = GrumpArt.plain(hex)
            XCTAssertGreaterThanOrEqual(MascotInk.contrast(palette[.coat]!, palette[.cream]!), 2.2 - 0.001, name)
        }
        XCTAssertEqual(GrumpArt.hex("nope"), GrumpArt.defaultHex)
    }
}
