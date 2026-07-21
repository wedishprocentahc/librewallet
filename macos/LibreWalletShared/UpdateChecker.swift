import Foundation

enum UpdateCheckResult: Equatable {
    case upToDate(current: String)
    case updateAvailable(latest: String, releaseURL: URL, downloadURL: URL?)
    case failed(String)
}

enum LibreWalletDistribution {
    static let githubOwner = "wedishprocentahc"
    static let githubRepo = "librewallet"
    static let releasesPageURL = URL(string: "https://github.com/\(githubOwner)/\(githubRepo)/releases/latest")!
    static let downloadPageURL = URL(string: "https://wedishprocentahc.github.io/librewallet/")!
    static let zipAssetName = "LibreWallet.zip"

    static var latestZipURL: URL {
        URL(string: "https://github.com/\(githubOwner)/\(githubRepo)/releases/latest/download/\(zipAssetName)")!
    }

    static var latestReleaseAPIURL: URL {
        URL(string: "https://api.github.com/repos/\(githubOwner)/\(githubRepo)/releases/latest")!
    }
}

enum UpdateChecker {
    static func checkForUpdates() async -> UpdateCheckResult {
        do {
            var request = URLRequest(url: LibreWalletDistribution.latestReleaseAPIURL)
            request.setValue("LibreWallet/\(AppVersion.shortVersion)", forHTTPHeaderField: "User-Agent")
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")

            let (data, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, http.statusCode == 404 {
                return .upToDate(current: AppVersion.shortVersion)
            }
            guard let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) else {
                return .failed("Nie udało się sprawdzić aktualizacji (HTTP).")
            }

            let release = try JSONDecoder().decode(GitHubRelease.self, from: data)
            let latest = release.tagName
            let current = AppVersion.shortVersion

            guard AppVersion.isVersion(current, olderThan: latest) else {
                return .upToDate(current: current)
            }

            let releaseURL = URL(string: release.htmlURL) ?? LibreWalletDistribution.releasesPageURL
            let zipURL = release.assets
                .first(where: { $0.name == LibreWalletDistribution.zipAssetName })
                .flatMap { URL(string: $0.browserDownloadURL) }
                ?? LibreWalletDistribution.latestZipURL

            return .updateAvailable(latest: stripV(latest), releaseURL: releaseURL, downloadURL: zipURL)
        } catch {
            return .failed(error.localizedDescription)
        }
    }

    private static func stripV(_ tag: String) -> String {
        if tag.hasPrefix("v") || tag.hasPrefix("V") {
            return String(tag.dropFirst())
        }
        return tag
    }
}

private struct GitHubRelease: Decodable {
    let tagName: String
    let htmlURL: String
    let assets: [GitHubAsset]

    enum CodingKeys: String, CodingKey {
        case tagName = "tag_name"
        case htmlURL = "html_url"
        case assets
    }
}

private struct GitHubAsset: Decodable {
    let name: String
    let browserDownloadURL: String

    enum CodingKeys: String, CodingKey {
        case name
        case browserDownloadURL = "browser_download_url"
    }
}
