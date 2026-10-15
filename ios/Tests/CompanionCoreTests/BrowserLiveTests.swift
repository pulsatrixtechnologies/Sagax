// Browser mode of the Computer tab: the live browser stream's messages, the
// view folded from them, and the SSE event name the stream relies on.
import XCTest
@testable import CompanionCore

final class BrowserLiveTests: XCTestCase {
    func testParsesTheViewerProtocol() {
        XCTAssertEqual(BrowserLiveMessage.parse(event: "ready", data: #"{"viewerId":"v1"}"#), .ready(viewerId: "v1"))
        XCTAssertEqual(BrowserLiveMessage.parse(event: "waiting", data: #"{"reason":"busy"}"#), .waiting(reason: "busy"))
        let png = Data([0x89, 0x50, 0x4E, 0x47]).base64EncodedString()
        XCTAssertEqual(BrowserLiveMessage.parse(event: "frame", data: #"{"seq":7,"data":"\#(png)","format":"png","metadata":{"deviceWidth":1440,"deviceHeight":900}}"#),
                       .frame(seq: 7, image: Data([0x89, 0x50, 0x4E, 0x47]), width: 1440, height: 900))
        XCTAssertEqual(BrowserLiveMessage.parse(event: "url", data: #"{"url":"https://example.test/a"}"#), .url("https://example.test/a"))
        XCTAssertEqual(BrowserLiveMessage.parse(event: "tabs", data: #"{"tabs":[{"tabId":"t1","title":"A","url":"https://a.test/","active":false},{"tabId":"t2","title":"B","url":"https://b.test/","active":true}]}"#),
                       .tabs([BrowserLiveTab(tabId: "t1", title: "A", url: "https://a.test/", active: false), BrowserLiveTab(tabId: "t2", title: "B", url: "https://b.test/", active: true)]))
        XCTAssertEqual(BrowserLiveMessage.parse(event: "status", data: #"{"connected":true,"screencasting":true}"#), .status(connected: true))
        XCTAssertEqual(BrowserLiveMessage.parse(event: "error", data: #"{"retryable":false,"message":"Gone"}"#), .error(message: "Gone", retryable: false))
        XCTAssertEqual(BrowserLiveMessage.parse(event: "heartbeat", data: "{}"), .heartbeat)
        // what this build does not read is skipped, never a crash
        XCTAssertNil(BrowserLiveMessage.parse(event: "dialog", data: #"{"held":true}"#))
        XCTAssertNil(BrowserLiveMessage.parse(event: "frame", data: #"{"seq":0,"data":"x"}"#))
        XCTAssertNil(BrowserLiveMessage.parse(event: nil, data: "{}"))
        XCTAssertNil(BrowserLiveMessage.parse(event: "ready", data: "not json"))
    }

    func testTheViewFoldsTheStreamAndAcknowledgesEachFrame() {
        var state = BrowserLiveState()
        XCTAssertNil(state.apply(.ready(viewerId: "v1")))
        XCTAssertEqual(state.viewerId, "v1")
        XCTAssertNil(state.apply(.waiting(reason: "busy")))
        XCTAssertTrue(state.waiting)
        XCTAssertEqual(state.apply(.frame(seq: 3, image: Data([1]), width: 800, height: 600)), 3)
        XCTAssertFalse(state.waiting)
        XCTAssertEqual(state.size, BrowserPageSize(width: 800, height: 600))
        _ = state.apply(.tabs([BrowserLiveTab(tabId: "t1", title: "Docs", url: "https://docs.test/", active: true)]))
        XCTAssertEqual(state.title, "Docs")
        XCTAssertEqual(state.url, "https://docs.test/")
        _ = state.apply(.error(message: "Gone", retryable: true))
        XCTAssertEqual(state.error, "Gone")
    }

    func testTheParserKeepsTheEventName() {
        var parser = SSEParser()
        XCTAssertNil(parser.line("event: ready"))
        XCTAssertNil(parser.line(#"data: {"viewerId":"v1"}"#))
        let event = parser.line("")
        XCTAssertEqual(event?.event, "ready")
        XCTAssertEqual(BrowserLiveMessage.parse(event: event?.event, data: event?.data ?? ""), .ready(viewerId: "v1"))
    }
}

final class BrowserLivePreviewTests: XCTestCase {
    func testParsesControlAndOffline() {
        XCTAssertEqual(BrowserLiveMessage.parse(event: "control", data: #"{"held":true,"owned":true,"controlling":false}"#),
                       .control(held: true, owned: true, controlling: false))
        XCTAssertEqual(BrowserLiveMessage.parse(event: "offline", data: "{}"), .offline)
        XCTAssertNil(BrowserLiveMessage.parse(event: "control", data: #"{"owned":true}"#))
        var state = BrowserLiveState()
        _ = state.apply(.control(held: true, owned: true, controlling: true))
        XCTAssertTrue(state.held)
        XCTAssertTrue(state.owned)
        XCTAssertTrue(state.controlling)
        _ = state.apply(.offline)
        XCTAssertTrue(state.offline)
    }

    func testThePreviewAsksForTheWatchOnlyStream() throws {
        let client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t")
        let preview = try client.browserLiveRequest(botId: "b1", preview: true)
        XCTAssertEqual(preview.url?.path, "/api/bots/b1/browser/live")
        XCTAssertEqual(preview.url?.query, "preview=1")
        let full = try client.browserLiveRequest(botId: "b1", preview: false)
        XCTAssertNil(full.url?.query)
    }

    func testActionBodiesMatchTheServerParser() {
        XCTAssertEqual(BrowserLiveAction.take.body as NSDictionary, ["type": "take"])
        XCTAssertEqual(BrowserLiveAction.release.body as NSDictionary, ["type": "release"])
        XCTAssertEqual(BrowserLiveAction.reload.body as NSDictionary, ["type": "reload"])
        XCTAssertEqual(BrowserLiveAction.mouse(event: "mousePressed", x: 10.4, y: 20.6, button: "left", clickCount: 1).body as NSDictionary,
                       ["type": "input_mouse", "eventType": "mousePressed", "x": 10.0, "y": 21.0, "button": "left", "clickCount": 1])
        XCTAssertEqual(BrowserLiveAction.mouse(event: "mouseWheel", x: -5, y: 9000, deltaX: 0, deltaY: 120).body as NSDictionary,
                       ["type": "input_mouse", "eventType": "mouseWheel", "x": 0.0, "y": 8192.0, "button": "none", "clickCount": 0, "deltaX": 0.0, "deltaY": 120.0])
        XCTAssertEqual(BrowserLiveAction.text("bonjour").body as NSDictionary, ["type": "input_keyboard", "eventType": "char", "text": "bonjour"])
        XCTAssertEqual(BrowserLiveAction.key("Backspace").body as NSDictionary, ["type": "input_keyboard", "eventType": "keyDown", "key": "Backspace"])
        XCTAssertEqual(BrowserLiveAction.special(.up), .key("ArrowUp"))
        XCTAssertEqual(BrowserLiveAction.typed("ab\ncd"), [.text("ab"), .key("Enter"), .text("cd")])
        XCTAssertTrue(BrowserLiveAction.mouse(event: "mousePressed", x: 0, y: 0).interacts)
        XCTAssertFalse(BrowserLiveAction.mouse(event: "mouseReleased", x: 0, y: 0).interacts)
        XCTAssertFalse(BrowserLiveAction.take.interacts)
        XCTAssertTrue(BrowserLiveAction.back.interacts)
    }

    func testAPointOnThePictureLandsOnThePage() {
        let page = BrowserPageSize(width: 1280, height: 800)
        // a 16:10 page in a 320x400 view: 200pt tall, centered, 100pt bars
        let point = BrowserPagePoint.map(x: 160, y: 200, viewWidth: 320, viewHeight: 400, page: page)
        XCTAssertEqual(point?.x ?? 0, 640, accuracy: 0.01)
        XCTAssertEqual(point?.y ?? 0, 400, accuracy: 0.01)
        XCTAssertNil(BrowserPagePoint.map(x: 160, y: 50, viewWidth: 320, viewHeight: 400, page: page))
    }
}
