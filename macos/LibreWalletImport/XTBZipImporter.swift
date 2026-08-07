import Foundation
import ZIPFoundation
import CoreXLSX

enum XTBZipImporter {
    static func importPreview(from url: URL) throws -> [ImportedTransaction] {
        let archive = try Archive(url: url, accessMode: .read)
        var all: [ImportedTransaction] = []
        var csvFiles: [String] = []
        var xlsxFiles: [String] = []

        for entry in archive {
            guard entry.type == .file else { continue }
            let name = entry.path.lowercased()
            let account = accountHint(fromZipPath: entry.path)
            if name.hasSuffix(".csv") {
                csvFiles.append(entry.path)

                let data = try extract(entry: entry, from: archive)
                let rows = try CSV.parse(data: data)
                // Heuristic: try universal mapping first
                let universal = rows.compactMap(UniversalImporterPreview.mapIfPossible)
                if !universal.isEmpty {
                    all.append(contentsOf: universal.map { $0.with(source: "XTB import", account: account) })
                    continue
                }
                // Fallback: attempt XTB-specific mapping
                all.append(contentsOf: rows.compactMap { mapXTBRow($0, account: account) })
                continue
            }

            if name.hasSuffix(".xlsx") || name.hasSuffix(".xls") {
                xlsxFiles.append(entry.path)
                let data = try extract(entry: entry, from: archive)
                let tmp = try writeTempFile(data: data, fileName: URL(fileURLWithPath: entry.path).lastPathComponent)
                defer { try? FileManager.default.removeItem(at: tmp) }
                let currencyHint = XTBXLSX.currencyHint(fromFileName: tmp.lastPathComponent)
                let imported = (try? XTBXLSX.importPreview(from: tmp, currencyHint: currencyHint)) ?? []
                if imported.isEmpty {
                    // Fallback to universal template (if the sheet is actually universal)
                    let universal = try UniversalImporter.importPreview(from: tmp)
                    all.append(contentsOf: universal.map { $0.with(source: "XTB import", account: account) })
                } else {
                    all.append(contentsOf: imported.map { $0.with(source: "XTB import", account: account) })
                }
                continue
            }
        }

        let sorted = all.sorted { $0.date < $1.date }
        if sorted.isEmpty {
            throw ImportError.noTransactions(csvFiles: csvFiles, xlsxFiles: xlsxFiles)
        }
        return sorted
    }

    private static func extract(entry: Entry, from archive: Archive) throws -> Data {
        var data = Data()
        _ = try archive.extract(entry) { chunk in
            data.append(chunk)
        }
        return data
    }

