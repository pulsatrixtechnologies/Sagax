// Small carriers for sharing and selecting a message's text.
import SwiftUI
import UIKit

struct ShareFile: Identifiable {
    let url: URL
    var id: String { url.path }
}

/// A message's text on its way to the selection sheet.
struct SelectableText: Identifiable {
    let id = UUID()
    let text: String
}

struct ActivityShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
