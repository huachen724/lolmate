import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSession } from "../../hooks/useSession";
import { signOut } from "../../lib/session";
import { SearchBar } from "../SearchBar/SearchBar";
import { SignInModal } from "../SignInModal/SignInModal";
import "./Navbar.css";

export function Navbar() {
  const session = useSession();
  const navigate = useNavigate();
  const [showSignIn, setShowSignIn] = useState(false);

  function handleSignOut() {
    signOut();
    navigate("/");
  }

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <Link to="/" className="navbar-logo">
          <span className="navbar-logo-mark">LM</span>
          LolMate
        </Link>

        <SearchBar variant="compact" />

        <nav className="navbar-links">
          {session && (
            <Link
              to={`/live/${encodeURIComponent(session.riotId.gameName)}/${encodeURIComponent(session.riotId.tagLine)}`}
              className="navbar-link"
            >
              My live game
            </Link>
          )}

          {session ? (
            <div className="navbar-account">
              <Link to="/dashboard" className="navbar-account-name">
                <img
                  className="navbar-avatar"
                  alt=""
                  src={`https://placehold.co/32x32/161a2c/5ce1c6?text=${session.riotId.gameName[0]}`}
                />
                {session.riotId.gameName}
                <span className="faint">#{session.riotId.tagLine}</span>
              </Link>
              <button className="btn btn-ghost" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          ) : (
            <button className="btn btn-primary" onClick={() => setShowSignIn(true)}>
              Sign in with Riot Games
            </button>
          )}
        </nav>
      </div>

      {showSignIn && (
        <SignInModal
          onClose={() => setShowSignIn(false)}
          onSignedIn={() => {
            setShowSignIn(false);
            navigate("/dashboard");
          }}
        />
      )}
    </header>
  );
}
