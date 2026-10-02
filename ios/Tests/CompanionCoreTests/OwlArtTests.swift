// The owl's numbers against the desktop's: `owl-skins.test.ts`,
// `owl-state.test.ts` and `owl-wings.test.ts`, plus values captured from the
// TypeScript functions themselves where "the same" means the same string.
import CoreGraphics
import XCTest
@testable import CompanionCore

final class OwlArtTests: XCTestCase {
    // MARK: palette

    func testTheGreenOwlsPaletteIsTheDesktops() {
        // owlPalette(MAUS_COLORS.green), captured from the desktop
        XCTAssertEqual(OwlArt.palette("#009957"), OwlPalette(
            plumage: "#009957", wingNear: "#006B3D", socket: "#002E1A", cream: "#F6F1E8", grey: "#ACA09C",
            greyDark: "#464147", iris: "#F8CA48", pupil: "#0E0B0E", highlight: "#FBF8F2"
        ))
    }

    func testTheBlackOwlHasItsOwnCharcoalAndTheOnlyRim() {
        let palette = OwlArt.palette(MausColors.hex["black"]!)
        XCTAssertEqual(palette.plumage, "#24252B")
        XCTAssertEqual(palette.wingNear, "#141519")
        XCTAssertEqual(palette.socket, "#08080A")
        XCTAssertEqual(palette.cream, "#F6F1E8")
        XCTAssertEqual(palette.iris, "#F8CA48")
        XCTAssertEqual(OwlArt.rim(MausColors.hex["black"]!), OwlArt.blackRim)
        for name in MausColors.names where name != "black" {
            XCTAssertNil(OwlArt.rim(MausColors.hex[name]!), name)
        }
    }

    func testTheWhiteOwlIsWarmGrey() {
        XCTAssertEqual(OwlArt.palette(MausColors.hex["white"]!).plumage, "#CFCBC4")
    }

    func testGeometryMatchesTheTrace() {
        // owlSvgParts(...).lid.d and .eye.highlight on the desktop
        XCTAssertEqual(OwlArt.lidPath, "M136.3 61.46H176.82V93.88Q156.56 106.84 136.3 93.88Z")
        XCTAssertEqual(OwlArt.highlightCenter.x, 157.83, accuracy: 0.0001)
        XCTAssertEqual(OwlArt.highlightCenter.y, 75.06, accuracy: 0.0001)
        XCTAssertEqual(OwlArt.farMirrorX, 131.4, accuracy: 0.0001)
        // the beak is the high part of the dark-grey layer, the feet the low
        let greyDark = OwlArt.layer(.greyDark)
        XCTAssertEqual(greyDark.filter(OwlArt.isBeak).count, 1)
        XCTAssertEqual(greyDark.filter { !OwlArt.isBeak($0) }.count, 2)
        // every layer parses inside the 256 box
        for (role, ds) in OwlTrace.layers {
            for d in ds {
                let b = SVGPath.parse(d).boundingBoxOfPath
                XCTAssertFalse(b.isEmpty, role.rawValue)
                XCTAssertTrue(CGRect(x: 0, y: 0, width: 256, height: 256).contains(b), role.rawValue)
            }
        }
    }

    // MARK: skins

    func testNoneLeavesThePaletteAlone() {
        let base = OwlArt.palette(MausColors.hex["blue"]!)
        XCTAssertEqual(OwlSkins.palette(.none, base: base, hex: MausColors.hex["blue"]!), base)
        XCTAssertEqual(OwlSkins.look(.none, hex: MausColors.hex["blue"]!), OwlSkinLook())
    }

    func testEverySkinRecolorsAndAddsALook() {
        let green = MausColors.hex["green"]!
        let base = OwlArt.palette(green)
        for skin in MascotSkin.allCases where skin != .none {
            XCTAssertNotEqual(OwlSkins.palette(skin, base: base, hex: green), base, skin.rawValue)
            let look = OwlSkins.look(skin, hex: green)
            XCTAssertTrue(look.aura != nil || look.rim != nil, skin.rawValue)
        }
    }

    func testLightningKeepsThePlumageAndChargesTheEye() {
        let black = MausColors.hex["black"]!
        let base = OwlArt.palette(black)
        let palette = OwlSkins.palette(.lightning, base: base, hex: black)
        XCTAssertEqual(palette.plumage, base.plumage)
        XCTAssertNotEqual(palette.iris, base.iris)
        XCTAssertNotNil(OwlSkins.look(.lightning, hex: black).eyeGlow)
    }

