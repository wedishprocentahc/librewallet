import XCTest
@testable import LibreWallet

final class BondPricingTests: XCTestCase {
    func testCapitalizedBondAccruesCompoundInterest() {
        let terms = BondTerms(
            code: "EDO",
            termMonths: 120,
            firstYearRate: 6.3,
            margin: 2.0,
            indexation: "cpi",
            capitalization: true,
            earlyRedemptionFee: 2.0
        )
        let purchase = date("2024-01-01")
        let asOf = date("2025-01-01")
        let price = BondPricing.currentPrice(terms: terms, purchaseDate: purchase, asOf: asOf)
        // ~100 * 1.063^1
        XCTAssertEqual(price, 106.3, accuracy: 0.05)
    }

    func testCouponBondAccruesOnlyCurrentYearFraction() {
        let terms = BondTerms(
            code: "COI",
            termMonths: 48,
            firstYearRate: 6.05,
            margin: 1.5,
            indexation: "cpi",
            capitalization: false,
            earlyRedemptionFee: 0.7
        )
        let purchase = date("2024-01-01")
        let asOf = date("2024-07-01") // ~0.5 year into first period
        let price = BondPricing.currentPrice(terms: terms, purchaseDate: purchase, asOf: asOf)
        XCTAssertEqual(price, 100 * (1 + 0.0605 * 0.5), accuracy: 0.2)
    }

    func testParseNotesFromBondsView() {
        let notes = "Bond EDO term=120m rate=6.3% margin=2.0 index=cpi cap=true fee=2.0"
        let terms = BondPricing.parseNotes(notes)
        XCTAssertEqual(terms?.code, "EDO")
        XCTAssertEqual(terms?.termMonths, 120)
        XCTAssertEqual(terms?.firstYearRate ?? 0, 6.3, accuracy: 1e-9)
        XCTAssertEqual(terms?.capitalization, true)
    }

    func testPortfolioShowsBondProfit() {
        let group = PortfolioGroup(name: "G", createdAt: .now)
        let portfolio = Portfolio(
            name: "P",
            baseCurrency: "PLN",
            colorHex: "#000000",
            kind: .manual,
            createdAt: .now,
            group: group
        )
        let purchase = date("2024-01-01")
        let buy = Transaction(
            date: purchase,
            type: .buy,
            symbol: "EDO",
            name: "EDO – 10-letnie indeksowane inflacją",
            quantity: 10,
            price: 100,
            gross: 1000,
            fee: 0,
            currency: "PLN",
            notes: "Bond EDO term=120m rate=6.3% margin=2.0 index=cpi cap=true fee=2.0",
            source: "Bond preset",
            assetType: "bond",
            portfolio: portfolio
        )

        let scope = PortfolioCalculator.calculate(
            portfolio: portfolio,
            allTransactions: [buy],
            quotes: []
        )

        XCTAssertEqual(scope.positions.count, 1)
        guard let pos = scope.positions.first else {
            XCTFail("Expected bond position")
            return
        }
        XCTAssertGreaterThan(pos.currentValue, 1000)
        XCTAssertGreaterThan(pos.profit, 0)
        XCTAssertGreaterThan(scope.totalProfitBase, 0)
    }

    private func date(_ ymd: String) -> Date {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(secondsFromGMT: 0)
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: ymd)!
    }
}
