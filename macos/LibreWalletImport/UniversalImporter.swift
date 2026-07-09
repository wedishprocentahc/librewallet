import Foundation
import CoreXLSX
import UniformTypeIdentifiers

enum UniversalImporter {
    static let expectedHeaders: Set<String> = [
        "date",
        "type",
        "symbol",
        "name",
        "quantity",
        "price",
        "gross",
        "fee",
        "currency",
        "cash_delta",
        "external_id",
        "notes",
    ]

    static func importPreview(from url: URL) throws -> [ImportedTransaction] {
        let ext = url.pathExtension.lowercased()
        if ext == "csv" {
            return try importCSV(from: url)
        }
        if ext == "xlsx" || ext == "xls" {
            return try importXLSX(from: url)
        }
        // Fallback: try as CSV anyway
        return try importCSV(from: url)
    }

    private static func importCSV(from url: URL) throws -> [ImportedTransaction] {
        let data = try Data(contentsOf: url)
        let rows = try CSV.parse(data: data)
        return rows.compactMap(mapUniversalRow)
    }

    private static func importXLSX(from url: URL) throws -> [ImportedTransaction] {
        guard let file = XLSXFile(filepath: url.path) else {
            throw ImportError.invalidXLSX
        }
        let sharedStrings = try file.parseSharedStrings()
        guard let workbook = try file.parseWorkbooks().first else {
            return []
        }
        guard let sheet = try file.parseWorksheetPathsAndNames(workbook: workbook).first else {
            return []
        }
        let path = sheet.path
        _ = sheet.name
        let ws = try file.parseWorksheet(at: path)

        // Assume first row is header.
        var headerByCol: [String: String] = [:]
        var output: [ImportedTransaction] = []

        let rows = ws.data?.rows ?? []
        for (rowIndex, row) in rows.enumerated() {
            if rowIndex == 0 {
                for cell in row.cells {
                    let col = columnKey(from: cell)
                    let value = cellString(cell, sharedStrings: sharedStrings)
                    headerByCol[col] = value
                }
                continue
            }
            var dict: [String: String] = [:]
            for cell in row.cells {
                let col = columnKey(from: cell)
                guard let header = headerByCol[col] else { continue }
                dict[normalize(header)] = cellString(cell, sharedStrings: sharedStrings)
            }
            if let tx = mapUniversalRow(dict) { output.append(tx) }
        }
        return output
    }

    private static func columnKey(from cell: Cell) -> String {
        // CoreXLSX uses a typed reference; String(describing:) yields e.g. "A1".
        let ref = String(describing: cell.reference)
        let letters = ref.prefix { $0.isLetter }
        return String(letters)
    }

    private static func cellString(_ cell: Cell, sharedStrings: SharedStrings?) -> String {
        if let sharedStrings, let s = cell.stringValue(sharedStrings) {
            return s
        }
        return cell.value ?? ""
    }

    private static func mapUniversalRow(_ row: [String: String]) -> ImportedTransaction? {
        guard let date = parseDate(row["date"]) else { return nil }
        guard let type = parseType(row["type"]) else { return nil }
        let currency = (row["currency"] ?? "PLN").trimmed.uppercased()

        return ImportedTransaction(
            date: date,
            type: type,
            symbol: row["symbol"]?.trimmed.nilIfEmpty?.uppercased(),
            name: row["name"]?.trimmed.nilIfEmpty,
            quantity: parseNumber(row["quantity"]),
            price: parseNumber(row["price"]),
            gross: parseNumber(row["gross"]) ?? 0,
            fee: parseNumber(row["fee"]) ?? 0,
            currency: currency,
            cashDelta: parseNumber(row["cash_delta"]),
            externalId: row["external_id"]?.trimmed.nilIfEmpty,
            notes: row["notes"]?.trimmed.nilIfEmpty,
            source: "Universal import",
            assetType: nil,
            account: nil
        )
    }

    private static func parseType(_ value: String?) -> TransactionType? {
        let raw = (value ?? "").trimmed.lowercased()
        switch raw {
        case "buy", "kupno", "zakup": return .buy
        case "sell", "sprzedaz", "sprzedaż": return .sell
        case "deposit", "wplata", "wpłata": return .deposit
        case "withdrawal", "wyplata", "wypłata": return .withdrawal
        case "transfer", "przelew": return .transfer
        case "fee", "prowizja": return .fee
        case "tax", "podatek": return .tax
        case "interest", "odsetki": return .interest
        case "dividend", "dywidenda": return .dividend
        case "other", "inne": return .other
        default: return nil
        }
    }

    private static func parseDate(_ value: String?) -> Date? {
        let s = (value ?? "").trimmed
        if s.isEmpty { return nil }
        // Accept YYYY-MM-DD or DD.MM.YYYY
        let iso = DateFormatter()
        iso.locale = Locale(identifier: "en_US_POSIX")
        iso.dateFormat = "yyyy-MM-dd"
        if let d = iso.date(from: s) { return d }
        let pl = DateFormatter()
        pl.locale = Locale(identifier: "pl_PL")
        pl.dateFormat = "dd.MM.yyyy"
        return pl.date(from: s)
    }

    private static func parseNumber(_ value: String?) -> Double? {
        let s = (value ?? "").trimmed
        if s.isEmpty { return nil }
        return Double(s.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: ",", with: "."))
    }

    private static func normalize(_ header: String) -> String {
        header
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: " ", with: "_")
            .replacingOccurrences(of: "-", with: "_")
    }

    enum ImportError: LocalizedError {
        case invalidXLSX

        var errorDescription: String? {
            switch self {
            case .invalidXLSX: "Nie można otworzyć pliku XLSX."
            }
        }
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