    private static func writeTempFile(data: Data, fileName: String) throws -> URL {
        let base = FileManager.default.temporaryDirectory
        let dir = base.appendingPathComponent("librewallet-import-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let out = dir.appendingPathComponent(fileName)
        try data.write(to: out, options: [.atomic])
        return out
    }

    private static func mapXTBRow(_ row: [String: String], account: String?) -> ImportedTransaction? {
        // Heuristics for typical XTB exports (headers vary by locale/version).
        let date = parseDate(pick(row, keys: [
            "date", "time", "transaction_time", "trade_time", "data",
            "data_transakcji", "czas", "czas_transakcji", "trade_date"
        ]))
        guard let date else { return nil }

        let type = parseType(pick(row, keys: [
            "type", "operation", "side", "typ", "rodzaj",
            "typ_operacji", "operation_type", "action"
        ]))
        guard let type else { return nil }

        let symbol = pick(row, keys: [
            "symbol", "instrument", "ticker", "walor", "instrument_symbol"
        ])?.trimmed.nilIfEmpty?.uppercased()
        let name = pick(row, keys: [
            "name", "instrument_name", "nazwa", "instrument_nazwa"
        ])?.trimmed.nilIfEmpty
        let currency = (pick(row, keys: [
            "currency", "ccy", "waluta", "currency_code"
        ]) ?? "PLN").trimmed.uppercased()

        let quantity = parseNumber(pick(row, keys: ["quantity", "qty", "ilosc", "ilość", "wolumen"]))
        let price = parseNumber(pick(row, keys: ["price", "rate", "cena", "kurs"]))
        let gross = parseNumber(pick(row, keys: [
            "gross", "value", "amount", "wartosc", "wartość",
            "kwota", "amount_pln", "net_amount", "total"
        ])) ?? 0
        let fee = parseNumber(pick(row, keys: ["fee", "commission", "provision", "prowizja", "oplaty", "opłaty"])) ?? 0

        return ImportedTransaction(
            date: date,
            type: type,
            symbol: symbol,
            name: name,
            quantity: quantity,
            price: price,
            gross: gross,
            fee: fee,
            currency: currency,
            cashDelta: nil,
            externalId: pick(row, keys: ["external_id", "id", "transaction_id", "order_id"])?.trimmed.nilIfEmpty,
            notes: nil,
            source: "XTB import",
            assetType: nil,
            account: account
        )
    }

    private static func parseType(_ value: String?) -> TransactionType? {
        let raw = (value ?? "").trimmed.lowercased()
        if raw.contains("buy") || raw.contains("kup") { return .buy }
        if raw.contains("sell") || raw.contains("sprzed") { return .sell }
        if raw.contains("deposit") || raw.contains("wpłat") || raw.contains("wplat") { return .deposit }
        if raw.contains("withdraw") || raw.contains("wypłat") || raw.contains("wyplat") { return .withdrawal }
        if raw.contains("transfer") || raw.contains("przelew") { return .transfer }
        if raw.contains("dividend") || raw.contains("dywid") { return .dividend }
        if raw.contains("interest") || raw.contains("odset") { return .interest }
        if raw.contains("fee") || raw.contains("prowiz") { return .fee }
        if raw.contains("tax") || raw.contains("podatek") { return .tax }
        return nil
    }

    private static func parseDate(_ value: String?) -> Date? {
        let s = (value ?? "").trimmed
        if s.isEmpty { return nil }
        let isoDateTime = ISO8601DateFormatter()
        if let d = isoDateTime.date(from: s) { return d }
        let isoDateTime2 = ISO8601DateFormatter()
        isoDateTime2.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = isoDateTime2.date(from: s) { return d }
        let iso = DateFormatter()
        iso.locale = Locale(identifier: "en_US_POSIX")
        iso.dateFormat = "yyyy-MM-dd"
        if let d = iso.date(from: s) { return d }
        let pl = DateFormatter()
        pl.locale = Locale(identifier: "pl_PL")
        pl.dateFormat = "dd.MM.yyyy"
        if let d = pl.date(from: s) { return d }
        let pl2 = DateFormatter()
        pl2.locale = Locale(identifier: "pl_PL")
        pl2.dateFormat = "dd.MM.yyyy HH:mm:ss"
        if let d = pl2.date(from: s) { return d }
        let slash = DateFormatter()
        slash.locale = Locale(identifier: "en_US_POSIX")
        slash.dateFormat = "dd/MM/yyyy"
        if let d = slash.date(from: s) { return d }
        let dt = DateFormatter()
        dt.locale = Locale(identifier: "en_US_POSIX")
        dt.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return dt.date(from: s)
    }

    private static func parseNumber(_ value: String?) -> Double? {
        let s = (value ?? "").trimmed
        if s.isEmpty { return nil }
        return Double(s.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: ",", with: "."))
    }

    enum ImportError: LocalizedError {
        case invalidArchive
        case noTransactions(csvFiles: [String], xlsxFiles: [String])

