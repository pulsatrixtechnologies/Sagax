// Ogre on the phone: the same colours as the desktop for every bot colour,
// every face and skin drawable, the substitutions named.
import XCTest
@testable import CompanionCore

final class OgreArtTests: XCTestCase {
    /// `ogrePalette` on the phone gives the desktop's colours (the samples are generated from the desktop).
    func testThePaletteMatchesTheDesktopForEveryBotColour() throws {
        XCTAssertFalse(OgreStillArt.paletteSamples.isEmpty)
        for (name, sample) in OgreStillArt.paletteSamples {
            let hex = try XCTUnwrap(MausColors.hex(for: name), name)
            let palette = OgreArt.palette(hex: hex)
            XCTAssertEqual(palette["skin"]?.uppercased(), sample.skin, "\(name) skin")
            XCTAssertEqual(palette["vest"]?.uppercased(), sample.vest, "\(name) vest")
            XCTAssertEqual(palette["line"]?.uppercased(), sample.line, "\(name) line")
            XCTAssertEqual(palette["tunicShade"]?.uppercased(), sample.tunicShade, "\(name) tunicShade")
        }
        XCTAssertEqual(OgreArt.palette(hex: nil)["skin"], "#9DBE4A")
    }

    /// Every face and every skin draws, and every role a drawing uses is painted.
    func testEveryFaceAndSkinIsDrawable() {
        XCTAssertEqual(OgreStillArt.faces.count, 16)
        for skin in OgreSkin.allCases {
            let paint = OgreArt.paint(skin, hex: "#377FE6")
            for expression in OgreStillArt.faces.keys {
                for size in [32.0, 120.0] {
                    let ops = OgreArt.ops(expression: expression, size: size, marks: paint.marks)
                    XCTAssertFalse(ops.isEmpty)
                    for op in ops {
                        if let fill = op.fill { XCTAssertNotNil(paint.palette[fill], "\(skin) \(fill)") }
                        if let stroke = op.stroke { XCTAssertNotNil(paint.palette[stroke], "\(skin) \(stroke)") }
                    }
                }
            }
        }
        XCTAssertEqual(OgreArt.paint(.lava, hex: "#377FE6").marks, "cracks")
        XCTAssertEqual(OgreArt.paint(.armor, hex: "#377FE6").marks, "rivets")
        // the hides are the ogre's own whatever the bot colour
        XCTAssertEqual(OgreArt.paint(.stone, hex: "#377FE6").palette["skin"], OgreArt.paint(.stone, hex: "#D94B52").palette["skin"])
    }

    /// The outline never drops under 1.6 points, and a small avatar is the bust without the z.
    func testOutlineAndBust() {
        for size in [16.0, 32.0, 48.0, 64.0, 240.0] {
            let box = size <= OgreArt.bustMax ? 90.0 : 100.0
            XCTAssertGreaterThanOrEqual(OgreArt.outline(size: size) * size / box, 1.59)
        }
        XCTAssertTrue(OgreStillArt.faces["sleepy"]?.bustExtras.isEmpty ?? false)
        XCTAssertFalse(OgreStillArt.faces["sleepy"]?.extras.isEmpty ?? true)
    }

    func testStatesAndSubstitutions() {
        XCTAssertEqual(OgreArt.expression(for: "sleeping"), "sleepy")
        XCTAssertEqual(OgreArt.expression(for: "searching"), "curious")
        XCTAssertEqual(OgreArt.expression(for: "angry"), "angry")
        XCTAssertEqual(OgreArt.expression(for: "idle"), "neutral")
        XCTAssertTrue(MascotSubstitution.entries(for: CompleteMascotLook(character: .ogre, ogreSkin: .swamp)).isEmpty)
        let lava = MascotSubstitution.entries(for: CompleteMascotLook(character: .ogre, ogreSkin: .lava))
        XCTAssertEqual(lava.map(\.wanted), ["Ogre skin lava"])
        XCTAssertEqual(lava.first?.character, .ogre)
    }

    func testTheLookDecodesWithItsSkin() throws {
        let look = try JSONDecoder().decode(MascotLook.self, from: Data(#"{"character":"ogre","skins":{"ogre":"magma"}}"#.utf8))
        XCTAssertEqual(look.character, .ogre)
        XCTAssertEqual(look.complete.ogreSkin, .lava, "a legacy id")
        XCTAssertEqual(look.complete.stored.skins?.ogre, .lava)
    }
}
