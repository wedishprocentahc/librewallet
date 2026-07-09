import Foundation

enum CSV {
    static func parse(data: Data) throws -> [[String: String]] {
        guard let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .windowsCP1250) else {
            throw CSVError.invalidEncoding
        }
        let lines = text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .split(separator: "\n")
            .map(String.init)
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

        guard let headerLine = lines.first else { return [] }
        let delimiter: Character = detectDelimiter(headerLine)
        let headers = split(line: headerLine, delimiter: delimiter).map(normalizeHeader)

        var rows: [[String: String]] = []
        for line in lines.dropFirst() {
            let values = split(line: line, delimiter: delimiter)
            var row: [String: String] = [:]
            for (idx, header) in headers.enumerated() where idx < values.count {
                row[header] = values[idx]
            }
            rows.append(row)
        }
        return rows
    }

    private static func split(line: String, delimiter: Character) -> [String] {
        // CSV with minimal quote support (handles delimiters inside quotes).
        var out: [String] = []
        var current = ""
        var inQuotes = false
        var i = line.startIndex
        while i < line.endIndex {
            let ch = line[i]
            if ch == "\"" {
                // Handle escaped quotes: ""
                let next = line.index(after: i)
                if inQuotes, next < line.endIndex, line[next] == "\"" {
                    current.append("\"")
                    i = line.index(after: next)
                    continue
                }
                inQuotes.toggle()
                i = line.index(after: i)
                continue
            }
            if ch == delimiter, !inQuotes {
                out.append(current.trimmed)
                current = ""
                i = line.index(after: i)
                continue
            }
            current.append(ch)
            i = line.index(after: i)
        }
        out.append(current.trimmed)
        return out
    }

    private static func detectDelimiter(_ headerLine: String) -> Character {
        // XTB exports are often ';' or '\t'. Universal template: ',' or ';'.
        if headerLine.contains("\t") { return "\t" }
        if headerLine.contains(";") { return ";" }
        return ","
    }

    private static func normalizeHeader(_ header: String) -> String {
        header
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: " ", with: "_")
            .replacingOccurrences(of: "-", with: "_")
    }

    enum CSVError: LocalizedError {
        case invalidEncoding

        var errorDescription: String? {
            switch self {
            case .invalidEncoding: "Nie można odczytać pliku CSV (kodowanie)."
            }
        }
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}

