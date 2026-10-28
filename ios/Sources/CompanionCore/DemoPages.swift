// The demo's one page (2026-10-28, the page view): Atlas proposed it in its
// conversation, so the card, the open page, Share, the floating composer and
// the Library all show on made-up data. In memory only; its document is
// drawn locally (the demo never reaches a network).
import Foundation

struct DemoPage {
    var title: String
    var status = "draft"
    var access = "private"
    var expiresAt: Double?
    var pinned = false
    var deleted = false
    var invites = PageInvites.none
    var currentVersion: Int?
    var versions: [(n: Int, state: String)] = [(1, "proposed")]
    let at: Double

    init(language: DemoLanguage, at: Double) {
        title = language.pick("Weekly plan", "Plan de la semaine")
        self.at = at
    }

    var summary: [String: Any] {
        var value: [String: Any] = [
            "id": DemoServer.pageID, "title": title, "status": status, "access": access,
            "expiresAt": expiresAt ?? NSNull(), "expired": false, "updatedAt": at, "createdAt": at,
            "versions": versions.map { ["n": $0.n, "title": title, "state": $0.state, "createdAt": at] },
            "currentVersion": currentVersion ?? NSNull(), "botId": "demo-atlas", "threadId": "demo-thread-atlas",
            "pinned": pinned, "invites": ["people": invites.people, "teams": invites.teams], "comments": 0,
        ]
        if status == "published" { value["url"] = "https://\(DemoServer.host)/p/\(DemoServer.pageID)" }
        return value
    }
}

extension DemoServer {
    public static let pageID = "demo-page-weekly"

    func pages(method: String, parts: [String], json: [String: Any]) -> Response {
        lock.lock(); defer { lock.unlock() }
        func answer(_ object: [String: Any], status: Int = 200) -> Response {
            .init(status: status, body: (try? JSONSerialization.data(withJSONObject: object)) ?? Data())
        }
        if parts.count == 2 {
            return method == "GET" ? answer(["pages": demoPage.deleted ? [] : [demoPage.summary]]) : refusal(status: 405)
        }
        if parts.count == 3, parts[2] == "policy" {
            return answer(["linkSharing": true, "readerComments": true])
        }
        guard parts.count >= 3, parts[2] == Self.pageID, !demoPage.deleted else { return refusal(status: 404) }
        let rest = Array(parts.dropFirst(3))
        switch (method, rest) {
        case ("GET", []):
            return answer(["page": demoPage.summary])
        case ("GET", let tail) where tail.count == 2 && tail[0] == "versions":
            guard let n = Int(tail[1]), demoPage.versions.contains(where: { $0.n == n }) else { return refusal(status: 404) }
            return answer(["version": ["n": n, "title": demoPage.title, "previewPath": "/pages/preview/\(Self.pageID)/\(n)"]])
        case ("PATCH", []):
            if let title = json["title"] as? String, !title.isEmpty { demoPage.title = String(title.prefix(PageViewRules.titleMax)) }
            if let pinned = json["pinned"] as? Bool { demoPage.pinned = pinned }
            if let access = json["access"] as? String, PublishedPageAccess(rawValue: access) != nil { demoPage.access = access }
            if json.keys.contains("expiresAt") { demoPage.expiresAt = json["expiresAt"] as? Double }
            return answer(["page": demoPage.summary])
        case ("POST", ["publish"]):
            guard let n = json["version"] as? Int, let index = demoPage.versions.firstIndex(where: { $0.n == n }) else { return refusal(status: 400) }
            demoPage.status = "published"
            demoPage.access = (json["access"] as? String).flatMap { PublishedPageAccess(rawValue: $0)?.rawValue } ?? demoPage.access
            demoPage.expiresAt = json["expiresAt"] as? Double
            demoPage.currentVersion = n
            demoPage.versions[index].state = "published"
            return answer(["page": demoPage.summary])
        case ("POST", ["invite"]):
            demoPage.invites = PageInvites(people: json["people"] as? [String] ?? [], teams: json["teams"] as? [String] ?? [])
            return answer(["page": demoPage.summary])
        case ("POST", ["revoke"]):
            demoPage.status = "revoked"
            return answer(["page": demoPage.summary])
        case ("POST", ["decline"]):
            guard let n = json["version"] as? Int, let index = demoPage.versions.firstIndex(where: { $0.n == n }) else { return refusal(status: 400) }
            demoPage.versions[index].state = "declined"
            return answer(["page": demoPage.summary])
        case ("DELETE", []):
            demoPage.deleted = true
            return answer(["ok": true])
        default:
            return refusal(status: method == "GET" ? 404 : 403)
        }
    }

