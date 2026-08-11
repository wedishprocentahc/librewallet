import SwiftUI

struct AppFeedback: Equatable, Identifiable {
    enum Kind: Equatable {
        case success
        case error
    }

    let id = UUID()
    let kind: Kind
    let message: String
}

struct FeedbackBannerView: View {
    let feedback: AppFeedback
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: feedback.kind == .success ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(feedback.kind == .success ? Color.green : Color.orange)
            Text(feedback.message)
                .font(.callout)
                .foregroundStyle(.primary)
                .lineLimit(3)
            Spacer(minLength: 8)
            Button {
                onDismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .help(L10n.t("common.cancel"))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(feedback.kind == .success ? Color.green.opacity(0.35) : Color.orange.opacity(0.45), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
        .frame(maxWidth: 520)
        .padding(.horizontal, 16)
        .accessibilityAddTraits(.isStaticText)
    }
}
