import XCTest
@testable import LibreWallet

final class LocalIntegrationAPITests: XCTestCase {
    func testHoldingsExtractsOpenPositionsAndFormatsMarkets() {
        let pln = Portfolio(name: "XTB PLN (1)", baseCurrency: "PLN", colorHex: "#000", kind: .account, createdAt: .now, group: nil)
        let buy = Transaction(
            date: .now,
            type: .buy,
            symbol: "PKN.PL",
            name: "Orlen",
            quantity: 2,
            price: 100,
            gross: 200,
            fee: 0,
            currency: "PLN",
            assetType: "stock",
            portfolio: pln
        )
        let ignored = Transaction(
            date: .now,
            type: .buy,
            symbol: "EEE.PL",
            name: "EEE",
            quantity: 5,
            price: 1,
            gross: 5,
            fee: 0,
            currency: "PLN",
            portfolio: pln
        )
        let sold = Transaction(
            date: .now,
            type: .sell,
            symbol: "PKN.PL",
            name: "Orlen",
            quantity: 2,
            price: 100,
            gross: 200,
            fee: 0,
            currency: "PLN",
            portfolio: pln
        )
        let nvda = Transaction(
            date: .now,
            type: .buy,
            symbol: "NVDA.US",
            name: "Nvidia",
            quantity: 1,
            price: 100,
            gross: 100,
            fee: 0,
            currency: "PLN",
            assetType: "stock",
            portfolio: pln
        )

        let holdings = LocalIntegrationAPI.holdings(
            portfolios: [pln],
            transactions: [buy, ignored, sold, nvda]
        )
        XCTAssertEqual(holdings.portfolioCount, 1)
        XCTAssertEqual(holdings.instruments.map(\.symbol), ["NVDA.US"])
        XCTAssertEqual(holdings.instruments.first?.market, "NASDAQ")
    }

    func testPortfolioSummaryIncludesCashByCurrency() {
        let portfolio = Portfolio(
            name: "XTB EUR (9)",
            baseCurrency: "EUR",
            colorHex: "#000",
            kind: .account,
            createdAt: .now,
            group: nil
        )
        let deposit = Transaction(
            date: .now,
            type: .deposit,
            gross: 10,
            fee: 0,
            currency: "EUR",
            cashDelta: 10,
            portfolio: portfolio
        )
        let summary = LocalIntegrationAPI.portfolioSummary(
            portfolios: [portfolio],
            transactions: [deposit],
            quotes: [],
            ratesToPLN: ["EUR": 4, "PLN": 1]
        )
        XCTAssertEqual(summary.baseCurrency, "EUR")
        XCTAssertEqual(summary.totalValue, 10, accuracy: 1e-9)
        XCTAssertEqual(summary.cashByCurrency["EUR"] ?? -1, 10, accuracy: 1e-9)
    }
}
