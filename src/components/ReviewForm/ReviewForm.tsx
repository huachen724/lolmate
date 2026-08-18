import { useEffect, useState } from "react";
import { REVIEW_CATEGORIES } from "../../types";
import type { AuthUser, MatchSummary, Review, ReviewCategory, ReviewScores, RiotId } from "../../types";
import { REVIEW_BODY_MAX_LENGTH, REVIEW_ELIGIBILITY_WINDOW_MS } from "../../lib/constants";
import { ApiError, fetchAccount, submitReview } from "../../lib/api";
import { countSharedGames, mostRecentSharedGameTimestamp } from "../../lib/reviewStats";
import { getOrCreateUnverifiedReviewerId } from "../../lib/session";
import { timeAgo } from "../../lib/time";
import { RatingStars } from "../RatingStars/RatingStars";
import { Spinner } from "../Spinner/Spinner";
import "./ReviewForm.css";

const RIOT_ID_LOOKUP_DEBOUNCE_MS = 500;

interface ReviewFormProps {
  target: { puuid: string; riotId: RiotId };
  targetMatches: MatchSummary[];
  // Whether the current viewer has already reviewed this target — computed
  // by the caller from a review list already fetched with `isMine` set
  // (see server.js's rowToReview), rather than re-fetched here.
  alreadyReviewed: boolean;
  // Logged in (Discord/Google) does not by itself mean "post as verified"
  // — only a session with riotPuuid set (icon verification completed) can.
  // A login without that falls back to the same unverified flow as a
  // signed-out visitor (see `verifiedIdentity` below).
  session: AuthUser | null;
  onClose: () => void;
  onSubmit: (review: Review) => void;
}

// Local editing state: 0 means "no stars clicked yet" (RatingStars' unrated
// sentinel), converted to null on submit rather than reusing ReviewScores
// (which allows null directly) since RatingStars deals in plain numbers.
type DraftScores = Record<ReviewCategory, number>;

const emptyScores: DraftScores = {
  mapAwareness: 0,
  mechanicalSkill: 0,
  teamwork: 0,
  communication: 0,
  sportsmanship: 0,
};

