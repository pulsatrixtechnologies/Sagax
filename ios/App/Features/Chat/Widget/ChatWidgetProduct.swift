// Shopping cards (shared/widget.ts "Products"), the desktop's WidgetProduct
// in SwiftUI: a Carousel of Products side by side, in stock first, and one
// Product's card: its picture, name, rating, price, store, badges and stock,
// then Buy now and View. The picture and the buttons are the Product's own
// Image and Button children, drawn by the usual views, so the image waits for
// its tap and a press goes the usual way.
import CompanionCore
import SwiftUI

enum ChatWidgetProductFormat {
    /// A price in the phone's locale when the currency is known, else as written.
    static func price(_ amount: String?, _ currency: String?) -> String? {
        guard let amount, !amount.isEmpty else { return nil }
        if let currency, let value = Double(amount) {
            return value.formatted(.currency(code: currency))
        }
        return [amount, currency].compactMap { $0 }.joined(separator: " ")
    }
}

struct ChatWidgetProduct: View {
    let node: ChatWidgetNode
    var inCarousel = false
    @Environment(\.chatWidgetInk) private var ink

    var body: some View {
        let title = node.string("title") ?? ""
        let currency = node.string("currency")
        let price = ChatWidgetProductFormat.price(node.string("price"), currency)
        let was = ChatWidgetProductFormat.price(node.string("compareAtPrice"), currency)
        let badges = node["badges"]?.array?.compactMap(\.string) ?? []
        let outOfStock = node["inStock"]?.bool == false
        let image = node.children.first { $0.type == "Image" }
        let buttons = node.children.filter { $0.type == "Button" }
        VStack(alignment: .leading, spacing: 8) {
            if let image {
                ChatWidgetNodeView(node: image)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            VStack(alignment: .leading, spacing: 4) {
                if !badges.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(Array(badges.enumerated()), id: \.offset) { index, label in
                            ChatWidgetBadge(node: ChatWidgetNode(type: "Badge", id: "\(node.id)-b\(index)", props: [
                                "label": .string(label), "size": .string("sm"), "color": .string(index == 0 ? "info" : "secondary"),
                            ]))
                        }
                    }
                }
                Text(verbatim: title)
                    .font(ink.font(14, .medium))
                    .foregroundStyle(ink.ink)
                    .lineLimit(2)
                    .frame(minHeight: 40, alignment: .topLeading)
                if let rating = node.number("rating") {
                    rated(rating, reviews: node.number("reviews"))
                }
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    if let price {
                        Text(verbatim: price).font(ink.font(17, .semibold)).monospacedDigit().foregroundStyle(ink.ink)
                    }
                    if let was {
                        Text(verbatim: was).font(ink.font(12)).monospacedDigit().strikethrough().foregroundStyle(ink.tertiary)
                            .accessibilityLabel(Text("Was \(was)"))
                    }
                }
                if let store = node.string("store") {
                    Text("Sold by \(store)").font(ink.font(12)).foregroundStyle(ink.secondary).lineLimit(1)
                }
                Group {
                    if outOfStock {
                        Text("Out of stock")
                    } else if let delivery = node.string("delivery") {
                        Text(verbatim: delivery)
                    } else {
                        Text("In stock")
                    }
                }
                .font(ink.font(12))
                .foregroundStyle(outOfStock ? ink.danger : ink.success)
                .lineLimit(1)
            }
            if !buttons.isEmpty {
                Spacer(minLength: 0)
                VStack(spacing: 6) {
                    ForEach(buttons) { button in ChatWidgetNodeView(node: button) }
                }
            }
        }
        .padding(12)
        .frame(width: inCarousel ? 212 : nil, alignment: .topLeading)
        .frame(maxWidth: inCarousel ? nil : .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(ink.inset, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .opacity(outOfStock ? 0.8 : 1)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityIdentifier("widget-product-\(node.id)")
    }

    private func rated(_ value: Double, reviews: Double?) -> some View {
        HStack(spacing: 4) {
            HStack(spacing: 0) {
                ForEach(0..<5, id: \.self) { index in
                    let fill = max(0, min(1, value - Double(index)))
                    Image(systemName: fill >= 0.75 ? "star.fill" : fill >= 0.25 ? "star.leadinghalf.filled" : "star")
                        .font(.system(size: 10))
                        .foregroundStyle(ink.warning)
                }
            }
            Text(verbatim: String(format: "%.1f", value)).monospacedDigit()
            if let reviews {
                Text(verbatim: "(\(Int(reviews).formatted()))").foregroundStyle(ink.tertiary)
            }
        }
        .font(ink.font(12))
        .foregroundStyle(ink.secondary)
        .lineLimit(1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(String(format: "%.1f", value)) out of 5"))
    }
}

struct ChatWidgetCarousel: View {
    let node: ChatWidgetNode
    @Environment(\.chatWidgetInk) private var ink

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title = node.string("title") {
                Text(verbatim: title).font(ink.font(13, .medium)).foregroundStyle(ink.secondary)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 8) {
                    ForEach(node.children.filter { $0.type == "Product" }) { product in
                        ChatWidgetProduct(node: product, inCarousel: true)
                    }
                }
            }
        }
        .accessibilityIdentifier("widget-carousel-\(node.id)")
    }
}
