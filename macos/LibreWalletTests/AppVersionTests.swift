import XCTest
@testable import LibreWallet

final class AppVersionTests: XCTestCase {
    func testSemverComparison() {
        XCTAssertTrue(AppVersion.isVersion("0.1.0", olderThan: "0.1.1"))
        XCTAssertTrue(AppVersion.isVersion("0.1.0", olderThan: "v0.2.0"))
        XCTAssertTrue(AppVersion.isVersion("1.0.0", olderThan: "1.0.1"))
        XCTAssertFalse(AppVersion.isVersion("0.2.0", olderThan: "0.1.9"))
        XCTAssertFalse(AppVersion.isVersion("0.1.0", olderThan: "0.1.0"))
        XCTAssertFalse(AppVersion.isVersion("v0.1.0", olderThan: "0.1.0"))
    }
}