    func testNeonBurnsInTheBotsColourAndCyanForBlackAndWhite() {
        XCTAssertEqual(OwlSkins.accent(MausColors.hex["black"]!), "#22D3EE")
        XCTAssertEqual(OwlSkins.accent(MausColors.hex["white"]!), "#22D3EE")
        // owlSkinAccent(MAUS_COLORS.pink) on the desktop
        XCTAssertEqual(OwlSkins.accent(MausColors.hex["pink"]!), "#E484AE")
        let pink = OwlSkins.palette(.neon, base: OwlArt.palette(MausColors.hex["pink"]!), hex: MausColors.hex["pink"]!)
        XCTAssertEqual(pink.iris, "#E484AE")
        XCTAssertEqual(pink.grey, "#E484AE")
        XCTAssertEqual(pink.cream, "#21253A")
    }

    func testDrawsTheSameBoltsAsTheDesktop() {
        // owlBolt([0, 0], [10, 10], [20, 0], 5) and two of OWL_LIGHTNING_ARCS, from the desktop
        XCTAssertEqual(
            OwlSkins.bolt(CGPoint(x: 0, y: 0), CGPoint(x: 10, y: 10), CGPoint(x: 20, y: 0), seed: 5),
            "M0 0L0.6 4.1L2.6 6.8L7.9 0.7L8.7 6.7L10.5 -0.8L13.7 5.7L17.1 6.2L17.4 1.5L20 0M8.7 6.7L14.8 10.6L19 20.5"
        )
        XCTAssertEqual(OwlSkins.lightningArcs[0].d, "M44 104L40.7 90.2L40.2 77.3L43.2 65.5L47.7 54.5L57.8 46.7L64.8 34.2L74.6 19.9L93.6 17.5L112 10M47.7 54.5L53.4 60.9L60.2 65.3")
        XCTAssertEqual(OwlSkins.lightningArcs[5].d, "M16 70L7.1 82L12.2 95.6L10.7 107.6L13.8 118.8L18.8 128.9L22 140M10.7 107.6L15.1 113.2L23.8 117.5")
        XCTAssertNotEqual(
            OwlSkins.bolt(CGPoint(x: 0, y: 0), CGPoint(x: 10, y: 10), CGPoint(x: 20, y: 0), seed: 5),
            OwlSkins.bolt(CGPoint(x: 0, y: 0), CGPoint(x: 10, y: 10), CGPoint(x: 20, y: 0), seed: 6)
        )
    }

    // MARK: states

    /// The whole table, as `owl-state.test.ts` writes it out.
    private let expected: [String: OwlState] = [
        "sleeping": .sleepy, "waking": .idle, "idle": .idle, "listening": .thinking, "thinking": .thinking,
        "searching": .thinking, "working": .working, "excited": .success, "surprised": .alert,
        "suspicious": .thinking, "angry": .alert, "drowsy": .sleepy, "happy": .success, "curious": .thinking,
        "confused": .thinking, "bored": .sleepy, "proud": .success, "shy": .idle, "sad": .idle,
        "laughing": .success, "scared": .alert, "playful": .idle, "celebrate": .success, "orbit": .working,
        "radar": .thinking, "progress": .working, "spawning": .idle, "humming": .working, "loading": .working,
        "dictating": .working, "sending": .working, "receiving": .working, "uploading": .working,
        "writing": .working, "notifying": .alert, "alerting": .alert, "bouncing": .success,
        "dragging": .working, "powering-down": .sleepy,
    ]

    func testMapsEveryMausState() {
        XCTAssertEqual(Set(expected.keys), MascotStates.all)
        for (state, owl) in expected {
            XCTAssertEqual(OwlState.forMaus(state), owl, state)
            XCTAssertEqual(OwlState.forMaus(state).isOneShot, owl == .success || owl == .alert)
        }
    }

    func testMapsLegacyNamesThroughTheirCurrentState() {
        XCTAssertEqual(OwlState.forMaus("deadpan"), .idle)
        XCTAssertEqual(OwlState.forMaus("friendly"), .success)
        XCTAssertEqual(OwlState.forMaus("focused"), .working)
        XCTAssertEqual(OwlState.forMaus("sleepy"), .sleepy)
        XCTAssertEqual(OwlState.forMaus("skeptical"), .thinking)
        XCTAssertEqual(OwlState.forMaus("worried"), .alert)
        XCTAssertEqual(OwlState.forMaus("mischievous"), .idle)
    }

    func testJunkIsIdle() {
        XCTAssertEqual(OwlState.forMaus("nope"), .idle)
        XCTAssertEqual(OwlState.forMaus(nil), .idle)
        XCTAssertEqual(OwlState.forMaus(""), .idle)
    }

