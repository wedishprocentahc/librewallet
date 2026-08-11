import Foundation

/// Interactive Brokers Activity / Trade Confirmation style CSV (flexible header matching).
enum IBKRImporter {
    static func importPreview(from url: URL) throws -> [ImportedTransaction] {
        let data = try Data(contentsOf: url)
        let rows = try CSV.parse(data: data)
        return rows.compactMap(mapRow)
    }

    private static func mapRow(_ row: [String: String]) -> ImportedTransaction? {
        let normalized = Dictionary(uniqueKeysWithValues: row.map { (normalize($0.key), $0.value) })

        // Detect section-style IBKR exports: skip non-trade rows
        if let section = normalized["section"], !section.isEmpty {
            let s = section.lowercased()
            if !(s.contains("trade") || s.contains("dividend") || s.contains("interest") || s.contains("cash")) {
                return nil
            }
        }

        guard let date = parseDate(normalized["datetime"] ?? normalized["date"] ?? normalized["trade_date"] ?? normalized["tradedate"] ?? normalized["settle_date"]) else {
            return nil
        }

        let symbol = (normalized["symbol"] ?? normalized["underlying_symbol"] ?? "").trimmed.uppercased()
        let currency = (normalized["currency"] ?? normalized["currency_primary"] ?? normalized["currencyprimary"] ?? "USD").trimmed.uppercased()
        let qty = parseNumber(normalized["quantity"] ?? normalized["qty"])
        let price = parseNumber(normalized["trade_price"] ?? normalized["tradeprice"] ?? normalized["t._price"] ?? normalized["price"])
        let proceeds = parseNumber(normalized["proceeds"] ?? normalized["amount"] ?? normalized["net_cash"] ?? normalized["netcash"])
        let fee = abs(parseNumber(normalized["ibcommission"] ?? normalized["comm/fee"] ?? normalized["commission"] ?? normalized["comm_fee"]) ?? 0)
        let assetCategory = (normalized["asset_category"] ?? normalized["assetcategory"] ?? "").lowercased()

        let type: TransactionType = {
            if let raw = normalized["buy/sell"] ?? normalized["side"] {
                let s = raw.lowercased()
                if s.hasPrefix("b") { return .buy }
                if s.hasPrefix("s") { return .sell }
            }
            if let raw = normalized["type"] {
                return parseType(raw) ?? .other
            }
            if assetCategory.contains("dividend") { return .dividend }
            if assetCategory.contains("interest") { return .interest }
            if let q = qty {
                return q >= 0 ? .buy : .sell
            }
            return .other
        }()

        let absQty = qty.map(abs)
        let gross: Double = {
            if let proceeds { return abs(proceeds) }
            if let absQty, let price { return absQty * price }
            return 0
        }()

        guard type != .other || gross != 0 || absQty != nil else { return nil }

        let assetType: String? = {
            if assetCategory.contains("stock") || assetCategory.contains("equity") { return "stock" }
            if assetCategory.contains("etf") { return "etf" }
            if assetCategory.contains("bond") { return "bond" }
            return AssetTypeDetection.detect(symbol: symbol.isEmpty ? nil : symbol, name: normalized["description"])
        }()

        return ImportedTransaction(
            date: date,
            type: type,
            symbol: symbol.isEmpty ? nil : symbol,
            name: normalized["description"] ?? normalized["name"],
            quantity: absQty,
            price: price.map(abs),
            gross: gross,
            fee: fee,
            currency: currency.isEmpty ? "USD" : currency,
            cashDelta: type == .dividend || type == .interest ? gross : nil,
            externalId: normalized["tradeid"] ?? normalized["trade_id"] ?? normalized["transactionid"] ?? normalized["orderid"],
            notes: normalized["notes"],
            source: "IBKR CSV",
            assetType: assetType,
            account: normalized["account"] ?? normalized["clientaccountid"] ?? normalized["client_account_id"]
        )
    }

    private static func normalize(_ header: String) -> String {
        header
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: " ", with: "_")
            .replacingOccurrences(of: "-", with: "_")
    }

    private static func parseNumber(_ raw: String?) -> Double? {
        guard var s = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
        s = s.replacingOccurrences(of: " ", with: "")
        if s.contains(",") && s.contains(".") {
            s = s.replacingOccurrences(of: ",", with: "")
        } else if s.contains(",") {
            s = s.replacingOccurrences(of: ",", with: ".")
        }
        return Double(s)
    }

    private static func parseDate(_ raw: String?) -> Date? {
        guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        let formats = [
            "yyyy-MM-dd",
            "yyyyMMdd",
            "yyyy-MM-dd, HH:mm:ss",
            "yyyy-MM-dd HH:mm:ss",
            "dd/MM/yyyy",
            "MM/dd/yyyy",
        ]
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        for f in formats {
            df.dateFormat = f
            if let d = df.date(from: raw) { return d }
        }
        let iso = ISO8601DateFormatter()
        return iso.date(from: raw)
    }

    private static func parseType(_ raw: String) -> TransactionType? {
        switch raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "buy", "b": return .buy
        case "sell", "s": return .sell
        case "dividend", "div": return .dividend
        case "interest": return .interest
        case "fee", "commission": return .fee
        case "tax", "withholding tax": return .tax
        case "deposit": return .deposit
        case "withdrawal": return .withdrawal
        case "transfer": return .transfer
        default: return nil
        }
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
