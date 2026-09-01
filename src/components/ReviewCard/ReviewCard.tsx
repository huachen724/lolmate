import { useState } from "react";
import { Link } from "react-router-dom";
import { REVIEW_CATEGORIES } from "../../types";
import type { Review, ReviewHistoryEntry, RiotId, VoteValue } from "../../types";
import { useSession } from "../../hooks/useSession";
import { getOrCreateUnverifiedReviewerId } from "../../lib/session";
import { deleteReview, fetchReviewHistory, voteOnReview } from "../../lib/api";
import { timeAgo } from "../../lib/time";
import { VerifiedBadge } from "../VerifiedBadge/VerifiedBadge";
import "./ReviewCard.css";

function reviewerLabel(review: Review): { name: string; verified: boolean } {
  if (review.reviewer.kind === "verified") {
    return {
      name: review.reviewer.anonymous ? "Anonymous (verified)" : review.reviewer.riotId.gameName,
      verified: true,
    };
  }
  return { name: review.reviewer.displayName, verified: false };
}

function historyEntryLabel(entry: ReviewHistoryEntry): string {
  return entry.reviewer.kind === "verified" ? entry.reviewer.riotId.gameName : entry.reviewer.displayName;
}

// Reviews written before per-mode tracking existed have an empty object —
// undefined here means no `title` attribute at all, not an empty tooltip.
function modeBreakdownTitle(byMode: Record<string, number> | undefined): string | undefined {
  if (!byMode) return undefined;
  const entries = Object.entries(byMode);
  if (entries.length === 0) return undefined;
  return entries.map(([mode, count]) => `${count} ${mode}`).join(", ");
}

interface ReviewCardProps {
  review: Review;
  onDeleted?: (reviewId: string) => void;
  onEdit?: (review: Review) => void;
  // Set on the dashboard's "My reviews" section, where every card is about
  // a different target but always written by the same person (you) —
  // showing the target's name is more useful there than the reviewer's
  // name (which would just say "you" on every card).
  targetRiotId?: RiotId | null;
}

