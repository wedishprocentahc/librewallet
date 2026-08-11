import XCTest
import SwiftData
@testable import LibreWallet

final class PeriodReturnsTests: XCTestCase {
    func testYTDStartIsJanuaryFirst() {
        let cal = Calendar(identifier: .gregorian)
        var comps = DateComponents(year: 2026, month: 8, day: 11)
        let asOf = cal.date(from: comps)!
        let start = ReturnPeriod.ytd.startDate(asOf: asOf, calendar: cal)
        XCTAssertEqual(cal.component(.year, from: start), 2026)
        XCTAssertEqual(cal.component(.month, from: start), 1)
        XCTAssertEqual(cal.component(.day, from: start), 1)
    }

    func testReturnPctFromHistory() {
        let cal = Calendar(identifier: .gregorian)
        let asOf = cal.date(from: DateComponents(year: 2026, month: 8, day: 1))!
        let past = cal.date(from: DateComponents(year: 2026, month: 7, day: 1))!
        let histories = ["AAPL": [(date: past, close: 100.0)]]
        let pct = PeriodReturns.returnPct(
            symbol: "AAPL",
            currentPrice: 110,
            histories: histories,
            period: .oneMonth,
            asOf: asOf
        )
        XCTAssertEqual(pct ?? -1, 10, accuracy: 0.01)
    }
}

final class BondMaturityTests: XCTestCase {
    func testOpenLotsFromBuy() throws {
        let portfolio = Portfolio(name: "P", baseCurrency: "PLN", colorHex: "#000", kind: .manual, createdAt: .now, group: nil)
        let purchase = Calendar.current.date(from: DateComponents(year: 2025, month: 1, day: 15))!
        let tx = Transaction(
            date: purchase,
            type: .buy,
            symbol: "OTS",
            name: "OTS",
            quantity: 10,
            price: 100,
            gross: 1000,
            fee: 0,
            currency: "PLN",
            notes: "Bond OTS term=3m rate=3.0% margin=0 index=fixed cap=true fee=0",
            source: "Bond preset",
            assetType: "bond",
            portfolio: portfolio
        )
        let entries = BondMaturity.openLots(transactions: [tx], portfolios: [portfolio], asOf: purchase)
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0].quantity, 10, accuracy: 0.001)
        XCTAssertEqual(entries[0].symbol, "OTS")
    }
}

final class CSVExportTests: XCTestCase {
    func testTemplateHasHeaders() {
        let data = CSVExport.templateCSV()
        let text = String(data: data, encoding: .utf8)!
        XCTAssertTrue(text.contains("date,type,symbol"))
        XCTAssertTrue(text.contains("AAPL.US"))
    }
}

final class TaxReportTests: XCTestCase {
    func testRealizedGainOnSell() {
        let portfolio = Portfolio(name: "P", baseCurrency: "PLN", colorHex: "#000", kind: .manual, createdAt: .now, group: nil)
        let buy = Transaction(
            date: date(2024, 1, 10),
            type: .buy,
            symbol: "AAA",
            quantity: 10,
            price: 10,
            gross: 100,
            fee: 0,
            currency: "PLN",
            portfolio: portfolio
        )
        let sell = Transaction(
            date: date(2024, 6, 10),
            type: .sell,
            symbol: "AAA",
            quantity: 10,
            price: 15,
            gross: 150,
            fee: 0,
            currency: "PLN",
            portfolio: portfolio
        )
        let summary = TaxReport.summary(
            year: 2024,
            transactions: [buy, sell],
            portfolios: [portfolio],
            ratesToPLN: ["PLN": 1],
            reportCurrency: "PLN"
        )
        XCTAssertEqual(summary.realizedGains, 50, accuracy: 0.01)
        XCTAssertEqual(summary.realizedLosses, 0, accuracy: 0.01)
        XCTAssertEqual(summary.capitalProceeds, 150, accuracy: 0.01)
        XCTAssertEqual(summary.capitalCosts, 100, accuracy: 0.01)
    }

