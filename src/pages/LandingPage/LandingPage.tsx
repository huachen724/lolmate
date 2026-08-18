import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "../../hooks/useSession";
import { SearchBar } from "../../components/SearchBar/SearchBar";
import { SignInModal } from "../../components/SignInModal/SignInModal";
import { getRecentSearches } from "../../lib/session";
import "./LandingPage.css";

// Entry point for a visitor with no session/cookie: just a search box.
// Recently searched players (if any — see lib/session.ts) surface as soon
// as they click into the search bar, so the app still feels "revisitable"
// even before they ever sign in.
export function LandingPage() {
  const session = useSession();
  const [showSignIn, setShowSignIn] = useState(false);
  const hasRecent = getRecentSearches().length > 0;

  // Signed-in visitors don't need the marketing/search landing page — they
  // go straight to their dashboard (recent match + teammates to review).
  if (session) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="landing">
      <section className="landing-hero">
        <h1>Know who you're playing with.</h1>
        <p className="muted">
          Look up stats for any League player — then see what real teammates and opponents had to
          say about playing with them.
        </p>
        <SearchBar variant="hero" placeholder="Search Riot ID, e.g. yourName#tag" />
        {hasRecent && <p className="faint landing-hint">Click the search bar to see players you've looked up before.</p>}

        <div className="landing-divider">
          <span>or</span>
        </div>

        <button className="btn btn-primary landing-signin" onClick={() => setShowSignIn(true)}>
          Sign in
        </button>
        <p className="faint">
          Signing in with Discord or Google lets you review teammates from your own match history
          — once you've verified you actually own the Riot account you're posting under.
        </p>
      </section>

      <section className="landing-features">
        <div className="card landing-feature">
          <h3>Look anyone up</h3>
          <p className="muted">
            Search any Riot ID to see rank, win rate, top champions, and match history.
          </p>
          {/* account-v1 by-riot-id -> summoner-v4 by-puuid -> league-v4 entries,
              match-v5 ids + match details (used to derive top champions too).
              See server.js's /api/profile route for the exact endpoints. */}
        </div>
        <div className="card landing-feature">
          <h3>Real teammate reviews</h3>
          <p className="muted">
            See map awareness, mechanics, teamwork, comms, and sportsmanship ratings left by
            people who've actually played with them.
          </p>
        </div>
        <div className="card landing-feature">
          <h3>Live game breakdown</h3>
          <p className="muted">
            While you're in champ select or loading screen, see everyone's stats — and reviews —
            before the game even starts.
          </p>
          {/* spectator-v5 active-games/by-summoner. See server.js's /api/live
              route and LiveMatchPage. */}
        </div>
      </section>

      {showSignIn && <SignInModal onClose={() => setShowSignIn(false)} />}
    </div>
  );
}
