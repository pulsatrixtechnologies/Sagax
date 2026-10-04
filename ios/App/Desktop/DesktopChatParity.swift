// iPad I3: the desktop chat surfaces of the parity harness
// (ios/parity/desktop/surfaces.mjs, "chat"), opened on Ara's chat the way
// the reference opens them: a scroll position, a draft, an open menu, or
// transcript rows injected into this screen only (the reference injects
// them into its page's store; nothing reaches the fixture server).
import SwiftUI
import CompanionCore

extension IPadParityScreen {
    /// Drawn by the desktop chat (DesktopShell opens Ara for these).
    var isDesktopChat: Bool {
        switch self {
        case .chatTop, .chatAttachments, .chatMarkdown, .chatApproval, .chatQuestion, .chatMessageHover,
             .chatComposerDraft, .chatComposerSlash, .chatExportMenu, .chatModelPicker, .chatApprovalMode,
             .chatWhereMenu, .chatFind, .chatThreads, .inspector:
            true
        default:
            false
        }
    }
}

#if DEBUG
enum DesktopChatParity {
    static var screen: IPadParityScreen? { ParityLaunch.current?.iPadScreen }

    /// chat-message-hover: the reply the pointer rests on.
    static func forcesHover(_ message: Message) -> Bool {
        screen == .chatMessageHover && (message.text ?? "").contains("Veux-tu que je refasse")
    }

    /// The find bar draws as focused without taking the keyboard.
    static var findLooksFocused: Bool { screen == .chatFind }

    /// The composer's open policy menu on its surface.
    static var openMenu: DesktopComposerMenu? {
        switch screen {
        case .chatApprovalMode: .approval
        case .chatWhereMenu: .place
        default: nil
        }
    }

    static let markdown = """
    Voici le tableau de remplacement demandé, avec un exemple de code :

    | Poste | Responsable | Échéance | État |
    | --- | --- | --- | --- |
    | Sauvegarde | Ara | 3 oct. | Fait |
    | Migration | Keepler | 10 oct. | En cours |
    | Documentation | Lux | 17 oct. | À faire |

    ```ts
    export function prochainLundi(date: Date): Date {
      const jour = date.getDay();
      const ecart = (8 - jour) % 7 || 7;
      return new Date(date.getTime() + ecart * 86_400_000);
    }
    ```

    1. **Gras** et *italique* pour la forme.
    2. Un lien : [documentation](https://docs.example.com).

    > Une citation courte, en texte de remplacement.
    """

    /// The rows surfaces.mjs injects, as wire JSON.
    static var injected: [[String: Any]] {
        switch screen {
        case .chatMarkdown:
            return [
                ["role": "user", "kind": "text", "text": "Montre-moi le tableau."],
                ["role": "bot", "kind": "text", "text": markdown, "turnTerminal": true],
            ]
        case .chatApproval:
            return [
                ["role": "user", "kind": "text", "text": "Pousse la sauvegarde."],
                ["role": "bot", "kind": "options", "card": [
                    "title": "Run a command?", "subtitle": "git push origin main",
                    "options": ["Deny", "Always allow", "Allow once"], "requestId": "parity-req-1", "tool": "Bash",
                    "allowKey": "Bash:git",
                    "commandAllowlist": ["command": "git push origin main", "cwd": "/workspace/fixture", "providerInstanceId": "claude"],
                ] as [String: Any]],
            ]
        case .chatQuestion:
            return [
                ["role": "user", "kind": "text", "text": "Planifie la sauvegarde."],
                ["role": "bot", "kind": "options", "card": [
                    "title": "Question", "subtitle": "", "options": ["Dimanche soir", "Lundi matin", "Chaque jour"],
                    "requestId": "parity-req-2", "tool": "AskUserQuestion",
                    "questionRequest": ["version": 1, "questions": [[
                        "question": "Quand faut-il refaire la sauvegarde ?", "header": "Horaire", "multiSelect": false,
                        "options": [
                            ["label": "Dimanche soir", "description": "Une fois par semaine, à 21 h."],
                            ["label": "Lundi matin", "description": "Avant la réunion d'équipe."],
                            ["label": "Chaque jour", "description": "À 2 h, en dehors des heures de travail."],
                        ],
                    ]]] as [String: Any],
                ] as [String: Any]],
            ]
        default:
            return []
        }
    }
}

extension ChatView {
    /// Opens this chat's parity surface once the transcript has settled
    /// (after the newest-message settle at 150 and 450 ms).
    func desktopParityLaunch(_ proxy: ScrollViewProxy) async {
        guard desktopChat != nil, let screen = DesktopChatParity.screen, screen.isDesktopChat else { return }
        for _ in 0..<100 where messages.isEmpty {
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        let rows = DesktopChatParity.injected
        if !rows.isEmpty {
            var parent = messages.last?.id
            var at = messages.last.map { $0.at } ?? Date().timeIntervalSince1970 * 1000
            for (index, row) in rows.enumerated() {
                at += 60_000
                var wire = row
                wire["id"] = "parity-desktop-\(index + 1)"
                wire["at"] = at
                if let parent { wire["parentId"] = parent }
                guard let data = try? JSONSerialization.data(withJSONObject: wire),
                      let message = try? JSONDecoder().decode(Message.self, from: data) else { continue }
                session.parityApply(.message(threadId: threadId, message: message))
                parent = message.id
            }
        }
        try? await Task.sleep(nanoseconds: 900_000_000)
        switch screen {
        case .chatTop:
            if let target = messages.first(where: { ($0.text ?? "").hasPrefix("Peux-tu me donner les liens") }) {
                follow.pause()
                proxy.scrollTo("parity-top-\(rowId(for: target))", anchor: .top)
            }
        case .chatAttachments:
            if let target = messages.first(where: { ($0.text ?? "").hasPrefix("Les deux captures de remplacement") }) {
                follow.pause()
                proxy.scrollTo(rowId(for: target), anchor: .center)
            }
        case .chatComposerDraft:
            // the simulator's software keyboard would cover the screen: the
            // draft without the focus (the reference hides its caret anyway)
            draft = "Brouillon de remplacement : vérifie la sauvegarde de dimanche\net envoie le résumé à l'équipe."
        case .chatComposerSlash:
            draft = "/"
        case .chatFind:
            openFind()
            finder.query = "sauvegarde"
        default:
            if !rows.isEmpty { proxy.scrollTo(Self.bottomId, anchor: .bottom) }
        }
    }

    /// chat-top: the reference scrolls a row to the very top of the column,
    /// under the floating header; this marker sits a header's height into the
    /// row, so scrolling it to the top inset puts the row at y 0.
    @ViewBuilder
    func desktopParityTopMarker(_ id: String, below: CGFloat) -> some View {
        if desktopChat != nil, DesktopChatParity.screen == .chatTop {
            Color.clear.frame(height: 1).id("parity-top-\(id)").padding(.top, Self.topBarHeight + below)
        }
    }

    /// The transcript row that holds this message (a folded turn holds several).
    private func rowId(for message: Message) -> String {
        rows.first { row in
            if case let .assistantTurn(turn) = row { return turn.messages.contains { $0.id == message.id } }
            return row.id == message.id
        }?.id ?? message.id
    }
}
#endif
