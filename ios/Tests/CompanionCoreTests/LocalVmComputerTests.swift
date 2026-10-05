// The Local VM screen the iPhone and iPad share with the desktop Computer
// tab: the same states, the same words, and the same two routes.
import XCTest
@testable import CompanionCore

final class LocalVmComputerTests: XCTestCase {
    func testShowsOnlyTheOrganizationLocalComputers() {
        for place in [DesktopWorksOn.vm, .local] {
            XCTAssertTrue(OrgLocalVmScreen.shows(worksOn: place, organization: true))
            XCTAssertFalse(OrgLocalVmScreen.shows(worksOn: place, organization: false))
        }
        for place in [DesktopWorksOn.auto, .cloud, .browser, .off] {
            XCTAssertFalse(OrgLocalVmScreen.shows(worksOn: place, organization: true))
        }
    }

    func testMapsTheDesktopStatus() throws {
        XCTAssertEqual(LocalVmView.of(status: nil, connected: false, pending: nil).problem, .notConnected)
        let stale = try status(#"{"state":"exited","stale":"missing_folder","folder":"/gone"}"#)
        let staleView = LocalVmView.of(status: stale, connected: true, pending: nil)
        XCTAssertEqual(staleView.state, .error)
        XCTAssertEqual(staleView.problem, .stale)
        XCTAssertTrue(staleView.repair)
        XCTAssertTrue(staleView.canPlay)
        XCTAssertTrue(staleView.playNeedsConsent)

        let missing = try status("null")
        let missingView = LocalVmView.of(status: missing, connected: true, pending: nil)
        XCTAssertEqual(missingView.state, .off)
        XCTAssertEqual(missingView.problem, .missing)
        XCTAssertEqual(missingView.setupTitle, "Set up in one click")

        let running = LocalVmView.of(status: try status(#"{"state":"running","stale":null,"folder":"/vm"}"#), connected: true, pending: nil)
        XCTAssertEqual(running.state, .running)
        XCTAssertTrue(running.canPause)
        XCTAssertTrue(running.canStop)
        XCTAssertFalse(running.canPlay)

        let paused = LocalVmView.of(status: try status(#"{"state":"paused","stale":null}"#), connected: true, pending: nil)
        XCTAssertEqual(paused.state, .paused)
        XCTAssertTrue(paused.canResume)
        XCTAssertEqual(paused.playLabel, "Resume")

        let exited = LocalVmView.of(status: try status(#"{"state":"exited","stale":null}"#), connected: true, pending: nil)
        XCTAssertEqual(exited.state, .off)
        XCTAssertTrue(exited.canPlay)
        XCTAssertFalse(exited.playNeedsConsent)
        XCTAssertEqual(exited.setupTitle, "Start")

        XCTAssertEqual(LocalVmView.of(status: missing, connected: true, pending: .setup).state, .starting)
        let foreign = LocalVmView.of(status: try status(#"{"state":"exited","stale":"foreign"}"#), connected: true, pending: nil)
        XCTAssertEqual(foreign.problem, .foreign)
        XCTAssertFalse(foreign.canPlay)

        let stopped = LocalVmView.of(status: try runtimeStatus(daemonUp: false, found: true, cli: "docker", vm: "null"), connected: true, pending: nil)
        XCTAssertEqual(stopped.problem, .runtimeStopped)
        XCTAssertTrue(stopped.canPlay)
        XCTAssertFalse(stopped.playNeedsConsent)
        XCTAssertEqual(stopped.setupTitle, "Start")

        let none = LocalVmView.of(status: try runtimeStatus(daemonUp: false, found: false, cli: nil, vm: "null"), connected: true, pending: nil)
        XCTAssertEqual(none.state, .error)
        XCTAssertEqual(none.problem, .noRuntime)
        XCTAssertNil(none.setupTitle)

        let failed = try runtimeStatus(daemonUp: true, found: true, cli: "docker", vm: "null", setup: #"{"state":"error","steps":[],"error":"boom","code":"no_runtime"}"#)
        XCTAssertEqual(LocalVmView.of(status: failed, connected: true, pending: nil).problem, .noRuntime)
    }

    func testWordsStayTheScreensSentences() throws {
        let gone = LocalVmView.of(status: nil, connected: false, pending: nil)
        XCTAssertEqual(gone.words(status: nil), "Your computer is not connected. Open the Sagax app on it to use its Local VM.")
        let off = LocalVmView.of(status: try status(#"{"state":"exited","stale":null}"#), connected: true, pending: nil)
        XCTAssertEqual(off.words(status: nil), "The Local VM is off. Press Start to turn it on.")
        let starting = try runtimeStatus(
            daemonUp: true, found: true, cli: "docker", vm: "null",
            setup: #"{"state":"running","steps":[{"id":"image","state":"running"}]}"#
        )
        let view = LocalVmView.of(status: starting, connected: true, pending: nil)
        XCTAssertEqual(view.state, .starting)
        XCTAssertEqual(view.words(status: starting), "Step 1 of 1: Desktop image")
    }

    func testInstallChoicesFollowTheComputer() {
        XCTAssertEqual(LocalVmInstall.choices(platform: "darwin").map(\.raw), ["orbstack-download", "docker-download", "orbstack-brew"])
        XCTAssertEqual(LocalVmInstall.choices(platform: "win32").map(\.title), ["Get Docker Desktop (WSL 2)", "Get Podman Desktop"])
        XCTAssertEqual(LocalVmInstall.choices(platform: "linux").map(\.raw), ["docker-download", "podman-download"])
    }

    func testPicksTheOnlineDesktopThatCanRunTheVm() throws {
        let bridge = try JSONDecoder().decode(PersonDesktopBridge.self, from: Data(#"""
        {"connected":true,"desktops":[
          {"platform":"darwin","online":false,"lastSeenAt":9,"capabilities":{"localVm":true}},
          {"platform":"linux","online":true,"lastSeenAt":1,"capabilities":{"localVm":false}},
          {"platform":"darwin","online":true,"lastSeenAt":3,"capabilities":{"localVm":true}}
        ]}
        """#.utf8))
        XCTAssertEqual(bridge.localVmDesktop().connected, true)
        XCTAssertEqual(bridge.localVmDesktop().platform, "darwin")
        let none = try JSONDecoder().decode(PersonDesktopBridge.self, from: Data(#"{"connected":false,"desktops":[]}"#.utf8))
        XCTAssertFalse(none.localVmDesktop().connected)
        let older = try JSONDecoder().decode(PersonDesktopBridge.self, from: Data(#"""
        {"connected":true,"desktops":[
          {"platform":"darwin","online":true,"lastSeenAt":1,"capabilities":{"localVm":true}},
          {"platform":"linux","online":true,"lastSeenAt":4,"capabilities":{"localVm":false}}
        ]}
        """#.utf8))
        XCTAssertFalse(older.localVmDesktop().connected)
        XCTAssertEqual(older.localVmDesktop().platform, "linux")
    }

    func testThePhoneCannotNameTheBotsScreenAction() {
        XCTAssertNil(LocalVmAction(rawValue: "use"))
        XCTAssertNil(LocalVmAction(rawValue: "vm_computer_call"))
    }

    func testReadsTheDesktopAnswer() throws {
        let payload = #"{"runtime":{"found":true,"runtime":"docker","cli":"docker","product":"Docker Desktop","daemonUp":true},"workspace":"/vm","vm":{"state":"exited","stale":"missing_folder","folder":"/gone"},"setup":null}"#
        let outer: [String: Any] = [
            "result": [
                "content": [
                    ["type": "text", "text": payload],
                    ["type": "image", "mimeType": "image/png", "data": "aGVsbG8="],
                ],
            ],
        ]
        let body = try JSONDecoder().decode(LocalVmBridgeBody.self, from: JSONSerialization.data(withJSONObject: outer))
        let answer = LocalVmAnswer.parse(body)
        XCTAssertEqual(answer.status?.vm?.stale, "missing_folder")
        XCTAssertEqual(answer.image, Data("hello".utf8))
        let refused = try JSONDecoder().decode(LocalVmBridgeBody.self, from: Data(#"{"result":{"content":[{"type":"text","text":"nope"}],"isError":true}}"#.utf8))
        let bad = LocalVmAnswer.parse(refused)
        XCTAssertFalse(bad.ok)
        XCTAssertEqual(bad.text, "nope")
        XCTAssertNil(bad.status)
        XCTAssertNil(bad.image)
    }

    func testAsksThePersonsOwnLocalVm() async throws {
        LocalVmRequestStub.body = #"{"result":{"content":[{"type":"text","text":"ok"}]}}"#
        LocalVmRequestStub.status = 200
        LocalVmRequestStub.request = nil
        LocalVmRequestStub.capturedBody = nil
        let session = LocalVmRequestStub.makeSession()
        let client = CompanionClient(connection: Connection(name: "Org", host: "127.0.0.1", port: 8810), token: "phone", session: session)
        let answer = try await client.localVm(action: .screenshot)
        XCTAssertEqual(LocalVmRequestStub.request?.httpMethod, "POST")
        XCTAssertEqual(LocalVmRequestStub.request?.url?.path, "/api/me/desktop-bridge/local-vm")
        XCTAssertEqual(LocalVmRequestStub.request?.timeoutInterval, 150)
        XCTAssertEqual(LocalVmRequestStub.json()?["action"] as? String, "screenshot")
        XCTAssertNil(LocalVmRequestStub.json()?["choice"])
        XCTAssertTrue(answer.ok)

        _ = try await client.localVm(action: .install, choice: "orbstack-download")
        XCTAssertEqual(LocalVmRequestStub.json()?["action"] as? String, "install")
        XCTAssertEqual(LocalVmRequestStub.json()?["choice"] as? String, "orbstack-download")

        LocalVmRequestStub.status = 404
        LocalVmRequestStub.body = #"{"error":"no route"}"#
        let bridge = try await client.personDesktopBridge()
        XCTAssertNil(bridge)
        XCTAssertEqual(LocalVmRequestStub.request?.url?.path, "/api/me/desktop-bridge")
        session.invalidateAndCancel()
    }

    private func status(_ vm: String) throws -> LocalVmStatus {
        try runtimeStatus(daemonUp: true, found: true, cli: "docker", vm: vm)
    }

    private func runtimeStatus(daemonUp: Bool, found: Bool, cli: String?, vm: String, setup: String = "null") throws -> LocalVmStatus {
        let cliJSON = cli.map { "\"\($0)\"" } ?? "null"
        let json = #"{"runtime":{"found":\#(found),"runtime":"docker","cli":\#(cliJSON),"product":"Docker Desktop","daemonUp":\#(daemonUp)},"workspace":"/vm","vm":\#(vm),"setup":\#(setup)}"#
        return try JSONDecoder().decode(LocalVmStatus.self, from: Data(json.utf8))
    }
}

private final class LocalVmRequestStub: URLProtocol {
    static var body = "{}"
    static var status = 200
    static var request: URLRequest?
    static var capturedBody: Data?

    static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [LocalVmRequestStub.self]
        return URLSession(configuration: configuration)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.request = request
        Self.capturedBody = Self.read(request)
        let response = HTTPURLResponse(
            url: request.url!, statusCode: Self.status, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(Self.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    static func json() -> [String: Any]? {
        guard let body = capturedBody else { return nil }
        return try? JSONSerialization.jsonObject(with: body) as? [String: Any]
    }

    private static func read(_ request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1024)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}
