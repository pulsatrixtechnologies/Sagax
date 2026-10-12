// DEBUG only. The macOS CI job launches the simulator app with
// `-providerSetupPreview` and takes one screenshot. No pairing, no key,
// and no page is opened. Release builds omit this file's type.
import Foundation
import SwiftUI
#if DEBUG
import CompanionCore

struct ProviderSetupPreview: View {
    static var requested: Bool {
        ProcessInfo.processInfo.arguments.contains("-providerSetupPreview")
    }

    private let client = ProviderSetupPreview.client
    private let engines = ProviderSetupPreview.engines

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Model providers")
                    .font(.system(size: 22, weight: .semibold))
                ForEach(engines, id: \.instanceId) { engine in
                    VStack(alignment: .leading, spacing: 0) {
                        Text(verbatim: engine.name)
                            .font(.system(size: 17, weight: .semibold))
                            .padding(.horizontal, 16)
                            .padding(.top, 14)
                        DesktopEngineSetup(
                            engine: engine,
                            client: client,
                            reload: { () async in },
                            openKeys: { _ in }
                        )
                    }
                    .background(Color(white: 0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color(white: 0.05))
        .accessibilityIdentifier("provider-setup-preview")
    }

    private static var client: CompanionClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ProviderSetupStubProtocol.self]
        return CompanionClient(
            connection: Connection(name: "Preview", host: "127.0.0.1", port: 9),
            token: "preview",
            session: URLSession(configuration: configuration)
        )
    }

    /// One open-link card and one key card. The key field stays empty.
    private static var engines: [DesktopEngine] {
        let json = """
        [
          {
            "instanceId": "cursor",
            "driverKind": "cursorAgent",
            "displayName": "Cursor",
            "snapshot": { "state": "unavailable", "authenticated": false },
            "authentication": { "method": "open-link" },
            "install": { "apiKey": true, "signInCommand": "cursor-agent login" }
          },
          {
            "instanceId": "minimax",
            "driverKind": "minimax",
            "displayName": "MiniMax",
            "snapshot": { "state": "unavailable", "authenticated": false },
            "install": { "apiKey": true }
          }
        ]
        """
        return (try? JSONDecoder().decode([DesktopEngine].self, from: Data(json.utf8))) ?? []
    }
}

/// Answers the key-status read with `{ configured: false }`. The preview
/// never sends a key and never leaves the device.
private final class ProviderSetupStubProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let body = Data(#"{"configured":false}"#.utf8)
        let response = HTTPURLResponse(
            url: request.url ?? URL(string: "http://127.0.0.1/")!,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
#endif
