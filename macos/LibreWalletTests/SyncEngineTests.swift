import XCTest
import SwiftData
@testable import LibreWallet

final class SyncEngineTests: XCTestCase {
    // MARK: decide()

    func testDecideRules() {
        XCTAssertEqual(SyncEngine.decide(local: "a", peer: "a", base: nil), .none)
        XCTAssertEqual(SyncEngine.decide(local: nil, peer: "a", base: nil), .takePeer)
        XCTAssertEqual(SyncEngine.decide(local: "a", peer: nil, base: nil), .none)
        XCTAssertEqual(SyncEngine.decide(local: "a", peer: "b", base: "a"), .takePeer)   // peer edited
        XCTAssertEqual(SyncEngine.decide(local: "b", peer: "a", base: "a"), .none)       // we edited
        XCTAssertEqual(SyncEngine.decide(local: "a", peer: nil, base: "a"), .deleteLocal) // peer deleted
        XCTAssertEqual(SyncEngine.decide(local: nil, peer: "a", base: "a"), .none)       // we deleted
        XCTAssertEqual(SyncEngine.decide(local: "b", peer: nil, base: "a"), .none)       // keep our edit
        XCTAssertEqual(SyncEngine.decide(local: nil, peer: "b", base: "a"), .takePeer)   // keep peer's edit
    }

    // MARK: two-device simulation

    private final class Device {
        var state = SyncState()
        var base = SyncBase()

        func sync(with peer: Device) {
            let plan = SyncEngine.plan(local: state, peer: peer.state, base: base)
            Self.apply(plan, to: &state)
            base = plan.base
        }

        static func apply(_ plan: SyncPlan, to s: inout SyncState) {
            s.groups.removeAll { plan.deleteGroupIds.contains($0.id) }
            s.portfolios.removeAll { plan.deletePortfolioIds.contains($0.id) }
            s.transactions.removeAll { plan.deleteTransactionIds.contains($0.id) }
            s.targets.removeAll { plan.deleteTargetIds.contains($0.id) }
            for g in plan.upsertGroups { s.groups.removeAll { $0.id == g.id }; s.groups.append(g) }
            for p in plan.upsertPortfolios { s.portfolios.removeAll { $0.id == p.id }; s.portfolios.append(p) }
            for t in plan.upsertTransactions { s.transactions.removeAll { $0.id == t.id }; s.transactions.append(t) }
            for t in plan.upsertTargets { s.targets.removeAll { $0.id == t.id }; s.targets.append(t) }
        }
    }

    private func converge(_ a: Device, _ b: Device, rounds: Int = 4) {
        for _ in 0..<rounds {
            a.sync(with: b)
            b.sync(with: a)
        }
    }

    func testNewTransactionsPropagateBothWays() {
        let a = Device(), b = Device()
        let p = portfolio("XTB PLN")
        a.state.portfolios = [p]
        a.state.transactions = [tx(p.id, ext: "1")]
        converge(a, b)
        b.state.transactions.append(tx(b.state.portfolios[0].id, ext: "2", qty: 5))
        converge(a, b)

        XCTAssertEqual(a.state.transactions.count, 2)
        XCTAssertEqual(SyncEngine.hash(a.state), SyncEngine.hash(b.state))
    }

    func testDeletionPropagatesAndEditsWin() {
        let a = Device(), b = Device()
        let p = portfolio("XTB PLN")
        let t1 = tx(p.id, ext: "1"), t2 = tx(p.id, ext: "2", qty: 3)
        a.state.portfolios = [p]
        a.state.transactions = [t1, t2]
        converge(a, b)

        a.state.transactions.removeAll { $0.id == t1.id }                  // A deletes t1
        b.state.transactions = b.state.transactions.map {                  // B edits t2
            $0.id == t2.id ? tx(p.id, id: t2.id, ext: "2", qty: 9) : $0
        }
        converge(a, b)

        XCTAssertEqual(a.state.transactions.map(\.id), [t2.id])
        XCTAssertEqual(a.state.transactions.first?.quantity, 9)
        XCTAssertEqual(SyncEngine.hash(a.state), SyncEngine.hash(b.state))
    }

