// Every mascot look the desktop can store, read by the phone exactly as the
// desktop reads it. The fixture (Fixtures/mascot-looks.json) is generated
// from the desktop's own lists by src/components/ios-mascot-export.test.ts
// (characters, shapes, every skin, the editor's saved form with all three
// skins, legacy ids, a newer build's values) together with what
// `botMascotLook` and `botMascotSkin` read from each, so a desktop change
// that the phone does not follow fails here.
import XCTest
@testable import CompanionCore

final class MascotLookFixtureTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Case: Decodable {
            var name: String
            var input: AnyJSON
            var expected: AnyJSON
        }
        struct SkinCase: Decodable {
            var input: AnyJSON
            var expected: String
        }
        var characters: [String]
        var shapes: [String]
        var shapeSkins: [String]
        var trombiSkins: [String]
        var bunbuSkins: [String]
        var ogreSkins: [String]
        var owlSkins: [String]
        var colorGroups: [String: [String]]
        var colors: [String: String]
        var looks: [Case]
        var owlSkinCases: [SkinCase]
    }

    /// Any JSON value, kept as its serialized form.
    private struct AnyJSON: Decodable {
        var data: Data
        init(from decoder: Decoder) throws {
            let value = try decoder.singleValueContainer().decode(JSONValue.self)
            data = try JSONEncoder().encode(value)
        }
    }

    private indirect enum JSONValue: Codable {
        case null, bool(Bool), number(Double), string(String), array([JSONValue]), object([String: JSONValue])
        init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if c.decodeNil() { self = .null }
            else if let b = try? c.decode(Bool.self) { self = .bool(b) }
            else if let n = try? c.decode(Double.self) { self = .number(n) }
            else if let s = try? c.decode(String.self) { self = .string(s) }
            else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
            else { self = .object(try c.decode([String: JSONValue].self)) }
        }
        func encode(to encoder: Encoder) throws {
            var c = encoder.singleValueContainer()
            switch self {
            case .null: try c.encodeNil()
            case let .bool(b): try c.encode(b)
            case let .number(n): try c.encode(n)
            case let .string(s): try c.encode(s)
            case let .array(a): try c.encode(a)
            case let .object(o): try c.encode(o)
            }
        }
    }

    private func fixture() throws -> Fixture {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: "mascot-looks", withExtension: "json", subdirectory: "Fixtures")
                ?? Bundle.module.url(forResource: "mascot-looks", withExtension: "json")
        )
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    /// The look as a bot carries it: `{"look": <input>}`, absent on null.
    private func decode(_ input: Data) throws -> MascotLook {
        struct Box: Decodable { var look: MascotLook? }
        let wrapped = Data("{\"look\":".utf8) + input + Data("}".utf8)
        return try JSONDecoder().decode(Box.self, from: wrapped).look ?? .owl
    }

    private func object(_ data: Data) throws -> NSDictionary {
        try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? NSDictionary)
    }

    func testTheListsMatchTheDesktop() throws {
        let f = try fixture()
        XCTAssertEqual(MascotCharacter.allCases.map(\.rawValue), f.characters)
        XCTAssertEqual(MascotShape.allCases.map(\.rawValue), f.shapes)
        XCTAssertEqual(ShapeSkin.allCases.map(\.rawValue), f.shapeSkins)
        XCTAssertEqual(TrombiSkin.allCases.map(\.rawValue), f.trombiSkins)
        XCTAssertEqual(BunbuSkin.allCases.map(\.rawValue), f.bunbuSkins)
        XCTAssertEqual(OgreSkin.allCases.map(\.rawValue), f.ogreSkins)
        XCTAssertEqual(MascotSkin.allCases.map(\.rawValue), f.owlSkins)
    }

    /// Each look reads on the phone as `botMascotLook` reads it on the desktop.
    func testEveryDesktopLookDecodesAsTheDesktopReadsIt() throws {
        let f = try fixture()
        XCTAssertGreaterThan(f.looks.count, 150)
        for c in f.looks {
            let decoded = try decode(c.input.data)
            let encoded = try JSONEncoder().encode(decoded)
            XCTAssertEqual(try object(encoded), try object(c.expected.data), c.name)
        }
    }

    /// The rule JC needs: a known character never comes back as the owl.
    func testAKnownCharacterNeverFallsBackToTheOwl() throws {
        let f = try fixture()
        var checked = 0
        for c in f.looks {
            let expected = try object(c.expected.data)
            guard let character = expected["character"] as? String, character != "owl" else { continue }
            let decoded = try decode(c.input.data)
            XCTAssertEqual(decoded.character.rawValue, character, c.name)
            // and what the phone draws for it is that same character
            for entry in MascotSubstitution.entries(for: decoded.complete) {
                XCTAssertEqual(entry.character, decoded.character, c.name)
            }
            checked += 1
        }
        XCTAssertGreaterThan(checked, 120)
    }

    func testEveryOwlSkinReadsAsTheDesktopReadsIt() throws {
        let f = try fixture()
        struct Box: Decodable { var skin: MascotSkin? }
        for c in f.owlSkinCases {
            let wrapped = Data("{\"skin\":".utf8) + c.input.data + Data("}".utf8)
            let skin = try JSONDecoder().decode(Box.self, from: wrapped).skin ?? MascotSkin.none
            XCTAssertEqual(skin.rawValue, c.expected, String(decoding: c.input.data, as: UTF8.self))
        }
    }

    /// Every colour a bot may wear has its value on the phone (the Clay
    /// palette included): a tomato shape is never drawn green.
    func testEveryBotColourHasItsValue() throws {
        let f = try fixture()
        for (name, hex) in f.colors {
            XCTAssertEqual(MausColors.hex(for: name), hex.uppercased(), name)
        }
        XCTAssertEqual(MausColors.clay.count, 12)
        XCTAssertEqual(Set(MausColors.clay), Set(f.colorGroups["clay", default: []] + ["brown"]))
    }

    /// Each premium skin the phone draws with less than the desktop is
    /// recorded, and the everyday finishes are drawn as they are.
    func testSubstitutionsAreNamedAndKeepTheCharacter() {
        XCTAssertTrue(MascotSubstitution.entries(for: CompleteMascotLook(character: .shape, shapeSkin: .plain)).isEmpty)
        XCTAssertTrue(MascotSubstitution.entries(for: CompleteMascotLook(character: .bunbu, bunbuSkin: .plush)).isEmpty)
        let galaxy = MascotSubstitution.entries(for: CompleteMascotLook(character: .shape, shape: .cloud, shapeSkin: .galaxy))
        XCTAssertEqual(galaxy.map(\.wanted), ["shape skin galaxy"])
        XCTAssertEqual(galaxy.first?.character, .shape)
        let owl = MascotSubstitution.entries(for: MascotLook.owl.complete, owlSkin: .spirit)
        XCTAssertEqual(owl.first?.character, .owl)
        XCTAssertTrue(MascotSubstitution.entries(for: MascotLook.owl.complete, owlSkin: .lightning).isEmpty)
    }

    /// The Shapes art the phone draws is the desktop's: one outline per
    /// shape and a pair of eyes for each mood.
    func testEveryShapeHasItsStillFrames() {
        for shape in MascotShape.allCases {
            XCTAssertFalse(ShapeStillArt.body[shape, default: ""].isEmpty, shape.rawValue)
            for mood in ShapeMood.allCases {
                XCTAssertFalse(ShapeStillArt.eyes[shape]?[mood]?.isEmpty ?? true, "\(shape.rawValue) \(mood.rawValue)")
            }
        }
    }

    /// The skins' base finishes follow `shapeSkinBase`.
    func testShapeSkinBaseFinishes() {
        let green = "#009957"
        XCTAssertEqual(ShapeArt.paint(.gold, hex: green).fill, "#E2AE34")
        XCTAssertEqual(ShapeArt.paint(.outline, hex: green).stroke, "#1B1F27")
        XCTAssertEqual(ShapeArt.paint(.plain, hex: "#0A0A0C").eyes, MascotInk.light, "light eyes on the ink body")
        XCTAssertEqual(ShapeArt.paint(.plain, hex: "#F1EFE9").eyes, MascotInk.dark)
        XCTAssertEqual(BunbuArt.paint(.velvet, hex: green).eyes, "#FDF3FF")
        XCTAssertEqual(ShapeArt.clayStops(green).map(\.offset), [0, 0.3, 0.7, 1])
    }
}
