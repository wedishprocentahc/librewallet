import XCTest
@testable import LibreWallet

final class SymbolResolverTests: XCTestCase {
    override func tearDown() {
        AppPreferences.symbolMappings = []
        super.tearDown()
    }

    func testDIAPLMapsToWarsawNotBareUS() {
        let result = SymbolResolver.resolve(xtbSymbol: "DIA.PL", positionCurrency: "PLN")
        guard case .success(let resolved) = result else {
            return XCTFail("expected success")
        }
        XCTAssertEqual(resolved.providerSymbol, "DIA.WA")
        XCTAssertNotEqual(resolved.providerSymbol, "DIA")
        XCTAssertEqual(resolved.expectedCurrency, "PLN")
        XCTAssertFalse(resolved.fromOverride)
    }

    func testAAPLUSMapsToBareYahoo() {
        let result = SymbolResolver.resolve(xtbSymbol: "AAPL.US", positionCurrency: "USD")
        guard case .success(let resolved) = result else {
            return XCTFail("expected success")
        }
        XCTAssertEqual(resolved.providerSymbol, "AAPL")
        XCTAssertEqual(resolved.expectedCurrency, "USD")
    }

    func testVWCEDEAsIs() {
        let result = SymbolResolver.resolve(xtbSymbol: "VWCE.DE", positionCurrency: "EUR")
        guard case .success(let resolved) = result else {
            return XCTFail("expected success")
        }
        XCTAssertEqual(resolved.providerSymbol, "VWCE.DE")
        XCTAssertEqual(resolved.expectedCurrency, "EUR")
    }

    func testOverrideBeatsMarketRule() {
        AppPreferences.symbolMappings = [
            SymbolMapping(id: "DIA.PL", providerSymbol: "CUSTOM.WA", note: "test")
        ]
        let result = SymbolResolver.resolve(xtbSymbol: "DIA.PL", positionCurrency: "PLN")
        guard case .success(let resolved) = result else {
            return XCTFail("expected success")
        }
        XCTAssertEqual(resolved.providerSymbol, "CUSTOM.WA")
        XCTAssertTrue(resolved.fromOverride)
    }

    func testBareSymbolUnresolvedWithoutOverride() {
        let result = SymbolResolver.resolve(xtbSymbol: "SOMETHING", positionCurrency: "PLN")
        guard case .failure(.unresolved(let s)) = result else {
            return XCTFail("expected unresolved, got \(result)")
        }
        XCTAssertEqual(s, "SOMETHING")
    }

    func testEEEIgnored() {
        let result = SymbolResolver.resolve(xtbSymbol: "EEE.PL", positionCurrency: "PLN")
        XCTAssertEqual(result, .failure(.ignored))
    }

    func testCurrencyMismatchRejected() async throws {
        // Force resolve to US DIA via override while expecting PLN → fetch must fail.
        AppPreferences.symbolMappings = [
            SymbolMapping(id: "DIA.PL", providerSymbol: "DIA")
        ]
        do {
            _ = try await PricingService.fetchQuote(xtbSymbol: "DIA.PL", positionCurrency: "PLN")
            XCTFail("expected currency mismatch")
        } catch let error as PricingService.FetchError {
            if case .currencyMismatch(let expected, let got, _) = error {
                XCTAssertEqual(expected, "PLN")
                XCTAssertEqual(got, "USD")
            } else {
                // Network may fail in CI — accept http/noData as skip-like.
                switch error {
                case .http, .noData:
                    throw XCTSkip("Yahoo unavailable: \(error)")
                default:
                    XCTFail("unexpected fetch error: \(error)")
                }
            }
        }
    }
}
