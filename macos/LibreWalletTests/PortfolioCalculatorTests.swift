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
        XCTAssertEqual(scope.totalValueBase, 650, accuracy: 1e-9)
        XCTAssertEqual(scope.totalProfitBase, 150, accuracy: 1e-9)
        XCTAssertEqual(scope.netInvestedBase, 500, accuracy: 1e-9)
        XCTAssertEqual(scope.returnPct, 30, accuracy: 1e-9)
    }
}