export function ReviewCard({ review, onDeleted, onEdit, targetRiotId }: ReviewCardProps) {
  const session = useSession();
  const [upvotes, setUpvotes] = useState(review.upvotes);
  const [downvotes, setDownvotes] = useState(review.downvotes);
  const [myVote, setMyVote] = useState<VoteValue | null>(review.myVote ?? null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteState, setDeleteState] = useState<"idle" | "deleting" | "error">("idle");
  const [history, setHistory] = useState<
    { status: "hidden" } | { status: "loading" } | { status: "shown"; entries: ReviewHistoryEntry[] } | { status: "error" }
  >({ status: "hidden" });

  const { name, verified } = reviewerLabel(review);
  const ratedCategories = REVIEW_CATEGORIES.filter((c) => review.scores[c.key] != null);

  async function handleDelete() {
    const voterKey = session?.riotPuuid ? session.riotPuuid : getOrCreateUnverifiedReviewerId();
    setDeleteState("deleting");
    try {
      await deleteReview(review.id, voterKey);
      onDeleted?.(review.id);
    } catch {
      setDeleteState("error");
    }
  }

  async function toggleHistory() {
    if (history.status === "shown" || history.status === "loading") {
      setHistory({ status: "hidden" });
      return;
    }
    setHistory({ status: "loading" });
    try {
      const entries = await fetchReviewHistory(review.id);
      setHistory({ status: "shown", entries });
    } catch {
      setHistory({ status: "error" });
    }
  }

  // Thumbs up/down dedup: one vote per (reviewId, voterKey), enforced by a
  // unique constraint in the database (see db.js) — voterKey is the
  // signed-in puuid, or the same per-browser cookie id unverified reviewers
  // use. Optimistic update with rollback if the request fails.
  function vote(next: VoteValue) {
    const resolved = myVote === next ? null : next;
    const voterKey = session?.riotPuuid ? session.riotPuuid : getOrCreateUnverifiedReviewerId();

    const prevUp = upvotes;
    const prevDown = downvotes;
    const prevVote = myVote;

    setUpvotes((v) => v + (resolved === 1 ? 1 : 0) - (myVote === 1 ? 1 : 0));
    setDownvotes((v) => v + (resolved === -1 ? 1 : 0) - (myVote === -1 ? 1 : 0));
    setMyVote(resolved);

    voteOnReview(review.id, voterKey, resolved).catch(() => {
      setUpvotes(prevUp);
      setDownvotes(prevDown);
      setMyVote(prevVote);
    });
  }

  return (
    <article className="review-card card">
      <header className="review-card-header">
        <div className="review-card-reviewer">
          {targetRiotId !== undefined ? (
            targetRiotId ? (
              <Link
                className="review-card-name"
                to={`/profile/${encodeURIComponent(targetRiotId.gameName)}/${encodeURIComponent(targetRiotId.tagLine)}`}
              >
                Review of {targetRiotId.gameName}
                <span className="faint">#{targetRiotId.tagLine}</span>
              </Link>
            ) : (
              <span className="review-card-name faint">Review of an unknown player</span>
            )
          ) : (
            <>
              <span className="review-card-name">{name}</span>
              {verified && <VerifiedBadge />}
            </>
          )}
          <span className="tag" title={modeBreakdownTitle(review.sharedGamesByMode)}>
            {review.sharedGamesWithTarget} games together
          </span>
        </div>
        <span className="faint">
          {timeAgo(review.createdAt)}
          {review.editedAt && (
            <>
              {" · "}
              <button type="button" className="review-card-edited-btn" onClick={toggleHistory}>
                (edited)
              </button>
            </>
          )}
        </span>
      </header>

      {history.status === "shown" && (
        <div className="review-card-history">
          {history.entries.length === 0 ? (
            <p className="faint">No earlier versions found.</p>
          ) : (
            history.entries.map((entry) => (
              <div className="review-card-history-entry" key={entry.id}>
                <div className="faint review-card-history-meta">
                  {historyEntryLabel(entry)} · {timeAgo(entry.archivedAt)}
                </div>
                <p className="review-card-history-body">{entry.body}</p>
              </div>
            ))
          )}
        </div>
      )}
      {history.status === "loading" && <p className="faint">Loading previous versions…</p>}
      {history.status === "error" && <p className="faint">Couldn't load previous versions.</p>}

      {ratedCategories.length > 0 ? (
        <div className="review-card-scores">
          {ratedCategories.map((category) => (
            <div className="review-card-score" key={category.key} title={category.hint}>
              <span className="faint">{category.label}</span>
              <strong>{review.scores[category.key]}/5</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="faint review-card-no-ratings">No category ratings — comment only.</p>
      )}

      <p className="review-card-body">{review.body}</p>

      <footer className="review-card-footer">
        <button
          type="button"
          className={`review-vote-btn ${myVote === 1 ? "review-vote-active-up" : ""}`}
          onClick={() => vote(1)}
          aria-pressed={myVote === 1}
        >
          ▲ {upvotes}
        </button>
        <button
          type="button"
          className={`review-vote-btn ${myVote === -1 ? "review-vote-active-down" : ""}`}
          onClick={() => vote(-1)}
          aria-pressed={myVote === -1}
        >
          ▼ {downvotes}
        </button>

        {review.isMine && (
          <div className="review-card-owner-actions">
            {confirmingDelete ? (
              <>
                <span className="faint">
                  {deleteState === "error" ? "Couldn't delete — try again?" : "Delete this review?"}
                </span>
                <button
                  type="button"
                  className="review-card-delete-confirm"
                  onClick={handleDelete}
                  disabled={deleteState === "deleting"}
                >
                  {deleteState === "deleting" ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  type="button"
                  className="review-card-delete-cancel"
                  onClick={() => {
                    setConfirmingDelete(false);
                    setDeleteState("idle");
                  }}
                  disabled={deleteState === "deleting"}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                {onEdit && (
                  <button type="button" className="review-card-edit-btn" onClick={() => onEdit(review)}>
                    Edit
                  </button>
                )}
                <button type="button" className="review-card-delete-btn" onClick={() => setConfirmingDelete(true)}>
                  Delete
                </button>
              </>
            )}
          </div>
        )}
      </footer>
    </article>
  );
}
