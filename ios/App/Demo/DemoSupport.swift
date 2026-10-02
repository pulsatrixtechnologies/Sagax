// The app side of demo mode: launch options, the made-up computer screen,
// and the banner that says it is a demo. The data and the fake server live
// in CompanionCore (`DemoServer`, `DemoFixture`).
import CompanionCore
import SwiftUI
import UIKit

enum DemoLaunch {
    /// `-demo` opens the demo at launch (screenshots, UI tests).
    static var opensAtLaunch: Bool { ProcessInfo.processInfo.arguments.contains("-demo") }

    /// `-demo-clock <epoch seconds>` pins the demo's clock so every capture
    /// shows the same times.
    static var clock: Date? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-demo-clock"), index + 1 < arguments.count,
              let seconds = TimeInterval(arguments[index + 1]) else { return nil }
        return Date(timeIntervalSince1970: seconds)
    }
}

/// Forge's computer in the demo: a drawn desktop with a terminal running the
/// release checks. Drawn on the phone, so no image ships and nothing is
/// fetched.
enum DemoScreen {
    static func pngBase64() -> String? {
        let size = CGSize(width: 1280, height: 800)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
            let cg = context.cgContext
            // desktop
            let colors = [UIColor(hex: 0x1D2B53).cgColor, UIColor(hex: 0x7E2553).cgColor] as CFArray
            if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
                cg.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: size.width, y: size.height), options: [])
            }
            // menu bar
            UIColor(white: 0, alpha: 0.35).setFill()
            cg.fill(CGRect(x: 0, y: 0, width: size.width, height: 28))
            draw("Forge's computer", at: CGPoint(x: 16, y: 6), size: 14, color: .white, weight: .semibold)
            // terminal window
            let window = CGRect(x: 120, y: 90, width: 1040, height: 600)
            UIColor(hex: 0x141414).setFill()
            UIBezierPath(roundedRect: window, cornerRadius: 14).fill()
            UIColor(hex: 0x2A2A2A).setFill()
            UIBezierPath(roundedRect: CGRect(x: window.minX, y: window.minY, width: window.width, height: 36), byRoundingCorners: [.topLeft, .topRight], cornerRadii: CGSize(width: 14, height: 14)).fill()
            for (index, hex) in [0xFF5F57, 0xFEBC2E, 0x28C840].enumerated() {
                UIColor(hex: UInt32(hex)).setFill()
                UIBezierPath(ovalIn: CGRect(x: window.minX + 16 + CGFloat(index) * 22, y: window.minY + 12, width: 13, height: 13)).fill()
            }
            draw("release-check", at: CGPoint(x: window.midX - 50, y: window.minY + 10), size: 14, color: UIColor(white: 0.7, alpha: 1), weight: .medium)
            let lines: [(String, UInt32)] = [
                ("$ make release-check", 0xE6E6E6),
                ("Building signed archive ... done (2m 14s)", 0xB5B5B5),
                ("Running unit tests ... 1,284 passed", 0x68CE67),
                ("Running UI tests ... 96 passed", 0x68CE67),
                ("Checking privacy manifest ... ok", 0x68CE67),
                ("Uploading symbols ... 62%", 0xFEBC2E),
                ("", 0xE6E6E6),
                ("Waiting on approval: TestFlight upload (Scout)", 0x9C9BA1),
            ]
            for (index, line) in lines.enumerated() {
                draw(line.0, at: CGPoint(x: window.minX + 28, y: window.minY + 64 + CGFloat(index) * 34), size: 20, color: UIColor(hex: line.1), weight: .regular, mono: true)
            }
        }
        return image.pngData()?.base64EncodedString()
    }

    private static func draw(_ text: String, at point: CGPoint, size: CGFloat, color: UIColor, weight: UIFont.Weight, mono: Bool = false) {
        let font = mono ? UIFont.monospacedSystemFont(ofSize: size, weight: weight) : UIFont.systemFont(ofSize: size, weight: weight)
        (text as NSString).draw(at: point, withAttributes: [.font: font, .foregroundColor: color])
    }
}

/// The card at the top of the home while the demo is open.
struct DemoBanner: View {
    @EnvironmentObject private var session: Session

    var body: some View {
        HStack(spacing: 10) {
            Text("Demo")
                .font(Theme.Font.roleChip)
                .foregroundStyle(Color.black)
                .padding(.horizontal, 8)
                .frame(height: Theme.Metric.chipHeight)
                .background(Color.white, in: RoundedRectangle(cornerRadius: Theme.Metric.chipRadius, style: .continuous))
                .accessibilityIdentifier("demo-badge")
            Text("Made-up data, nothing leaves this phone.")
                .font(Theme.Font.label)
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer(minLength: 6)
            Button {
                Haptics.selection()
                session.exitDemo()
            } label: {
                Text("Exit demo")
                    .font(Theme.Font.buttonLabel)
                    .foregroundStyle(Theme.textPrimary)
                    .padding(.horizontal, 12)
                    .frame(height: 30)
                    .themeGlass(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("demo-exit")
        }
        .padding(.leading, 14)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
        .padding(.horizontal, Theme.Metric.screenEdge)
        .padding(.bottom, 6)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("demo-banner")
    }
}
