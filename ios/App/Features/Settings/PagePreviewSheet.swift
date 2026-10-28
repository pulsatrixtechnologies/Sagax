// A page opened from Settings > Published pages: the same full page as
// over a conversation (PageSurfaceView: ×, the title pill, « ⋯ », Share),
// without a composer. The page is the server's preview wrapper with this
// phone's bearer; later loads stay on the API origin and on the preview or
// preview-frame path (PagePreview.allows).
import CompanionCore
import SwiftUI

struct PagePreviewSheet: View {
    let pageID: String
    let version: Int
    var title = ""
    var onChange: ((PublishedPageSummary) -> Void)?

    var body: some View {
        PageFullScreen(pageId: pageID, version: version, title: title, onChange: onChange)
    }
}
