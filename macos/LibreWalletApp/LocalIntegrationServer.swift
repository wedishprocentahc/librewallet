import Foundation
import Network
import SwiftData

/// Loopback HTTP API (`127.0.0.1:8787`) for OpenClaw / Inwestor — same contract as `server.js`.
@MainActor
final class LocalIntegrationServer {
    static let shared = LocalIntegrationServer()

    private(set) var isRunning = false
    private(set) var lastError: String?
    private var listener: NWListener?
    private var container: ModelContainer?

    private let host = "127.0.0.1"
    private let port: UInt16 = 8787

    func start(container: ModelContainer) {
        self.container = container
        guard listener == nil else { return }

        do {
            let parameters = NWParameters.tcp
            parameters.allowLocalEndpointReuse = true
            let listener = try NWListener(using: parameters, on: NWEndpoint.Port(rawValue: port)!)
            listener.newConnectionHandler = { [weak self] connection in
                Task { @MainActor in
                    self?.handle(connection: connection)
                }
            }
            listener.stateUpdateHandler = { [weak self] state in
                Task { @MainActor in
                    guard let self else { return }
                    switch state {
                    case .ready:
                        self.isRunning = true
                        self.lastError = nil
                        print("LibreWallet API: http://\(self.host):\(self.port)/")
                    case .failed(let error):
                        self.isRunning = false
                        self.lastError = error.localizedDescription
                        print("LibreWallet API failed: \(error)")
                        self.listener?.cancel()
                        self.listener = nil
                    case .cancelled:
                        self.isRunning = false
                    default:
                        break
                    }
                }
            }
            self.listener = listener
            listener.start(queue: .global(qos: .utility))
        } catch {
            lastError = error.localizedDescription
            print("LibreWallet API could not start: \(error)")
        }
    }

    func stop() {
        listener?.cancel()
        listener = nil
        isRunning = false
    }

    private func handle(connection: NWConnection) {
        connection.start(queue: .global(qos: .utility))
        receive(on: connection, buffer: Data())
    }

