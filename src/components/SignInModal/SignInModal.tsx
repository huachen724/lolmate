import { useEffect, useState } from "react";
import { API_BASE, fetchStatus } from "../../lib/api";
import "./SignInModal.css";

interface SignInModalProps {
  onClose: () => void;
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="#5865F2"
        d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
      />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.583-5.036-3.71H.957v2.332A8.997 8.997 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A9 9 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
  );
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
              <DiscordIcon />
              Continue with Discord
            </button>
          )}
          {providers?.googleAuth && (
            <button type="button" className="btn btn-primary sign-in-provider-btn" onClick={() => signInWith("google")}>
              <GoogleIcon />
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
