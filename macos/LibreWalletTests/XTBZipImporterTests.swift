import XCTest
@testable import LibreWallet

final class XTBZipImporterTests: XCTestCase {
    func testImportsCashOperationsFromMultiSheetXLSX() throws {
        let url = URL(fileURLWithPath: "/tmp/xtb-inspect/53254345/PLN_53254345_2006-01-01_2026-08-07.xlsx")
        try XCTSkipIf(!FileManager.default.fileExists(atPath: url.path), "Sample XTB XLSX not extracted at \(url.path)")

        let rows = try XTBZipImporter.importPreview(from: makeZip(containing: url, accountFolder: "53254345"))
        XCTAssertFalse(rows.isEmpty, "Expected cash operations rows from Cash Operations sheet")
        XCTAssertTrue(rows.contains(where: { $0.type == .buy || $0.type == .sell }))
        XCTAssertTrue(rows.contains(where: { ($0.account ?? "") == "53254345" }))
        XCTAssertTrue(rows.allSatisfy { $0.currency == "PLN" })
    }

    func testImportsFullXTBZip() throws {
        let zip = URL(fileURLWithPath: "/Users/wedish/Downloads/53254345_53315423_53315424_2006-01-01_2026-08-07.zip")
        try XCTSkipIf(!FileManager.default.fileExists(atPath: zip.path), "Sample XTB ZIP missing")

        let rows = try XTBZipImporter.importPreview(from: zip)
        XCTAssertGreaterThan(rows.count, 20)
        let accounts = Set(rows.compactMap(\.account))
        XCTAssertTrue(accounts.contains("53254345"))
        XCTAssertTrue(accounts.contains("53315423") || accounts.contains("53315424"))
        let currencies = Set(rows.map(\.currency))
        XCTAssertTrue(currencies.isSuperset(of: ["PLN"]))
    }

    /// Wrap a single XLSX in a ZIP with XTB-like folder layout so account/currency hints apply.
    private func makeZip(containing xlsx: URL, accountFolder: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("xtb-test-\(UUID().uuidString)", isDirectory: true)
        let nested = dir.appendingPathComponent(accountFolder, isDirectory: true)
        try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: true)
        let dest = nested.appendingPathComponent(xlsx.lastPathComponent)
        try FileManager.default.copyItem(at: xlsx, to: dest)

        let zipURL = FileManager.default.temporaryDirectory.appendingPathComponent("xtb-test-\(UUID().uuidString).zip")
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/zip")
        proc.currentDirectoryURL = dir
        proc.arguments = ["-r", zipURL.path, "."]
        try proc.run()
        proc.waitUntilExit()
        XCTAssertEqual(proc.terminationStatus, 0)
        return zipURL
    }
}
