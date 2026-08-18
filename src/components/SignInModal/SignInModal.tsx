import { useEffect, useState } from "react";
import { API_BASE, fetchStatus } from "../../lib/api";
import "./SignInModal.css";

interface SignInModalProps {
  onClose: () => void;
}

// Real login — Discord or Google OAuth (see server.js's /api/auth/*
// routes and auth.js). Clicking a provider button is a full page
// navigation, not a fetch (OAuth redirects can't happen through XHR/fetch)
// — the provider's callback sets the session cookie server-side and sends
// the browser straight to /dashboard, where useSession() picks up the new
// session on that fresh page load. So there's no onSignedIn callback here;
// this modal just starts the redirect and the current page goes away.
export function SignInModal({ onClose }: SignInModalProps) {
  const [providers, setProviders] = useState<{ discordAuth: boolean; googleAuth: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchStatus()
      .then((status) => {
        if (!cancelled) setProviders({ discordAuth: status.discordAuth, googleAuth: status.googleAuth });
      })
      .catch(() => {
        if (!cancelled) setProviders({ discordAuth: false, googleAuth: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function signInWith(provider: "discord" | "google") {
    window.location.href = `${API_BASE}/api/auth/${provider}`;
  }

  const nothingConfigured = providers && !providers.discordAuth && !providers.googleAuth;

  return (
    <div className="sign-in-modal-overlay" onClick={onClose}>
      <div className="card sign-in-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Sign in</h2>
        <p className="muted">
          Sign in to see your own recent matches and review teammates from them — and to post
          reviews under a Riot account you've proven you actually own, instead of just typing one.
        </p>

        {nothingConfigured && <p className="sign-in-modal-error">Sign-in isn't configured yet.</p>}

        <div className="sign-in-modal-providers">
          {providers?.discordAuth && (
            <button type="button" className="btn btn-primary sign-in-provider-btn" onClick={() => signInWith("discord")}>
              Continue with Discord
            </button>
          )}
          {providers?.googleAuth && (
            <button type="button" className="btn btn-primary sign-in-provider-btn" onClick={() => signInWith("google")}>
              Continue with Google
            </button>
          )}
        </div>

        <div className="sign-in-modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
