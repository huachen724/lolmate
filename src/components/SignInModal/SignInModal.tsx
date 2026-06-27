import { useState } from "react";
import { ApiError, fetchAccount } from "../../lib/api";
import { mockSignIn } from "../../lib/session";
import { Spinner } from "../Spinner/Spinner";
import "./SignInModal.css";

interface SignInModalProps {
  onClose: () => void;
  onSignedIn: () => void;
}

// Stand-in for Riot Sign On (RSO). Real RSO redirects to
// https://auth.riotgames.com/authorize and never has the user type a Riot
// ID — but RSO is a separate Riot approval beyond just an API key (see
// server.js's getAccountByRiotId comment), so until that's approved this
// resolves whatever Riot ID you type via the real account-v1 endpoint and
// treats that as "you".
export function SignInModal({ onClose, onSignedIn }: SignInModalProps) {
  const [riotIdInput, setRiotIdInput] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = riotIdInput.trim();
    if (!trimmed.includes("#")) {
      setStatus("error");
      setError("Enter your Riot ID as gameName#tagLine.");
      return;
    }
    const [gameName, tagLine] = trimmed.split("#");

    setStatus("loading");
    try {
      const account = await fetchAccount(gameName, tagLine);
      mockSignIn(account);
      onSignedIn();
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof ApiError && err.status === 404
          ? "Couldn't find that Riot ID. Double check the spelling and tag."
          : err instanceof Error
            ? err.message
            : "Something went wrong.",
      );
    }
  }

  return (
    <div className="sign-in-modal-overlay" onClick={onClose}>
      <div className="card sign-in-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Sign in with Riot Games</h2>
        <p className="muted">
          Real "Sign in with Riot Games" uses Riot Sign On (RSO), which needs a separate approval
          from Riot beyond just an API key. Until that's approved, type your Riot ID and we'll
          look it up for real to use as your session.
        </p>
        <form onSubmit={handleSubmit} className="sign-in-modal-form">
          <input
            value={riotIdInput}
            onChange={(e) => setRiotIdInput(e.target.value)}
            placeholder="yourName#tag"
            autoFocus
          />
          {status === "error" && <p className="sign-in-modal-error">{error}</p>}
          <div className="sign-in-modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={status === "loading"}>
              {status === "loading" ? (
                <>
                  <Spinner size={14} /> Looking up…
                </>
              ) : (
                "Continue"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
