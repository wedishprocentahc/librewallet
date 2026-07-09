import Foundation

enum LWFormatting {
    static func money(_ amount: Double, currency: String, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .currency
        formatter.currencyCode = currency
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        return formatter.string(from: NSNumber(value: amount)) ?? "\(amount) \(currency)"
    }

    static func percent(_ value: Double, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        let str = formatter.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value)
        let prefix = value >= 0 ? "+" : ""
        return "\(prefix)\(str)%"
    }
}

