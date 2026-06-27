import { useState } from "react";
import "./DemoModeBanner.css";

// Honest framing for anyone clicking around: player stats, match history,
// live game, and reviews are all real now (server.js -> Riot API for the
// first three, server.js -> Postgres for reviews, see db.js). The one
// thing still mocked is "sign in" — there's no approved RSO client yet
// (see components/SignInModal), so it just resolves whatever Riot ID you
// type via the real account-v1 endpoint instead of real OAuth.
export function DemoModeBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="demo-banner">
      <span>
        <strong>Player stats and reviews are live</strong> — Riot API for stats, our own database
        for reviews. <strong>Sign-in</strong> is still a stand-in: no approved Riot Sign On yet, so
        it resolves whatever Riot ID you type instead of real OAuth.
      </span>
      <button className="demo-banner-close" onClick={() => setDismissed(true)} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
