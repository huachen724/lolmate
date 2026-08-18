import { useEffect, useState } from "react";
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

type State =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "challenge"; challenge: VerificationChallenge }
  | { status: "checking"; challenge: VerificationChallenge }
  | { status: "mismatch"; challenge: VerificationChallenge }
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

  useEffect(() => {
    if (state.status !== "challenge" && state.status !== "mismatch") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.status]);

  useEffect(() => {
    if ((state.status === "challenge" || state.status === "mismatch") && now >= state.challenge.expiresAt) {
      setState({ status: "expired" });
    }
  }, [now, state]);

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
      setState({ status: "challenge", challenge });
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

  async function handleCheck() {
    if (state.status !== "challenge" && state.status !== "mismatch") return;
    const { challenge } = state;
    setState({ status: "checking", challenge });
    try {
      const result = await checkIconVerification();
      if (result.verified) {
        notifySessionChanged();
        onVerified();
      } else {
        setState({ status: "mismatch", challenge });
      }
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Verification check failed.",
      });
    }
  }

  return (
    <div className="sign-in-modal-overlay" onClick={onClose}>
      <div className="card sign-in-modal riot-verify-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Verify your Riot account</h2>
        <p className="muted">
          Riot retired the old in-client verification code, so this proves you own the account the
          way most third-party sites do now: briefly switch your summoner icon to one we pick, then
          switch it back once you're done.
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

        {(state.status === "challenge" || state.status === "checking" || state.status === "mismatch") && (
          <div className="riot-verify-challenge">
            <img
              className="riot-verify-icon"
              alt={`Challenge icon ${state.challenge.challengeIconId}`}
              src={profileIconUrl(state.challenge.challengeIconId, ddragonVersion)}
            />
            <p>
              In the League client, set your summoner icon to the one shown above, then come back and
              click Verify.
            </p>
            <p className="faint">Expires in {Math.max(0, Math.ceil((state.challenge.expiresAt - now) / 1000))}s</p>
            {state.status === "mismatch" && (
              <p className="sign-in-modal-error">
                That doesn't match yet — make sure the icon change saved in-client, then try again.
              </p>
            )}
            <div className="sign-in-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={handleCheck} disabled={state.status === "checking"}>
                {state.status === "checking" ? (
                  <>
                    <Spinner size={14} /> Checking…
                  </>
                ) : (
                  "Verify"
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
