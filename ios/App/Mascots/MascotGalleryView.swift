// DEBUG only: every character, skin and a few colours at the reference's
// frame sizes (24, 42, 85 pt), for comparing the phone's renders with the
// desktop's. Launch with `-mascotGallery owl|shape|trombi|group`; the same
// pages are rendered from the desktop components by
// `ios/parity/mascot-gallery.render.ts`, with the same layout.
import SwiftUI
#if DEBUG
import CompanionCore
import UIKit

struct MascotGalleryView: View {
    let page: String

    static var requestedPage: String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let i = arguments.firstIndex(of: "-mascotGallery") else { return nil }
        return i + 1 < arguments.count ? arguments[i + 1] : "owl"
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color(hex: "#141414")
            VStack(alignment: .leading, spacing: 10) {
                Text(verbatim: "iOS · \(page)")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                switch page {
                case "shape": shapes
                case "trombi": trombis
                case "group": groups
                default: owls
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 60)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .ignoresSafeArea()
        .preferredColorScheme(.dark)
    }

    private func label(_ text: String) -> some View {
        Text(verbatim: text)
            .font(.system(size: 11))
            .foregroundStyle(Color.white.opacity(0.6))
    }

    private func row<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            label(title)
            HStack(alignment: .bottom, spacing: 8) { content() }
        }
    }

    private func character(_ look: CompleteMascotLook, _ color: String, _ skin: MascotSkin = .none, _ size: CGFloat, _ state: MausState = .idle) -> some View {
        MascotCharacterView(look: look, color: color, skin: skin, size: size, state: state)
    }

    // MARK: pages

    private var owls: some View {
        let owl = MascotLook.owl.complete
        return VStack(alignment: .leading, spacing: 10) {
            ForEach(MascotSkin.allCases, id: \.self) { skin in
                row(skin.rawValue) {
                    character(owl, "green", skin, 24)
                    character(owl, "green", skin, 42)
                    character(owl, "blue", skin, 42)
                    character(owl, "black", skin, 42)
                    character(owl, "white", skin, 42)
                    character(owl, "green", skin, 85)
                }
            }
        }
    }

    private var shapes: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(ShapeSkin.allCases, id: \.self) { skin in
                row(skin.rawValue) {
                    ForEach(MascotShape.allCases, id: \.self) { shape in
                        character(CompleteMascotLook(character: .shape, shape: shape, shapeSkin: skin), "purple", .none, 36)
                    }
                }
            }
            row("sizes, colours") {
                character(CompleteMascotLook(character: .shape), "red", .none, 24)
                character(CompleteMascotLook(character: .shape), "red", .none, 42)
                character(CompleteMascotLook(character: .shape), "red", .none, 85)
                character(CompleteMascotLook(character: .shape, shape: .cloud, shapeSkin: .glossy), "blue", .none, 85)
            }
            row("moods: thinking, working, happy, sleeping") {
                character(CompleteMascotLook(character: .shape, shape: .squircle), "teal", .none, 60, .thinking)
                character(CompleteMascotLook(character: .shape, shape: .squircle), "teal", .none, 60, .working)
                character(CompleteMascotLook(character: .shape, shape: .squircle), "teal", .none, 60, .happy)
                character(CompleteMascotLook(character: .shape, shape: .squircle), "teal", .none, 60, .sleeping)
            }
        }
    }

    private var trombis: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(TrombiSkin.allCases, id: \.self) { skin in
                row(skin.rawValue) {
                    let look = CompleteMascotLook(character: .trombi, trombiSkin: skin)
                    character(look, "green", .none, 24)
                    character(look, "green", .none, 42)
                    character(look, "green", .none, 85)
                }
            }
            row("poses: idle, think, celebrate, sleep") {
                let look = CompleteMascotLook(character: .trombi)
                character(look, "green", .none, 85, .idle)
                character(look, "green", .none, 85, .working)
                character(look, "green", .none, 85, .happy)
                character(look, "green", .none, 85, .sleeping)
            }
        }
    }

    private static func bot(_ id: String, _ color: String, _ look: MascotLook?, _ skin: MascotSkin? = nil) -> Bot {
        let json = """
        {"id":"\(id)","threadId":"\(id)","name":"\(id)","title":"","description":"","notifications":true,
         "color":"\(color)","unread":false,"modelSelection":{"instanceId":"e","model":"m"},"createdAt":0}
        """
        var bot = try! JSONDecoder().decode(Bot.self, from: Data(json.utf8))
        bot.mascotLook = look
        bot.mascotSkin = skin
        return bot
    }

    private var groups: some View {
        let members = [
            Self.bot("a", "white", MascotLook(character: .shape, shape: .triangle)),
            Self.bot("b", "blue", MascotLook(character: .shape, shape: .drop)),
            Self.bot("c", "purple", MascotLook(character: .shape, shape: .circle)),
        ]
        let mixed = [Self.bot("d", "orange", nil), Self.bot("e", "teal", MascotLook(character: .trombi)), Self.bot("f", "pink", nil, .gold)]
        let picture = Bundle.main.url(forResource: "ImagePreview", withExtension: "png").flatMap { UIImage(contentsOfFile: $0.path) }
        return VStack(alignment: .leading, spacing: 10) {
            row("group 85: shapes, owls + trombi, two") {
                GroupMascotView(members: members, size: 85, background: Color(hex: "#141414"))
                GroupMascotView(members: mixed, size: 85, background: Color(hex: "#141414"))
                GroupMascotView(members: Array(members.prefix(2)), size: 85, background: Color(hex: "#141414"))
            }
            row("group 42") {
                GroupMascotView(members: members, size: 42, background: Color(hex: "#141414"))
                GroupMascotView(members: mixed, size: 42, background: Color(hex: "#141414"))
            }
            if let picture {
                row("picture: circle, rounded, square, zoom 2 @ (0.2, 0.3)") {
                    FramedPicture(image: picture, size: 85, crop: .circle)
                    FramedPicture(image: picture, size: 85, crop: .rounded)
                    FramedPicture(image: picture, size: 85, crop: .square)
                    FramedPicture(image: picture, size: 85, crop: .circle, zoom: 2, focusX: 0.2, focusY: 0.3)
                }
            }
            row("owl wings open (still), alert, sleepy") {
                OwlMascotView(color: "green", size: 85, wings: 1)
                OwlMascotView(color: "red", size: 85, state: .alert)
                OwlMascotView(color: "purple", size: 85, state: .sleepy)
            }
        }
    }
}
/// The app's root, or the gallery when launched with `-mascotGallery`.
struct MascotGalleryGate<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        if let page = MascotGalleryView.requestedPage {
            MascotGalleryView(page: page)
        } else {
            content()
        }
    }
}
#else
/// Release builds have no gallery.
struct MascotGalleryGate<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View { content() }
}
#endif
