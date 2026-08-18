import { useState } from "react";
import "./DemoModeBanner.css";

// Honest framing for anyone clicking around: everything here is real —
// player stats, match history, and live game come from the Riot API
// (server.js), reviews are our own Postgres data (db.js), and sign-in is
// real Discord/Google OAuth (auth.js) paired with a profile-icon ownership
// challenge (components/RiotVerifyModal) rather than Riot Sign On, which
// needs a separate Riot approval beyond a personal API key.
export function DemoModeBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="demo-banner">
      <span>
        <strong>Everything here is live</strong> — Riot API for stats, our own database for
        reviews. <strong>Sign-in</strong> uses Discord/Google (real Riot Sign On needs a separate
        Riot approval), plus a profile-icon challenge to prove you actually own the Riot account
        you post reviews under.
      </span>
      <button className="demo-banner-close" onClick={() => setDismissed(true)} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
