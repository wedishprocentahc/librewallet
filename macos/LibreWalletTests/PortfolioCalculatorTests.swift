import XCTest
@testable import LibreWallet

final class PortfolioCalculatorTests: XCTestCase {
    func testSimpleBuySellProfit() {
        let group = PortfolioGroup(name: "G", createdAt: .now)
        let portfolio = Portfolio(name: "P", baseCurrency: "PLN", colorHex: "#000000", kind: .manual, createdAt: .now, group: group)

        let buy = Transaction(
            date: Date(timeIntervalSince1970: 0),
            type: .buy,
            symbol: "AAPL.US",
            name: "Apple",
            quantity: 10,
            price: 100,
            gross: 1000,
            fee: 0,
            currency: "PLN",
            portfolio: portfolio
        )
        let sell = Transaction(
            date: Date(timeIntervalSince1970: 86400),
            type: .sell,
            symbol: "AAPL.US",
            name: "Apple",
            quantity: 5,
            price: 120,
            gross: 600,
            fee: 0,
            currency: "PLN",
            portfolio: portfolio
        )

        let quote = Quote(symbol: "AAPL.US", currency: "PLN", price: 130, asOf: .now)

        let scope = PortfolioCalculator.calculate(
            portfolio: portfolio,
            allTransactions: [buy, sell],
            quotes: [quote]
        )

        XCTAssertEqual(scope.positions.count, 1)
        guard let pos = scope.positions.first else {
            XCTFail("Expected a position row")
            return
        }
        XCTAssertEqual(pos.quantity, 5, accuracy: 1e-9)
        XCTAssertEqual(pos.invested, 500, accuracy: 1e-9) // remaining cost basis
        XCTAssertEqual(pos.currentValue, 650, accuracy: 1e-9)
        XCTAssertEqual(pos.profit, 150, accuracy: 1e-9) // unrealized
        XCTAssertEqual(pos.realized, 100, accuracy: 1e-9)
        XCTAssertEqual(scope.totalValueBase, 650, accuracy: 1e-9)
        // totalProfit includes unrealized + realized (+ income)
        XCTAssertEqual(scope.totalProfitBase, 250, accuracy: 1e-9)
        // Without cash ops: buys − sells = 1000 − 600
        XCTAssertEqual(scope.netInvestedBase, 400, accuracy: 1e-9)
        XCTAssertEqual(scope.returnPct, 62.5, accuracy: 1e-9)
    }

    func testForeignQuoteConvertedIntoAccountCurrency() {
        let group = PortfolioGroup(name: "G", createdAt: .now)
        let portfolio = Portfolio(
            name: "PLN",
            baseCurrency: "PLN",
            colorHex: "#000000",
            kind: .account,
            createdAt: .now,
            group: group
        )
        let buy = Transaction(
            date: Date(timeIntervalSince1970: 0),
            type: .buy,
            symbol: "NVDA.US",
            name: "Nvidia",
            quantity: 1,
            price: 100,
            gross: 400, // paid in PLN
            fee: 0,
            currency: "PLN",
            portfolio: portfolio
        )
        // Yahoo quote in USD; NBP: 1 USD = 4 PLN → mark = 200 USD * 4 = 800 PLN
        let quote = Quote(symbol: "NVDA.US", currency: "USD", price: 200, asOf: .now)
        let scope = PortfolioCalculator.calculate(
            portfolio: portfolio,
            allTransactions: [buy],
            quotes: [quote],
            ratesToPLN: ["PLN": 1, "USD": 4]
        )
        XCTAssertEqual(scope.positions.count, 1)
        XCTAssertEqual(scope.positions[0].currentPrice, 800, accuracy: 1e-9)
        XCTAssertEqual(scope.positions[0].currentValue, 800, accuracy: 1e-9)
        XCTAssertEqual(scope.totalValueBase, 800, accuracy: 1e-9)
    }
}

