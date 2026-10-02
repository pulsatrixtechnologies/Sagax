// A bot's character drawn from its stored look: the owl, one of the original
// shapes, or Trombi (`CharacterAvatar` and `MausAvatar` in the desktop's
// `Avatar.tsx`). No picture and no network here, so the widgets and the Live
// Activity can draw it too; `BotMascotView` adds the uploaded picture.
import CompanionCore
import SwiftUI

struct MascotCharacterView: View {
    let look: CompleteMascotLook
    /// A bot colour name; the owl and the shapes wear it, Trombi has none.
    let color: String
    var skin: MascotSkin = .none
    var size: CGFloat = 44
    var state: MausState = .idle
    var animated = false
    /// Wing moves and beats for the owl (profile preview).
    var owlHandle: OwlMascotHandle?

    var body: some View {
        switch look.character {
        case .owl:
            OwlMascotView(color: color, skin: skin, size: size, state: state.owlState, animated: animated, handle: owlHandle)
        case .shape:
            ShapeMascotView(shape: look.shape, skin: look.shapeSkin, color: color, size: size, mood: state.shapeMood, animated: animated)
        case .trombi:
            TrombiMascotView(skin: look.trombiSkin, size: size, pose: state.trombiPose, animated: animated)
        }
    }
}

extension MascotCharacterView {
    /// The bot's own character, colour and skin.
    init(bot: Bot, size: CGFloat, state: MausState = .idle, animated: Bool = false, owlHandle: OwlMascotHandle? = nil) {
        self.init(look: bot.resolvedMascotLook, color: bot.color, skin: bot.resolvedMascotSkin, size: size, state: state, animated: animated, owlHandle: owlHandle)
    }
}

/// A room's face: its members' own mascots in one frame, the three-member
/// layout of the reference's pinned group (`measure-home.md`): each member at
/// 0.57 of the frame, the back one up top, then bottom-left, then the front
/// one bottom-right, each cut out of those behind it by a background-coloured
/// outline about 0.062 of the frame wide.
struct GroupMascotView: View {
    let members: [Bot]
    var size: CGFloat = 52
    /// The surface the group sits on, which the cut-outs are painted in.
    var background: Color = Color(uiColor: .systemBackground)
    var state: MausState = .happy

    /// Offsets from the frame centre, as fractions of the frame.
    static let three: [CGPoint] = [CGPoint(x: -0.008, y: -0.236), CGPoint(x: -0.241, y: 0.234), CGPoint(x: 0.233, y: 0.235)]
    static let two: [CGPoint] = [CGPoint(x: -0.19, y: -0.19), CGPoint(x: 0.19, y: 0.19)]
    static let memberScale: CGFloat = 0.57
    static let cutout: CGFloat = 0.062

    var body: some View {
        ZStack {
            switch members.count {
            case 0:
                OwlMascotView(color: "blue", size: size, state: .success)
            case 1:
                MascotCharacterView(bot: members[0], size: size, state: state)
            default:
                let shown = Array(members.prefix(3))
                let offsets = shown.count == 2 ? Self.two : Self.three
                let member = size * (shown.count == 2 ? 0.62 : Self.memberScale)
                ForEach(Array(shown.enumerated()), id: \.offset) { index, bot in
                    MascotCharacterView(bot: bot, size: member, state: state)
                        .modifier(CutOut(width: index == 0 ? 0 : size * Self.cutout, color: background))
                        .offset(x: offsets[index].x * size, y: offsets[index].y * size)
                }
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// A background-coloured outline around a mascot's own silhouette, so it
/// reads as cut out of whatever is behind it: the mascot's alpha, filled
/// with the background and stamped around a ring.
private struct CutOut: ViewModifier {
    let width: CGFloat
    let color: Color

    func body(content: Content) -> some View {
        if width <= 0 {
            content
        } else {
            content.background {
                ZStack {
                    ForEach(0..<16, id: \.self) { i in
                        let a = Double(i) / 16 * 2 * .pi
                        color
                            .mask(content)
                            .offset(x: cos(a) * width, y: sin(a) * width)
                    }
                    color.mask(content)
                }
            }
        }
    }
}

/// A still mascot for the places that only render snapshots: the widgets and
/// the Live Activity. A bot's chat draws its own character; anything else
/// (a room, no chat at all) draws the owl in `color`.
struct MascotStill: View {
    var chat: Chat?
    var color: String
    var look: CompleteMascotLook = MascotLook.owl.complete
    var skin: MascotSkin = .none
    var state: MausState = .idle
    var size: CGFloat = 52
    var comets = false
    /// The clock for the comets' phase; a different date is a different frame.
    var at: Date = Date()

    var body: some View {
        MascotComets(size: size, active: comets, at: at) {
            if case let .bot(bot)? = chat {
                MascotCharacterView(bot: bot, size: size, state: state)
            } else {
                MascotCharacterView(look: look, color: color, skin: skin, size: size, state: state)
            }
        }
        .frame(width: size, height: size)
    }
}
