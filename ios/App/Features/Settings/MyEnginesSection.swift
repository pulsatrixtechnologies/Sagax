// Settings > My engines (#1098, `src/components/settings/MyEngines.tsx`):
// each engine the organization offers this person, what their own turns on
// it run with, and their own subscription sign-in (Connect, a code to type
// or paste, Sign out). The server's list is the lock: an engine it does not
// offer is never shown, and the sign-in is always the person's own, never
// the server's. Keys are set in Perspicax (one link).
import CompanionCore
import SwiftUI

@MainActor
final class MyEnginesModel: ObservableObject {
    @Published var list: MyEnginesList?
    @Published var loadError: String?
    /// The engine whose action is running.
    @Published var busy: String?
    /// A sign-in waiting for the provider's page, by engine.
    @Published var login: [String: EngineLoginState] = [:]
    @Published var codes: [String: String] = [:]
    @Published var errors: [String: String] = [:]
    var client: CompanionClient?
    private var polls: [String: Task<Void, Never>] = [:]

    func refresh() async {
        guard let client else { return }
        do {
            list = try await client.myEngines()
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    func signIn(_ engine: MyEngine, open: (URL) -> Void) async {
        guard let client, busy == nil else { return }
        busy = engine.id
        errors[engine.id] = nil
        defer { busy = nil }
        do {
            guard let auth = try await client.startEngineLogin(instanceId: engine.id), auth.phase != "succeeded" else {
                await refresh()
                return
            }
            login[engine.id] = auth
            if let page = auth.signInPage { open(page) }
            if let flowId = auth.flowId { watch(engine, flowId: flowId) }
        } catch {
            errors[engine.id] = Self.message(error, engine)
        }
    }

    func complete(_ engine: MyEngine) async {
        guard let client, let flowId = login[engine.id]?.flowId else { return }
        let code = (codes[engine.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else { return }
        busy = engine.id
        defer { busy = nil }
        do {
            try await client.completeEngineLogin(instanceId: engine.id, flowId: flowId, code: code)
            codes[engine.id] = nil
            await refresh()
        } catch {
            errors[engine.id] = Self.message(error, engine)
        }
    }

    func cancel(_ engine: MyEngine) async {
        polls[engine.id]?.cancel()
        polls[engine.id] = nil
        let flowId = login[engine.id]?.flowId
        login[engine.id] = nil
        try? await client?.cancelEngineLogin(instanceId: engine.id, flowId: flowId)
    }

    func signOut(_ engine: MyEngine) async {
        guard let client, busy == nil else { return }
        busy = engine.id
        defer { busy = nil }
        do {
            try await client.signOutEngine(instanceId: engine.id)
            await refresh()
        } catch {
            errors[engine.id] = Self.message(error, engine)
        }
    }

    func stop() {
        polls.values.forEach { $0.cancel() }
        polls = [:]
    }

    /// Asks every 1.5 s until the sign-in ends, as the desktop does.
    private func watch(_ engine: MyEngine, flowId: String) {
        polls[engine.id]?.cancel()
        polls[engine.id] = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                guard let self, let client = self.client, !Task.isCancelled else { return }
                do {
                    let auth = try await client.engineLoginStatus(instanceId: engine.id, flowId: flowId)
                    if auth.phase == "waiting" { continue }
                    self.login[engine.id] = nil
                    if auth.phase != "succeeded" {
                        self.errors[engine.id] = auth.message ?? String(localized: "The sign-in did not finish.")
                    }
                    await self.refresh()
                    return
                } catch let APIError.status(code, _) where code == 409 {
                    continue  // the server is still writing the flow
                } catch {
                    self.login[engine.id] = nil
                    self.errors[engine.id] = Self.message(error, engine)
                    return
                }
            }
        }
    }

    /// `engineSignInError`: on an engine the server lists as installed,
    /// "not installed on this server" means the person is not connected.
    static func message(_ error: Error, _ engine: MyEngine) -> String {
        let text: String
        if case let APIError.status(_, message?) = error { text = message } else { text = error.localizedDescription }
        if engine.installed, text.range(of: "is not installed on this server", options: .caseInsensitive) != nil {
            return String(localized: "Connect your \(engine.connectName) account to use it.")
        }
        return text.isEmpty ? String(localized: "The sign-in did not work. Try again.") : text
    }
}

struct MyEnginesSection: View {
    enum Style { case phone, desktop }

    let style: Style
    @Environment(\.desktopTheme) private var theme
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var session: Session
    @StateObject private var model = MyEnginesModel()

    private var ink: Color { style == .desktop ? theme.ink : Theme.textPrimary }
    private var secondary: Color { style == .desktop ? theme.inkSecondary : Theme.textSecondary }
    private var cardFill: Color { style == .desktop ? theme.card : Theme.card }
    private var insetFill: Color { style == .desktop ? theme.inset : Theme.inset }
    private var danger: Color { style == .desktop ? theme.danger : .red }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Sign in to your own subscription on the engines your organization offers. Your turns use it on your bots and on the bots shared with you. Your organization chooses which engines are offered.")
                .font(.system(size: 13))
                .foregroundStyle(secondary)
                .fixedSize(horizontal: false, vertical: true)
            if let list = model.list {
                if list.engines.isEmpty {
                    Text("Your organization offers no engine yet.")
                        .font(.system(size: 13))
                        .foregroundStyle(secondary)
                        .accessibilityIdentifier("my-engines-empty")
                }
                ForEach(list.engines) { engine in
                    row(engine)
                }
                if let keys = list.keysUrl.flatMap(MyEnginesRules.signInPage) {
                    Button { openURL(keys) } label: {
                        Label("Manage my keys in Perspicax", systemImage: "arrow.up.right.square")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("my-engines-keys")
                }
            } else if let error = model.loadError {
                Text(verbatim: error).font(.system(size: 13)).foregroundStyle(danger)
                Button("Try again") { Task { await model.refresh() } }
                    .font(.system(size: 13, weight: .medium))
                    .accessibilityIdentifier("my-engines-retry")
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, style == .phone ? SettingsMetrics.cardMargin : 0)
        .task(id: session.connection?.id) {
            model.client = session.settingsClient
            await model.refresh()
        }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("my-engines")
    }

    private func row(_ engine: MyEngine) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: engine.displayName)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(ink)
                    Text(status(engine))
                        .font(.system(size: 12.5))
                        .foregroundStyle(secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if engine.offersSignIn, model.login[engine.id] == nil {
                    if engine.subscription.signedIn {
                        button("Sign out", engine) { await model.signOut(engine) }
                            .accessibilityIdentifier("my-engines.\(engine.id).sign-out")
                    } else {
                        button("Connect \(engine.connectName)", engine, prominent: true) {
                            await model.signIn(engine) { openURL($0) }
                        }
                        .accessibilityIdentifier("my-engines.\(engine.id).connect")
                    }
                }
            }
            if let login = model.login[engine.id] {
                pending(engine, login)
            }
            if let error = model.errors[engine.id] {
                Text(verbatim: error)
                    .font(.system(size: 12))
                    .foregroundStyle(danger)
                    .accessibilityIdentifier("my-engines.\(engine.id).error")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(cardFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("my-engines.\(engine.id)")
    }

    private func pending(_ engine: MyEngine, _ login: EngineLoginState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let code = login.userCode {
                Text("Code: \(code)")
                    .font(Theme.mono(14))
                    .foregroundStyle(ink)
                    .textSelection(.enabled)
            }
            if let page = login.signInPage {
                Button { openURL(page) } label: {
                    Text("Open the sign-in page").font(.system(size: 13)).underline()
                }
                .buttonStyle(.plain)
                .foregroundStyle(ink)
            }
            if login.userCode == nil {
                HStack(spacing: 8) {
                    TextField(String(localized: "Paste the code"), text: Binding(
                        get: { model.codes[engine.id] ?? "" },
                        set: { model.codes[engine.id] = $0 }
                    ))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.system(size: 13))
                    .padding(.horizontal, 10)
                    .frame(height: 34)
                    .background(insetFill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .accessibilityIdentifier("my-engines.\(engine.id).code")
                    button("Done", engine, prominent: true) { await model.complete(engine) }
                        .disabled((model.codes[engine.id] ?? "").trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            button("Cancel", engine) { await model.cancel(engine) }
        }
        .padding(10)
        .background(insetFill.opacity(0.5), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func button(_ title: LocalizedStringKey, _ engine: MyEngine, prominent: Bool = false, action: @escaping () async -> Void) -> some View {
        Button { Task { await action() } } label: {
            HStack(spacing: 6) {
                if model.busy == engine.id { ProgressView().controlSize(.mini) }
                Text(title).font(.system(size: 13, weight: .medium))
            }
            .padding(.horizontal, 12)
            .frame(height: 30)
            .foregroundStyle(prominent ? (style == .desktop ? theme.accentInk : Theme.primaryInk) : ink)
            .background(prominent ? (style == .desktop ? theme.accent : Theme.primaryFill) : insetFill, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(model.busy != nil)
    }

    /// What the person's own turns on it run with (the desktop's line).
    private func status(_ engine: MyEngine) -> String {
        if engine.unavailable { return String(localized: "Not available on this server") }
        switch engine.myTurns {
        case "subscription": return String(localized: "Your turns use your subscription.")
        case "key": return String(localized: "Your turns use your own key.")
        // #1533: an engine the organization's key runs says who pays, as on the desktop
        case "org-key": return String(localized: "Pays with: the organization")
        default:
            if engine.orgNotAllowed == true { return String(localized: "Outside your organization's list: only your own subscription or key runs it.") }
            if engine.orgKeyNotGiven == true { return String(localized: "Not given to you: connect your own account or add your key.") }
            return String(localized: "Not connected")
        }
    }
}
