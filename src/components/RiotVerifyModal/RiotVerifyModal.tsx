import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, checkIconVerification, startIconVerification } from "../../lib/api";
import type { VerificationChallenge } from "../../lib/api";
import { profileIconUrl, useDdragonVersion } from "../../lib/ddragon";
import { notifySessionChanged } from "../../lib/session";
import { Spinner } from "../Spinner/Spinner";
import "../SignInModal/SignInModal.css";
import "./RiotVerifyModal.css";

interface RiotVerifyModalProps {
  onClose: () => void;
  onVerified: () => void;
}

// How often we re-check in the background once a challenge is active.
// Riot's summoner-v4 (where the check reads profileIconId from) can lag
// well behind an in-client icon change, so this polls quietly instead of
// making the user manually re-click Verify over and over.
const POLL_INTERVAL_MS = 15 * 1000;

type State =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "polling"; challenge: VerificationChallenge; lastCheckedAt: number | null }
  | { status: "expired" }
  | { status: "error"; message: string };

// The profile-icon ownership challenge: since Riot retired the old
// in-client verification-code endpoint, this is the standard replacement
// most third-party sites use — prove you control the account by briefly
// switching its summoner icon to one we pick (see server.js's
// /api/verify/start and /api/verify/check), which only the real owner can
// do. Shown once a Discord/Google login exists but hasn't linked a Riot
// account yet (see Navbar / DashboardPage).
export function RiotVerifyModal({ onClose, onVerified }: RiotVerifyModalProps) {
  const ddragonVersion = useDdragonVersion();
  const [riotIdInput, setRiotIdInput] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const [manualChecking, setManualChecking] = useState(false);

  // onVerified is typically a fresh arrow function from the parent on every
  // render — keeping it out of the polling effect's dependencies (via this
  // ref) avoids tearing down and restarting the interval on unrelated
  // parent re-renders.
  const onVerifiedRef = useRef(onVerified);
  useEffect(() => {
    onVerifiedRef.current = onVerified;
  }, [onVerified]);

  useEffect(() => {
    if (state.status !== "polling") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.status]);

  useEffect(() => {
    if (state.status === "polling" && now >= state.challenge.expiresAt) {
      setState({ status: "expired" });
    }
  }, [now, state]);

  // Stable across renders (empty deps + refs/functional setState only), so
  // it's safe for the polling effect below to depend on without that
  // effect needing to restart every render.
  const checkOnce = useCallback(async () => {
    try {
      const result = await checkIconVerification();
      if (result.verified) {
        notifySessionChanged();
        onVerifiedRef.current();
        return;
      }
      setState((s) => (s.status === "polling" ? { ...s, lastCheckedAt: Date.now() } : s));
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Verification check failed.",
      });
    }
  }, []);

  useEffect(() => {
    if (state.status !== "polling") return;
    const id = setInterval(() => void checkOnce(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
    // Keyed on expiresAt (unique per generated challenge) rather than the
    // whole challenge object, which would otherwise change identity (and
    // restart this interval) every time lastCheckedAt updates.
  }, [state.status === "polling" ? state.challenge.expiresAt : null, checkOnce]);

  async function handleStart(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = riotIdInput.trim();
    if (!trimmed.includes("#")) {
      setState({ status: "error", message: "Enter your Riot ID as gameName#tagLine." });
      return;
    }
    const [gameName, tagLine] = trimmed.split("#");
    if (!gameName || !tagLine) {
      setState({ status: "error", message: "Enter your Riot ID as gameName#tagLine." });
      return;
    }

    setState({ status: "starting" });
    try {
      const challenge = await startIconVerification(gameName, tagLine);
      setState({ status: "polling", challenge, lastCheckedAt: null });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof ApiError && error.status === 404
            ? "Couldn't find that Riot ID. Double check the spelling and tag."
            : error instanceof Error
              ? error.message
              : "Something went wrong.",
      });
    }
  }

  async function handleCheckNow() {
    if (manualChecking) return;
    setManualChecking(true);
    await checkOnce();
    setManualChecking(false);
  }

  return (
    <div className="sign-in-modal-overlay" onClick={onClose}>
      <div className="card sign-in-modal riot-verify-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Verify your Riot account</h2>
        <p className="muted">
          Riot retired the old in-client verification code, so this proves you own the account the
          way most third-party sites do now: briefly switch your summoner icon to one we pick.
        </p>

        {(state.status === "idle" || state.status === "starting" || state.status === "error") && (
          <form onSubmit={handleStart} className="sign-in-modal-form">
            <input value={riotIdInput} onChange={(e) => setRiotIdInput(e.target.value)} placeholder="yourName#tag" autoFocus />
            {state.status === "error" && <p className="sign-in-modal-error">{state.message}</p>}
            <div className="sign-in-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={state.status === "starting"}>
                {state.status === "starting" ? (
                  <>
                    <Spinner size={14} /> Starting…
                  </>
                ) : (
                  "Continue"
                )}
              </button>
            </div>
          </form>
        )}

        {state.status === "polling" && (
          <div className="riot-verify-challenge">
            <img
              className="riot-verify-icon"
              alt={`Challenge icon ${state.challenge.challengeIconId}`}
              src={profileIconUrl(state.challenge.challengeIconId, ddragonVersion)}
            />
            <p>In the League client, set your summoner icon to the one shown above.</p>
            <p className="faint">
              We're checking automatically every 15 seconds — you don't need to click anything.
              <br />
              Once you've set it, please don't change it again until this finishes.
            </p>
            <div className="riot-verify-status">
              <Spinner size={12} />
              {state.lastCheckedAt
                ? `Waiting for Riot to catch up — last checked ${Math.max(0, Math.round((now - state.lastCheckedAt) / 1000))}s ago.`
                : "Waiting for your icon change…"}
            </div>
            <p className="faint">Expires in {Math.max(0, Math.ceil((state.challenge.expiresAt - now) / 1000))}s</p>
            <div className="sign-in-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={handleCheckNow} disabled={manualChecking}>
                {manualChecking ? (
                  <>
                    <Spinner size={14} /> Checking…
                  </>
                ) : (
                  "Check now"
                )}
              </button>
            </div>
          </div>
        )}

        {state.status === "expired" && (
          <div className="riot-verify-challenge">
            <p className="sign-in-modal-error">That challenge expired.</p>
            <div className="sign-in-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setState({ status: "idle" })}>
                Try again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
