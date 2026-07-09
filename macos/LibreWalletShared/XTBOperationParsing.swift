import Foundation

enum XTBOperationParsing {
    struct DealDetails {
        let quantity: Double
        let price: Double
    }

    static func parseDealComment(_ comment: String?) -> DealDetails {
        let text = comment ?? ""
        let pattern = #"\b(?:OPEN|CLOSE)\s+(?:BUY|SELL)\s+([0-9]+(?:[.,][0-9]+)?)(?:\s*/\s*[0-9]+(?:[.,][0-9]+)?)?\s*@\s*([0-9]+(?:[.,][0-9]+)?)"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              match.numberOfRanges >= 3,
              let qtyRange = Range(match.range(at: 1), in: text),
              let priceRange = Range(match.range(at: 2), in: text) else {
            return DealDetails(quantity: 0, price: 0)
        }
        return DealDetails(
            quantity: abs(parseNumber(String(text[qtyRange])) ?? 0),
            price: abs(parseNumber(String(text[priceRange])) ?? 0)
        )
    }

    static func mapOperationType(from rowType: String) -> TransactionType? {
        let value = normalize(rowType)
        if value.isEmpty || matches(value, pattern: "^(total|profit/loss|profit loss|saldo|suma)$") { return nil }
        if matches(value, pattern: "^stock purchase") || matches(value, pattern: "^zakup") { return .buy }
        if matches(value, pattern: "^stock sell") || matches(value, pattern: "^sprzed") { return .sell }
        if matches(value, pattern: "^ike deposit") || matches(value, pattern: "^ikze deposit") { return .transfer }
        if matches(value, pattern: "^deposit") || matches(value, pattern: "^wplata") { return .deposit }
        if matches(value, pattern: "^withdrawal") || matches(value, pattern: "^wyplata") { return .withdrawal }
        if matches(value, pattern: "^subaccount transfer")
            || matches(value, pattern: "^transfer")
            || matches(value, pattern: "^przelew")
            || matches(value, pattern: "^konwersja") {
            return .transfer
        }
        if matches(value, pattern: "^dividend")
            || matches(value, pattern: "^divident")
            || matches(value, pattern: "^dywidenda") {
            return .dividend
        }
        if matches(value, pattern: "withholding tax")
            || matches(value, pattern: "free.funds interest tax")
            || matches(value, pattern: "^podatek") {
            return .tax
        }
        if matches(value, pattern: "free.funds interest")
            || matches(value, pattern: "^odset")
            || matches(value, pattern: "^interest") {
            return .interest
        }
        return nil
    }

    static func detectOperationType(
        text: String,
        amount: Double,
        symbol: String?,
        quantity: Double,
        price: Double
    ) -> TransactionType {
        let value = normalize(text)
        if matches(value, pattern: "^(total|profit/loss|profit loss|saldo|suma)$") { return .other }
        if matches(value, pattern: "(tax|podatek)") { return .tax }
        if matches(value, pattern: "ike deposit|ikze deposit") { return .transfer }
        if matches(value, pattern: "(dywid|dividend)") { return .dividend }
        if matches(value, pattern: "(odset|interest|coupon)") { return .interest }
        if matches(value, pattern: "(wplat|deposit|cash in|zasil)") { return .deposit }
        if matches(value, pattern: "(wyplat|withdraw|cash out)") { return .withdrawal }
        if matches(value, pattern: "(transfer|currency conversion|conversion|subaccount transfer|konwersja|przelew miedzy|przelew)"),
           symbol?.isEmpty != false {
            return .transfer
        }
        if matches(value, pattern: "(stock sell|sprzed|sell|market sell|close buy|close sell)") { return .sell }
        if matches(value, pattern: "(stock purchase|purchase|kup|buy|market buy|open buy)") { return .buy }
        if let symbol, !symbol.isEmpty, quantity > 0, price > 0 {
            return amount > 0 ? .sell : .buy
        }
        if symbol?.isEmpty != false, amount < 0 { return .withdrawal }
        if symbol?.isEmpty != false, amount > 0 { return .deposit }
        return .other
    }

    static func resolveType(
        rowType: String,
        sideText: String,
        amount: Double,
        symbol: String?,
        quantity: Double?,
        price: Double?,
        existingType: TransactionType
    ) -> TransactionType {
        if existingType != .other {
            return existingType
        }
        let deal = parseDealComment(sideText)
        let qty = abs(quantity ?? 0) > 0 ? abs(quantity ?? 0) : deal.quantity
        let px = abs(price ?? 0) > 0 ? abs(price ?? 0) : deal.price
        return mapOperationType(from: rowType)
            ?? detectOperationType(text: sideText, amount: amount, symbol: symbol, quantity: qty, price: px)
    }

    static func grossMagnitude(amount: Double, quantity: Double, price: Double) -> Double {
        let absAmount = abs(amount)
        if absAmount > 0 { return absAmount }
        return quantity * price
    }

    private static func normalize(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private static func parseNumber(_ value: String) -> Double? {
        let s = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return nil }
        return Double(s.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: ",", with: "."))
    }

    private static func matches(_ value: String, pattern: String) -> Bool {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return false
        }
        return regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil
    }
}
