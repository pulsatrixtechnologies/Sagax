// The skin's texture (Grain, Grid, Dots, Lines) over the ground of the chat
// and of the list beside it, as the desktop lays it over the chat's ground
// and the sidebar (src/styles/skin-texture.css). The layers come from the
// desktop's stylesheet (CompanionCore/SkinVariantsData.swift): each is drawn
// once as a small tile in the ground's ink, at the layer's opacity, and
// repeated. Never over bubbles, fields or menus: only the ground views
// carry it. Hibou 98 has none (SkinLook.normalized).
import SwiftUI
import UIKit
import CompanionCore

struct SkinTextureView: View {
    let texture: SkinTexture
    /// The ink of the surface it sits on (the sidebar's on a navy rail).
    let ink: UIColor
    @Environment(\.displayScale) private var scale

    var body: some View {
        let layers = texture.layers
        ZStack {
            ForEach(Array(layers.enumerated()), id: \.offset) { index, layer in
                Image(uiImage: SkinTextureTiles.tile(texture, index: index, layer: layer, ink: ink, scale: scale))
                    .resizable(resizingMode: .tile)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

extension View {
    /// The skin's texture over this ground view, in `ink`; nothing without a texture.
    func skinTexture(_ texture: SkinTexture, ink: UIColor) -> some View {
        overlay { if texture != .none { SkinTextureView(texture: texture, ink: ink) } }
    }
}

@MainActor
enum SkinTextureTiles {
    private static var cache: [String: UIImage] = [:]

    static func tile(_ texture: SkinTexture, index: Int, layer: SkinTextureLayer, ink: UIColor, scale: CGFloat) -> UIImage {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        ink.getRed(&r, green: &g, blue: &b, alpha: &a)
        let key = "\(texture.rawValue)-\(index)-\(Int(r * 255))-\(Int(g * 255))-\(Int(b * 255))-\(scale)"
        if let image = cache[key] { return image }
        let image = draw(layer, color: UIColor(red: r, green: g, blue: b, alpha: a * layer.alpha), scale: max(scale, 1))
        cache[key] = image
        return image
    }

    /// One tile in pixels, rounded so the repeat has no seam.
    private static func draw(_ layer: SkinTextureLayer, color: UIColor, scale: CGFloat) -> UIImage {
        let px = { (points: Double) in max(1, (CGFloat(points) * scale).rounded()) }
        let size: CGSize
        switch layer.kind {
        // the period across the lines, as the side of a square tile the lines cross corner to corner
        case .diagonal: size = CGSize(width: px(layer.tileWidth * 2.squareRoot()), height: px(layer.tileWidth * 2.squareRoot()))
        default: size = CGSize(width: px(layer.tileWidth), height: px(layer.tileHeight))
        }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
            let cg = context.cgContext
            cg.setFillColor(color.cgColor)
            cg.setStrokeColor(color.cgColor)
            let width = CGFloat(layer.size) * scale
            switch layer.kind {
            case .dot:
                let radius = CGFloat(layer.size) * scale
                let centre = CGPoint(x: CGFloat(layer.x) * scale, y: CGFloat(layer.y) * scale)
                cg.fillEllipse(in: CGRect(x: centre.x - radius, y: centre.y - radius, width: radius * 2, height: radius * 2))
            case .vertical:
                cg.fill(CGRect(x: 0, y: 0, width: width, height: size.height))
            case .horizontal:
                cg.fill(CGRect(x: 0, y: 0, width: size.width, height: width))
            case .diagonal:
                // x + y = c for c = 0, side, 2 side: lines rising to the right, one period apart
                let side = size.width
                cg.setLineWidth(width)
                for c in [0, side, side * 2] {
                    cg.move(to: CGPoint(x: -side, y: c + side))
                    cg.addLine(to: CGPoint(x: side * 2, y: c - side * 2))
                }
                cg.strokePath()
            }
        }
        guard let cgImage = image.cgImage else { return image }
        return UIImage(cgImage: cgImage, scale: scale, orientation: .up)
    }
}
