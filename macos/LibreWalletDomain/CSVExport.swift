import Foundation
import SwiftData
import UniformTypeIdentifiers
import SwiftUI

enum CSVExport {
    static let transactionHeaders = [
        "date", "timestamp", "portfolio", "account", "externalId", "type", "symbol", "name",
        "assetType", "quantity", "price", "gross", "fee", "cashDelta", "currency", "source", "notes",
    ]

    static let templateHeaders = [
        "date", "type", "symbol", "name", "quantity", "price", "gross", "fee",
        "currency", "cash_delta", "external_id", "notes",
    ]

    static func exportTransactions(_ transactions: [Transaction]) -> Data {
        var lines: [String] = [transactionHeaders.joined(separator: ",")]
        let df = ISO8601DateFormatter()
        df.formatOptions = [.withFullDate]
        let ts = ISO8601DateFormatter()

        for tx in transactions.sorted(by: { $0.date < $1.date }) {
            let row: [String] = [
                df.string(from: tx.date),
                ts.string(from: tx.date),
                tx.portfolio?.name ?? "",
                "",
                tx.externalId ?? "",
                tx.typeRaw,
                tx.symbol ?? "",
                tx.name ?? "",
                tx.assetType ?? "",
                string(tx.quantity),
                string(tx.price),
                string(tx.gross),
                string(tx.fee),
                string(tx.cashDelta),
                tx.currency,
                tx.source ?? "",
                tx.notes ?? "",
            ]
            lines.append(row.map(escape).joined(separator: ","))
        }
        return Data(lines.joined(separator: "\n").utf8)
    }

    static func templateCSV() -> Data {
        let example = [
            "2024-01-15", "buy", "AAPL.US", "Apple", "10", "180.5", "1805", "0",
            "USD", "", "", "example",
        ]
        let body = [
            templateHeaders.joined(separator: ","),
            example.map(escape).joined(separator: ","),
        ].joined(separator: "\n")
        return Data(body.utf8)
    }

    private static func string(_ value: Double?) -> String {
        guard let value else { return "" }
        if value.rounded() == value { return String(Int(value)) }
        return String(format: "%.8g", value)
    }

    private static func string(_ value: Double) -> String {
        if value.rounded() == value { return String(Int(value)) }
        return String(format: "%.8g", value)
    }

    private static func escape(_ value: String) -> String {
        if value.contains(",") || value.contains("\"") || value.contains("\n") {
            return "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }
        return value
    }
}

struct LWCSVDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.commaSeparatedText, .plainText] }
    static var writableContentTypes: [UTType] { [.commaSeparatedText] }

    var data: Data

    init(data: Data = Data()) {
        self.data = data
    }

    init(configuration: ReadConfiguration) throws {
        self.data = configuration.file.regularFileContents ?? Data()
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}
