import Foundation

/// ISO currency helpers. XTB account product labels (IKE / IKZE) are not currencies —
/// Polish IKE and IKZE accounts are always denominated in PLN.
enum CurrencyCode {
    /// Account wrappers that must display/settle as PLN.
    private static let plnAccountProducts: Set<String> = ["IKE", "IKZE"]

    /// Normalize a currency / account-label string to an ISO currency code.
    /// `IKE` and `IKZE` → `PLN`. Empty → `PLN`.
    static func normalize(_ raw: String?) -> String {
        let code = (raw ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .uppercased()
        if code.isEmpty { return "PLN" }
        if plnAccountProducts.contains(code) { return "PLN" }
        return code
    }

    /// True when `raw` is an XTB account product label (IKE/IKZE), not an ISO currency.
    static func isAccountProductLabel(_ raw: String?) -> Bool {
        let code = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return plnAccountProducts.contains(code)
    }
}