    func testFIFOUsesPriorYearBuys() {
        let portfolio = Portfolio(name: "Broker", baseCurrency: "PLN", colorHex: "#000", kind: .manual, createdAt: .now, group: nil)
        let buy = Transaction(
            date: date(2023, 1, 10),
            type: .buy,
            symbol: "AAA",
            quantity: 10,
            price: 10,
            gross: 100,
            fee: 0,
            currency: "PLN",
            portfolio: portfolio
        )
        let sell = Transaction(
            date: date(2024, 6, 10),
            type: .sell,
            symbol: "AAA",
            quantity: 10,
            price: 15,
            gross: 150,
            fee: 0,
            currency: "PLN",
            portfolio: portfolio
        )
        let summary = TaxReport.summary(
            year: 2024,
            transactions: [buy, sell],
            portfolios: [portfolio],
            ratesToPLN: ["PLN": 1]
        )
        XCTAssertEqual(summary.capitalProceeds, 150, accuracy: 0.01)
        XCTAssertEqual(summary.capitalCosts, 100, accuracy: 0.01)
        XCTAssertEqual(summary.realizedGains, 50, accuracy: 0.01)
        XCTAssertEqual(summary.pit38CapitalIncome, 50, accuracy: 0.01)
    }

    func testFIFOConsumesOldestLotsFirst() {
        let portfolio = Portfolio(name: "Broker", baseCurrency: "PLN", colorHex: "#000", kind: .manual, createdAt: .now, group: nil)
        let buy1 = Transaction(
            date: date(2024, 1, 1),
            type: .buy,
            symbol: "AAA",
            quantity: 5,
            price: 10,
            gross: 50,
            fee: 0,
            currency: "PLN",
            portfolio: portfolio
        )
        let buy2 = Transaction(
            date: date(2024, 2, 1),
            type: .buy,
            symbol: "AAA",
            quantity: 5,
            price: 20,
            gross: 100,
            fee: 0,
            currency: "PLN",
            portfolio: portfolio
        )
        let sell = Transaction(
            date: date(2024, 3, 1),
            type: .sell,
            symbol: "AAA",
            quantity: 5,
            price: 30,
            gross: 150,
            fee: 0,
            currency: "PLN",
            portfolio: portfolio
        )
        let report = TaxReport.report(
            year: 2024,
            transactions: [buy1, buy2, sell],
            portfolios: [portfolio],
            rateOnDate: { _, _ in 1 }
        )
        XCTAssertEqual(report.summary.capitalCosts, 50, accuracy: 0.01)
        XCTAssertEqual(report.summary.realizedGains, 100, accuracy: 0.01)
        XCTAssertEqual(report.sells.count, 1)
    }

    func testIKEExcludedByDefault() {
        let ike = Portfolio(name: "XTB IKE (123)", baseCurrency: "PLN", colorHex: "#000", kind: .account, createdAt: .now, group: nil)
        let normal = Portfolio(name: "XTB PLN (999)", baseCurrency: "PLN", colorHex: "#000", kind: .account, createdAt: .now, group: nil)

        let buyIKE = Transaction(date: date(2024, 1, 1), type: .buy, symbol: "AAA", quantity: 1, price: 10, gross: 10, fee: 0, currency: "PLN", portfolio: ike)
        let sellIKE = Transaction(date: date(2024, 6, 1), type: .sell, symbol: "AAA", quantity: 1, price: 20, gross: 20, fee: 0, currency: "PLN", portfolio: ike)
        let buyN = Transaction(date: date(2024, 1, 1), type: .buy, symbol: "BBB", quantity: 1, price: 10, gross: 10, fee: 0, currency: "PLN", portfolio: normal)
        let sellN = Transaction(date: date(2024, 6, 1), type: .sell, symbol: "BBB", quantity: 1, price: 12, gross: 12, fee: 0, currency: "PLN", portfolio: normal)

        let excluded = TaxReport.summary(
            year: 2024,
            transactions: [buyIKE, sellIKE, buyN, sellN],
            portfolios: [ike, normal],
            ratesToPLN: ["PLN": 1],
            includeTaxExemptAccounts: false
        )
        XCTAssertEqual(excluded.realizedGains, 2, accuracy: 0.01)
        XCTAssertEqual(excluded.excludedTaxExemptCount, 1)

        let included = TaxReport.summary(
            year: 2024,
            transactions: [buyIKE, sellIKE, buyN, sellN],
            portfolios: [ike, normal],
            ratesToPLN: ["PLN": 1],
            includeTaxExemptAccounts: true
        )
        XCTAssertEqual(included.realizedGains, 12, accuracy: 0.01)
    }