        var errorDescription: String? {
            switch self {
            case .invalidArchive:
                return "Nie można otworzyć pliku ZIP."
            case .noTransactions(let csvFiles, let xlsxFiles):
                if csvFiles.isEmpty && xlsxFiles.isEmpty {
                    return "ZIP nie zawiera plików CSV/XLSX z operacjami."
                }
                let csvPart = csvFiles.isEmpty ? nil : "CSV: \(csvFiles.joined(separator: ", "))"
                let xlsxPart = xlsxFiles.isEmpty ? nil : "XLSX: \(xlsxFiles.joined(separator: ", "))"
                let parts = [csvPart, xlsxPart].compactMap { $0 }.joined(separator: " | ")
                return "Nie udało się zmapować żadnej transakcji z plików w ZIP. (\(parts))"
            }
        }
    }
}

private enum XTBXLSX {
    static func currencyHint(fromFileName name: String) -> String? {
        // e.g. "PLN_53254345_2026-06-10_2026-07-07.xlsx"
        let base = name.split(separator: "_").first.map(String.init)
        return base?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }

    static func importPreview(from url: URL, currencyHint: String?) throws -> [ImportedTransaction] {
        guard let file = XLSXFile(filepath: url.path) else { return [] }
        let sharedStrings = try file.parseSharedStrings()
        guard let workbook = try file.parseWorkbooks().first else { return [] }
        let sheets = try file.parseWorksheetPathsAndNames(workbook: workbook)
        guard !sheets.isEmpty else { return [] }

        // XTB exports have multiple sheets (Closed Positions / Cash Operations / Open Positions).
        // Cash ops live on "Cash Operations" — scanning only the first sheet misses them.
        let ordered = sheets.sorted { lhs, rhs in
            cashOperationsScore(lhs.name) > cashOperationsScore(rhs.name)
        }

        for sheet in ordered {
            let imported = try importCashOperationsSheet(
                file: file,
                path: sheet.path,
                sharedStrings: sharedStrings,
                currencyHint: currencyHint
            )
            if !imported.isEmpty {
                return imported
            }
        }
        return []
    }

    /// Prefer explicit Cash Operations sheet names (EN/PL).
    private static func cashOperationsScore(_ name: String?) -> Int {
        let label = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if label == "cash operations" { return 100 }
        if label.contains("cash operation") { return 90 }
        if label.contains("operacje gotowk") || label.contains("operacje pieniez") || label.contains("operacje pienięż") {
            return 90
        }
        return 0
    }

    private static func importCashOperationsSheet(
        file: XLSXFile,
        path: String,
        sharedStrings: SharedStrings?,
        currencyHint: String?
    ) throws -> [ImportedTransaction] {
        let ws = try file.parseWorksheet(at: path)
        let rows = ws.data?.rows ?? []
        if rows.isEmpty { return [] }

        // Header example: Type, Instrument, Ticker, Category, Time, Amount, ID, Comment, Product
        var headerByCol: [String: String] = [:]
        var headerRowIndex: Int?
        for (idx, row) in rows.enumerated() {
            var tmp: [String: String] = [:]
            for cell in row.cells {
                let col = columnKey(from: cell)
                let value = cellString(cell, sharedStrings: sharedStrings).trimmed
                if !value.isEmpty { tmp[col] = value }
            }
            let normalized = Set(tmp.values.map { $0.trimmed.lowercased() })
            let hasType = normalized.contains("type") || normalized.contains("typ") || normalized.contains("operacja")
            let hasAmount = normalized.contains("amount")
                || normalized.contains("kwota")
                || normalized.contains("wartość")
                || normalized.contains("wartosc")
            let hasTime = normalized.contains("time")
                || normalized.contains("czas")
                || normalized.contains("date")
                || normalized.contains("data")
            // Require cash-ops shape; Closed Positions has Type/Ticker/Volume but no Amount.
            if hasType, hasAmount, hasTime {
                headerByCol = tmp
                headerRowIndex = idx
                break
            }
        }
        guard let headerRowIndex else { return [] }

        var out: [ImportedTransaction] = []
        for row in rows.dropFirst(headerRowIndex + 1) {
            var dict: [String: String] = [:]
            for cell in row.cells {
                let col = columnKey(from: cell)
                guard let header = headerByCol[col] else { continue }
                dict[header.trimmed.lowercased()] = cellString(cell, sharedStrings: sharedStrings)
            }

            // Stop at totals/footer
            if let first = dict.values.first(where: { !$0.trimmed.isEmpty }),
               first.trimmed.lowercased() == "total" || first.trimmed.lowercased() == "profit/loss" {
                break
            }
            if dict.isEmpty { continue }

            if let tx = mapCashOpsRow(dict, currencyHint: currencyHint) {
                out.append(tx)
            }
        }
        return out.sorted { $0.date < $1.date }
    }