    /// The demo page's document in the app's theme: drawn locally, no
    /// script, no network.
    public func pageDocument(theme: PageTheme) -> String {
        let t = language.pick
        lock.lock(); let title = demoPage.title; lock.unlock()
        let dark = theme == .dark
        let ground = dark ? "#0d1117" : "#ffffff"
        let ink = dark ? "#e6edf3" : "#1f2328"
        let soft = dark ? "#9198a1" : "#59636e"
        let card = dark ? "#161b22" : "#f6f8fa"
        let line = dark ? "#30363d" : "#d1d9e0"
        let rows = [
            (t("Ship the iOS beta", "Livrer la bêta iOS"), t("Internal testers, Friday", "Testeurs internes, vendredi"), 72),
            (t("Finish the onboarding screens", "Terminer les écrans d'accueil"), t("Three screens left", "Trois écrans restants"), 45),
            (t("Keep the release build green", "Garder le build de version au vert"), t("Checks running", "Vérifications en cours"), 90),
        ]
        let items = rows.map { row in
            "<li><div class=\"top\"><strong>\(Self.escape(row.0))</strong><span>\(row.2) %</span></div>"
                + "<p>\(Self.escape(row.1))</p><div class=\"bar\"><i style=\"width:\(row.2)%\"></i></div></li>"
        }.joined()
        let days = [t("Mon", "lun"), t("Tue", "mar"), t("Wed", "mer"), t("Thu", "jeu"), t("Fri", "ven")]
        let heights = [38, 62, 54, 80, 66]
        let chart = zip(days, heights).map { "<div class=\"col\"><i style=\"height:\($0.1)%\"></i><span>\(Self.escape($0.0))</span></div>" }.joined()
        return """
        <!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="color-scheme" content="\(theme.rawValue)"><title>\(Self.escape(title))</title><style>
        body{margin:0;padding:20px 20px 160px;background:\(ground);color:\(ink);font:16px/1.5 -apple-system,system-ui,sans-serif}
        h1{font-size:28px;line-height:1.2;margin:0 0 6px}.lead{color:\(soft);margin:0 0 24px}
        h2{font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:\(soft);margin:28px 0 10px}
        ul{list-style:none;margin:0;padding:0;display:grid;gap:12px}
        li{background:\(card);border:1px solid \(line);border-radius:14px;padding:14px 16px}
        .top{display:flex;justify-content:space-between;gap:12px}.top span{color:\(soft);font-variant-numeric:tabular-nums}
        li p{margin:2px 0 10px;color:\(soft);font-size:14px}
        .bar{height:6px;border-radius:3px;background:\(line);overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,#0ea5e9,#6366f1)}
        .chart{display:flex;align-items:flex-end;gap:12px;height:160px;background:\(card);border:1px solid \(line);border-radius:14px;padding:16px}
        .col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:6px}
        .col i{display:block;width:100%;border-radius:6px 6px 2px 2px;background:linear-gradient(180deg,#38bdf8,#6366f1)}
        .col span{font-size:12px;color:\(soft)}
        </style></head><body>
        <h1>\(Self.escape(title))</h1><p class="lead">\(Self.escape(t("Three priorities for the team this week.", "Trois priorités pour l'équipe cette semaine.")))</p>
        <h2>\(Self.escape(t("Priorities", "Priorités")))</h2><ul>\(items)</ul>
        <h2>\(Self.escape(t("Checks per day", "Vérifications par jour")))</h2><div class="chart">\(chart)</div>
        </body></html>
        """
    }

    private static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }
}