    func testConcurrentEditsConvergeWithoutOscillation() {
        let a = Device(), b = Device()
        let p = portfolio("XTB PLN")
        let t = tx(p.id, ext: "1")
        a.state.portfolios = [p]
        a.state.transactions = [t]
        converge(a, b)

        a.state.transactions = [tx(p.id, id: t.id, ext: "1", qty: 7)]
        b.state.transactions = [tx(p.id, id: t.id, ext: "1", qty: 8)]
        converge(a, b)

        XCTAssertEqual(a.state.transactions, b.state.transactions)
        let settled = SyncEngine.hash(a.state)
        converge(a, b, rounds: 2)
        XCTAssertEqual(SyncEngine.hash(a.state), settled)
    }

    func testSameReportImportedOnBothDevicesDoesNotDuplicate() {
        let a = Device(), b = Device()
        let pa = portfolio("XTB PLN (1)"), pb = portfolio("XTB PLN (1)")
        a.state.portfolios = [pa]
        b.state.portfolios = [pb]
        a.state.transactions = [tx(pa.id, ext: "100"), tx(pa.id, ext: "101", qty: 2)]
        b.state.transactions = [tx(pb.id, ext: "100"), tx(pb.id, ext: "101", qty: 2)]  // new UUIDs

        converge(a, b)

        XCTAssertEqual(a.state.portfolios.count, 1)
        XCTAssertEqual(a.state.transactions.count, 2)
        XCTAssertEqual(b.state.portfolios.count, 1)
        XCTAssertEqual(b.state.transactions.count, 2)
    }

    // MARK: SwiftData round trip

    @MainActor
    func testApplyPlanToDatabaseAndBack() throws {
        let schema = Schema([
            PortfolioGroup.self, Portfolio.self, Transaction.self, BondHolding.self, AllocationTarget.self, Quote.self,
        ])
        let container = try ModelContainer(for: schema, configurations: [ModelConfiguration(isStoredInMemoryOnly: true)])
        let context = ModelContext(container)

        let p = portfolio("XTB PLN")
        let t = tx(p.id, ext: "1", qty: 2)
        let peer = SyncState(portfolios: [p], transactions: [t])

        var plan = SyncEngine.plan(local: SyncState(), peer: peer, base: SyncBase())
        XCTAssertEqual(plan.changeCount, 2)
        try SyncCoordinator.apply(plan, context: context)

        let local = try SyncCoordinator.currentState(context: context)
        XCTAssertEqual(local.transactions, [t])
        XCTAssertEqual(local.portfolios.map(\.name), ["XTB PLN"])

        // Peer deletes the transaction → we delete it, portfolio stays.
        let afterDelete = SyncState(portfolios: [p])
        plan = SyncEngine.plan(local: local, peer: afterDelete, base: plan.base)
        XCTAssertEqual(plan.deleteTransactionIds, [t.id])
        try SyncCoordinator.apply(plan, context: context)
        XCTAssertTrue(try SyncCoordinator.currentState(context: context).transactions.isEmpty)
    }

    // MARK: helpers

    private func portfolio(_ name: String) -> LWBackup.PortfolioDTO {
        .init(id: UUID(), groupId: nil, name: name, baseCurrency: "PLN", colorHex: "#000000", kindRaw: "account", createdAt: Date(timeIntervalSince1970: 1))
    }

    private func tx(_ portfolioId: UUID, id: UUID = UUID(), ext: String, qty: Double = 1) -> LWBackup.TransactionDTO {
        .init(
            id: id, portfolioId: portfolioId, date: Date(timeIntervalSince1970: 1_000 + (Double(ext) ?? 0)),
            typeRaw: "buy", symbol: "PKN.PL", name: nil, quantity: qty, price: 100, gross: qty * 100, fee: 0,
            currency: "PLN", cashDelta: -qty * 100, externalId: ext, notes: nil, source: nil, assetType: nil
        )
    }
}