    private static func mapCashOpsRow(_ row: [String: String], currencyHint: String?) -> ImportedTransaction? {
        let rawType = (row["type"] ?? "").trimmed
        if rawType.isEmpty { return nil }

        let date = parseExcelOrDate(row["time"])
        guard let date else { return nil }

        let amount = parseNumber(row["amount"]) ?? 0
        let symbol = row["ticker"]?.trimmed.nilIfEmpty?.uppercased()
        let name = row["instrument"]?.trimmed.nilIfEmpty
        let externalId = row["id"]?.trimmed.nilIfEmpty
        let notes = row["comment"]?.trimmed.nilIfEmpty
        let currency = (currencyHint ?? "PLN").trimmed.uppercased()

        let deal = XTBOperationParsing.parseDealComment(notes)
        let type = XTBOperationParsing.mapOperationType(from: rawType)
            ?? XTBOperationParsing.detectOperationType(
                text: [notes, rawType].compactMap { $0 }.joined(separator: " "),
                amount: amount,
                symbol: symbol,
                quantity: deal.quantity,
                price: deal.price
            )
        let gross = XTBOperationParsing.grossMagnitude(amount: amount, quantity: deal.quantity, price: deal.price)

        return ImportedTransaction(
            date: date,
            type: type,
            symbol: symbol,
            name: name,
            quantity: deal.quantity > 0 ? deal.quantity : nil,
            price: deal.price > 0 ? deal.price : nil,
            gross: gross,
            fee: 0,
            currency: currency,
            cashDelta: amount,
            externalId: externalId,
            notes: notes,
            source: "XTB import",
            assetType: nil,
            account: nil
        )
    }

    private static func parseType(_ value: String) -> TransactionType {
        XTBOperationParsing.mapOperationType(from: value)
            ?? XTBOperationParsing.detectOperationType(text: value, amount: 0, symbol: nil, quantity: 0, price: 0)
    }

    private static func parseExcelOrDate(_ value: String?) -> Date? {
        let s = (value ?? "").trimmed
        if s.isEmpty { return nil }
        if let n = Double(s.replacingOccurrences(of: ",", with: ".")) {
            return excelSerialToDate(n)
        }
        // fallback to ISO / common formats
        let isoDateTime = ISO8601DateFormatter()
        if let d = isoDateTime.date(from: s) { return d }
        let dt = DateFormatter()
        dt.locale = Locale(identifier: "en_US_POSIX")
        dt.dateFormat = "yyyy-MM-dd HH:mm:ss"
        if let d = dt.date(from: s) { return d }
        let iso = DateFormatter()
        iso.locale = Locale(identifier: "en_US_POSIX")
        iso.dateFormat = "yyyy-MM-dd"
        if let d = iso.date(from: s) { return d }
        let pl = DateFormatter()
        pl.locale = Locale(identifier: "pl_PL")
        pl.dateFormat = "dd.MM.yyyy"
        return pl.date(from: s)
    }

    private static func excelSerialToDate(_ serial: Double) -> Date {
        // Excel 1900 date system: Unix epoch is 25569 days after 1899-12-30.
        let seconds = (serial - 25569.0) * 86400.0
        return Date(timeIntervalSince1970: seconds)
    }