    func testFXUsesProvidedRateOnDate() {
        let portfolio = Portfolio(name: "Broker", baseCurrency: "PLN", colorHex: "#000", kind: .manual, createdAt: .now, group: nil)
        let buy = Transaction(
            date: date(2023, 1, 10),
            type: .buy,
            symbol: "AAPL.US",
            quantity: 1,
            price: 100,
            gross: 100,
            fee: 0,
            currency: "USD",
            portfolio: portfolio
        )
        let sell = Transaction(
            date: date(2024, 6, 10),
            type: .sell,
            symbol: "AAPL.US",
            quantity: 1,
            price: 110,
            gross: 110,
            fee: 0,
            currency: "USD",
            portfolio: portfolio
        )
        let report = TaxReport.report(
            year: 2024,
            transactions: [buy, sell],
            portfolios: [portfolio],
            rateOnDate: { ccy, date in
                if CurrencyCode.normalize(ccy) != "USD" { return 1 }
                let y = Calendar.current.component(.year, from: date)
                return y == 2023 ? 4.0 : 5.0
            }
        )
        XCTAssertEqual(report.summary.capitalCosts, 400, accuracy: 0.01)
        XCTAssertEqual(report.summary.capitalProceeds, 550, accuracy: 0.01)
        XCTAssertEqual(report.summary.realizedGains, 150, accuracy: 0.01)
    }

    private func date(_ y: Int, _ m: Int, _ d: Int) -> Date {
        Calendar.current.date(from: DateComponents(year: y, month: m, day: d))!
    }
}

final class BackupRoundTripTests: XCTestCase {
    func testExportImportRoundTrip() throws {
        let schema = Schema([
            PortfolioGroup.self,
            Portfolio.self,
            Transaction.self,
            BondHolding.self,
            AllocationTarget.self,
            Quote.self,
        ])
        let config = ModelConfiguration(isStoredInMemoryOnly: true)
        let container = try ModelContainer(for: schema, configurations: [config])
        let context = ModelContext(container)

        let group = PortfolioGroup(name: "G", colorHex: "#176b4d", createdAt: .now)
        context.insert(group)
        let portfolio = Portfolio(name: "P", baseCurrency: "PLN", colorHex: "#176b4d", kind: .manual, createdAt: .now, group: group)
        context.insert(portfolio)
        context.insert(Transaction(
            date: .now,
            type: .deposit,
            gross: 1000,
            fee: 0,
            currency: "PLN",
            cashDelta: 1000,
            portfolio: portfolio
        ))
        try context.save()

        let data = try BackupService.export(context: context)
        try BackupService.wipe(context: context)
        try BackupService.import(data: data, context: context, wipeExisting: false)

        let portfolios = try context.fetch(FetchDescriptor<Portfolio>())
        let txs = try context.fetch(FetchDescriptor<Transaction>())
        XCTAssertEqual(portfolios.count, 1)
        XCTAssertEqual(txs.count, 1)
        XCTAssertEqual(portfolios.first?.name, "P")
    }
}
