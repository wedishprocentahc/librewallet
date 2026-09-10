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

    func testBondPortfolioWithoutDepositsDoesNotPoisonAggregateCash() {
        let bonds = Portfolio(name: "Obligacje", baseCurrency: "PLN", colorHex: "#000", kind: .manual, createdAt: .now, group: nil)
        let broker = Portfolio(name: "XTB EUR (1)", baseCurrency: "EUR", colorHex: "#000", kind: .account, createdAt: .now, group: nil)

        let bondBuy = Transaction(
            date: Date(timeIntervalSince1970: 0),
            type: .buy,
            symbol: "EDO",
            name: "EDO",
            quantity: 12,
            price: 100,
            gross: 1200,
            fee: 0,
            currency: "PLN",
            assetType: "bond",
            portfolio: bonds
        )
        let eurDeposit = Transaction(
            date: Date(timeIntervalSince1970: 0),
            type: .deposit,
            symbol: nil,
            name: nil,
            quantity: nil,
            price: nil,
            gross: 2.38,
            fee: 0,
            currency: "EUR",
            cashDelta: 2.38,
            portfolio: broker
        )

        let scope = PortfolioCalculator.aggregateToPLN(
            portfolios: [bonds, broker],
            allTransactions: [bondBuy, eurDeposit],
            quotes: [],
            ratesToPLN: ["PLN": 1, "EUR": 4]
        )

        // Bond buys without cash ops must not subtract 1200 PLN from free funds.
        XCTAssertEqual(scope.cashValueBase, 2.38 * 4, accuracy: 1e-9)
        XCTAssertEqual(scope.allocationByType["cash"] ?? -1, 2.38 * 4, accuracy: 1e-9)
        XCTAssertFalse(scope.cashRows.contains(where: { $0.currency == "PLN" && $0.value < 0 }))
    }

    func testDropsOppositeSignInternalTransferLegs() {
        let portfolio = Portfolio(
            name: "XTB PLN (53254345)",
            baseCurrency: "PLN",
            colorHex: "#000",
            kind: .account,
            createdAt: .now,
            group: nil
        )
        let deposit = Transaction(
            date: Date(timeIntervalSince1970: 0),
            type: .deposit,
            gross: 200,
            fee: 0,
            currency: "PLN",
            cashDelta: 200,
            portfolio: portfolio
        )
        let wrongIn = Transaction(
            date: Date(timeIntervalSince1970: 1),
            type: .transfer,
            gross: 200,
            fee: 0,
            currency: "PLN",
            cashDelta: 200,
            notes: "Transfer from 53254345 to 53255466",
            portfolio: portfolio
        )
        let rightOut = Transaction(
            date: Date(timeIntervalSince1970: 2),
            type: .transfer,
            gross: 200,
            fee: 0,
            currency: "PLN",
            cashDelta: -200,
            notes: "Transfer from 53254345 to 53255466",
            portfolio: portfolio
        )

        let scope = PortfolioCalculator.calculate(
            portfolio: portfolio,
            allTransactions: [deposit, wrongIn, rightOut],
            quotes: []
        )
        // Deposit 200, then only the outbound -200 should apply → cash 0.
        XCTAssertEqual(scope.cashValueBase, 0, accuracy: 1e-9)
    }
}

