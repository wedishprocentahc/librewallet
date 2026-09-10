import XCTest
@testable import LibreWallet

final class AgentFeedTests: XCTestCase {
    func testBuildIncludesQuantityProfitAndCashPerPortfolio() {
        let portfolio = Portfolio(
            name: "XTB PLN (1)",
            baseCurrency: "PLN",
            colorHex: "#000",
            kind: .account,
            createdAt: .now,
            group: nil
        )
        let deposit = Transaction(
            date: Date(timeIntervalSince1970: 0),
            type: .deposit,
            gross: 1000,
            fee: 0,
            currency: "PLN",
            cashDelta: 1000,
            portfolio: portfolio
        )
        let buy = Transaction(
            date: Date(timeIntervalSince1970: 1),
            type: .buy,
            symbol: "PKN.PL",
            name: "Orlen",
            quantity: 2,
            price: 100,
            gross: 200,
            fee: 0,
            currency: "PLN",
            cashDelta: -200,
            assetType: "stock",
            portfolio: portfolio
        )
        let quote = Quote(symbol: "PKN.PL", currency: "PLN", price: 150, asOf: .now)

        let feed = AgentFeedBuilder.build(
            portfolios: [portfolio],
            transactions: [deposit, buy],
            quotes: [quote],
            ratesToPLN: ["PLN": 1],
            appVersion: "0.5.6"
        )

        XCTAssertEqual(feed.schemaVersion, 1)
        XCTAssertEqual(feed.source, "librewallet-native")
        XCTAssertEqual(feed.positions.count, 1)
        XCTAssertEqual(feed.positions[0].symbol, "PKN.PL")
        XCTAssertEqual(feed.positions[0].quantity, 2, accuracy: 1e-9)
        XCTAssertEqual(feed.positions[0].avgCost, 100, accuracy: 1e-9)
        XCTAssertEqual(feed.positions[0].currentValue, 300, accuracy: 1e-9)
        XCTAssertEqual(feed.positions[0].profit, 100, accuracy: 1e-9)
        XCTAssertEqual(feed.positions[0].profitPct, 50, accuracy: 1e-9)
        XCTAssertEqual(feed.cash.count, 1)
        XCTAssertEqual(feed.cash[0].value, 800, accuracy: 1e-9)
        XCTAssertEqual(feed.totalValue, 1100, accuracy: 1e-9)
        XCTAssertTrue(feed.missingQuotes.isEmpty)
    }

    func testAtomicWriteRoundTrip() throws {
        let feed = AgentFeedBuilder.Feed(
            schemaVersion: 1,
            generatedAt: "2026-09-10T10:00:00Z",
            appVersion: "test",
            baseCurrency: "PLN",
            source: "librewallet-native",
            lastSyncAt: nil,
            totalValue: 1,
            netInvested: 1,
            totalProfit: 0,
            returnPct: 0,
            allocationByType: [:],
            allocationByCurrency: [:],
            positions: [],
            cash: [],
            quotesAgeMinutes: nil,
            staleSymbols: [],
            missingQuotes: []
        )
        try AgentFeedStore.write(feed)
        let data = try XCTUnwrap(AgentFeedStore.readData())
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["schemaVersion"] as? Int, 1)
        XCTAssertEqual(json["source"] as? String, "librewallet-native")
    }
}
