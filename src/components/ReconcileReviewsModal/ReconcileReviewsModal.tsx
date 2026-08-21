import { useEffect, useState } from "react";
import { fetchUnverifiedReviewMatches, reconcileReviews } from "../../lib/api";
import type { UnverifiedReviewCandidate } from "../../types";
import { timeAgo } from "../../lib/time";
import { Spinner } from "../Spinner/Spinner";
import "../SignInModal/SignInModal.css";
import "./ReconcileReviewsModal.css";

interface ReconcileReviewsModalProps {
  onClose: () => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "ready"; candidates: UnverifiedReviewCandidate[] }
  | { status: "load-error"; message: string };

type SubmitState = { status: "idle" } | { status: "submitting" } | { status: "error"; message: string };

// Shown right after completing Riot verification: every unverified review
// that claimed to be this exact (now-verified) puuid, across every target
// — some may genuinely be the user's own past reviews (written before they
// verified), others may be someone else typing their Riot ID to pass the
// eligibility check. Checkboxes default unchecked (opt in, not opt out) —
// confirming converts the selected ones to verified in place; anything
// left unchecked is treated as "not mine" and soft-deleted. "Skip for now"
// closes without deciding anything, so dismissing isn't itself destructive.
export function ReconcileReviewsModal({ onClose }: ReconcileReviewsModalProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ confirmed: number; rejected: number; skipped: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchUnverifiedReviewMatches()
      .then((candidates) => {
        if (cancelled) return;
        setLoadState(candidates.length === 0 ? { status: "empty" } : { status: "ready", candidates });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadState({ status: "load-error", message: error instanceof Error ? error.message : "Couldn't load reviews." });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleConfirm() {
    if (loadState.status !== "ready") return;
    setSubmitState({ status: "submitting" });
    try {
      const outcome = await reconcileReviews([...selected]);
      setResult(outcome);
    } catch (error) {
      setSubmitState({
        status: "error",
        message: error instanceof Error ? error.message : "Something went wrong reconciling your reviews.",
      });
      return;
    }
    setSubmitState({ status: "idle" });
  }

  if (result) {
    return (
      <div className="sign-in-modal-overlay" onClick={onClose}>
        <div className="card sign-in-modal reconcile-modal" onClick={(e) => e.stopPropagation()}>
          <h2>Reviews claiming to be you</h2>
          <p className="muted">
            {result.confirmed > 0 && `${result.confirmed} review${result.confirmed === 1 ? "" : "s"} now verified. `}
            {result.rejected > 0 && `${result.rejected} removed. `}
            {result.skipped > 0 &&
              `${result.skipped} skipped — you already have a verified review of that player from elsewhere.`}
          </p>
          <div className="sign-in-modal-actions">
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sign-in-modal-overlay" onClick={onClose}>
      <div className="card sign-in-modal reconcile-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Reviews claiming to be you</h2>

        {loadState.status === "loading" && (
          <p className="muted">
            <Spinner size={14} /> Checking for unverified reviews under your Riot ID…
          </p>
        )}

        {loadState.status === "load-error" && (
          <>
            <p className="sign-in-modal-error">{loadState.message}</p>
            <div className="sign-in-modal-actions">
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}

        {loadState.status === "empty" && (
          <>
            <p className="muted">No unverified reviews were found claiming your Riot ID. Nothing to do here.</p>
            <div className="sign-in-modal-actions">
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}

        {loadState.status === "ready" && (
          <>
            <p className="muted">
              These unverified reviews were posted claiming your exact Riot ID — some may genuinely be
              yours from before you verified, others may be someone else. Check the ones that are
              actually yours; everything else will be removed.
            </p>

            <button
              type="button"
              className="reconcile-select-all"
              onClick={() =>
                setSelected((prev) =>
                  prev.size === loadState.candidates.length ? new Set() : new Set(loadState.candidates.map((c) => c.id)),
                )
              }
              disabled={submitState.status === "submitting"}
            >
              {selected.size === loadState.candidates.length ? "Deselect all" : "Select all"}
            </button>

            <div className="reconcile-list">
              {loadState.candidates.map((candidate) => (
                <label className="reconcile-item" key={candidate.id}>
                  <input
                    type="checkbox"
                    checked={selected.has(candidate.id)}
                    onChange={() => toggle(candidate.id)}
                    disabled={submitState.status === "submitting"}
                  />
                  <div className="reconcile-item-body">
                    <div className="reconcile-item-header">
                      <strong>
                        {candidate.targetRiotId
                          ? `${candidate.targetRiotId.gameName}#${candidate.targetRiotId.tagLine}`
                          : "Unknown player"}
                      </strong>
                      <span className="faint">
                        posted as "{candidate.displayName}" · {timeAgo(candidate.createdAt)}
                      </span>
                    </div>
                    <p className="reconcile-item-text">{candidate.body}</p>
                    <span className="tag">{candidate.sharedGamesWithTarget} games together</span>
                  </div>
                </label>
              ))}
            </div>

            {submitState.status === "error" && <p className="sign-in-modal-error">{submitState.message}</p>}

            <div className="sign-in-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitState.status === "submitting"}>
                Skip for now
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirm}
                disabled={submitState.status === "submitting"}
              >
                {submitState.status === "submitting" ? (
                  <>
                    <Spinner size={14} /> Saving…
                  </>
                ) : (
                  `Confirm selected (${selected.size})`
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
