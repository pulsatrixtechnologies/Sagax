// iPad I3: syntax colours for the desktop code block. The desktop runs
// Shiki with github-dark-default / github-light-default
// (ChatMarkdown.tsx); this is a small tokenizer that paints the same roles
// for the C-family, Python and shell languages a bot writes: keywords and
// operators, strings, numbers and constants, function names, types and
// parameters, comments. Anything it does not know stays in the ink.
import SwiftUI
import UIKit

enum DesktopCodeHighlight {
    struct Palette {
        var keyword, string, constant, function, type, comment: Color

        static let dark = Palette(
            keyword: Color(codeHex: 0xFF7B72), string: Color(codeHex: 0xA5D6FF), constant: Color(codeHex: 0x79C0FF),
            function: Color(codeHex: 0xD2A8FF), type: Color(codeHex: 0xFFA657), comment: Color(codeHex: 0x8B949E)
        )
        static let light = Palette(
            keyword: Color(codeHex: 0xCF222E), string: Color(codeHex: 0x0A3069), constant: Color(codeHex: 0x0550AE),
            function: Color(codeHex: 0x8250DF), type: Color(codeHex: 0x953800), comment: Color(codeHex: 0x6E7781)
        )
    }

    /// Languages it colours (the fence's name, lowercased).
    static func supports(_ language: String?) -> Bool {
        guard let language = language?.lowercased(), !language.isEmpty else { return false }
        return cFamily.contains(language) || hashComment.contains(language)
    }

    private static let cFamily: Set<String> = [
        "ts", "typescript", "tsx", "js", "javascript", "jsx", "mjs", "cjs", "swift", "go", "rust", "rs", "java",
        "kotlin", "kt", "c", "cpp", "c++", "h", "cs", "csharp", "dart", "php", "scala", "json", "jsonc",
    ]
    private static let hashComment: Set<String> = ["py", "python", "sh", "bash", "zsh", "shell", "ruby", "rb", "yaml", "yml", "toml"]

    private static let keywords: Set<String> = [
        "export", "import", "from", "as", "default", "function", "func", "fn", "def", "class", "struct", "enum",
        "interface", "type", "extends", "implements", "const", "let", "var", "val", "return", "if", "else", "for",
        "while", "do", "switch", "case", "break", "continue", "new", "delete", "typeof", "instanceof", "in", "of",
        "await", "async", "yield", "try", "catch", "finally", "throw", "throws", "public", "private", "protected",
        "static", "readonly", "guard", "where", "extension", "protocol", "init", "self", "super", "package", "use",
        "mut", "pub", "impl", "match", "lambda", "pass", "with", "elif", "and", "or", "not", "is", "then", "fi",
        "done", "echo", "local", "export", "go", "defer", "chan", "select", "void",
    ]
    private static let constants: Set<String> = ["true", "false", "null", "undefined", "nil", "None", "True", "False", "this", "NaN", "Infinity"]
    private static let declarers: Set<String> = ["const", "let", "var", "val"]

    static func attributed(_ code: String, language: String?, ink: Color, dark: Bool) -> AttributedString {
        let palette = dark ? Palette.dark : Palette.light
        let hash = hashComment.contains(language?.lowercased() ?? "")
        let chars = Array(code.unicodeScalars)
        var out = AttributedString()
        var i = 0
        var previousWord = ""
        /// Inside the parameter list of a declaration (`function name(...)`).
        var paramDepth = 0
        var depth = 0
        var declaring = false
        var lastSignificant: Character = " "

        func emit(_ text: String, _ color: Color?) {
            var piece = AttributedString(text)
            piece.foregroundColor = color ?? ink
            out.append(piece)
        }
        func isIdentStart(_ c: Unicode.Scalar) -> Bool { CharacterSet.letters.contains(c) || c == "_" || c == "$" }
        func isIdent(_ c: Unicode.Scalar) -> Bool { isIdentStart(c) || CharacterSet.decimalDigits.contains(c) }
        func nextNonSpace(_ from: Int) -> Unicode.Scalar? {
            var j = from
            while j < chars.count, chars[j] == " " || chars[j] == "\t" { j += 1 }
            return j < chars.count ? chars[j] : nil
        }

        while i < chars.count {
            let c = chars[i]
            let rest = { (n: Int) -> String in String(String.UnicodeScalarView(chars[i..<min(chars.count, i + n)])) }
            // comments
            if (!hash && rest(2) == "//") || (hash && c == "#") {
                var j = i
                while j < chars.count, chars[j] != "\n" { j += 1 }
                emit(String(String.UnicodeScalarView(chars[i..<j])), palette.comment)
                i = j
                continue
            }
            if !hash, rest(2) == "/*" {
                var j = i + 2
                while j < chars.count, !(chars[j] == "*" && j + 1 < chars.count && chars[j + 1] == "/") { j += 1 }
                j = min(chars.count, j + 2)
                emit(String(String.UnicodeScalarView(chars[i..<j])), palette.comment)
                i = j
                continue
            }
            // strings
            if c == "\"" || c == "'" || c == "`" {
                var j = i + 1
                while j < chars.count, chars[j] != c, !(c != "`" && chars[j] == "\n") {
                    if chars[j] == "\\" { j += 1 }
                    j += 1
                }
                j = min(chars.count, j + 1)
                emit(String(String.UnicodeScalarView(chars[i..<j])), palette.string)
                i = j
                lastSignificant = "\""
                continue
            }
            // numbers
            if CharacterSet.decimalDigits.contains(c) {
                var j = i
                while j < chars.count, isIdent(chars[j]) || chars[j] == "." { j += 1 }
                emit(String(String.UnicodeScalarView(chars[i..<j])), palette.constant)
                i = j
                lastSignificant = "0"
                continue
            }
            // words
            if isIdentStart(c) {
                var j = i
                while j < chars.count, isIdent(chars[j]) { j += 1 }
                let word = String(String.UnicodeScalarView(chars[i..<j]))
                let next = nextNonSpace(j)
                let color: Color?
                if keywords.contains(word) {
                    color = palette.keyword
                } else if constants.contains(word) {
                    color = palette.constant
                } else if next == "(" {
                    color = palette.function
                } else if paramDepth > 0 && depth >= paramDepth {
                    color = palette.type
                } else if lastSignificant == ":" && word.first?.isUppercase == true {
                    color = palette.type
                } else if declarers.contains(previousWord) {
                    color = palette.constant
                } else {
                    color = nil
                }
                if ["function", "func", "fn", "def"].contains(word) { declaring = true }
                emit(word, color)
                previousWord = word
                lastSignificant = "a"
                i = j
                continue
            }
            // punctuation and operators
            switch c {
            case "(":
                depth += 1
                if declaring { paramDepth = depth; declaring = false }
                emit("(", nil)
            case ")":
                if depth == paramDepth { paramDepth = 0 }
                depth = max(0, depth - 1)
                emit(")", nil)
            case "=", "+", "-", "*", "/", "%", "|", "&", "!", "<", ">", "?", ":", "^", "~":
                emit(String(c), palette.keyword)
            default:
                emit(String(c), nil)
            }
            if c != " " && c != "\t" && c != "\n" { lastSignificant = Character(c) }
            if c == "\n" { previousWord = "" } else if c != " " { previousWord = "" }
            i += 1
        }
        return out
    }
}

private extension Color {
    init(codeHex hex: UInt32) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}
