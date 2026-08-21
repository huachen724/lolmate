import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSession } from "../../hooks/useSession";
import { signOut } from "../../lib/session";
import { SearchBar } from "../SearchBar/SearchBar";
import { SignInModal } from "../SignInModal/SignInModal";
import { RiotVerifyModal } from "../RiotVerifyModal/RiotVerifyModal";
import { ReconcileReviewsModal } from "../ReconcileReviewsModal/ReconcileReviewsModal";
import { ThemeToggle } from "../ThemeToggle/ThemeToggle";
import logo from "../../assets/logo.png";
import "./Navbar.css";

export function Navbar() {
  const session = useSession();
  const navigate = useNavigate();
  const [showSignIn, setShowSignIn] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const [showReconcile, setShowReconcile] = useState(false);

  async function handleSignOut() {
    await signOut();
    navigate("/");
  }

  const needsRiotVerification = session != null && !session.riotPuuid;

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <Link to="/" className="navbar-logo">
          <img className="navbar-logo-mark" src={logo} alt="" />
          LolMate
        </Link>

        <SearchBar variant="compact" />

        <nav className="navbar-links">
          <ThemeToggle />

          {session?.riotGameName && session.riotTagLine && (
            <Link
              to={`/live/${encodeURIComponent(session.riotGameName)}/${encodeURIComponent(session.riotTagLine)}`}
              className="navbar-link"
            >
              My live game
            </Link>
          )}

          {session === undefined ? null : session === null ? (
            <button className="btn btn-primary" onClick={() => setShowSignIn(true)}>
              Sign in
            </button>
          ) : needsRiotVerification ? (
            <div className="navbar-account">
              <span className="faint">{session.displayName}</span>
              <button className="btn btn-primary" onClick={() => setShowVerify(true)}>
                Verify Riot account
              </button>
              <button className="btn btn-ghost" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          ) : (
            <div className="navbar-account">
              <Link to="/dashboard" className="navbar-account-name">
                {session.avatarUrl && <img className="navbar-avatar" alt="" src={session.avatarUrl} />}
                {session.riotGameName}
                <span className="faint">#{session.riotTagLine}</span>
              </Link>
              <button className="btn btn-ghost" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          )}
        </nav>
      </div>

      {showSignIn && <SignInModal onClose={() => setShowSignIn(false)} />}

      {showVerify && (
        <RiotVerifyModal
          onClose={() => setShowVerify(false)}
          onVerified={() => {
            setShowVerify(false);
            setShowReconcile(true);
          }}
        />
      )}

      {showReconcile && (
        <ReconcileReviewsModal
          onClose={() => {
            setShowReconcile(false);
            navigate("/dashboard");
          }}
        />
      )}
    </header>
  );
}
