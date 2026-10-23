import XCTest
@testable import LibreWallet

final class ImportDeduperTests: XCTestCase {
    func testSkipsExistingExternalIdsAndInBatchDuplicates() {
        let a = makeTx(externalId: "100")
        let b = makeTx(externalId: "100")
        let c = makeTx(externalId: "200")
        let noId = makeTx(externalId: nil)

        let outcome = ImportDeduper.filterNew(
            [a, b, c, noId],
            existingExternalIds: ["200", " 300 "]
        )

        XCTAssertEqual(outcome.skippedDuplicates, 2) // batch dup of 100 + existing 200
        XCTAssertEqual(outcome.toInsert.count, 2)
        XCTAssertEqual(outcome.toInsert.map(\.externalId), ["100", nil])
    }

    func testKeepsAllWhenNoExternalIds() {
        let items = [makeTx(externalId: nil), makeTx(externalId: "")]
        let outcome = ImportDeduper.filterNew(items, existingExternalIds: ["999"])
        XCTAssertEqual(outcome.skippedDuplicates, 0)
        XCTAssertEqual(outcome.toInsert.count, 2)
    }

    func testSkipsRowWithDifferentIdAndSubSecondTimestampMatchingStoredFingerprint() {
        let stored = makeTx(externalId: "100", date: Date(timeIntervalSince1970: 1_000))
        let reexport = makeTx(externalId: "101", date: Date(timeIntervalSince1970: 1_000.873))
        let other = makeTx(externalId: "102", date: Date(timeIntervalSince1970: 2_000))

        let outcome = ImportDeduper.filterNew(
            [reexport, other],
            existingExternalIds: ["100"],
            existingFingerprints: [ImportDeduper.fingerprint(stored)]
        )

        XCTAssertEqual(outcome.skippedDuplicates, 1)
        XCTAssertEqual(outcome.toInsert.map(\.externalId), ["102"])
    }

    func testParsesDealCommentWithTickerBetweenSideAndQuantity() {
        let withTicker = XTBOperationParsing.parseDealComment("OPEN BUY ETFBW20TR.PL 0.9309 @ 86.990")
        XCTAssertEqual(withTicker.quantity, 0.9309, accuracy: 1e-9)
        XCTAssertEqual(withTicker.price, 86.99, accuracy: 1e-9)

        let fractional = XTBOperationParsing.parseDealComment("CLOSE BUY 0.4248/3.9527 @ 179.40")
        XCTAssertEqual(fractional.quantity, 0.4248, accuracy: 1e-9)
    }

    private func makeTx(externalId: String?, date: Date = .now) -> ImportedTransaction {
        ImportedTransaction(
            date: date,
            type: .buy,
            symbol: "PKN.PL",
            name: "PKN",
            quantity: 1,
            price: 100,
            gross: 100,
            fee: 0,
            currency: "PLN",
            cashDelta: -100,
            externalId: externalId
        )
    }
}