    private func receive(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            var buffer = buffer
            if let data, !data.isEmpty {
                buffer.append(data)
            }
            if let error {
                connection.cancel()
                print("LibreWallet API connection error: \(error)")
                return
            }
            if let request = HTTPRequest.parse(buffer) {
                Task { @MainActor in
                    let response = await self?.response(for: request) ?? Self.jsonResponse(status: 500, object: ["error": "Server unavailable"])
                    Self.send(response, on: connection)
                }
                return
            }
            if isComplete {
                connection.cancel()
                return
            }
            // Headers not complete yet — keep reading.
            if buffer.count > 1_000_000 {
                Self.send(Self.jsonResponse(status: 413, object: ["error": "Request too large"]), on: connection)
                return
            }
            self?.receive(on: connection, buffer: buffer)
        }
    }

    private func response(for request: HTTPRequest) async -> Data {
        switch (request.method, request.path) {
        case ("GET", "/api/health"):
            return Self.jsonResponse(status: 200, object: [
                "ok": true,
                "service": "librewallet",
                "version": AppVersion.shortVersion,
                "source": "macos",
            ])

        case ("GET", "/api/holdings"):
            return holdingsGET()

        case ("GET", "/api/portfolio"):
            return portfolioGET()

        case ("GET", "/api/agent-feed"):
            return agentFeedGET()

        case ("POST", "/api/holdings"):
            // Web compat no-op — macOS serves live data on GET.
            return Self.jsonResponse(status: 200, object: ["ok": true, "count": 0, "note": "macos-live"])

        case ("POST", "/api/quotes"):
            return await refreshQuotes()

        default:
            return Self.jsonResponse(status: 404, object: ["error": "Not found"])
        }
    }

    private func agentFeedGET() -> Data {
        if let feed = AgentFeedPublisher.publishNow() {
            return Self.jsonResponse(status: 200, encodable: feed)
        }
        if let cached = AgentFeedStore.readData() {
            return Self.httpMessage(status: 200, body: cached)
        }
        return Self.jsonResponse(status: 503, object: ["error": "Agent feed unavailable"])
    }

    private func holdingsGET() -> Data {
        guard let context = makeContext() else {
            return Self.jsonResponse(status: 503, object: ["error": "Store unavailable"])
        }
        do {
            let portfolios = try context.fetch(FetchDescriptor<Portfolio>(sortBy: [SortDescriptor(\.createdAt)]))
            let transactions = try context.fetch(FetchDescriptor<Transaction>())
            let payload = LocalIntegrationAPI.holdings(portfolios: portfolios, transactions: transactions)
            return Self.jsonResponse(status: 200, encodable: payload)
        } catch {
            return Self.jsonResponse(status: 500, object: ["error": error.localizedDescription])
        }
    }

    private func portfolioGET() -> Data {
        guard let context = makeContext() else {
            return Self.jsonResponse(
                status: 200,
                encodable: LocalIntegrationAPI.PortfolioResponse.noData("LibreWallet store unavailable.")
            )
        }
        do {
            let portfolios = try context.fetch(FetchDescriptor<Portfolio>(sortBy: [SortDescriptor(\.createdAt)]))
            let transactions = try context.fetch(FetchDescriptor<Transaction>())
            let quotes = try context.fetch(FetchDescriptor<Quote>())
            guard !portfolios.isEmpty else {
                return Self.jsonResponse(
                    status: 200,
                    encodable: LocalIntegrationAPI.PortfolioResponse.noData(
                        "Brak portfeli w LibreWallet."
                    )
                )
            }
            let rates = NBPExchangeRateService.cachedRatesToPLN()
            let summary = LocalIntegrationAPI.portfolioSummary(
                portfolios: portfolios,
                transactions: transactions,
                quotes: quotes,
                ratesToPLN: rates
            )
            let holdings = LocalIntegrationAPI.holdings(portfolios: portfolios, transactions: transactions)
            return Self.jsonResponse(
                status: 200,
                encodable: LocalIntegrationAPI.PortfolioResponse.ok(summary: summary, holdings: holdings)
            )
        } catch {
            return Self.jsonResponse(status: 500, object: ["error": error.localizedDescription])
        }
    }

    private func refreshQuotes() async -> Data {
        guard let context = makeContext() else {
            return Self.jsonResponse(status: 503, object: ["error": "Store unavailable"])
        }
        do {
            let transactions = try context.fetch(FetchDescriptor<Transaction>())
            try await PricingService.refreshQuotes(for: transactions, context: context)
            _ = try? await NBPExchangeRateService.ratesToPLN()
            let quotes = try context.fetch(FetchDescriptor<Quote>())
            AgentFeedPublisher.publishNow()
            return Self.jsonResponse(status: 200, object: [
                "ok": true,
                "fetchedAt": ISO8601DateFormatter().string(from: Date()),
                "refreshed": quotes.count,
                "source": "macos",
            ])
        } catch {
            return Self.jsonResponse(status: 500, object: ["error": error.localizedDescription])
        }
    }

    private func makeContext() -> ModelContext? {
        guard let container else { return nil }
        return ModelContext(container)
    }

    private static func send(_ response: Data, on connection: NWConnection) {
        connection.send(content: response, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private static func jsonResponse(status: Int, object: [String: Any]) -> Data {
        let body = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
        return httpMessage(status: status, body: body)
    }

    private static func jsonResponse<T: Encodable>(status: Int, encodable: T) -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let body = (try? encoder.encode(encodable)) ?? Data("{}".utf8)
        return httpMessage(status: status, body: body)
    }

    static func httpMessage(status: Int, body: Data) -> Data {
        let reason: String
        switch status {
        case 200: reason = "OK"
        case 404: reason = "Not Found"
        case 413: reason = "Payload Too Large"
        case 500: reason = "Internal Server Error"
        case 503: reason = "Service Unavailable"
        default: reason = "OK"
        }
        var header = "HTTP/1.1 \(status) \(reason)\r\n"
        header += "Content-Type: application/json; charset=utf-8\r\n"
        header += "Content-Length: \(body.count)\r\n"
        header += "Connection: close\r\n"
        header += "Access-Control-Allow-Origin: *\r\n"
        header += "\r\n"
        var data = Data(header.utf8)
        data.append(body)
        return data
    }
}

private struct HTTPRequest {
    let method: String
    let path: String

    static func parse(_ data: Data) -> HTTPRequest? {
        guard let text = String(data: data, encoding: .utf8) else { return nil }
        guard text.contains("\r\n\r\n") || text.contains("\n\n") else { return nil }
        let lines = text.split(whereSeparator: \.isNewline)
        guard let first = lines.first else { return nil }
        let parts = first.split(separator: " ")
        guard parts.count >= 2 else { return nil }
        let method = String(parts[0]).uppercased()
        let pathOnly = String(parts[1]).split(separator: "?").first.map(String.init) ?? String(parts[1])
        return HTTPRequest(method: method, path: pathOnly)
    }
}
