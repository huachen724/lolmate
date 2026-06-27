import "./VerifiedBadge.css";

// Shown next to a reviewer's name when they posted through Riot Sign On
// (RSO), instead of just typing an unverified display name. We trust this
// because the puuid on the review came from an OAuth-backed session, not
// user input — see src/lib/session.ts for the (mocked) sign-in flow.
export function VerifiedBadge({ size = "sm" }: { size?: "sm" | "md" }) {
  return (
    <span className={`verified-badge verified-badge-${size}`} title="Verified Riot Games account">
      <svg viewBox="0 0 16 16" width="100%" height="100%" aria-hidden="true">
        <path
          fill="currentColor"
          d="M8 0l1.7 1.6 2.3-.5.7 2.3 2.3.7-.5 2.3L16 8l-1.6 1.7.5 2.3-2.3.7-.7 2.3-2.3-.5L8 16l-1.7-1.6-2.3.5-.7-2.3-2.3-.7.5-2.3L0 8l1.6-1.7-.5-2.3 2.3-.7.7-2.3 2.3.5z"
        />
        <path
          fill="#06251f"
          d="M6.9 11.2 4.3 8.6l1-1 1.6 1.6 4-4 1 1z"
        />
      </svg>
      <span className="visually-hidden">Verified</span>
    </span>
  );
}