    private static func parseNumber(_ value: String?) -> Double? {
        let s = (value ?? "").trimmed
        if s.isEmpty { return nil }
        return Double(s.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: ",", with: "."))
    }

    private static func columnKey(from cell: Cell) -> String {
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
}

private func pick(_ row: [String: String], keys: [String]) -> String? {
    for key in keys {
        if let v = row[key], !v.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return v
        }
    }
    // fallback: try fuzzy match (contains)
    for key in keys {
        if let (k, v) = row.first(where: { $0.key.contains(key) }), !v.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            _ = k
            return v
        }
    }
    return nil
}

private enum UniversalImporterPreview {
    static func mapIfPossible(_ row: [String: String]) -> ImportedTransaction? {
        // Reuse universal mapping only when headers look like universal template.
        if row.keys.contains("type") && row.keys.contains("date") && row.keys.contains("gross") {
            return UniversalImporterMirror.map(row)
        }
        return nil
    }
}

private enum UniversalImporterMirror {
    static func map(_ row: [String: String]) -> ImportedTransaction? {
        // Minimal inline version of UniversalImporter.mapUniversalRow (kept private to avoid exposing internals).
        guard let date = UniversalImporterDate.parse(row["date"]) else { return nil }
        guard let type = UniversalImporterType.parse(row["type"]) else { return nil }
        let currency = (row["currency"] ?? "PLN").trimmed.uppercased()
        return ImportedTransaction(
            date: date,
            type: type,
            symbol: row["symbol"]?.trimmed.nilIfEmpty?.uppercased(),
            name: row["name"]?.trimmed.nilIfEmpty,
            quantity: UniversalImporterNumber.parse(row["quantity"]),
            price: UniversalImporterNumber.parse(row["price"]),
            gross: UniversalImporterNumber.parse(row["gross"]) ?? 0,
            fee: UniversalImporterNumber.parse(row["fee"]) ?? 0,
            currency: currency,
            cashDelta: UniversalImporterNumber.parse(row["cash_delta"]),
            externalId: row["external_id"]?.trimmed.nilIfEmpty,
            notes: row["notes"]?.trimmed.nilIfEmpty,
            source: "Universal import",
            assetType: nil,
            account: nil
        )
    }
}

private enum UniversalImporterType {
    static func parse(_ value: String?) -> TransactionType? {
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
}

private enum UniversalImporterDate {
    static func parse(_ value: String?) -> Date? {
        let s = (value ?? "").trimmed
        if s.isEmpty { return nil }
        let iso = DateFormatter()
        iso.locale = Locale(identifier: "en_US_POSIX")
        iso.dateFormat = "yyyy-MM-dd"
        if let d = iso.date(from: s) { return d }
        let pl = DateFormatter()
        pl.locale = Locale(identifier: "pl_PL")
        pl.dateFormat = "dd.MM.yyyy"
        return pl.date(from: s)
    }
}

private enum UniversalImporterNumber {
    static func parse(_ value: String?) -> Double? {
        let s = (value ?? "").trimmed
        if s.isEmpty { return nil }
        return Double(s.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: ",", with: "."))
    }
}

private extension ImportedTransaction {
    func with(source: String, account: String?) -> ImportedTransaction {
        ImportedTransaction(
            id: id,
            date: date,
            type: type,
            symbol: symbol,
            name: name,
            quantity: quantity,
            price: price,
            gross: gross,
            fee: fee,
            currency: currency,
            cashDelta: cashDelta,
            externalId: externalId,
            notes: notes,
            source: source,
            assetType: assetType,
            account: account ?? self.account
        )
    }
}

private func accountHint(fromZipPath path: String) -> String? {
    // XTB ZIP often uses: "<account>/<currency>_....xlsx"
    let comps = path.split(separator: "/").map(String.init)
    guard let first = comps.first else { return nil }
    let trimmed = first.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, trimmed.allSatisfy({ $0.isNumber }) else { return nil }
    return trimmed
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

