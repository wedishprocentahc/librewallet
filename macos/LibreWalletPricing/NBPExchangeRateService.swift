import Foundation

enum NBPExchangeRateService {
    private static var cachedRates: [String: Double]?
    private static var cachedAt: Date?

    /// Mid rates from NBP table A: PLN per 1 unit of foreign currency.
    static func ratesToPLN() async throws -> [String: Double] {
        if let cachedRates, let cachedAt, Calendar.current.isDateInToday(cachedAt) {
            return cachedRates
        }

        guard let url = URL(string: "https://api.nbp.pl/api/exchangerates/tables/A/?format=json") else {
            throw ServiceError.invalidURL
        }

        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            throw ServiceError.httpStatus(http.statusCode)
        }

        let tables = try JSONDecoder().decode([RateTable].self, from: data)
        guard let table = tables.first else {
            throw ServiceError.emptyResponse
        }

        var rates: [String: Double] = ["PLN": 1.0]
        for row in table.rates {
            rates[row.code.uppercased()] = row.mid
        }

        cachedRates = rates
        cachedAt = Date()
        return rates
    }

    static func convertToPLN(_ amount: Double, currency: String, rates: [String: Double]) -> Double {
        let code = currency.uppercased()
        if code == "PLN" { return amount }
        guard let rate = rates[code] else { return amount }
        return amount * rate
    }

    static func cachedRatesToPLN() -> [String: Double] {
        cachedRates ?? ["PLN": 1.0]
    }

    enum ServiceError: LocalizedError {
        case invalidURL
        case httpStatus(Int)
        case emptyResponse

        var errorDescription: String? {
            switch self {
            case .invalidURL: "Nieprawidłowy adres API NBP."
            case .httpStatus(let code): "API NBP zwróciło błąd HTTP \(code)."
            case .emptyResponse: "API NBP zwróciło pustą odpowiedź."
            }
        }
    }

    private struct RateTable: Decodable {
        let effectiveDate: String
        let rates: [RateRow]
    }

    private struct RateRow: Decodable {
        let code: String
        let mid: Double
    }
}