    func testEveryMotionHasABeat() {
        let motions = ["arrive", "switch", "customize", "alert", "thinking", "working", "launch", "success", "celebrate",
                       "blink", "surprise", "failure", "spread-wings", "flap", "take-off", "shake", "hoot"]
        XCTAssertEqual(Set(OwlBeat.byMotion.keys), Set(motions))
        for motion in motions {
            let beat = OwlBeat.forMotion(motion)
            XCTAssertTrue(beat?.play != nil || beat?.blink == true || beat?.wings != nil, motion)
        }
        for motion in ["spread-wings", "flap", "take-off", "shake", "hoot"] {
            XCTAssertNotNil(OwlBeat.forMotion(motion)?.wings, motion)
            XCTAssertNotNil(OwlWingMove(motion: motion), motion)
        }
        XCTAssertEqual(OwlBeat.forMotion("celebrate")?.wings, .flap)
        XCTAssertEqual(OwlBeat.forMotion("success")?.wings, .spread)
        XCTAssertEqual(OwlBeat.forMotion("launch")?.wings, .takeoff)
        for quiet in ["blink", "thinking", "failure", "switch"] { XCTAssertNil(OwlBeat.forMotion(quiet)?.wings, quiet) }
        XCTAssertNil(OwlBeat.forMotion("none"))
    }

    // MARK: pose

    func testThePoseFunctionMatchesTheDesktop() {
        // owlPose("success", 0.3, true, 1) on the desktop
        let hop = OwlArt.pose(.success, 0.3)
        XCTAssertEqual(hop.y, -28.8, accuracy: 0.0001)
        XCTAssertEqual(hop.sx, 0.97, accuracy: 0.0001)
        XCTAssertEqual(hop.sy, 1.048, accuracy: 0.0001)
        XCTAssertEqual(hop.gaze, CGPoint(x: 0.6, y: -0.7))
        // owlWingPose("takeoff", 1.1)
        let rise = OwlArt.wingPose(.takeoff, 1.1)
        XCTAssertEqual(rise.open, 0.44022724691939097, accuracy: 1e-9)
        XCTAssertEqual(rise.y, -32.23909101232243, accuracy: 1e-9)
        XCTAssertEqual(rise.sy, 1.03, accuracy: 1e-9)
    }

    func testRestsFolded() {
        for state in OwlState.allCases { XCTAssertEqual(OwlArt.pose(state, 0.4).open, 0, state.rawValue) }
        XCTAssertEqual(OwlArt.nearWing(0, open: 0).degrees, 0)
        XCTAssertEqual(OwlArt.nearWing(0, open: 0).scale, 1)
        XCTAssertFalse(OwlArt.farWing(0, open: 0).visible)
    }

    func testEveryWingMoveOpensThenFoldsAndFinishes() {
        for move in OwlWingMove.allCases {
            let end = move.duration
            let peak = (0..<60).map { OwlArt.wingPose(move, end * Double($0) / 60).open }.max()!
            XCTAssertGreaterThan(peak, 0.25, move.rawValue)
            XCTAssertLessThanOrEqual(peak, 1, move.rawValue)
            XCTAssertLessThan(OwlArt.wingPose(move, 0).open, 0.05, move.rawValue)
            XCTAssertLessThan(OwlArt.wingPose(move, end - 0.001).open, 0.05, move.rawValue)
            XCTAssertTrue(OwlArt.wingPose(move, end).done, move.rawValue)
        }
    }

    func testSpreadsFullyAndTakesOffAboveTheGround() {
        XCTAssertGreaterThan(OwlArt.wingPose(.spread, 0.8).open, 0.95)
        XCTAssertLessThan(OwlArt.wingPose(.takeoff, 1.1).y, -20)
        XCTAssertGreaterThan(OwlArt.wingPose(.takeoff, 1.1, hop: 0.35).y, OwlArt.wingPose(.takeoff, 1.1).y)
    }

    func testStillPoses() {
        XCTAssertEqual(OwlArt.stillPose(.success), OwlArt.pose(.idle, 0))
        XCTAssertEqual(OwlArt.stillPose(.alert).eyeScale, 1.15, accuracy: 0.0001)
        XCTAssertEqual(OwlArt.stillPose(.sleepy).lid, 0.55)
    }

    func testGazeAndSizes() {
        XCTAssertEqual(OwlArt.gazeOffset(nil), OwlArt.gazeRest)
        let far = OwlArt.gazeOffset(CGPoint(x: 3, y: 4))
        XCTAssertEqual(hypot(far.x, far.y), OwlArt.gazeMax, accuracy: 0.0001)
        XCTAssertEqual(OwlArt.hop(forSize: 24), 0.35)
        XCTAssertEqual(OwlArt.hop(forSize: 42), 0.55)
        XCTAssertEqual(OwlArt.hop(forSize: 85), 1)
        XCTAssertEqual(OwlArt.rimWidth(24), 17.07)
        XCTAssertEqual(OwlArt.rimWidth(200), 5)
    }
}
