// The parts of shared/approval-describe.ts a step reuses to word an MCP
// call: the product (the name the server declared, else the name prefix,
// then the server), the verb from the
// tool's last or first word (or its arguments for generic tools), the
// resource, and a short reading of the arguments (who, which record). The
// date range the desktop adds to that reading is left out on the phone.
import Foundation

struct ApprovalReading {
    var action: String?
    var verbless = false
    var product: String?
    var summary: String?

    private enum Operation: String { case read, create, update, delete, run }

    private static let internalServers: Set<String> = ["ogb", "sagax", "maus", "harness"]

    /// This platform's own gateway: its tools are named for the product
    /// they serve. No other product name is written here: the server
    /// declares it (`ToolActivity.product`), else the prefix reads as its
    /// own words, titled.
    private static let productByServer: [(NSRegularExpression, String)] = [
        (StepRegex.make(#"perspicax|pulsatrix"#, [.caseInsensitive]), "Pulsatrix"),
    ]

    /// A product prefix in a tool's own name: `<product>__<tool>`.
    private static let productPrefix = StepRegex.make(#"^([a-z0-9][a-z0-9_-]*?)__."#, [.caseInsensitive])

    private static let acronyms: Set<String> = ["psa", "rmm", "api", "mcp", "ai", "it", "id", "url", "cw", "sso", "vpn", "dns"]

    static func titleCase(_ words: String) -> String {
        words.split(whereSeparator: { $0 == " " || $0 == "_" || $0 == "-" }).map { word in
            acronyms.contains(word.lowercased()) ? word.uppercased() : word.prefix(1).uppercased() + word.dropFirst()
        }.joined(separator: " ")
    }

    /// Mirror of shared/approval-describe.ts `productFor`: the declared
    /// name and id first, then a `<product>__` prefix, then the server.
    static func productFor(server: String?, name: String, declared: String? = nil, declaredId: String? = nil) -> (product: String?, prefixTokens: Int) {
        let lower = name.lowercased()
        let trimmed = declared?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let product: String? = trimmed.isEmpty ? nil : trimmed
        let id = declaredId?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        let count = { (words: String) in words.split(separator: "_").filter { !$0.isEmpty }.count }
        if !id.isEmpty, lower == id || lower.hasPrefix("\(id)_") {
            return (product ?? titleCase(id), count(id))
        }
        let whole = NSRange(lower.startIndex..., in: lower)
        if let match = productPrefix.firstMatch(in: lower, range: whole), let range = Range(match.range(at: 1), in: lower) {
            let prefix = String(lower[range])
            return (product ?? titleCase(prefix), count(prefix))
        }
        if let product { return (product, 0) }
        guard let server, !internalServers.contains(server.lowercased()) else { return (nil, 0) }
        for (pattern, product) in productByServer where StepRegex.test(pattern, server) { return (product, 0) }
        let bare = StepRegex.strip(StepRegex.make(#"^plugin_[^_]+_"#, [.caseInsensitive]), StepRegex.strip(StepRegex.make(#"^claude_ai_"#, [.caseInsensitive]), server))
        return (titleCase(bare), 0)
    }

    private static let verbs: [(NSRegularExpression, Operation)] = [
        (StepRegex.make(#"^(query|read|list|get|search|find|describe|fetch|show|view|lookup|count|browse|inspect|status)$"#), .read),
        (StepRegex.make(#"^(create|add|new|post|insert|submit|open|book)$"#), .create),
        (StepRegex.make(#"^(write|update|patch|put|set|edit|modify|upsert|assign|move|rename|change|close|merge)$"#), .update),
        (StepRegex.make(#"^(delete|remove|destroy|purge|erase|drop|wipe|uninstall)$"#), .delete),
        (StepRegex.make(#"^(action|run|execute|exec|invoke|trigger|start|stop|restart|reboot|send|call|isolate|kill)$"#), .run),
    ]

    private static func operation(_ word: String?) -> Operation? {
        guard let word else { return nil }
        let lower = word.lowercased()
        return verbs.first { StepRegex.test($0.0, lower) }?.1
    }

    private static func operationFromArgs(_ args: [String: Any]?) -> Operation? {
        guard let args else { return nil }
        for key in ["operation", "method", "op", "verb", "mode", "action"] {
            guard let value = args[key] as? String else { continue }
            switch value.uppercased() {
            case "GET": return .read
            case "POST": return .create
            case "PUT", "PATCH": return .update
            case "DELETE": return .delete
            default: break
            }
            let first = value.split(whereSeparator: { $0 == " " || $0 == "_" || $0 == "-" || $0 == "\t" }).first.map(String.init)
            if let op = operation(first) { return op }
        }
        return nil
    }

    private static let resources: [(NSRegularExpression, String)] = [
        (StepRegex.make(#"^schedule(s|entr(y|ies))?$"#), "schedule"),
        (StepRegex.make(#"^time(entr(y|ies))?$"#), "timeEntries"),
        (StepRegex.make(#"^timesheets?$"#), "timesheets"),
        (StepRegex.make(#"^(service)?tickets?$"#), "tickets"),
        (StepRegex.make(#"^compan(y|ies)$"#), "companies"),
        (StepRegex.make(#"^contacts?$"#), "contacts"),
        (StepRegex.make(#"^projects?$"#), "projects"),
        (StepRegex.make(#"^agreements?$"#), "agreements"),
        (StepRegex.make(#"^invoices?$"#), "invoices"),
        (StepRegex.make(#"^members?$"#), "members"),
        (StepRegex.make(#"^configurations?$"#), "configurations"),
        (StepRegex.make(#"^opportunit(y|ies)$"#), "opportunities"),
        (StepRegex.make(#"^activit(y|ies)$"#), "activities"),
        (StepRegex.make(#"^notes?$"#), "notes"),
        (StepRegex.make(#"^(agents?|endpoints?|devices?)$"#), "devices"),
        (StepRegex.make(#"^(threats?|alerts?|incidents?)$"#), "alerts"),
        (StepRegex.make(#"^(mail|messages?|emails?)$"#), "messages"),
        (StepRegex.make(#"^(events?|calendar)$"#), "calendar"),
        (StepRegex.make(#"^(files?|documents?)$"#), "files"),
    ]

    private static func resourceKey(_ raw: String?) -> String? {
        guard let raw else { return nil }
        var clean = raw.lowercased().replacingOccurrences(of: ".", with: "/")
        clean = clean.replacingOccurrences(of: #"[^a-z0-9/_ -]"#, with: "", options: .regularExpression)
        let joined = clean.replacingOccurrences(of: #"[/_ -]+"#, with: "", options: .regularExpression)
        let last = clean.split(whereSeparator: { "/_ -".contains($0) }).last.map(String.init) ?? ""
        for candidate in [joined, last] {
            if let key = resources.first(where: { StepRegex.test($0.0, candidate) })?.1 { return key }
        }
        return nil
    }

    private static func dashesToSpaces(_ text: String) -> String {
        text.replacingOccurrences(of: #"[/_-]+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces).lowercased()
    }

    private static let personKeys = StepRegex.make(#"^(member|memberidentifier|member_identifier|owner|assignee|assignedto|user|username|technician|identifier|resource)$"#, [.caseInsensitive])
    private static let personInText = StepRegex.make(#"(?:member|owner|assignee|resource|user)(?:\/|\.|_)?(?:identifier|name|id)?\s*(?:=|eq|==)\s*['"]([A-Za-z0-9._@-]{2,40})['"]"#, [.caseInsensitive])
    private static let personValue = StepRegex.make(#"^[A-Za-z0-9._@-]{2,40}$"#)

    private static func findPerson(_ value: Any?, depth: Int = 0) -> String? {
        guard depth <= 3, let object = value as? [String: Any] else { return nil }
        for (key, child) in object where StepRegex.test(personKeys, key) {
            if let text = child as? String, StepRegex.test(personValue, text), Int(text) == nil { return text }
            if let inner = child as? [String: Any], let name = (inner["identifier"] ?? inner["name"]) as? String, name.count <= 40 { return name }
        }
        for child in object.values {
            if let found = findPerson(child, depth: depth + 1) { return found }
        }
        return nil
    }

    static func summarize(_ args: [String: Any]?, text: String, french: Bool) -> String? {
        var parts: [String] = []
        if let person = findPerson(args) ?? StepRegex.match(personInText, text)?[1] ?? nil { parts.append(person) }
        let body = args?["body"] as? [String: Any]
        for source in [args, body].compactMap({ $0 }) {
            let name = ["summary", "name", "title", "subject"].lazy.compactMap { source[$0] as? String }
                .first { !$0.trimmingCharacters(in: .whitespaces).isEmpty && $0.count <= 80 }
            if let name {
                let trimmed = name.trimmingCharacters(in: .whitespaces)
                parts.append(french ? "« \(trimmed) »" : "\u{201C}\(trimmed)\u{201D}")
                break
            }
        }
        for source in [args, body].compactMap({ $0 }) {
            let ref = ["ticketId", "chargeToId", "ticket", "projectId", "companyId", "id"].lazy.compactMap { key -> String? in
                if let number = source[key] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue == number.doubleValue.rounded() {
                    return String(number.int64Value)
                }
                if let text = source[key] as? String, text.range(of: #"^\d{1,10}$"#, options: .regularExpression) != nil { return text }
                return nil
            }.first
            if let ref {
                parts.append("#\(ref)")
                break
            }
        }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    private static let runCommandNoun = StepRegex.make(#"^(?:shell |terminal |bash )?(?:command|commands|cmd|shell|bash|terminal)$"#)

    /// `describeApproval`'s action, product and summary. `verb` words the
    /// `approval.verb.*` and `approval.tool.runCommand` keys (a step turns
    /// them into its own tense); every other key goes to `words`.
    static func describe(_ tool: String, input: String?, words: StepWords, product declared: String? = nil, productId: String? = nil, verb: (String, [String: String]) -> String) -> ApprovalReading {
        let text = input ?? ""
        let args = StepLabel.parseArgs(text)
        let parsed = StepLabel.parseToolId(tool)
        guard let server = parsed.server else { return ApprovalReading() }
        let (product, prefixTokens) = productFor(server: server, name: parsed.name, declared: declared, declaredId: productId)
        var tokens = Array(parsed.name.split(separator: "_").map(String.init).filter { !$0.isEmpty }.dropFirst(prefixTokens))
        // no product prefix: a leading word that is no verb, before a verb,
        // is the tool's own namespace (outlook_create_event)
        if prefixTokens == 0, tokens.count >= 3, operation(tokens[0]) == nil, operation(tokens[1]) != nil || operation(tokens.last) != nil {
            tokens = Array(tokens.dropFirst())
        }
        var op = operation(tokens.last)
        var rest = Array(tokens.dropLast())
        if op == nil {
            op = operation(tokens.first)
            rest = Array(tokens.dropFirst())
        }
        if let argsOp = operationFromArgs(args), op == nil || op == .update || op == .run, tokens.count <= 1 || rest.isEmpty {
            op = argsOp
        }
        let actionArg = args?["action"] as? String
        let resourceRaw: String? = !rest.isEmpty ? rest.joined(separator: " ")
            : (op == .run && actionArg != nil) ? actionArg
            : (args?["resource"] as? String) ?? (args?["entity"] as? String)
        let summary = summarize(args, text: text, french: words.isFrench)
        guard let op else {
            let joined = tokens.joined(separator: " ")
            return ApprovalReading(action: joined.isEmpty ? parsed.name : joined, verbless: true, product: product, summary: summary)
        }
        let resource: String?
        if op == .run {
            let plain = resourceRaw.map(dashesToSpaces)
            resource = plain?.isEmpty == false ? plain : nil
        } else if let key = resourceKey(resourceRaw) {
            resource = words.t("approval.resource.\(key)\(op == .create ? ".one" : "")")
        } else if let raw = resourceRaw, !dashesToSpaces(raw).isEmpty {
            resource = words.t("approval.resource.other", ["name": dashesToSpaces(raw)])
        } else {
            resource = nil
        }
        let action: String
        if op == .run, let resource, StepRegex.test(runCommandNoun, resource) {
            action = verb("approval.tool.runCommand", [:])
        } else if let resource {
            action = verb("approval.verb.\(op.rawValue)", ["resource": resource])
        } else {
            action = verb("approval.verb.\(op.rawValue).bare", [:])
        }
        return ApprovalReading(action: action, product: product, summary: summary)
    }
}