export function ReviewForm({ target, targetMatches, alreadyReviewed, session, onClose, onSubmit }: ReviewFormProps) {
  const [scores, setScores] = useState<DraftScores>(emptyScores);
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [submitState, setSubmitState] = useState<{ status: "idle" | "submitting" } | { status: "error"; message: string }>(
    { status: "idle" },
  );

  // Unverified path: someone without a verified Riot account behind their
  // session (not logged in at all, or logged in but hasn't completed the
  // icon challenge yet — see RiotVerifyModal). They still need to prove
  // (informally — there's no server-backed ownership check on this path)
  // that they've actually played with the target, so we ask for a Riot ID
  // and resolve it for real via account-v1 (through our backend) purely to
  // check shared match history. The name shown on the review is the
  // separate, self-chosen displayName below, which is what makes them
  // "unverified" rather than just a second verified flow.
  const [reviewerRiotIdInput, setReviewerRiotIdInput] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [lookupState, setLookupState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "found"; puuid: string }
    | { status: "not-found" }
    | { status: "error"; message: string }
  >({ status: "idle" });

  // Only a session that's completed icon verification (riotPuuid set) can
  // post as verified — logged in without that falls through to the same
  // unverified flow a signed-out visitor uses.
  const verifiedIdentity =
    session?.riotPuuid && session.riotGameName && session.riotTagLine
      ? { puuid: session.riotPuuid, riotId: { gameName: session.riotGameName, tagLine: session.riotTagLine } }
      : null;

  useEffect(() => {
    if (verifiedIdentity) return;
    const trimmed = reviewerRiotIdInput.trim();
    if (!trimmed.includes("#")) {
      setLookupState({ status: "idle" });
      return;
    }
    const [gameName, tagLine] = trimmed.split("#");
    if (!gameName || !tagLine) {
      setLookupState({ status: "idle" });
      return;
    }

    setLookupState({ status: "loading" });
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const account = await fetchAccount(gameName, tagLine);
        if (!cancelled) setLookupState({ status: "found", puuid: account.puuid });
      } catch (error) {
        if (cancelled) return;
        // Only a real 404 means "no such Riot ID" — a rate limit or other
        // failure is a different problem and shouldn't be reported as if
        // the Riot ID doesn't exist.
        if (error instanceof ApiError && error.status === 404) {
          setLookupState({ status: "not-found" });
        } else {
          setLookupState({
            status: "error",
            message: error instanceof Error ? error.message : "Lookup failed.",
          });
        }
      }
    }, RIOT_ID_LOOKUP_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // verifiedIdentity is a fresh object every render (derived from
    // session), so it's deliberately not in this dependency list — that
    // would re-run the effect on every render. session?.riotPuuid is the
    // primitive that actually determines whether verifiedIdentity is set.
  }, [session?.riotPuuid, reviewerRiotIdInput]);

  const reviewerPuuid = verifiedIdentity ? verifiedIdentity.puuid : lookupState.status === "found" ? lookupState.puuid : null;
  const sharedGames = reviewerPuuid ? countSharedGames(targetMatches, target.puuid, reviewerPuuid) : 0;
  const lastSharedGameAt = reviewerPuuid
    ? mostRecentSharedGameTimestamp(targetMatches, target.puuid, reviewerPuuid)
    : null;

  const isEligible = lastSharedGameAt !== null && Date.now() - lastSharedGameAt <= REVIEW_ELIGIBILITY_WINDOW_MS;
  const canSubmit =
    !alreadyReviewed &&
    isEligible &&
    body.trim().length > 0 &&
    submitState.status !== "submitting" &&
    (verifiedIdentity ? true : displayName.trim().length >= 2 && reviewerPuuid !== null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitState({ status: "submitting" });
    try {
      // Unrated categories are 0 in local UI state (RatingStars' "no stars
      // clicked" sentinel) — send those as null rather than a fake 0/5.
      const submittedScores: ReviewScores = REVIEW_CATEGORIES.reduce((acc, c) => {
        acc[c.key] = scores[c.key] > 0 ? scores[c.key] : null;
        return acc;
      }, {} as ReviewScores);

      // reviewerKey/gameName/tagLine for the verified path are derived
      // server-side from the session cookie (see server.js's POST
      // /api/reviews) — never trusted from here — so only the unverified
      // path needs to send its own identity.
      const review = await submitReview({
        id: `rev-${crypto.randomUUID()}`,
        targetPuuid: target.puuid,
        reviewerKind: verifiedIdentity ? "verified" : "unverified",
        reviewerKey: verifiedIdentity ? undefined : getOrCreateUnverifiedReviewerId(),
        reviewerAnonymous: verifiedIdentity ? anonymous : undefined,
        reviewerDisplayName: verifiedIdentity ? undefined : displayName.trim(),
        scores: submittedScores,
        body: body.trim(),
        sharedGamesWithTarget: sharedGames,
      });
      onSubmit(review);
    } catch (error) {
      setSubmitState({
        status: "error",
        message:
          error instanceof ApiError && error.status === 409
            ? "You've already reviewed this player."
            : error instanceof Error
              ? error.message
              : "Something went wrong submitting your review.",
      });
    }
  }

  return (
    <div className="review-form-overlay" onClick={onClose}>
      <div className="review-form card" onClick={(e) => e.stopPropagation()}>
        <header className="review-form-header">
          <h2>
            Review {target.riotId.gameName}
            <span className="faint">#{target.riotId.tagLine}</span>
          </h2>
          <button className="btn btn-ghost review-form-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {alreadyReviewed ? (
          <p className="review-form-blocked">
            You've already reviewed this player from this browser. Multiple reviews of the same
            player from one reviewer aren't allowed.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="review-form-body">
            {verifiedIdentity ? (
              <div className="review-form-identity">
                <span className="tag">
                  Posting as {verifiedIdentity.riotId.gameName}#{verifiedIdentity.riotId.tagLine}
                </span>
                <label className="review-form-checkbox">
                  <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
                  Post anonymously
                </label>
              </div>
            ) : (
              <div className="review-form-identity review-form-identity-unverified">
                <label className="review-form-field">
                  Your Riot ID (verifies you've played together — not shown publicly)
                  <input
                    value={reviewerRiotIdInput}
                    onChange={(e) => setReviewerRiotIdInput(e.target.value)}
                    placeholder="YourName#TAG"
                  />
                  {lookupState.status === "loading" && (
                    <span className="faint review-form-lookup-status">
                      <Spinner size={12} /> Looking up…
                    </span>
                  )}
                  {lookupState.status === "not-found" && (
                    <span className="review-form-lookup-status review-form-lookup-error">Riot ID not found</span>
                  )}
                  {lookupState.status === "error" && (
                    <span className="review-form-lookup-status review-form-lookup-error">{lookupState.message}</span>
                  )}
                </label>
                <label className="review-form-field">
                  Display name (shown on your review)
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. TopLaner22"
                    maxLength={24}
                  />
                </label>
                <p className="faint review-form-hint">
                  We'll remember this browser so you can't submit more than one review for the
                  same player.
                  {session
                    ? " Verify your Riot account to post as a verified account instead."
                    : " Sign in and verify your Riot account to post as a verified account instead."}
                </p>
              </div>
            )}

            <div className="review-form-eligibility" data-eligible={isEligible}>
              {isEligible
                ? `✓ Played with ${target.riotId.gameName} ${timeAgo(lastSharedGameAt as number)} — eligible to review.`
                : lastSharedGameAt !== null
                  ? `You played with ${target.riotId.gameName} ${timeAgo(lastSharedGameAt)}, which is outside the 1-week review window.`
                  : `You need to have played with ${target.riotId.gameName} in the past week to review them (none found in their last ${targetMatches.length} matches).`}
            </div>

            <div className="review-form-scores">
              <p className="faint review-form-scores-hint">
                Optional — rate any categories you want, or leave them all blank and just write a comment.
              </p>
              {REVIEW_CATEGORIES.map((category) => (
                <div className="review-form-score-row" key={category.key}>
                  <div>
                    <div className="review-form-score-label">{category.label}</div>
                    <div className="faint review-form-score-hint">{category.hint}</div>
                  </div>
                  <RatingStars
                    value={scores[category.key]}
                    onChange={(v) => setScores((s) => ({ ...s, [category.key]: v === s[category.key] ? 0 : v }))}
                    label={category.label}
                  />
                </div>
              ))}
            </div>

            <label className="review-form-field">
              Your review
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, REVIEW_BODY_MAX_LENGTH))}
                placeholder="What was it like playing with this person?"
                rows={4}
              />
              <span className="faint review-form-counter">
                {REVIEW_BODY_MAX_LENGTH - body.length} characters remaining
              </span>
            </label>

            {submitState.status === "error" && <p className="review-form-submit-error">{submitState.message}</p>}

            <div className="review-form-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
                {submitState.status === "submitting" ? (
                  <>
                    <Spinner size={14} /> Submitting…
                  </>
                ) : (
                  "Submit review"
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
