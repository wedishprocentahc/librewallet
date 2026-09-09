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

    private func makeTx(externalId: String?) -> ImportedTransaction {
        ImportedTransaction(
            date: .now,
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
