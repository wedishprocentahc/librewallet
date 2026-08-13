import XCTest
@testable import LibreWallet

final class AssetTypeDetectionTests: XCTestCase {
    func testPolishGPWETFSymbolsAreETF() {
        XCTAssertEqual(AssetTypeDetection.detect(symbol: "ETFBW20TR.PL", name: nil), "etf")
        XCTAssertEqual(AssetTypeDetection.detect(symbol: "ETFBM40TR.PL", name: "Beta ETF mWIG40TR"), "etf")
        XCTAssertEqual(AssetTypeDetection.detect(symbol: "ETFSPLTR.PL", name: nil), "etf")
        XCTAssertEqual(AssetTypeDetection.detect(symbol: "ETFDAXPL.PL", name: nil), "etf")
        XCTAssertEqual(AssetTypeDetection.detect(symbol: "ETFSP500.PL", name: nil), "etf")
    }

    func testRegularPolishStockStaysStock() {
        XCTAssertEqual(AssetTypeDetection.detect(symbol: "PKO.PL", name: "PKO BP"), "stock")
        XCTAssertEqual(AssetTypeDetection.detect(symbol: "CDR.PL", name: "CD Projekt"), "stock")
    }

    func testInternationalETFTickers() {
        XCTAssertEqual(AssetTypeDetection.detect(symbol: "VWCE.DE", name: nil), "etf")
        XCTAssertEqual(AssetTypeDetection.detect(symbol: "IWDA.AS", name: "iShares Core MSCI World"), "etf")
    }

    func testETFInNameWithoutSymbolKeyword() {
        XCTAssertEqual(AssetTypeDetection.detect(symbol: "XYZ.US", name: "Some UCITS ETF"), "etf")
    }
}
